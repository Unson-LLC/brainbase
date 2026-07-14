import { describe, expect, it, vi } from 'vitest';

import { CanonicalTaskApiClient } from '../../../scripts/lib/canonical-task-api-client.js';

function jsonResponse(payload, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(payload)
    };
}

describe('CanonicalTaskApiClient', () => {
    it('lists every canonical task using the server page limit and bearer auth', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'task-1' }], next_cursor: 'cursor-2' }))
            .mockResolvedValueOnce(jsonResponse({ items: [{ id: 'task-2' }], next_cursor: null }));
        const client = new CanonicalTaskApiClient({
            baseUrl: 'https://brainbase.example',
            token: 'secret',
            fetchImpl
        });

        await expect(client.listTasks()).resolves.toEqual([{ id: 'task-1' }, { id: 'task-2' }]);
        expect(fetchImpl).toHaveBeenNthCalledWith(1,
            'https://brainbase.example/api/companion/tasks?limit=50',
            expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret' }) })
        );
        expect(fetchImpl.mock.calls[1][0]).toContain('cursor=cursor-2');
    });

    it('creates tasks with a stable idempotency key through the canonical API', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'task-1' }, 201));
        const client = new CanonicalTaskApiClient({ token: 'secret', fetchImpl });

        await client.createTask({ title: '運用タスク', status: '未着手', priority: '高' }, 'test-script');

        const [, request] = fetchImpl.mock.calls[0];
        expect(request.method).toBe('POST');
        expect(request.headers['Idempotency-Key']).toMatch(/^operational-script-test-script-/);
        expect(JSON.parse(request.body)).toMatchObject({
            title: '運用タスク',
            status: 'pending',
            priority: 'high'
        });
    });
});
