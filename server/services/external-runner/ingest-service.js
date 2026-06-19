// @ts-check

import { ExternalRunnerContractError } from './contract-schema.js';
import { EveRuntimeAdapter } from './eve-runtime-adapter.js';

export class ExternalRunnerIngestService {
    constructor({ workflowRepository, candidateRepository = null, adapter = new EveRuntimeAdapter() }) {
        this.workflowRepository = workflowRepository;
        this.candidateRepository = candidateRepository;
        this.adapter = adapter;
    }

    async ingest(payload) {
        const normalized = this.adapter.normalize(payload);
        const existingRun = this.workflowRepository.getRun(normalized.run.id);
        if (existingRun) {
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
        if (existingWorkflow && existingWorkflow.project_id !== normalized.run.project_id) {
            throw new ExternalRunnerContractError(
                'workflow_project_mismatch',
                `workflow_id '${normalized.workflow.id}' belongs to project '${existingWorkflow.project_id}'`,
                {
                    workflow_id: normalized.workflow.id,
                    workflow_project_id: existingWorkflow.project_id,
                    run_project_id: normalized.run.project_id
                }
            );
        }
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
            .listAuditLogs({ targetId: runId })
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
        return {
            id: candidate.id || candidate.candidate_id,
            cognitive_type: candidate.cognitive_type,
            owner_person_id: candidate.owner_person_id || loopControl.owner_id,
            actor_person_id: candidate.actor_person_id || normalized.run.actor_id,
            source_system: candidate.source_system || 'external_runner',
            source_event_ids: candidate.source_event_ids || [normalized.externalRunId, candidate.candidate_id].filter(Boolean),
            workspace: candidate.workspace || normalized.run.workspace_id || 'default',
            project_code: candidate.project_code || normalized.run.project_id,
            org_ids: candidate.org_ids || [],
            project_ids: candidate.project_ids || [normalized.run.project_id].filter(Boolean),
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
