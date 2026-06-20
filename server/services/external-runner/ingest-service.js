// @ts-check

import { ExternalRunnerContractError } from './contract-schema.js';
import { EveRuntimeAdapter } from './eve-runtime-adapter.js';

function stableValue(value) {
    if (Array.isArray(value)) return value.map((item) => stableValue(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, stableValue(value[key])]));
}

function stableString(value) {
    return JSON.stringify(stableValue(value));
}

function normalizeRefKey(value) {
    return String(value || '').toLowerCase().replace(/_/g, '-').replace(/-/g, '');
}

function projectExpectedShape(actual, expected) {
    if (Array.isArray(expected)) {
        if (!Array.isArray(actual)) return actual;
        return expected.map((item, index) => projectExpectedShape(actual[index], item));
    }
    if (!expected || typeof expected !== 'object') return actual;
    const source = actual && typeof actual === 'object' ? actual : {};
    return Object.fromEntries(Object.keys(expected)
        .filter((key) => expected[key] !== undefined)
        .sort()
        .map((key) => [key, projectExpectedShape(source[key], expected[key])]));
}

function sortComparableList(items) {
    return [...items].sort((a, b) => stableString(a).localeCompare(stableString(b)));
}

export class ExternalRunnerIngestService {
    constructor({ workflowRepository, candidateRepository = null, adapter = new EveRuntimeAdapter() }) {
        this.workflowRepository = workflowRepository;
        this.candidateRepository = candidateRepository;
        this.adapter = adapter;
    }

    async ingest(payload) {
        const normalized = this.adapter.normalize(payload);
        this._validateLoopControlRefs(normalized);
        this._validateOrgReferenceBoundary(normalized);
        const existingRun = this.workflowRepository.getRun(normalized.run.id);
        if (existingRun) {
            this._assertCompleteDuplicate(existingRun, normalized);
            this._writeDuplicateReplayAudit(existingRun, normalized);
            return {
                status: 'duplicate',
                run: existingRun,
                workflow: this.workflowRepository.getWorkflow(existingRun.workflow_id),
                context_snapshots: this.workflowRepository.listContextSnapshots(existingRun.id),
                human_steps: this.workflowRepository.listHumanSteps(existingRun.id),
                outputs: this.workflowRepository.listOutputs(existingRun.id),
                audit_logs: this.workflowRepository.listAuditLogs({ targetId: existingRun.id }),
                learning_candidates: this._listPersistedLearningCandidates(existingRun.id)
            };
        }

        const existingWorkflow = this.workflowRepository.getWorkflow(normalized.workflow.id);
        this._assertExistingWorkflowCompatible(existingWorkflow, normalized.run);
        const write = async () => {
            const workflow = existingWorkflow || this.workflowRepository.upsertWorkflow(normalized.workflow);
            const run = this.workflowRepository.createRun(normalized.run);
            const contextSnapshots = normalized.contextSnapshots.map((snapshot) => (
                this.workflowRepository.createContextSnapshot(snapshot)
            ));
            const humanSteps = normalized.humanSteps.map((step) => (
                this.workflowRepository.createHumanStep(step)
            ));
            const outputs = normalized.outputs.map((output) => (
                this.workflowRepository.createOutput(output)
            ));
            normalized.auditEvents.forEach((entry) => (
                this.workflowRepository.writeAuditLog(entry)
            ));
            const learningCandidates = await this._storeLearningCandidates(normalized);
            const auditLogs = this.workflowRepository.listAuditLogs({ targetId: run.id });

            return {
                status: 'created',
                workflow,
                run,
                context_snapshots: contextSnapshots,
                human_steps: humanSteps,
                outputs,
                audit_logs: auditLogs,
                learning_candidates: learningCandidates
            };
        };
        if (typeof this.workflowRepository.transaction === 'function') {
            return this.workflowRepository.transaction(write);
        }
        return write();
    }

