import { afterEach, describe, expect, it, vi } from 'vitest';

import { CanonicalTaskApiClient } from '../../../scripts/lib/canonical-task-api-client.js';

function jsonResponse(payload, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(payload)
    };
}

describe('CanonicalTaskApiClient', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('requires an explicit or configured API base URL before any fetch', () => {
        vi.stubEnv('BRAINBASE_TASK_API_BASE_URL', '');
        vi.stubEnv('BRAINBASE_API_URL', '');
        const fetchImpl = vi.fn();

        expect(() => new CanonicalTaskApiClient({ token: 'secret', fetchImpl }))
            .toThrow(/baseUrl.*required/i);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('uses explicit baseUrl before the dedicated and legacy environment variables', () => {
        vi.stubEnv('BRAINBASE_TASK_API_BASE_URL', 'https://task.example');
        vi.stubEnv('BRAINBASE_API_URL', 'https://legacy.example');

        expect(new CanonicalTaskApiClient({
            baseUrl: 'https://explicit.example',
            token: 'secret',
            fetchImpl: vi.fn()
        }).baseUrl).toBe('https://explicit.example');
        expect(new CanonicalTaskApiClient({ token: 'secret', fetchImpl: vi.fn() }).baseUrl)
            .toBe('https://task.example');

        vi.stubEnv('BRAINBASE_TASK_API_BASE_URL', '');
        expect(() => new CanonicalTaskApiClient({ token: 'secret', fetchImpl: vi.fn() }))
            .toThrow(/baseUrl.*required/i);

        vi.stubEnv('BRAINBASE_TASK_API_BASE_URL', undefined);
        expect(new CanonicalTaskApiClient({ token: 'secret', fetchImpl: vi.fn() }).baseUrl)
            .toBe('https://legacy.example');
    });

    it('does not fall back from an explicitly blank baseUrl', () => {
        vi.stubEnv('BRAINBASE_TASK_API_BASE_URL', 'https://task.example');
        const fetchImpl = vi.fn();

        expect(() => new CanonicalTaskApiClient({ baseUrl: '  ', token: 'secret', fetchImpl }))
            .toThrow(/baseUrl.*required/i);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each([
        ['not a URL', 'invalid URL'],
        ['ftp://brainbase.example', 'unsupported protocol'],
        ['https://user:password@brainbase.example', 'credentials'],
        ['https://brainbase.example?tenant=acme', 'query'],
        ['https://brainbase.example#fragment', 'fragment'],
        ['http://brainbase.example', 'remote HTTP']
    ])('rejects %s (%s) before fetch', (baseUrl) => {
        const fetchImpl = vi.fn();

        expect(() => new CanonicalTaskApiClient({ baseUrl, token: 'secret', fetchImpl }))
            .toThrow(/baseUrl/i);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it.each(['http://localhost:31013', 'http://127.0.0.1:31013', 'http://[::1]:31013'])
        ('allows loopback HTTP at an explicit base URL: %s', async (baseUrl) => {
            const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }));
            const client = new CanonicalTaskApiClient({ baseUrl, token: 'secret', fetchImpl });

            await expect(client.listTasks()).resolves.toEqual([]);
            expect(fetchImpl).toHaveBeenCalledWith(`${baseUrl}/api/companion/tasks?limit=50`, expect.anything());
        });

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
        const client = new CanonicalTaskApiClient({ baseUrl: 'https://brainbase.example', token: 'secret', fetchImpl });

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

    it('keeps API paths below an explicit base URL path prefix', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ items: [], next_cursor: null }));
        const client = new CanonicalTaskApiClient({
            baseUrl: 'https://brainbase.example/runtime/',
            token: 'secret',
            fetchImpl
        });

        await client.listTasks();

        expect(fetchImpl).toHaveBeenCalledWith(
            'https://brainbase.example/runtime/api/companion/tasks?limit=50',
            expect.anything()
        );
    });

    it('transitions tasks with the expected version and idempotency key', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'task-1', version: 4 }));
        const client = new CanonicalTaskApiClient({ baseUrl: 'https://brainbase.example', token: 'secret', fetchImpl });

        await client.transitionTask({ id: 'task/1', version: 3 }, '完了', 'test-script');

        const [url, request] = fetchImpl.mock.calls[0];
        expect(url).toBe('https://brainbase.example/api/companion/tasks/task%2F1/transitions');
        expect(request.method).toBe('POST');
        expect(request.headers.Authorization).toBe('Bearer secret');
        expect(request.headers['Idempotency-Key']).toMatch(/^operational-script-test-script-/);
        expect(JSON.parse(request.body)).toEqual({ expected_version: 3, to_status: 'completed' });
    });
});
