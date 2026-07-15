import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { RunReceiptContractError } from '../../../server/services/run-receipt/contract.js';
import { RunReceiptIngestService } from '../../../server/services/run-receipt/ingest-service.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';

function idempotencyKey(projectId, sourceType, externalRunId) {
    return `rr1_${createHash('sha256')
        .update(JSON.stringify([projectId, sourceType, externalRunId]))
        .digest('hex')}`;
}

function makeReceipt(overrides = {}) {
    const source = {
        type: 'mana',
        workflow_id: 'mana:lambda:daily-secretary',
        runtime_target: 'lambda',
        ...(overrides.source || {})
    };
    const run = {
        project_id: 'brainbase',
        external_run_id: 'mana:lambda:daily-secretary:run:1',
        status: 'success',
        evidence_state: 'confirmed',
        started_at: '2026-07-15T09:00:00+09:00',
        finished_at: '2026-07-15T09:02:00+09:00',
        summary: '12 records processed',
        metrics: { processed: 12 },
        evidence_refs: [{ kind: 'log_ref', ref: 'cloudwatch:log-stream/example' }],
        ...(overrides.run || {})
    };
    return {
        contract_version: 'run_receipt.v1',
        source,
        run,
        delivery: {
            idempotency_key: idempotencyKey(run.project_id, source.type, run.external_run_id),
            attempt: 1,
            sent_at: '2026-07-15T09:02:03+09:00',
            ...(overrides.delivery || {})
        }
    };
}

function makeService(options = {}) {
    const repository = options.repository || new InMemoryWorkflowRepository();
    return {
        repository,
        service: new RunReceiptIngestService({
            workflowRepository: repository,
            lockAcquireTimeoutMs: 100,
            lockRetryMs: 1,
            ...options
        })
    };
}

