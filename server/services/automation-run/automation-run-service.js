// @ts-check

import crypto from 'node:crypto';

import { AppError } from '../../lib/errors.js';
import { PostgresWorkflowCheckpointRepository } from '../workflow/workflow-checkpoint-repository.js';

const MEETING_REVIEW_PACKAGE_INGEST_IMPLEMENTATION_KEY = 'meeting-review-package-ingest';
const AGENT_REPORT_INGEST_IMPLEMENTATION_KEY = 'external-runner:agent_report';
const CANONICAL_TASK_DECISION_RESOLUTIONS = Object.freeze({
    approve: 'approved',
    requestChanges: 'needs_changes',
    reject: 'rejected'
});
const CANONICAL_TASK_RESOLUTION_ALIASES = Object.freeze({
    approve: 'approved',
    approved: 'approved',
    requestChanges: 'needs_changes',
    needs_changes: 'needs_changes',
    reject: 'rejected',
    rejected: 'rejected'
});

function canonicalTaskApprovalError(message, details = {}) {
    const error = AppError.validation(message, details);
    error.code = 'inconsistent_approval_decision';
    error.status = 422;
    error.statusCode = 422;
    return error;
}

function canonicalJson(value) {
    if (Array.isArray(value)) return value.map(canonicalJson);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
    }
    return value;
}

function stableJson(value) {
    return JSON.stringify(canonicalJson(value));
}

function sortedRefs(value) {
    return Array.isArray(value)
        ? value.map(canonicalJson).sort((left, right) => stableJson(left).localeCompare(stableJson(right)))
        : [];
}

function normalizeCanonicalTaskCandidateSet(output) {
    if (!output || !Array.isArray(output.payload)) return output;
    const candidates = output.payload.map((rawCandidate) => {
        const source = rawCandidate && typeof rawCandidate === 'object' && !Array.isArray(rawCandidate)
            ? { ...rawCandidate }
            : { title: typeof rawCandidate === 'string' ? rawCandidate : '' };
        const title = typeof source.title === 'string' ? source.title.trim() : '';
        const description = typeof source.description === 'string' ? source.description.trim() : (source.description ?? null);
        const selectedOwnerId = source.assignee_person_id || source.selected_owner_id || null;
        const evidenceRefs = sortedRefs(source.evidence_refs);
        const sourceRefs = sortedRefs(source.source_refs);
        const contentHash = crypto.createHash('sha256').update(stableJson({
            title,
            description,
            assignee_person_id: selectedOwnerId,
            owner_state: selectedOwnerId ? 'resolved' : (source.owner_resolution?.status || 'unresolved'),
            priority: source.priority || 'medium',
            due_at: source.due_at || null,
            source_refs: [...sourceRefs, ...evidenceRefs].sort((left, right) => stableJson(left).localeCompare(stableJson(right)))
        })).digest('hex');
        return {
            ...source,
            title,
            description,
            ...(evidenceRefs.length ? { evidence_refs: evidenceRefs } : {}),
            ...(sourceRefs.length ? { source_refs: sourceRefs } : {}),
            ...(!selectedOwnerId && !source.owner_resolution
                ? { owner_resolution: { status: 'unresolved', reason: 'owner_selection_required' } }
                : {}),
            __content_hash: contentHash
        };
    });
    const ordinals = new Map();
    const normalized = candidates.map((candidate) => {
        const ordinal = (ordinals.get(candidate.__content_hash) || 0) + 1;
        ordinals.set(candidate.__content_hash, ordinal);
        const explicitId = typeof candidate.candidate_id === 'string' && candidate.candidate_id.trim()
            ? candidate.candidate_id.trim()
            : (typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.trim() : null);
        const { __content_hash: contentHash, ...projected } = candidate;
        return {
            ...projected,
            candidate_id: explicitId || `workflow-output:${output.id}:candidate:${contentHash}:${ordinal}`
        };
    }).sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
    if (new Set(normalized.map((candidate) => candidate.candidate_id)).size !== normalized.length) {
        throw canonicalTaskApprovalError('Canonical Task candidate IDs must be unique', {
            field: 'output.payload.candidate_id'
        });
    }
    return { ...output, payload: normalized };
}

function canonicalTaskDecision({ decisionMode, resolution, field }) {
    const byMode = decisionMode == null ? null : CANONICAL_TASK_DECISION_RESOLUTIONS[decisionMode];
    const byResolution = resolution == null ? null : CANONICAL_TASK_RESOLUTION_ALIASES[String(resolution)];
    if ((decisionMode != null && !byMode) || (resolution != null && !byResolution) || (byMode && byResolution && byMode !== byResolution)) {
        throw canonicalTaskApprovalError(`Canonical Task approval decision is inconsistent at '${field}'`, { field });
    }
    return byMode || byResolution;
}