    _assertExistingWorkflowCompatible(existingWorkflow, run) {
        if (!existingWorkflow) return;
        if (existingWorkflow.project_id !== run.project_id) {
            throw new ExternalRunnerContractError(
                'workflow_project_mismatch',
                `workflow_id '${existingWorkflow.id}' belongs to project '${existingWorkflow.project_id}'`,
                {
                    workflow_id: existingWorkflow.id,
                    workflow_project_id: existingWorkflow.project_id,
                    run_project_id: run.project_id
                }
            );
        }
        if (this._hasLoopControlRefs(run) && existingWorkflow.org_id !== run.org_id) {
            throw new ExternalRunnerContractError(
                'workflow_org_mismatch',
                `workflow_id '${existingWorkflow.id}' belongs to org '${existingWorkflow.org_id || null}'`,
                {
                    workflow_id: existingWorkflow.id,
                    workflow_org_id: existingWorkflow.org_id || null,
                    run_org_id: run.org_id
                }
            );
        }
    }

    _assertCompleteDuplicate(existingRun, normalized) {
        const contextSnapshots = this.workflowRepository.listContextSnapshots(existingRun.id);
        const humanSteps = this.workflowRepository.listHumanSteps(existingRun.id);
        const outputs = this.workflowRepository.listOutputs(existingRun.id);
        const auditLogs = this.workflowRepository.listAuditLogs({ targetId: existingRun.id, limit: 1000 });
        const learningCandidates = this._listPersistedLearningCandidates(existingRun.id);
        const hasIngestAudit = auditLogs.some((entry) => entry.action === 'external_runner.ingested');
        const missing = [];
        if (contextSnapshots.length < normalized.contextSnapshots.length) missing.push('context_snapshots');
        if (humanSteps.length < normalized.humanSteps.length) missing.push('human_steps');
        if (outputs.length < normalized.outputs.length) missing.push('outputs');
        if (!hasIngestAudit) missing.push('audit_logs');
        if (learningCandidates.length < normalized.learningCandidates.length) missing.push('learning_candidates');
        if (missing.length > 0) {
            throw new ExternalRunnerContractError(
                'partial_ingest_state',
                `existing workflow_run '${existingRun.id}' is missing persisted surfaces: ${missing.join(', ')}`,
                {
                    workflow_run_id: existingRun.id,
                    missing
                }
            );
        }
        this._assertDuplicatePayloadMatches(existingRun, normalized, {
            contextSnapshots,
            humanSteps,
            outputs,
            auditLogs,
            learningCandidates
        });
    }

    _writeDuplicateReplayAudit(existingRun, normalized) {
        this.workflowRepository.writeAuditLog({
            workspace_id: existingRun.workspace_id,
            org_id: existingRun.org_id || normalized.run.org_id || null,
            project_id: existingRun.project_id,
            actor_id: normalized.run.actor_id,
            action: 'external_runner.duplicate_replay_ignored',
            target_type: 'workflow_run',
            target_id: existingRun.id,
            after: {
                contract_version: normalized.contractVersion,
                runner_type: normalized.runnerType,
                external_run_id: normalized.run.metadata?.runner?.external_run_id || null,
                reason: 'idempotent_duplicate',
                original_run_id: existingRun.id
            }
        });
    }

    _assertDuplicatePayloadMatches(existingRun, normalized, persisted) {
        this._assertComparableSurface('run', existingRun, this._runDuplicateShape(normalized.run), existingRun.id);
        this._assertComparableSurface('context_snapshots', persisted.contextSnapshots, normalized.contextSnapshots, existingRun.id);
        this._assertComparableSurface('human_steps', persisted.humanSteps, normalized.humanSteps, existingRun.id);
        this._assertComparableSurface('outputs', persisted.outputs, normalized.outputs, existingRun.id);
        this._assertExactListSurface('audit_logs', this._auditDuplicateShape(persisted.auditLogs, normalized.auditEvents), normalized.auditEvents.map((entry) => ({
            action: entry.action,
            after: entry.after
        })), existingRun.id);
        this._assertComparableSurface('learning_candidates', persisted.learningCandidates, normalized.learningCandidates, existingRun.id);
    }

