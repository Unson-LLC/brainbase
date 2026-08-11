// @ts-check

import { randomUUID } from 'node:crypto';

import {
    RunReceiptContractError,
    normalizeRunReceipt
} from './contract.js';

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function fail(code, message, details = {}) {
    throw new RunReceiptContractError(code, message, details);
}

function workflowIdentity(normalized) {
    return {
        project_id: normalized.run.project_id,
        source_type: normalized.source.type,
        source_workflow_id: normalized.source.workflow_id
    };
}

function sameWorkflowIdentity(existing, normalized) {
    const identity = existing?.metadata?.run_receipt;
    const expected = workflowIdentity(normalized);
    return identity?.project_id === expected.project_id
        && identity?.source_type === expected.source_type
        && identity?.source_workflow_id === expected.source_workflow_id;
}

export class RunReceiptIngestService {
    constructor({
        workflowRepository,
        lockAcquireTimeoutMs = 5000,
        lockRetryMs = 20,
        lockTtlMs = 30000
    }) {
        this.workflowRepository = workflowRepository;
        this.lockAcquireTimeoutMs = lockAcquireTimeoutMs;
        this.lockRetryMs = lockRetryMs;
        this.lockTtlMs = lockTtlMs;
    }

    normalize(payload) {
        const normalized = normalizeRunReceipt(payload);
        return {
            ...normalized,
            lock: {
                workspace_id: `run_receipt:${normalized.run.project_id}`,
                workflow_id: normalized.identity.run_id
            }
        };
    }

    async ingest(payload) {
        const normalized = this.normalize(payload);
        this._requireRepositoryCapabilities();
        const lockedBy = `run-receipt:${randomUUID()}`;
        const lock = await this._acquireIdentityLock(normalized.lock, lockedBy);
        try {
            return await this.workflowRepository.transaction(() => this._persist(normalized));
        } finally {
            if (lock) {
                await this.workflowRepository.releaseWorkflowLock({
                    ...normalized.lock,
                    locked_by: lockedBy
                });
            }
        }
    }

    _requireRepositoryCapabilities() {
        const required = ['transaction', 'acquireWorkflowLock', 'releaseWorkflowLock'];
        const missing = required.filter((capability) => typeof this.workflowRepository?.[capability] !== 'function');
        if (missing.length > 0) {
            fail(
                'workflow_repository_capability_required',
                `run receipt ingest requires repository capabilities: ${missing.join(', ')}`,
                { missing }
            );
        }
    }

    async _acquireIdentityLock(lockIdentity, lockedBy) {
        const deadline = Date.now() + this.lockAcquireTimeoutMs;
        do {
            const lock = await this.workflowRepository.acquireWorkflowLock({
                ...lockIdentity,
                locked_by: lockedBy,
                ttl_ms: this.lockTtlMs
            });
            if (lock) return lock;
            if (Date.now() >= deadline) break;
            await sleep(Math.min(this.lockRetryMs, Math.max(deadline - Date.now(), 0)));
        } while (Date.now() <= deadline);
        fail('run_receipt_lock_timeout', 'timed out acquiring the run receipt identity lock', lockIdentity);
    }

    _persist(normalized) {
        const existingRun = this.workflowRepository.getRun(normalized.identity.run_id);
        if (existingRun) {
            const existingDigest = existingRun.metadata?.run_receipt?.payload_digest;
            if (existingDigest !== normalized.payload_digest) {
                fail('run_receipt_conflict', 'receipt identity already exists with different immutable content', {
                    run_id: normalized.identity.run_id,
                    existing_payload_digest: existingDigest || null,
                    received_payload_digest: normalized.payload_digest
                });
            }
            return {
                status: 'duplicate',
                workflow: this.workflowRepository.getWorkflow(existingRun.workflow_id),
                run: existingRun,
                audit_logs: this.workflowRepository.listAuditLogs({ targetId: existingRun.id })
            };
        }

        const existingWorkflow = this.workflowRepository.getWorkflow(normalized.identity.workflow_id);
        if (existingWorkflow && !sameWorkflowIdentity(existingWorkflow, normalized)) {
            fail('run_receipt_workflow_collision', 'deterministic receipt workflow id belongs to another identity', {
                workflow_id: normalized.identity.workflow_id,
                expected: workflowIdentity(normalized),
                actual: existingWorkflow.metadata?.run_receipt || null
            });
        }

        const workflow = existingWorkflow || this.workflowRepository.upsertWorkflow(
            this._toWorkflow(normalized)
        );
        const run = this.workflowRepository.createRun(this._toRun(normalized));
        this.workflowRepository.writeAuditLog(this._toAudit(normalized));
        return {
            status: 'created',
            workflow,
            run,
            audit_logs: this.workflowRepository.listAuditLogs({ targetId: run.id })
        };
    }