function assertWorkflowRunAllowed(workflow) {
    if (workflow?.implementation_key === MEETING_REVIEW_PACKAGE_INGEST_IMPLEMENTATION_KEY) {
        throw AppError.validation('meeting-review-package-ingest workflows cannot be manually run; use /api/workflows/control/meeting-pack/review-ingest');
    }
}

function isMeetingReviewPackageWorkflow(workflow) {
    return workflow?.implementation_key === MEETING_REVIEW_PACKAGE_INGEST_IMPLEMENTATION_KEY;
}

function isAgentReportWorkflow(workflow) {
    return workflow?.implementation_key === AGENT_REPORT_INGEST_IMPLEMENTATION_KEY;
}

function isApprovalOnlyIngestWorkflow(workflow) {
    return isMeetingReviewPackageWorkflow(workflow) || isAgentReportWorkflow(workflow);
}

function isRunReceiptWorkflow(workflow) {
    return Boolean(workflow?.metadata?.run_receipt || workflow?.metadata?.surface === 'run_receipt');
}

function isRunReceiptRun(run) {
    return Boolean(run?.metadata?.run_receipt);
}

function isApprovedHumanResolution(status) {
    return ['approved', 'approve'].includes(String(status || '').toLowerCase());
}

function isPendingHumanStepStatus(status) {
    return String(status || '').toLowerCase() === 'pending';
}

function isRejectedHumanStepStatus(status) {
    return ['rejected', 'reject', 'cancelled', 'canceled', 'declined'].includes(String(status || '').toLowerCase());
}

export class AutomationRunService {
    constructor({
        repository,
        runner,
        ensureDefaultWorkflows = async () => {},
        prepareProjectAccess = async () => {},
        assertProjectSelectable = async () => {},
        assertProjectAccess = () => {},
        assertHumanStepAccess = () => {},
        canonicalTaskService = null,
        checkpointRepository = null,
        companyAuthorityHumanApprovalService = null
    }) {
        this.repository = repository;
        this.runner = runner;
        this.ensureDefaultWorkflows = ensureDefaultWorkflows;
        this.prepareProjectAccess = prepareProjectAccess;
        this.assertProjectSelectable = assertProjectSelectable;
        this.assertProjectAccess = assertProjectAccess;
        this.assertHumanStepAccess = assertHumanStepAccess;
        this.canonicalTaskService = canonicalTaskService;
        this.companyAuthorityHumanApprovalService = companyAuthorityHumanApprovalService;
        const operationRepository = canonicalTaskService?.operationRepository || null;
        this.checkpointRepository = checkpointRepository
            || (operationRepository?.pool && operationRepository?.writerToken
                ? new PostgresWorkflowCheckpointRepository({ operationRepository })
                : null);
        this.canonicalTaskCheckpointInFlight = new Map();
        this.canonicalTaskCheckpointStartupError = null;
        this.canonicalTaskCheckpointStartup = this.checkpointRepository
            ? Promise.resolve()
                .then(() => this._reconcileCanonicalTaskCheckpoints({ completePrepared: false, markCompleted: false }))
                .catch((error) => {
                    this.canonicalTaskCheckpointStartupError = error;
                })
            : Promise.resolve();
    }

    async runWorkflow(workflowId, options = {}) {
        const actor = {
            sub: options.actorId,
            person_id: options.actorId,
            projectCodes: options.projectCodes || [],
            role: options.role,
            authSource: options.authSource,
            organizationId: options.organizationId || options.organization_id || options.tenantId || null
        };
        await this.ensureDefaultWorkflows();
        await this.prepareProjectAccess(actor);
        const workflow = this.repository.getWorkflow(workflowId);
        if (!workflow) throw AppError.notFound('workflow', workflowId);
        if (isRunReceiptWorkflow(workflow)) throw AppError.notFound('workflow', workflowId);
        await this.assertProjectSelectable(workflow.project_id, actor);
        this.assertProjectAccess(workflow.project_id, actor);
        if (workflow.enabled === false) {
            throw AppError.validation(`workflow '${workflowId}' is disabled`);
        }
        assertWorkflowRunAllowed(workflow);
        return this.runner.runWorkflow(workflow, options);
    }

    async rerun(runId, options = {}, actor = {}) {
        await this.prepareProjectAccess(actor);
        const previous = this.repository.getRun(runId);
        if (!previous) throw AppError.notFound('workflow_run', runId);
        if (isRunReceiptRun(previous)) throw AppError.notFound('workflow_run', runId);
        this.assertProjectAccess(previous.project_id, actor);
        const workflow = this.repository.getWorkflow(previous.workflow_id);
        assertWorkflowRunAllowed(workflow);
        return this.runWorkflow(previous.workflow_id, {
            ...options,
            projectCodes: actor.projectCodes || [],
            role: actor.role,
            authSource: actor.authSource,
            organizationId: actor.organizationId || actor.organization_id || actor.tenantId || null,
            parentRunId: runId,
            triggerType: 'retry',
            env: previous.env
        });
    }