    _runDuplicateShape(run) {
        const {
            started_at: _startedAt,
            finished_at: _finishedAt,
            ...stableRun
        } = run;
        return stableRun;
    }

    _auditDuplicateShape(auditLogs, expectedAuditEvents) {
        const expectedActions = new Set(expectedAuditEvents.map((entry) => entry.action));
        return auditLogs
            .filter((entry) => expectedActions.has(entry.action))
            .map((entry) => ({
                action: entry.action,
                after: entry.after
            }));
    }

    _assertComparableSurface(surface, actual, expected, runId) {
        if (Array.isArray(expected) && (!Array.isArray(actual) || actual.length !== expected.length)) {
            throw new ExternalRunnerContractError(
                'duplicate_payload_mismatch',
                `existing workflow_run '${runId}' duplicate replay differs on ${surface}`,
                {
                    workflow_run_id: runId,
                    surface,
                    expected_count: expected.length,
                    actual_count: Array.isArray(actual) ? actual.length : null
                }
            );
        }
        const comparableActual = Array.isArray(expected)
            ? sortComparableList(projectExpectedShape(actual, expected))
            : projectExpectedShape(actual, expected);
        const comparableExpected = Array.isArray(expected)
            ? sortComparableList(expected)
            : expected;
        if (stableString(comparableActual) === stableString(comparableExpected)) return;
        throw new ExternalRunnerContractError(
            'duplicate_payload_mismatch',
            `existing workflow_run '${runId}' duplicate replay differs on ${surface}`,
            {
                workflow_run_id: runId,
                surface,
                expected: comparableExpected,
                actual: comparableActual
            }
        );
    }

    _assertExactListSurface(surface, actual, expected, runId) {
        if (!Array.isArray(actual) || actual.length !== expected.length) {
            throw new ExternalRunnerContractError(
                'duplicate_payload_mismatch',
                `existing workflow_run '${runId}' duplicate replay differs on ${surface}`,
                {
                    workflow_run_id: runId,
                    surface,
                    expected_count: expected.length,
                    actual_count: Array.isArray(actual) ? actual.length : null
                }
            );
        }
        const comparableActual = sortComparableList(actual);
        const comparableExpected = sortComparableList(expected);
        if (stableString(comparableActual) === stableString(comparableExpected)) return;
        throw new ExternalRunnerContractError(
            'duplicate_payload_mismatch',
            `existing workflow_run '${runId}' duplicate replay differs on ${surface}`,
            {
                workflow_run_id: runId,
                surface,
                expected: comparableExpected,
                actual: comparableActual
            }
        );
    }