    _toWorkflow(normalized) {
        return {
            id: normalized.identity.workflow_id,
            workspace_id: 'default',
            org_id: normalized.run.org_id || null,
            project_id: normalized.run.project_id,
            name: normalized.run.workflow_name
                || normalized.source.name
                || `${normalized.source.type} run receipt`,
            description: `Source-owned run receipts for ${normalized.source.workflow_id}`,
            enabled: true,
            execution_env: 'external',
            risk_level: 'low',
            hitl_policy: 'none',
            implementation_key: `run-receipt:${normalized.source.type}`,
            context_sources: [],
            metadata: {
                surface: 'run_receipt',
                contract_version: normalized.contract_version,
                run_receipt: workflowIdentity(normalized)
            }
        };
    }

    _toRun(normalized) {
        const sourceActionRequired = Boolean(
            normalized.run.action_required && normalized.run.action_required !== 'none'
        );
        return {
            id: normalized.identity.run_id,
            workspace_id: 'default',
            org_id: normalized.run.org_id || null,
            project_id: normalized.run.project_id,
            workflow_id: normalized.identity.workflow_id,
            ...normalized.projection,
            output_count: 0,
            actor_id: `run-receipt:${normalized.source.type}`,
            trigger_type: 'external_runner',
            message: normalized.run.summary || null,
            started_at: normalized.run.started_at || normalized.run.finished_at,
            finished_at: normalized.run.finished_at || null,
            metadata: {
                contract_version: normalized.contract_version,
                run_receipt: {
                    payload_digest: normalized.payload_digest,
                    project_id: normalized.run.project_id,
                    org_id: normalized.run.org_id || null,
                    source: normalized.source,
                    source_status: normalized.run.status,
                    source_external_run_id: normalized.run.external_run_id,
                    parent_external_run_id: normalized.run.parent_external_run_id || null,
                    observation_kind: normalized.run.observation_kind,
                    evidence_state: normalized.run.evidence_state,
                    evidence_refs: normalized.run.evidence_refs,
                    metrics: normalized.run.metrics || {},
                    summary: normalized.run.summary || null,
                    blocker_reason: normalized.run.blocker_reason || null,
                    source_action_required: sourceActionRequired,
                    source_action: normalized.run.action_required || null,
                    delivery: normalized.delivery
                }
            }
        };
    }

    _toAudit(normalized) {
        return {
            workspace_id: 'default',
            org_id: normalized.run.org_id || null,
            project_id: normalized.run.project_id,
            actor_id: `run-receipt:${normalized.source.type}`,
            action: 'run_receipt.ingested',
            target_type: 'workflow_run',
            target_id: normalized.identity.run_id,
            after: {
                contract_version: normalized.contract_version,
                source_type: normalized.source.type,
                source_workflow_id: normalized.source.workflow_id,
                source_external_run_id: normalized.run.external_run_id,
                source_status: normalized.run.status,
                evidence_state: normalized.run.evidence_state,
                evidence_refs: normalized.run.evidence_refs,
                action_required: normalized.projection.action_required,
                blocker_present: Boolean(normalized.run.blocker_reason),
                payload_digest: normalized.payload_digest
            }
        };
    }
}