    async getRun(runId, actor = {}) {
        await this._reconcileCanonicalTaskCheckpoints({ runId });
        await this.prepareProjectAccess(actor);
        const run = this.repository.getRun(runId);
        if (!run) throw AppError.notFound('workflow_run', runId);
        if (isRunReceiptRun(run)) throw AppError.notFound('workflow_run', runId);
        this.assertProjectAccess(run.project_id, actor);
        return {
            run,
            run_steps: this.repository.listRunSteps(runId),
            context_snapshots: this.repository.listContextSnapshots(runId),
            human_steps: this.repository.listHumanSteps(runId),
            outputs: this.repository.listOutputs(runId),
            audit_logs: this.repository.listAuditLogs({ targetId: runId })
        };
    }

    _isCanonicalTaskHumanStep(step) {
        return step?.metadata?.write_back_target === 'task_store' || step?.write_back_target === 'task_store';
    }

    _canonicalTaskOutput(step) {
        const outputs = this.repository.listOutputs(step.workflow_run_id);
        const outputId = step?.metadata?.output_id || null;
        return normalizeCanonicalTaskCandidateSet(
            outputs.find((candidate) => candidate.id === outputId)
            || outputs.find((candidate) => candidate?.metadata?.write_back_target === 'task_store')
            || null
        );
    }

    _canonicalTaskApprovalInput(step, input = {}) {
        const output = this._canonicalTaskOutput(step);
        if (!output) return input;
        const rawResponseRef = input.response_ref || input.responseRef || null;
        if (rawResponseRef != null && (typeof rawResponseRef !== 'object' || Array.isArray(rawResponseRef))) {
            throw canonicalTaskApprovalError('Canonical Task approval response_ref must be an object', { field: 'response_ref' });
        }
        const responseRef = rawResponseRef ? { ...rawResponseRef } : null;
        const inputResolution = input.resolution == null && input.status == null
            ? null
            : canonicalTaskDecision({ resolution: input.resolution || input.status, field: 'resolution' });
        const responseResolution = responseRef
            ? canonicalTaskDecision({
                decisionMode: responseRef.decision_mode,
                resolution: responseRef.resolution,
                field: 'response_ref'
            })
            : null;
        let aggregateResolution = null;
        if (responseRef && Object.prototype.hasOwnProperty.call(responseRef, 'review_items')) {
            if (!Array.isArray(responseRef.review_items)) {
                throw canonicalTaskApprovalError('Canonical Task review_items must be an array', {
                    field: 'response_ref.review_items'
                });
            }
            const candidateIds = new Set(output.payload.map((candidate) => candidate.candidate_id));
            const seen = new Set();
            responseRef.review_items = responseRef.review_items.map((item, index) => {
                const candidateId = typeof item?.candidate_id === 'string' && item.candidate_id.trim()
                    ? item.candidate_id.trim()
                    : (typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : null);
                if (!candidateId || !candidateIds.has(candidateId) || seen.has(candidateId)) {
                    throw canonicalTaskApprovalError('Canonical Task review item does not map one-to-one to a candidate', {
                        field: `response_ref.review_items[${index}].candidate_id`
                    });
                }
                seen.add(candidateId);
                const itemResolution = canonicalTaskDecision({
                    decisionMode: item.decision_mode,
                    resolution: item.resolution,
                    field: `response_ref.review_items[${index}]`
                });
                if (!itemResolution) {
                    throw canonicalTaskApprovalError('Canonical Task review item decision is required', {
                        field: `response_ref.review_items[${index}]`
                    });
                }
                return { ...item, candidate_id: candidateId, resolution: itemResolution };
            }).sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
            if (seen.size !== candidateIds.size) {
                throw canonicalTaskApprovalError('Canonical Task review items must cover every candidate', {
                    field: 'response_ref.review_items'
                });
            }
            aggregateResolution = responseRef.review_items.some((item) => item.resolution === 'needs_changes')
                ? 'needs_changes'
                : 'approved';
        }
        const declared = [inputResolution, responseResolution].filter(Boolean);
        if (new Set(declared).size > 1) {
            throw canonicalTaskApprovalError('Top-level Canonical Task approval decisions are inconsistent', {
                field: 'resolution'
            });
        }
        const declaredResolution = responseResolution || inputResolution;
        if (aggregateResolution && declaredResolution !== 'rejected' && declaredResolution && declaredResolution !== aggregateResolution) {
            throw canonicalTaskApprovalError('Candidate decisions do not match the top-level Canonical Task decision', {
                field: 'response_ref.review_items'
            });
        }
        const resolution = declaredResolution || aggregateResolution || 'approved';
        return {
            ...input,
            resolution,
            ...(responseRef ? { response_ref: { ...responseRef, resolution } } : {})
        };
    }