    _validateLoopControlRefs(normalized) {
        const { run } = normalized;
        const refs = {
            role_agent_instance_id: run.role_agent_instance_id,
            workflow_template_id: run.workflow_template_id,
            workflow_binding_id: run.workflow_binding_id,
            trigger_id: run.trigger_id,
            loop_intent_id: run.loop_intent_id
        };
        if (!this._hasLoopControlRefs(run)) return;
        if (!run.org_id) {
            throw new ExternalRunnerContractError(
                'missing_org_id_for_loop_ref',
                'run.org_id is required when loop control reference ids are provided'
            );
        }

        const roleAgent = refs.role_agent_instance_id
            ? this._requireControlRef('role_agent_instance', refs.role_agent_instance_id, 'getRoleAgentInstance')
            : null;
        const template = refs.workflow_template_id
            ? this._requireControlRef('workflow_template', refs.workflow_template_id, 'getWorkflowTemplate')
            : null;
        const binding = refs.workflow_binding_id
            ? this._requireControlRef('workflow_binding', refs.workflow_binding_id, 'getWorkflowBinding')
            : null;
        const trigger = refs.trigger_id
            ? this._requireControlRef('workflow_trigger', refs.trigger_id, 'getWorkflowTrigger')
            : null;
        const loopIntent = refs.loop_intent_id
            ? this._requireControlRef('loop_intent', refs.loop_intent_id, 'getLoopIntent')
            : null;

        if (roleAgent) this._assertRefScope('role_agent_instance', roleAgent, run);
        if (template) this._assertRefScope('workflow_template', template, run, { allowGlobalOrg: true, allowGlobalProject: true });
        if (binding) this._assertRefScope('workflow_binding', binding, run);
        if (trigger) this._assertRefScope('workflow_trigger', trigger, run);
        if (loopIntent) this._assertRefScope('loop_intent', loopIntent, run);

        const lineageBinding = binding
            || (loopIntent?.workflow_binding_id ? this._requireControlRef('workflow_binding', loopIntent.workflow_binding_id, 'getWorkflowBinding') : null)
            || (trigger?.workflow_binding_id ? this._requireControlRef('workflow_binding', trigger.workflow_binding_id, 'getWorkflowBinding') : null);
        if (lineageBinding) this._assertRefScope('workflow_binding', lineageBinding, run);
        const lineageRoleAgent = roleAgent
            || (lineageBinding?.role_agent_instance_id ? this._requireControlRef('role_agent_instance', lineageBinding.role_agent_instance_id, 'getRoleAgentInstance') : null);
        if (lineageRoleAgent) this._assertRefScope('role_agent_instance', lineageRoleAgent, run);
        const lineageTemplate = template
            || (lineageBinding?.workflow_template_id ? this._requireControlRef('workflow_template', lineageBinding.workflow_template_id, 'getWorkflowTemplate') : null);
        if (lineageTemplate) this._assertRefScope('workflow_template', lineageTemplate, run, { allowGlobalOrg: true, allowGlobalProject: true });
        const lineageTrigger = trigger
            || (loopIntent?.trigger_id ? this._requireControlRef('workflow_trigger', loopIntent.trigger_id, 'getWorkflowTrigger') : null);
        if (lineageTrigger) this._assertRefScope('workflow_trigger', lineageTrigger, run);
        if (lineageTrigger?.trigger_type) {
            run.trigger_type = lineageTrigger.trigger_type;
            run.metadata = {
                ...(run.metadata || {}),
                trigger_type: lineageTrigger.trigger_type
            };
        }

        if (lineageBinding && lineageRoleAgent && lineageBinding.role_agent_instance_id !== lineageRoleAgent.id) {
            this._throwControlRefMismatch('workflow_binding', lineageBinding.id, 'role_agent_instance_id', lineageBinding.role_agent_instance_id, lineageRoleAgent.id);
        }
        if (lineageBinding && lineageTemplate && lineageBinding.workflow_template_id !== lineageTemplate.id) {
            this._throwControlRefMismatch('workflow_binding', lineageBinding.id, 'workflow_template_id', lineageBinding.workflow_template_id, lineageTemplate.id);
        }
        if (lineageTrigger && lineageBinding && lineageTrigger.workflow_binding_id !== lineageBinding.id) {
            this._throwControlRefMismatch('workflow_trigger', lineageTrigger.id, 'workflow_binding_id', lineageTrigger.workflow_binding_id, lineageBinding.id);
        }
        if (loopIntent && lineageBinding && loopIntent.workflow_binding_id !== lineageBinding.id) {
            this._throwControlRefMismatch('loop_intent', loopIntent.id, 'workflow_binding_id', loopIntent.workflow_binding_id, lineageBinding.id);
        }
        if (loopIntent && lineageTrigger && loopIntent.trigger_id !== lineageTrigger.id) {
            this._throwControlRefMismatch('loop_intent', loopIntent.id, 'trigger_id', loopIntent.trigger_id, lineageTrigger.id);
        }
    }

