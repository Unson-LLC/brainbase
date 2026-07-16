import { describe, expect, it, vi } from 'vitest';

import { RunReceiptQueryService } from '../../../server/services/run-receipt/query-service.js';
import { WorkflowService } from '../../../server/services/workflow/workflow-service.js';

function makeRun({
    id,
    projectId = 'brainbase',
    sourceType = 'mana',
    sourceIdentity = 'daily-secretary',
    sourceStatus = 'success',
    evidenceState = 'confirmed',
    sourceAction = null,
    effectiveAt = '2026-07-16T00:00:00Z'
}) {
    return {
        id,
        workflow_id: `receipt-${sourceType}-${sourceIdentity}`,
        project_id: projectId,
        status: sourceStatus,
        action_required: sourceAction || 'none',
        created_at: effectiveAt,
        finished_at: effectiveAt,
        metadata: {
            run_receipt: {
                source: {
                    type: sourceType,
                    workflow_id: sourceIdentity,
                    runtime_target: 'production'
                },
                source_status: sourceStatus,
                source_external_run_id: id,
                evidence_state: evidenceState,
                evidence_refs: evidenceState === 'confirmed'
                    ? [{ kind: 'log_ref', ref: `log:${id}` }]
                    : [],
                source_action_required: Boolean(sourceAction),
                source_action: sourceAction,
                blocker_reason: sourceStatus === 'blocked' ? `${id} blocked` : null
            }
        }
    };
}

function makeService(runs) {
    const prepareProjectAccess = vi.fn(async () => {});
    const assertProjectAccess = vi.fn();
    const canAccessProject = vi.fn((projectId) => projectId !== 'hidden');
    const repository = {
        listLatestRunReceipts: vi.fn(() => runs),
        listRuns: vi.fn(() => runs),
        getRun: vi.fn((runId) => runs.find((run) => run.id === runId) || null)
    };
    return {
        service: new RunReceiptQueryService({
            repository,
            prepareProjectAccess,
            assertProjectAccess,
            canAccessProject
        }),
        repository,
        prepareProjectAccess,
        assertProjectAccess,
        canAccessProject
    };
}

describe('RunReceiptQueryService', () => {
    it('WorkflowServiceの互換APIは専用serviceへ委譲する', async () => {
        const runReceiptQueryService = {
            listInbox: vi.fn(async () => ({ items: [] })),
            listHistory: vi.fn(async () => ({ items: [] })),
            diagnose: vi.fn(async () => ({ diagnosis: { state: 'healthy' } }))
        };
        const workflowService = new WorkflowService({
            repository: {},
            runner: {},
            configParser: null,
            runReceiptQueryService
        });
        const actor = { role: 'member' };

        await workflowService.listRunReceiptInbox({ projectId: 'brainbase' }, actor);
        await workflowService.listRunReceiptHistory({ projectId: 'brainbase' }, actor);
        await workflowService.diagnoseRunReceipt({ projectId: 'brainbase', runId: 'run-1' }, actor);

        expect(runReceiptQueryService.listInbox).toHaveBeenCalledWith({ projectId: 'brainbase' }, actor);
        expect(runReceiptQueryService.listHistory).toHaveBeenCalledWith({ projectId: 'brainbase' }, actor);
        expect(runReceiptQueryService.diagnose).toHaveBeenCalledWith({
            projectId: 'brainbase',
            runId: 'run-1'
        }, actor);
    });

    it('Inboxでは権限内の最新状態を優先度順に投影する', async () => {
        const { service, repository, prepareProjectAccess, assertProjectAccess } = makeService([
            makeRun({
                id: 'healthy',
                sourceIdentity: 'healthy',
                effectiveAt: '2026-07-16T03:00:00Z'
            }),
            makeRun({
                id: 'blocked',
                sourceIdentity: 'blocked',
                sourceStatus: 'blocked',
                evidenceState: 'no_data',
                sourceAction: 'reauthorize',
                effectiveAt: '2026-07-16T01:00:00Z'
            }),
            makeRun({ id: 'hidden', projectId: 'hidden', sourceIdentity: 'hidden' })
        ]);

        const result = await service.listInbox({ projectId: 'brainbase' }, { role: 'member' });

        expect(prepareProjectAccess).toHaveBeenCalledOnce();
        expect(assertProjectAccess).toHaveBeenCalledWith('brainbase', { role: 'member' });
        expect(repository.listLatestRunReceipts).toHaveBeenCalledWith({ projectId: 'brainbase' });
        expect(result.items.map((item) => [item.id, item.priority])).toEqual([
            ['blocked', 1],
            ['healthy', 6]
        ]);
    });

    it('履歴では同じsource identityだけを新しい順に返す', async () => {
        const { service } = makeService([
            makeRun({ id: 'old', effectiveAt: '2026-07-15T00:00:00Z' }),
            makeRun({ id: 'new', effectiveAt: '2026-07-16T00:00:00Z' }),
            makeRun({ id: 'other', sourceIdentity: 'other' })
        ]);

        const result = await service.listHistory({
            projectId: 'brainbase',
            sourceType: 'mana',
            sourceIdentity: 'daily-secretary',
            limit: 1
        });

        expect(result.items.map((item) => item.id)).toEqual(['new']);
        expect(result).toMatchObject({ count: 2, has_more: true, omitted_count: 1 });
    });

    it('診断ではsource状態と証跡状態を別々のissueとして保持する', async () => {
        const { service } = makeService([
            makeRun({
                id: 'blocked',
                sourceStatus: 'blocked',
                evidenceState: 'no_data',
                sourceAction: 'reauthorize'
            })
        ]);

        const result = await service.diagnose({ projectId: 'brainbase', runId: 'blocked' });

        expect(result.diagnosis).toEqual({
            state: 'action_required',
            issue_codes: ['source_blocked', 'evidence_missing'],
            recommended_action: 'reauthorize'
        });
    });
});