    async waitForCanonicalTaskCheckpointReconciliation() {
        await this.canonicalTaskCheckpointStartup;
        if (this.canonicalTaskCheckpointStartupError) throw this.canonicalTaskCheckpointStartupError;
    }

    _canonicalTaskActor(actor = {}) {
        return {
            person_id: actor.person_id || null,
            sub: actor.sub || null,
            role: actor.role || null,
            projectCodes: Array.isArray(actor.projectCodes) ? actor.projectCodes : [],
            authSource: actor.authSource || null
        };
    }

    async _materializeCanonicalTaskApproval(step, input, actor) {
        if (!this.canonicalTaskService?.materializeWorkflowApproval) {
            const error = new Error('Canonical Task materialization service is unavailable');
            error.code = 'canonical_task_service_unavailable';
            error.status = 503;
            error.statusCode = 503;
            throw error;
        }
        const output = this._canonicalTaskOutput(step);
        if (!output) {
            const error = new Error(`Task candidate output for human step '${step.id}' was not found`);
            error.code = 'task_candidate_output_not_found';
            error.status = 409;
            error.statusCode = 409;
            throw error;
        }
        return this.canonicalTaskService.materializeWorkflowApproval({
            step,
            output,
            responseRef: input.response_ref || input.responseRef || null,
            actor
        });
    }

    _withMaterialization(result, materialization) {
        return materialization ? {
            ...result,
            materialized_task_ids: materialization.task_ids || [],
            materialization
        } : result;
    }

    _withCompanyAuthorityApproval(result, approval) {
        return approval ? {
            ...result,
            company_authority_approval: {
                receipt: approval.receipt,
                consumed_at: approval.consumed_at,
                consumed_by: approval.consumed_by,
                fresh_context: approval.fresh_context
            }
        } : result;
    }

    _recordMaterialization(step, materialization, actor) {
        if (!materialization) return step;
        const auditId = `audit_canonical_task_materialization_${step.id}`;
        const existing = this.repository.listAuditLogs({ targetId: step.workflow_run_id, limit: 1000 })
            .find((entry) => entry.id === auditId);
        const persisted = this.repository.updateHumanStep(step.id, {
            canonical_task_materialization: materialization
        }) || step;
        if (!existing) {
            this.repository.writeAuditLog({
                id: auditId,
                workspace_id: step.workspace_id,
                project_id: step.project_id,
                actor_id: actor.person_id || actor.sub || 'system',
                action: 'workflow.canonical_tasks.materialized',
                target_type: 'workflow_run',
                target_id: step.workflow_run_id,
                after: {
                    human_step_id: step.id,
                    task_ids: materialization.task_ids || [],
                    status: materialization.status || 'completed'
                }
            });
        }
        return persisted;
    }

    _checkpointProjection(record, materialization) {
        const claim = record.recovery_checkpoint.human_step_claim;
        const step = claim.step;
        const workflow = this.repository.getWorkflow(step.workflow_id);
        const previousRun = this.repository.getRun(step.workflow_run_id);
        if (!isApprovalOnlyIngestWorkflow(workflow) || !previousRun) {
            throw AppError.conflict(`workflow '${step.workflow_id}' does not support durable approval-only projection`);
        }
        const humanStepTarget = {
            status: 'approved',
            response_ref: claim.response_ref,
            reason: claim.reason,
            resolved_at: claim.resolved_at,
            resolved_by: claim.resolved_by,
            canonical_task_materialization: materialization
        };
        const projected = this.repository.listHumanSteps(step.workflow_run_id)
            .map((item) => item.id === step.id ? { ...item, ...humanStepTarget } : item);
        const pending = projected.filter((item) => isPendingHumanStepStatus(item.status));
        const approved = projected.filter((item) => isApprovedHumanResolution(item.status));
        const rejected = projected.filter((item) => isRejectedHumanStepStatus(item.status));
        const allApproved = projected.length > 0 && approved.length === projected.length;
        const hasRejected = rejected.length > 0 || previousRun.status === 'cancelled';
        const label = isMeetingReviewPackageWorkflow(workflow) ? 'Meeting Review Package' : 'Agent report';
        const prefix = isMeetingReviewPackageWorkflow(workflow)
            ? 'workflow.run.meeting_review_approvals'
            : 'workflow.run.agent_report_approvals';
        const runTarget = hasRejected ? {
            status: 'cancelled',
            closure_state: 'closed',
            human_waiting: false,
            action_required: 'none',
            message: `${label} human approvals stopped after rejected gate`,
            finished_at: claim.resolved_at
        } : {
            status: allApproved ? 'success' : 'waiting_human',
            closure_state: allApproved ? 'closed' : 'open',
            human_waiting: !allApproved,
            action_required: allApproved ? 'none' : 'approve',
            message: allApproved ? `${label} human approvals completed` : `${label} is waiting for ${pending.length} human approval(s)`,
            finished_at: claim.resolved_at
        };
        const actorId = claim.actor.person_id || claim.actor.sub || 'system';
        const baseId = `canonical-task:${record.id}`;
        const audits = [
            {
                id: `${baseId}:tasks_materialized`,
                workspace_id: step.workspace_id,
                project_id: step.project_id,
                actor_id: actorId,
                action: 'workflow.canonical_tasks.materialized',
                target_type: 'workflow_run',
                target_id: step.workflow_run_id,
                after: { human_step_id: step.id, task_ids: materialization.task_ids || [], status: materialization.status || 'completed' }
            },
            {
                id: `${baseId}:human_step_approved`,
                workspace_id: step.workspace_id,
                project_id: step.project_id,
                actor_id: actorId,
                action: 'workflow.human_step.resolved',
                target_type: 'workflow_human_step',
                target_id: step.id,
                after: { ...step, ...humanStepTarget }
            },
            {
                id: `${baseId}:run_projected`,
                workspace_id: step.workspace_id,
                project_id: step.project_id,
                actor_id: actorId,
                action: hasRejected ? `${prefix}.cancelled` : allApproved ? `${prefix}.completed` : `${prefix}.progressed`,
                target_type: 'workflow_run',
                target_id: step.workflow_run_id,
                after: {
                    human_step_id: step.id,
                    approved_human_step_ids: approved.map((item) => item.id),
                    pending_human_step_ids: pending.map((item) => item.id),
                    rejected_human_step_ids: rejected.map((item) => item.id),
                    status: runTarget.status,
                    closure_state: runTarget.closure_state
                }
            }
        ];
        return {
            ...record.recovery_checkpoint,
            phase: 'tasks_materialized',
            human_step_target: humanStepTarget,
            run_target: runTarget,
            audit_checkpoint: { ids: audits.map((entry) => entry.id), entries: audits },
            post_processing_phase: 'pending'
        };
    }