    _validateOrgReferenceBoundary(normalized) {
        const { run } = normalized;
        if (!run.org_id || this._hasLoopControlRefs(run)) return;
        if (normalizeRefKey(run.org_id) === normalizeRefKey(run.project_id)) return;
        throw new ExternalRunnerContractError(
            'unknown_org_reference',
            `run.org_id '${run.org_id}' is not backed by loop-control refs and does not match project_id '${run.project_id}'`,
            {
                org_id: run.org_id,
                project_id: run.project_id
            }
        );
    }

    _hasLoopControlRefs(run) {
        return Boolean(
            run.role_agent_instance_id
            || run.workflow_template_id
            || run.workflow_binding_id
            || run.trigger_id
            || run.loop_intent_id
        );
    }

    _requireControlRef(type, id, getterName) {
        if (typeof this.workflowRepository[getterName] !== 'function') {
            throw new ExternalRunnerContractError('unsupported_loop_ref_validation', `${type} validation is not supported by the workflow repository`);
        }
        const item = this.workflowRepository[getterName](id);
        if (!item) {
            throw new ExternalRunnerContractError(
                'unknown_loop_control_ref',
                `${type} '${id}' not found`,
                { type, id }
            );
        }
        return item;
    }

    _assertRefScope(type, item, run, { allowGlobalOrg = false, allowGlobalProject = false } = {}) {
        if (!allowGlobalOrg && !item.org_id) {
            throw new ExternalRunnerContractError(
                'loop_control_ref_scope_mismatch',
                `${type} '${item.id}' must carry org_id`,
                { type, id: item.id, expected_org_id: run.org_id, actual_org_id: null }
            );
        }
        if (item.org_id && item.org_id !== run.org_id) {
            throw new ExternalRunnerContractError(
                'loop_control_ref_scope_mismatch',
                `${type} '${item.id}' belongs to org '${item.org_id}'`,
                { type, id: item.id, expected_org_id: run.org_id, actual_org_id: item.org_id }
            );
        }
        if (!allowGlobalProject || item.project_id) {
            if (item.project_id !== run.project_id) {
                throw new ExternalRunnerContractError(
                    'loop_control_ref_scope_mismatch',
                    `${type} '${item.id}' belongs to project '${item.project_id}'`,
                    { type, id: item.id, expected_project_id: run.project_id, actual_project_id: item.project_id }
                );
            }
        }
    }

    _throwControlRefMismatch(type, id, field, actual, expected) {
        throw new ExternalRunnerContractError(
            'loop_control_ref_relationship_mismatch',
            `${type} '${id}' has ${field}='${actual}', expected '${expected}'`,
            { type, id, field, actual, expected }
        );
    }

    async _storeLearningCandidates(normalized) {
        if (normalized.learningCandidates.length === 0) return [];
        const createCandidate = this._resolveCandidateCreate();
        if (!createCandidate) {
            return normalized.learningCandidates.map((candidate) => (
                this._writeDeferredLearningCandidateAudit(candidate, normalized, {
                    reason: 'candidate_store_unavailable'
                })
            ));
        }

        const stored = [];
        for (const candidate of normalized.learningCandidates) {
            try {
                const storedCandidate = await createCandidate(this._toCandidateStoreInput(candidate, normalized));
                this._writeStoredLearningCandidateAudit(candidate, storedCandidate, normalized);
                stored.push(storedCandidate);
            } catch (error) {
                const deferred = this._writeDeferredLearningCandidateAudit(candidate, normalized, {
                    reason: 'candidate_store_write_failed',
                    error: error instanceof Error ? error.message : String(error)
                });
                stored.push(deferred);
            }
        }
        return stored;
    }

