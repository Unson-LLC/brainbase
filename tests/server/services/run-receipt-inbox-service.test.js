import { describe, expect, it } from 'vitest';

import { WorkflowService } from '../../../server/services/workflow/workflow-service.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';

function makeReceiptRun({
    id,
    projectId = 'brainbase',
    sourceType = 'mana',
    sourceWorkflowId = 'daily-secretary',
    sourceStatus = 'success',
    evidenceState = 'confirmed',
    observationKind = 'source_run',
    sourceAction = null,
    effectiveAt = '2026-07-15T00:00:00Z',
    createdAt = effectiveAt
}) {
    return {
        id,
        workspace_id: 'default',
        project_id: projectId,
        workflow_id: `wf-${sourceType}-${sourceWorkflowId}`,
        status: sourceStatus === 'blocked' ? 'needs_action' : sourceStatus,
        action_required: sourceAction || (sourceStatus === 'failed' ? 'check_error' : 'none'),
        started_at: effectiveAt,
        finished_at: effectiveAt,
        created_at: createdAt,
        metadata: {
            contract_version: 'run_receipt.v1',
            run_receipt: {
                project_id: projectId,
                source: {
                    type: sourceType,
                    workflow_id: sourceWorkflowId,
                    name: `${sourceType} ${sourceWorkflowId}`,
                    runtime_target: 'production'
                },
                source_status: sourceStatus,
                source_external_run_id: id,
                observation_kind: observationKind,
                evidence_state: evidenceState,
                evidence_refs: evidenceState === 'confirmed'
                    ? [{ kind: 'log_ref', ref: `${sourceType}:artifact/${id}` }]
                    : [],
                metrics: { processed: 1 },
                summary: `${id} summary`,
                blocker_reason: sourceStatus === 'blocked' ? `${id} blocker` : null,
                source_action_required: Boolean(sourceAction && sourceAction !== 'none'),
                source_action: sourceAction
            }
        }
    };
}

async function makeService(runs) {
    const repository = new InMemoryWorkflowRepository();
    await repository.transaction(() => {
        for (const run of runs) repository.createRun(run);
    });
    return new WorkflowService({ repository, runner: {}, configParser: null });
}