    async _reconcileCheckpoint(record, { completePrepared = true, markCompleted = true } = {}) {
        const existing = this.canonicalTaskCheckpointInFlight.get(record.operation_key);
        if (existing) return existing;
        const promise = (async () => {
            let current = record;
            let materialization = current.result_json;
            const claim = current.recovery_checkpoint?.human_step_claim;
            if (!materialization && completePrepared && claim) {
                materialization = await this._materializeCanonicalTaskApproval(
                    claim.step,
                    { response_ref: claim.response_ref },
                    claim.actor
                );
                current = await this.checkpointRepository.saveMaterialization({
                    operationKey: current.operation_key,
                    fingerprint: current.fingerprint,
                    materialization,
                    recoveryCheckpoint: this._checkpointProjection(current, materialization)
                });
            }
            if (materialization && !current.recovery_checkpoint?.human_step_target && markCompleted) {
                current = await this.checkpointRepository.saveMaterialization({
                    operationKey: current.operation_key,
                    fingerprint: current.fingerprint,
                    materialization,
                    recoveryCheckpoint: this._checkpointProjection(current, materialization)
                });
            }
            if (!materialization || !current.recovery_checkpoint?.human_step_target) return null;
            const checkpoint = current.recovery_checkpoint;
            const { humanStep, run } = await this._transaction(() => {
                const resolvedHumanStep = this.repository.updateHumanStep(
                    checkpoint.human_step_id,
                    checkpoint.human_step_target
                );
                for (const audit of checkpoint.audit_checkpoint?.entries || []) {
                    this.repository.upsertAuditLog(audit);
                }
                const resumedRun = this.repository.updateRun(checkpoint.workflow_run_id, checkpoint.run_target);
                return { humanStep: resolvedHumanStep, run: resumedRun };
            });
            if (markCompleted && current.state !== 'completed') {
                await this.checkpointRepository.markCompleted({
                    operationKey: current.operation_key,
                    fingerprint: current.fingerprint,
                    recoveryCheckpoint: { ...checkpoint, phase: 'completed', post_processing_phase: 'completed' }
                });
            }
            return this._withMaterialization({ human_step: humanStep, resumed_run: run }, materialization);
        })().finally(() => this.canonicalTaskCheckpointInFlight.delete(record.operation_key));
        this.canonicalTaskCheckpointInFlight.set(record.operation_key, promise);
        return promise;
    }

    async _reconcileCanonicalTaskCheckpoints({ runId = null, humanStepId = null, completePrepared = true, markCompleted = true } = {}) {
        if (!this.checkpointRepository) return [];
        const records = await this.checkpointRepository.list({ runId, humanStepId });
        const reconciled = [];
        for (const record of records) {
            const result = await this._reconcileCheckpoint(record, { completePrepared, markCompleted });
            if (result) reconciled.push(result);
        }
        return reconciled;
    }