    _writeStoredLearningCandidateAudit(candidate, storedCandidate, normalized) {
        this.workflowRepository.writeAuditLog({
            workspace_id: normalized.run.workspace_id,
            org_id: normalized.run.org_id || null,
            project_id: normalized.run.project_id,
            actor_id: normalized.run.actor_id,
            action: 'external_runner.learning_candidate.stored',
            target_type: 'workflow_run',
            target_id: normalized.run.id,
            after: {
                ...candidate,
                stored_candidate_id: storedCandidate?.id || candidate.candidate_id,
                persistence_status: 'stored'
            }
        });
    }

    _writeDeferredLearningCandidateAudit(candidate, normalized, metadata = {}) {
        this.workflowRepository.writeAuditLog({
            workspace_id: normalized.run.workspace_id,
            org_id: normalized.run.org_id || null,
            project_id: normalized.run.project_id,
            actor_id: normalized.run.actor_id,
            action: 'external_runner.learning_candidate.deferred',
            target_type: 'workflow_run',
            target_id: normalized.run.id,
            after: {
                ...candidate,
                persistence_status: 'deferred',
                ...metadata
            }
        });
        return {
            ...candidate,
            persistence_status: 'deferred',
            ...metadata
        };
    }

    _listPersistedLearningCandidates(runId) {
        return this.workflowRepository
            .listAuditLogs({ targetId: runId, limit: 1000 })
            .filter((entry) => [
                'external_runner.learning_candidate.deferred',
                'external_runner.learning_candidate.stored'
            ].includes(entry.action))
            .map((entry) => entry.after)
            .filter(Boolean);
    }

    _resolveCandidateCreate() {
        if (!this.candidateRepository) return null;
        if (typeof this.candidateRepository.createCandidate === 'function') {
            return (candidate) => this.candidateRepository.createCandidate(candidate);
        }
        if (typeof this.candidateRepository.create === 'function') {
            return (candidate) => this.candidateRepository.create(candidate);
        }
        return null;
    }

    _toCandidateStoreInput(candidate, normalized) {
        const loopControl = normalized.run.metadata?.loop_control || {};
        const loopRefs = {
            org_id: normalized.run.org_id,
            role_agent_instance_id: normalized.run.role_agent_instance_id || null,
            workflow_template_id: normalized.run.workflow_template_id || null,
            workflow_binding_id: normalized.run.workflow_binding_id || null,
            trigger_id: normalized.run.trigger_id || null,
            loop_intent_id: normalized.run.loop_intent_id || null
        };
        return {
            id: candidate.id || candidate.candidate_id,
            cognitive_type: candidate.cognitive_type,
            owner_person_id: candidate.owner_person_id || loopControl.owner_id,
            actor_person_id: candidate.actor_person_id || normalized.run.actor_id,
            source_system: candidate.source_system || 'external_runner',
            source_event_ids: candidate.source_event_ids || [normalized.externalRunId, candidate.candidate_id].filter(Boolean),
            workspace: candidate.workspace || normalized.run.workspace_id || 'default',
            project_code: normalized.run.project_id,
            org_ids: normalized.run.org_id ? [normalized.run.org_id] : [],
            project_ids: [normalized.run.project_id].filter(Boolean),
            visibility: candidate.visibility || 'owner',
            sensitivity: candidate.sensitivity || 'internal',
            role_min: candidate.role_min || 'member',
            agency_level: candidate.agency_level || 'synthesize',
            recommended_subject_type: candidate.recommended_subject_type || null,
            recommended_owner_person_id: candidate.recommended_owner_person_id || loopControl.owner_id || null,
            promotion_status: 'candidate',
            requires_approval: true,
            permission_snapshot: candidate.permission_snapshot || {
                source: 'external_runner',
                workflow_run_id: normalized.run.id,
                ...loopRefs,
                evidence_refs: candidate.evidence_refs || []
            },
            evidence_ids: candidate.evidence_ids || candidate.evidence_refs || [],
            body: candidate.body,
            redaction_status: candidate.redaction_status || 'not_required',
            confidence: candidate.confidence || null,
            expires_at: candidate.expires_at || null
        };
    }
}