describe('WorkflowService.listRunReceiptInbox', () => {
    it('全6 priority bucketをsource actionとevidence stateを混同せず順序化する', async () => {
        const service = await makeService([
            makeReceiptRun({ id: 'run-6', sourceWorkflowId: 'confirmed', effectiveAt: '2026-07-15T06:00:00Z' }),
            makeReceiptRun({ id: 'run-cancelled', sourceWorkflowId: 'cancelled', sourceStatus: 'cancelled', effectiveAt: '2026-07-15T06:30:00Z' }),
            makeReceiptRun({ id: 'run-5', sourceWorkflowId: 'no-data', evidenceState: 'no_data', effectiveAt: '2026-07-15T05:00:00Z' }),
            makeReceiptRun({ id: 'run-4', sourceWorkflowId: 'unconfirmed', evidenceState: 'unconfirmed', effectiveAt: '2026-07-15T04:00:00Z' }),
            makeReceiptRun({ id: 'run-3', sourceWorkflowId: 'waiting', sourceStatus: 'waiting_human', effectiveAt: '2026-07-15T03:00:00Z' }),
            makeReceiptRun({ id: 'run-2', sourceWorkflowId: 'failed', sourceStatus: 'failed', effectiveAt: '2026-07-15T02:00:00Z' }),
            makeReceiptRun({ id: 'run-1', sourceWorkflowId: 'blocked', sourceStatus: 'blocked', evidenceState: 'no_data', effectiveAt: '2026-07-15T01:00:00Z' })
        ]);

        const result = await service.listRunReceiptInbox({}, {});

        expect(result.items.map((item) => [item.id, item.priority])).toEqual([
            ['run-1', 1], ['run-2', 2], ['run-3', 3], ['run-4', 4], ['run-5', 5],
            ['run-cancelled', 6], ['run-6', 6]
        ]);
        expect(result.items.find((item) => item.id === 'run-cancelled')).toMatchObject({
            source_status: 'cancelled',
            priority: 6
        });
    });

    it('source supplied actionはstatusより先にpriority 1へ上げる', async () => {
        const service = await makeService([
            makeReceiptRun({ id: 'action-success', sourceWorkflowId: 'action', sourceAction: 'review_run' }),
            makeReceiptRun({ id: 'plain-failed', sourceWorkflowId: 'failed', sourceStatus: 'failed' })
        ]);

        const result = await service.listRunReceiptInbox({}, {});

        expect(result.items.map((item) => [item.id, item.priority])).toEqual([
            ['action-success', 1], ['plain-failed', 2]
        ]);
    });

    it('connector_observationをInbox projectionへ保持し通常runと区別できる', async () => {
        const service = await makeService([
            makeReceiptRun({
                id: 'connector-observation-1',
                sourceWorkflowId: '__connector_observation__',
                sourceStatus: 'blocked',
                evidenceState: 'unconfirmed',
                observationKind: 'connector_observation',
                sourceAction: 'check_error'
            })
        ]);

        const result = await service.listRunReceiptInbox({}, {});

        expect(result.items[0]).toMatchObject({
            id: 'connector-observation-1',
            observation_kind: 'connector_observation'
        });
    });

    it('identityごとの最新runへ先に畳み込み古いblockedをfilterで復活させない', async () => {
        const service = await makeService([
            makeReceiptRun({ id: 'old-blocked', sourceWorkflowId: 'same', sourceStatus: 'blocked', effectiveAt: '2026-07-15T01:00:00Z' }),
            makeReceiptRun({ id: 'new-success', sourceWorkflowId: 'same', effectiveAt: '2026-07-15T02:00:00Z' })
        ]);

        const all = await service.listRunReceiptInbox({}, {});
        const blocked = await service.listRunReceiptInbox({ runStatus: 'blocked' }, {});

        expect(all.items.map((item) => item.id)).toEqual(['new-success']);
        expect(blocked).toMatchObject({ items: [], count: 0, has_more: false, omitted_count: 0 });
    });

    it('UTC instantでlatestとsortを決めoffset timestampを文字列比較しない', async () => {
        const service = await makeService([
            makeReceiptRun({ id: 'same-old', sourceWorkflowId: 'same', effectiveAt: '2026-07-15T09:00:00+09:00' }),
            makeReceiptRun({ id: 'same-new', sourceWorkflowId: 'same', effectiveAt: '2026-07-15T00:30:00Z' }),
            makeReceiptRun({ id: 'other', sourceWorkflowId: 'other', effectiveAt: '2026-07-15T00:15:00Z' })
        ]);

        const result = await service.listRunReceiptInbox({}, {});

        expect(result.items.map((item) => item.id)).toEqual(['same-new', 'other']);
    });

    it('effective、created、idの降順でtotal orderを固定する', async () => {
        const effectiveAt = '2026-07-15T00:00:00Z';
        const service = await makeService([
            makeReceiptRun({ id: 'run-a', sourceWorkflowId: 'a', effectiveAt, createdAt: '2026-07-15T00:00:01Z' }),
            makeReceiptRun({ id: 'run-b', sourceWorkflowId: 'b', effectiveAt, createdAt: '2026-07-15T00:00:02Z' }),
            makeReceiptRun({ id: 'run-c', sourceWorkflowId: 'c', effectiveAt, createdAt: '2026-07-15T00:00:02Z' })
        ]);

        const result = await service.listRunReceiptInbox({}, {});

        expect(result.items.map((item) => item.id)).toEqual(['run-c', 'run-b', 'run-a']);
    });

    it('collapse後にfilterとlimitを適用しcount/has_more/omitted_countを返す', async () => {
        const service = await makeService([
            makeReceiptRun({ id: 'mana-1', sourceWorkflowId: 'm1', evidenceState: 'unconfirmed' }),
            makeReceiptRun({ id: 'mana-2', sourceWorkflowId: 'm2', evidenceState: 'unconfirmed' }),
            makeReceiptRun({ id: 'github-1', sourceType: 'github_actions', sourceWorkflowId: 'g1', evidenceState: 'unconfirmed' }),
            makeReceiptRun({ id: 'other-project', projectId: 'mana', sourceWorkflowId: 'm3', evidenceState: 'unconfirmed' })
        ]);

        const result = await service.listRunReceiptInbox({
            projectId: 'brainbase',
            sourceType: 'mana',
            evidenceState: 'unconfirmed',
            limit: 1
        }, {});

        expect(result).toMatchObject({ count: 2, has_more: true, omitted_count: 1 });
        expect(result.items).toHaveLength(1);
    });

    it('actorに見えないprojectを一覧から除外する', async () => {
        const service = await makeService([
            makeReceiptRun({ id: 'brainbase-run', projectId: 'brainbase', sourceWorkflowId: 'brainbase' }),
            makeReceiptRun({ id: 'mana-run', projectId: 'mana', sourceWorkflowId: 'mana' })
        ]);

        const result = await service.listRunReceiptInbox({}, {
            role: 'member',
            projectCodes: ['brainbase']
        });

        expect(result.items.map((item) => item.id)).toEqual(['brainbase-run']);
    });

    it('receipt workflowを既存GET workflows projectionから除外し非receipt順序を維持する', async () => {
        const repository = new InMemoryWorkflowRepository();
        await repository.transaction(() => {
            repository.upsertWorkflow({
                id: 'normal-a',
                workspace_id: 'default',
                project_id: 'brainbase',
                name: 'normal a',
                metadata: {}
            });
            repository.upsertWorkflow({
                id: 'receipt-only',
                workspace_id: 'default',
                project_id: 'brainbase',
                name: 'receipt',
                metadata: {
                    surface: 'run_receipt',
                    run_receipt: { project_id: 'brainbase', source_type: 'mana' }
                }
            });
            repository.upsertWorkflow({
                id: 'normal-b',
                workspace_id: 'default',
                project_id: 'brainbase',
                name: 'normal b',
                metadata: {}
            });
            repository.createRun({
                id: 'normal-a-run', project_id: 'brainbase', workflow_id: 'normal-a',
                status: 'failed', started_at: '2026-07-15T01:00:00Z'
            });
            repository.createRun({
                id: 'normal-b-run', project_id: 'brainbase', workflow_id: 'normal-b',
                status: 'success', started_at: '2026-07-15T02:00:00Z'
            });
        });
        const service = new WorkflowService({ repository, runner: {}, configParser: null });

        const result = await service.listWorkflows({ projectId: 'brainbase' }, {});

        expect(result.workflows.map((workflow) => workflow.id)).toEqual(['normal-a', 'normal-b']);
    });

    it.each([
        [{ sourceType: 'unknown' }, 'source_type'],
        [{ runStatus: 'running' }, 'run_status'],
        [{ evidenceState: 'empty' }, 'evidence_state'],
        [{ limit: 0 }, 'limit'],
        [{ limit: 201 }, 'limit']
    ])('invalid query %j_400 validation errorにする', async (query, field) => {
        const service = await makeService([]);

        await expect(service.listRunReceiptInbox(query, {})).rejects.toMatchObject({
            statusCode: 400,
            details: expect.objectContaining({ field })
        });
    });
});