    async _resolveWithCheckpoint(step, input, actor) {
        const output = this._canonicalTaskOutput(step);
        if (!output) return this._materializeCanonicalTaskApproval(step, input, actor);
        const actorSnapshot = this._canonicalTaskActor(actor);
        const recoveryCheckpoint = {
            version: 1,
            phase: 'human_step_claimed',
            workflow_run_id: step.workflow_run_id,
            workflow_id: step.workflow_id,
            human_step_id: step.id,
            output_id: output.id,
            human_step_claim: {
                step,
                output,
                response_ref: input.response_ref || input.responseRef || null,
                reason: input.reason || step.reason || null,
                resolved_at: new Date().toISOString(),
                resolved_by: actorSnapshot.person_id || actorSnapshot.sub || 'system',
                actor: actorSnapshot
            },
            run_target: null,
            audit_checkpoint: { ids: [], entries: [] },
            post_processing_phase: 'not_started'
        };
        const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
            human_step_id: step.id,
            workflow_run_id: step.workflow_run_id,
            output_id: output.id,
            output_payload: output.payload,
            response_ref: recoveryCheckpoint.human_step_claim.response_ref,
            reason: recoveryCheckpoint.human_step_claim.reason,
            actor: actorSnapshot
        })).digest('hex');
        const prepared = await this.checkpointRepository.prepare({
            operationKey: `workflow:${step.id}`,
            fingerprint,
            authorizationSnapshot: actorSnapshot,
            recoveryCheckpoint
        });
        return this._reconcileCheckpoint(prepared);
    }

    async resolveHumanStep(stepId, input = {}, actor = {}) {
        await this.prepareProjectAccess(actor);
        let initialStep = this.repository.getHumanStep(stepId);
        if (!initialStep) throw AppError.notFound('workflow_human_step', stepId);
        if (input.run_id && input.run_id !== initialStep.workflow_run_id) {
            throw AppError.validation(`human step '${stepId}' does not belong to run '${input.run_id}'`);
        }
        this.assertProjectAccess(initialStep.project_id, actor);
        this.assertHumanStepAccess(initialStep, actor);
        if (this._isCanonicalTaskHumanStep(initialStep)) input = this._canonicalTaskApprovalInput(initialStep, input);
        const initialResolution = input.resolution || input.status || 'approved';
        const hasCompanyAuthorityMarker = Object.prototype.hasOwnProperty.call(
            initialStep.metadata || {},
            'company_authority_human_approval'
        );
        const companyAuthorityBound = hasCompanyAuthorityMarker
            || Boolean(this.companyAuthorityHumanApprovalService?.isBound?.(initialStep));
        if (
            companyAuthorityBound
            && initialStep.status === 'pending'
            && isApprovedHumanResolution(initialResolution)
            && !this.companyAuthorityHumanApprovalService?.resolve
        ) {
            throw new AppError(
                'Company Authority human approval service is unavailable',
                { code: 'company_authority_human_approval_unavailable', statusCode: 503 }
            );
        }
        let companyAuthorityApproval = null;
        if (
            companyAuthorityBound
            && initialStep.status === 'pending'
            && isApprovedHumanResolution(initialResolution)
        ) {
            companyAuthorityApproval = await this.companyAuthorityHumanApprovalService.resolve({
                step: initialStep,
                input,
                actor
            });
            if (!companyAuthorityApproval
                || !companyAuthorityApproval.receipt?.receipt_id
                || !companyAuthorityApproval.consumed_at
                || !companyAuthorityApproval.consumed_by
                || !companyAuthorityApproval.fresh_context) {
                throw new AppError(
                    'Company Authority human approval did not produce a valid consumed receipt',
                    { code: 'company_authority_human_approval_invalid', statusCode: 503 }
                );
            }
        }
        const shouldPrepareCanonicalTaskCheckpoint = initialStep.status === 'pending'
            && isApprovedHumanResolution(initialResolution)
            && this._isCanonicalTaskHumanStep(initialStep)
            && Boolean(this.canonicalTaskService?.materializeWorkflowApproval)
            && this.checkpointRepository
            && isApprovalOnlyIngestWorkflow(this.repository.getWorkflow(initialStep.workflow_id))
            && !companyAuthorityBound;
        if (shouldPrepareCanonicalTaskCheckpoint) {
            return this._resolveWithCheckpoint(initialStep, input, actor);
        }
        await this._reconcileCanonicalTaskCheckpoints({ humanStepId: stepId });
        initialStep = this.repository.getHumanStep(stepId);
        const resolution = initialResolution;
        const approvedResolution = isApprovedHumanResolution(resolution);
        const canonicalTaskStep = this._isCanonicalTaskHumanStep(initialStep);
        const materializationAvailable = Boolean(this.canonicalTaskService?.materializeWorkflowApproval);
        const materializationEnabled = canonicalTaskStep && materializationAvailable;
        if (initialStep.status === 'approved' && approvedResolution && this._isCanonicalTaskHumanStep(initialStep)) {
            if (!materializationEnabled && !initialStep.canonical_task_materialization) {
                throw AppError.conflict(`human step '${stepId}' is already ${initialStep.status}`);
            }
            const materialization = initialStep.canonical_task_materialization
                || await this._materializeCanonicalTaskApproval(initialStep, input, actor);
            const persisted = initialStep.canonical_task_materialization
                ? initialStep
                : this._recordMaterialization(initialStep, materialization, actor);
            return this._withMaterialization({
                human_step: persisted,
                resumed_run: this.repository.getRun(initialStep.workflow_run_id)
            }, materialization);
        }
        if (initialStep.status !== 'pending') {
            throw AppError.conflict(`human step '${stepId}' is already ${initialStep.status}`);
        }
        if (approvedResolution && canonicalTaskStep && !materializationAvailable) {
            throw new AppError(
                'Canonical Task service is unavailable',
                { code: 'task_store_unavailable', statusCode: 503 }
            );
        }
        if (resolution === 'needs_changes' && this._isCanonicalTaskHumanStep(initialStep)) {
            throw AppError.conflict('Canonical Task candidates require changes before approval', {
                human_step_id: initialStep.id,
                resolution
            });
        }
        if (
            approvedResolution
            && materializationEnabled
            && this.checkpointRepository
            && isApprovalOnlyIngestWorkflow(this.repository.getWorkflow(initialStep.workflow_id))
            && !companyAuthorityBound
        ) {
            return this._resolveWithCheckpoint(initialStep, input, actor);
        }
        const materialization = approvedResolution && materializationEnabled
            ? await this._materializeCanonicalTaskApproval(initialStep, input, actor)
            : null;
        const resolvedStatus = approvedResolution ? 'approved' : resolution;
        const mutation = await this._transaction(() => {
            const step = this.repository.getHumanStep(stepId);
            if (!step) throw AppError.notFound('workflow_human_step', stepId);
            if (step.status !== 'pending') {
                throw AppError.conflict(`human step '${stepId}' is already ${step.status}`);
            }
            const resolved = this.repository.updateHumanStep(stepId, {
                status: resolvedStatus,
                response_ref: input.response_ref || input.responseRef || null,
                reason: input.reason || step.reason || null,
                resolved_at: new Date().toISOString(),
                resolved_by: actor.person_id || actor.sub || 'system',
                ...(materialization ? { canonical_task_materialization: materialization } : {})
            });
            if (materialization) this._recordMaterialization(resolved, materialization, actor);
            this.repository.writeAuditLog({
                workspace_id: step.workspace_id,
                project_id: step.project_id,
                actor_id: actor.person_id || actor.sub || 'system',
                action: 'workflow.human_step.resolved',
                target_type: 'workflow_human_step',
                target_id: stepId,
                after: resolved
            });
            const previousRun = this.repository.getRun(step.workflow_run_id);
            const workflow = this.repository.getWorkflow(step.workflow_id);
            if (!approvedResolution) {
                const cancelledHumanStepIds = [];
                if (isApprovalOnlyIngestWorkflow(workflow)) {
                    for (const humanStep of this.repository.listHumanSteps(step.workflow_run_id)) {
                        if (humanStep.id !== stepId && isPendingHumanStepStatus(humanStep.status)) {
                            const cancelled = this.repository.updateHumanStep(humanStep.id, {
                                status: 'cancelled',
                                reason: `cancelled_after_${resolvedStatus}`,
                                resolved_at: new Date().toISOString(),
                                resolved_by: actor.person_id || actor.sub || 'system'
                            });
                            if (cancelled) cancelledHumanStepIds.push(cancelled.id);
                        }
                    }
                }
                const closedRun = previousRun
                    ? this.repository.updateRun(previousRun.id, {
                        status: 'cancelled',
                        closure_state: 'closed',
                        human_waiting: false,
                        action_required: 'none',
                        message: isMeetingReviewPackageWorkflow(workflow)
                            ? `Meeting Review Package stopped after human step ${resolvedStatus}`
                            : isAgentReportWorkflow(workflow)
                            ? `Agent report stopped after human step ${resolvedStatus}`
                            : `Human step ${resolvedStatus}`,
                        finished_at: new Date().toISOString()
                    })
                    : null;
                this.repository.writeAuditLog({
                    workspace_id: step.workspace_id,
                    project_id: step.project_id,
                    actor_id: actor.person_id || actor.sub || 'system',
                    action: 'workflow.run.human_step.cancelled',
                    target_type: 'workflow_run',
                    target_id: step.workflow_run_id,
                    after: {
                        human_step_id: stepId,
                        resolution: resolvedStatus,
                        cancelled_human_step_ids: cancelledHumanStepIds,
                        status: closedRun?.status || 'cancelled'
                    }
                });
                return {
                    terminal: this._withCompanyAuthorityApproval(
                        this._withMaterialization({ human_step: resolved, resumed_run: closedRun }, materialization),
                        companyAuthorityApproval
                    )
                };
            }
            if (isApprovalOnlyIngestWorkflow(workflow) && previousRun) {
                const approvalLabel = isMeetingReviewPackageWorkflow(workflow) ? 'Meeting Review Package' : 'Agent report';
                const auditPrefix = isMeetingReviewPackageWorkflow(workflow)
                    ? 'workflow.run.meeting_review_approvals'
                    : 'workflow.run.agent_report_approvals';
                const allHumanSteps = this.repository.listHumanSteps(step.workflow_run_id);
                const pendingHumanSteps = allHumanSteps.filter((humanStep) => isPendingHumanStepStatus(humanStep.status));
                const approvedHumanSteps = allHumanSteps.filter((humanStep) => isApprovedHumanResolution(humanStep.status));
                const rejectedHumanSteps = allHumanSteps.filter((humanStep) => isRejectedHumanStepStatus(humanStep.status));
                const allApproved = allHumanSteps.length > 0 && approvedHumanSteps.length === allHumanSteps.length;
                const hasRejectedStep = rejectedHumanSteps.length > 0 || previousRun.status === 'cancelled';
                const updatedRun = hasRejectedStep
                    ? this.repository.updateRun(previousRun.id, {
                        status: 'cancelled',
                        closure_state: 'closed',
                        human_waiting: false,
                        action_required: 'none',
                        message: `${approvalLabel} human approvals stopped after rejected gate`,
                        finished_at: new Date().toISOString()
                    })
                    : this.repository.updateRun(previousRun.id, {
                        status: allApproved ? 'success' : 'waiting_human',
                        closure_state: allApproved ? 'closed' : 'open',
                        human_waiting: !allApproved,
                        action_required: allApproved ? 'none' : 'approve',
                        message: allApproved
                            ? `${approvalLabel} human approvals completed`
                            : `${approvalLabel} is waiting for ${pendingHumanSteps.length} human approval(s)`,
                        finished_at: new Date().toISOString()
                    });
                this.repository.writeAuditLog({
                    workspace_id: step.workspace_id,
                    project_id: step.project_id,
                    actor_id: actor.person_id || actor.sub || 'system',
                    action: hasRejectedStep
                        ? `${auditPrefix}.cancelled`
                        : allApproved
                        ? `${auditPrefix}.completed`
                        : `${auditPrefix}.progressed`,
                    target_type: 'workflow_run',
                    target_id: previousRun.id,
                    after: {
                        human_step_id: stepId,
                        approved_human_step_ids: approvedHumanSteps.map((humanStep) => humanStep.id),
                        pending_human_step_ids: pendingHumanSteps.map((humanStep) => humanStep.id),
                        rejected_human_step_ids: rejectedHumanSteps.map((humanStep) => humanStep.id),
                        status: updatedRun?.status || previousRun.status,
                        closure_state: updatedRun?.closure_state || previousRun.closure_state
                    }
                });
                return {
                    terminal: this._withCompanyAuthorityApproval(
                        this._withMaterialization({ human_step: resolved, resumed_run: updatedRun }, materialization),
                        companyAuthorityApproval
                    )
                };
            }
            return { step, resolved, previousRun };
        });
        if (mutation.terminal) return mutation.terminal;
        const { step, resolved, previousRun } = mutation;
        const resume = await this.runWorkflow(step.workflow_id, {
            actorId: actor.person_id || actor.sub || 'system',
            originalRequesterId: step.requested_by || previousRun?.started_by || null,
            projectCodes: actor.projectCodes || [],
            role: actor.role,
            authSource: actor.authSource,
            organizationId: actor.organizationId || actor.organization_id || actor.tenantId || actor.tenant_id || null,
            parentRunId: step.workflow_run_id,
            triggerType: 'human_resume',
            env: previousRun?.env || 'local',
            humanStepResolution: {
                stepId,
                resolution,
                responseRef: resolved.response_ref,
                reason: resolved.reason,
                companyAuthorityApprovalReceiptId: companyAuthorityApproval?.receipt?.receipt_id || null
            }
        });
        await this._transaction(() => {
            this.repository.writeAuditLog({
                workspace_id: step.workspace_id,
                project_id: step.project_id,
                actor_id: actor.person_id || actor.sub || 'system',
                action: 'workflow.run.human_step.resumed',
                target_type: 'workflow_run',
                target_id: resume.run.id,
                after: {
                    human_step_id: stepId,
                    previous_run_id: step.workflow_run_id,
                    status: resume.run.status
                }
            });
        });
        return this._withCompanyAuthorityApproval(
            this._withMaterialization({ human_step: resolved, resumed_run: resume.run }, materialization),
            companyAuthorityApproval
        );
    }

    async _transaction(callback) {
        if (typeof this.repository.transaction === 'function') {
            return this.repository.transaction(callback);
        }
        return callback();
    }
}