describe('RunReceiptIngestService', () => {
    it('valid receipt_共有台帳へworkflow/run/auditを原子的に投影する', async () => {
        const { repository, service } = makeService();
        const result = await service.ingest(makeReceipt());

        expect(result.status).toBe('created');
        expect(repository.listWorkflows()).toHaveLength(1);
        expect(repository.listRuns({ limit: null })).toHaveLength(1);
        expect(repository.listAuditLogs({ targetId: result.run.id })).toHaveLength(1);
        expect(result.workflow.metadata.run_receipt).toMatchObject({
            project_id: 'brainbase',
            source_type: 'mana',
            source_workflow_id: 'mana:lambda:daily-secretary'
        });
        expect(result.run).toMatchObject({
            status: 'success',
            closure_state: 'closed',
            action_required: 'none'
        });
        expect(result.run.metadata.run_receipt).toMatchObject({
            source_status: 'success',
            evidence_state: 'confirmed',
            metrics: { processed: 12 }
        });
        expect(JSON.stringify(result.audit_logs)).not.toMatch(/raw_log|customer_text|transcript/);
    });

    it('deliveryだけ違う再送_duplicateかつ台帳を変更しない', async () => {
        const { repository, service } = makeService();
        const created = await service.ingest(makeReceipt());
        const snapshot = JSON.stringify(repository.ledger);
        const duplicate = await service.ingest(makeReceipt({
            delivery: { attempt: 8, sent_at: '2026-07-15T12:00:00Z' }
        }));

        expect(duplicate.status).toBe('duplicate');
        expect(duplicate.run.id).toBe(created.run.id);
        expect(JSON.stringify(repository.ledger)).toBe(snapshot);
    });

    it('同じidentityでimmutable内容が変わる_run_receipt_conflictかつrollbackする', async () => {
        const { repository, service } = makeService();
        await service.ingest(makeReceipt());
        const snapshot = JSON.stringify(repository.ledger);

        await expect(service.ingest(makeReceipt({
            run: { summary: '13 records processed', metrics: { processed: 13 } }
        }))).rejects.toMatchObject({ code: 'run_receipt_conflict' });
        expect(JSON.stringify(repository.ledger)).toBe(snapshot);
    });

    it('同時の同一receipt_identity lockで1 createdと残りduplicateになる', async () => {
        const { repository, service } = makeService({ lockAcquireTimeoutMs: 1000 });
        const results = await Promise.all(Array.from({ length: 8 }, () => service.ingest(makeReceipt())));

        expect(results.filter((result) => result.status === 'created')).toHaveLength(1);
        expect(results.filter((result) => result.status === 'duplicate')).toHaveLength(7);
        expect(repository.listRuns({ limit: null })).toHaveLength(1);
        expect(repository.listAuditLogs()).toHaveLength(1);
    });

    it('異なるreceipt identity_並行しても全workflow/run/auditを保持する', async () => {
        const { repository, service } = makeService({ lockAcquireTimeoutMs: 1000 });
        await Promise.all(Array.from({ length: 6 }, (_, index) => service.ingest(makeReceipt({
            run: { external_run_id: `mana:lambda:daily-secretary:run:${index + 1}` }
        }))));

        expect(repository.listWorkflows()).toHaveLength(1);
        expect(repository.listRuns({ limit: null })).toHaveLength(6);
        expect(repository.listAuditLogs()).toHaveLength(6);
    });

    it.each(['transaction', 'acquireWorkflowLock', 'releaseWorkflowLock'])(
        'repository.%sなし_書込前に拒否する',
        async (capability) => {
            const repository = new InMemoryWorkflowRepository();
            repository[capability] = undefined;
            const service = new RunReceiptIngestService({ workflowRepository: repository });

            await expect(service.ingest(makeReceipt())).rejects.toMatchObject({
                code: 'workflow_repository_capability_required'
            });
            expect(repository.listRuns({ limit: null })).toHaveLength(0);
        }
    );

    it('identity lock timeout_書込なしで明示的に失敗する', async () => {
        const repository = new InMemoryWorkflowRepository();
        const { service } = makeService({ repository, lockAcquireTimeoutMs: 5, lockRetryMs: 1 });
        const first = await service.normalize(makeReceipt());
        repository.acquireWorkflowLock({
            workspace_id: first.lock.workspace_id,
            workflow_id: first.lock.workflow_id,
            locked_by: 'other-owner',
            ttl_ms: 60000
        });

        await expect(service.ingest(makeReceipt())).rejects.toMatchObject({ code: 'run_receipt_lock_timeout' });
        expect(repository.listRuns({ limit: null })).toHaveLength(0);
    });

    it('identity lockはreceipt namespaceとprojectを含む正規tupleを使う', async () => {
        const repository = new InMemoryWorkflowRepository();
        const acquired = [];
        const originalAcquire = repository.acquireWorkflowLock.bind(repository);
        repository.acquireWorkflowLock = (input) => {
            acquired.push(input);
            return originalAcquire(input);
        };
        const { service } = makeService({ repository });
        const normalized = service.normalize(makeReceipt());

        await service.ingest(makeReceipt());

        expect(acquired).toHaveLength(1);
        expect(acquired[0]).toMatchObject({
            workspace_id: 'run_receipt:brainbase',
            workflow_id: normalized.identity.run_id
        });
    });

    it('deterministic workflow idに別identityが存在_衝突として拒否する', async () => {
        const { repository, service } = makeService();
        const normalized = await service.normalize(makeReceipt());
        await repository.transaction(() => repository.upsertWorkflow({
            id: normalized.identity.workflow_id,
            workspace_id: 'default',
            project_id: 'brainbase',
            name: 'collision',
            metadata: { run_receipt: { source_type: 'github_actions' } }
        }));
        const snapshot = JSON.stringify(repository.ledger);

        await expect(service.ingest(makeReceipt())).rejects.toMatchObject({ code: 'run_receipt_workflow_collision' });
        expect(JSON.stringify(repository.ledger)).toBe(snapshot);
    });

    it('既存runにreceipt metadataがない_衝突として拒否する', async () => {
        const { repository, service } = makeService();
        const normalized = await service.normalize(makeReceipt());
        await repository.transaction(() => repository.createRun({
            id: normalized.identity.run_id,
            workspace_id: 'default',
            project_id: 'brainbase',
            workflow_id: normalized.identity.workflow_id
        }));

        await expect(service.ingest(makeReceipt())).rejects.toBeInstanceOf(RunReceiptContractError);
        expect(repository.listRuns({ limit: null })).toHaveLength(1);
        expect(repository.listAuditLogs()).toHaveLength(0);
    });
});
