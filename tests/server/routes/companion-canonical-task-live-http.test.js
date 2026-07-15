import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startCanonicalTaskLiveApiHarness } from '../../helpers/canonical-task-live-api-harness.js';

describe('Companion canonical Task live HTTP contract', () => {
    let harness;

    beforeAll(async () => {
        harness = await startCanonicalTaskLiveApiHarness();
    });

    afterAll(async () => {
        await harness.close();
    });

    it('returns the Mac wire contract and enforces create idempotency over TCP', async () => {
        const create = (title) => fetch(`${harness.baseURL}/api/companion/tasks`, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer canonical-task-e2e',
                'Content-Type': 'application/json',
                'Idempotency-Key': 'live-http-mac-wire-contract'
            },
            body: JSON.stringify({ title, priority: 'high' })
        });
        const [response, concurrentReplay] = await Promise.all([
            create('Mac wire contract'),
            create('Mac wire contract')
        ]);
        const [body, concurrentReplayBody] = await Promise.all([
            response.json(),
            concurrentReplay.json()
        ]);

        expect(response.status).toBe(201);
        expect(concurrentReplay.status).toBe(201);
        expect(concurrentReplayBody.id).toBe(body.id);
        expect(body).toHaveProperty('completed_at', null);
        expect(body).toEqual(expect.objectContaining({
            id: expect.any(String),
            created_at: expect.any(String),
            updated_at: expect.any(String),
            web_url: expect.any(String)
        }));
        expect(() => new URL(body.web_url)).not.toThrow();

        const replay = await create('Mac wire contract');
        expect(replay.status).toBe(201);
        await expect(replay.json()).resolves.toMatchObject({ id: body.id });

        const conflict = await create('Changed input under the same key');
        expect(conflict.status).toBe(409);
        await expect(conflict.json()).resolves.toMatchObject({ code: 'idempotency_conflict' });
    });

    it('materializes one Task with origin references when approval is retried over TCP', async () => {
        const url = `${harness.baseURL}/api/workflow-runs/${harness.approvalFixture.runID}`
            + `/human-steps/${harness.approvalFixture.stepID}/resolve`;
        const request = () => fetch(url, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer canonical-task-e2e',
                'Content-Type': 'application/json',
                'x-session-id': 'live-approval-contract',
                'x-csrf-token': 'canonical-task-e2e-csrf',
                'Idempotency-Key': 'live-approval-contract'
            },
            body: JSON.stringify({
                resolution: 'approved',
                response_ref: { source: 'mac_companion', decision_mode: 'approve', card_kind: 'task_candidates' }
            })
        });

        const [first, replay] = await Promise.all([request(), request()]);
        const [firstBody, replayBody] = await Promise.all([first.json(), replay.json()]);
        expect(first.status).toBe(200);
        expect(replay.status).toBe(200);
        expect(firstBody.materialized_task_ids).toHaveLength(1);
        expect(replayBody.materialized_task_ids).toEqual(firstBody.materialized_task_ids);

        const taskResponse = await fetch(
            `${harness.baseURL}/api/companion/tasks/${encodeURIComponent(firstBody.materialized_task_ids[0])}`,
            { headers: { Authorization: 'Bearer canonical-task-e2e' } }
        );
        const task = await taskResponse.json();
        expect(taskResponse.status).toBe(200);
        expect(task.source_refs).toEqual(expect.arrayContaining([
            { type: 'workflow_output', id: harness.approvalFixture.outputID, url: null },
            { type: 'workflow_human_step', id: harness.approvalFixture.stepID, url: null }
        ]));

        const listResponse = await fetch(`${harness.baseURL}/api/companion/tasks?limit=50`, {
            headers: { Authorization: 'Bearer canonical-task-e2e' }
        });
        const page = await listResponse.json();
        expect(page.items.filter((item) => item.source_refs?.some(
            (source) => source.type === 'workflow_output' && source.id === harness.approvalFixture.outputID
        ))).toHaveLength(1);
    });
});
