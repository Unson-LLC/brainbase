import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { taskTools, handleTaskToolCall } from '../../src/tools/task-tools.js';
import { __testing as serverTesting } from '../../src/server.js';

interface CapturedRequest {
  url: string;
  method?: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    apiUrl: 'https://tasks.test',
    token: 'bbsvc_test-token',
    requestId: () => 'fixed-request-id',
    fetch: async () => new Response(
      JSON.stringify({ id: 'ct1.task', version: 1, status: 'pending', title: 'Test task' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
    ...overrides,
  };
}

function capturingFetch(captured: CapturedRequest[], response?: Response) {
  return async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(input),
      method: init?.method,
      headers: (init?.headers || {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return response ?? new Response(
      JSON.stringify({ id: 'ct1.task', version: 2, status: 'in_progress' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
}

describe('task tool registration', () => {
  it('exposes exactly create_task, update_task, and transition_task', () => {
    assert.deepEqual(
      taskTools.map((tool) => tool.name).sort(),
      ['create_task', 'transition_task', 'update_task'],
    );
  });

  it('does not expose any delete tool', () => {
    assert.equal(taskTools.some((tool) => /delete/i.test(tool.name)), false);
    for (const tool of serverTesting.tools) {
      assert.equal(/delete/i.test(tool.name), false, `unexpected delete tool: ${tool.name}`);
    }
  });

  it('registers the task tools on the server tool list', () => {
    const names = serverTesting.tools.map((tool) => tool.name);
    for (const expected of ['create_task', 'update_task', 'transition_task']) {
      assert.ok(names.includes(expected), `missing tool: ${expected}`);
    }
  });
});

describe('handleTaskToolCall routing', () => {
  it('returns null for unknown tool names', async () => {
    assert.equal(await handleTaskToolCall('delete_task', {}, dependencies()), null);
    assert.equal(await handleTaskToolCall('get_context', {}, dependencies()), null);
  });

  it('reports unavailable when no token is configured', async () => {
    const result = await handleTaskToolCall('create_task', { title: 'x' }, dependencies({ token: undefined }));
    assert.equal(result?.status, 'unavailable');
    assert.equal(result?.error?.code, 'task_store_not_configured');
  });
});

describe('create_task', () => {
  it('POSTs to /api/companion/tasks with auth and generated mcp: idempotency key', async () => {
    const captured: CapturedRequest[] = [];
    const result = await handleTaskToolCall(
      'create_task',
      { title: 'New task', description: 'body', priority: 'high', due_at: '2026-08-01T00:00:00Z' },
      dependencies({ fetch: capturingFetch(captured) }),
    );
    assert.equal(result?.status, 'ok');
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, 'https://tasks.test/api/companion/tasks');
    assert.equal(captured[0].method, 'POST');
    assert.equal(captured[0].headers.Authorization, 'Bearer bbsvc_test-token');
    assert.equal(captured[0].headers['Idempotency-Key'], 'mcp:fixed-request-id');
    assert.deepEqual(captured[0].body, {
      title: 'New task',
      description: 'body',
      priority: 'high',
      due_at: '2026-08-01T00:00:00Z',
    });
  });

  it('uses a caller-provided idempotency key verbatim', async () => {
    const captured: CapturedRequest[] = [];
    await handleTaskToolCall(
      'create_task',
      { title: 'New task', idempotency_key: 'mana-roadmap-key' },
      dependencies({ fetch: capturingFetch(captured) }),
    );
    assert.equal(captured[0].headers['Idempotency-Key'], 'mana-roadmap-key');
  });

  it('rejects reserved idempotency key prefixes', async () => {
    for (const key of ['api:x', 'workflow:y']) {
      const result = await handleTaskToolCall(
        'create_task',
        { title: 'New task', idempotency_key: key },
        dependencies(),
      );
      assert.equal(result?.status, 'error');
      assert.equal(result?.error?.code, 'task_input_invalid');
      assert.match(result?.error?.message ?? '', /reserved prefix/);
    }
  });

  it('rejects a missing title and a title over 200 characters', async () => {
    const missing = await handleTaskToolCall('create_task', {}, dependencies());
    assert.equal(missing?.error?.code, 'task_input_invalid');
    const tooLong = await handleTaskToolCall('create_task', { title: 'a'.repeat(201) }, dependencies());
    assert.equal(tooLong?.error?.code, 'task_input_invalid');
    assert.match(tooLong?.error?.message ?? '', /200/);
  });

  it('rejects an invalid priority', async () => {
    const result = await handleTaskToolCall('create_task', { title: 'x', priority: 'asap' }, dependencies());
    assert.equal(result?.status, 'error');
    assert.equal(result?.error?.code, 'task_input_invalid');
  });

  it('rejects non-object source_refs entries', async () => {
    const result = await handleTaskToolCall(
      'create_task',
      { title: 'x', source_refs: ['not-an-object'] },
      dependencies(),
    );
    assert.equal(result?.error?.code, 'task_input_invalid');
  });
});

describe('update_task', () => {
  it('PATCHes the task with expected_version and only provided fields', async () => {
    const captured: CapturedRequest[] = [];
    const result = await handleTaskToolCall(
      'update_task',
      { task_id: 'ct1.task/x', expected_version: 3, title: 'Renamed' },
      dependencies({ fetch: capturingFetch(captured) }),
    );
    assert.equal(result?.status, 'ok');
    assert.equal(captured[0].url, 'https://tasks.test/api/companion/tasks/ct1.task%2Fx');
    assert.equal(captured[0].method, 'PATCH');
    assert.deepEqual(captured[0].body, { expected_version: 3, title: 'Renamed' });
  });

  it('requires expected_version to be a positive integer', async () => {
    for (const expectedVersion of [undefined, 0, -1, 1.5, '2']) {
      const result = await handleTaskToolCall(
        'update_task',
        { task_id: 'ct1.task', expected_version: expectedVersion, title: 'x' },
        dependencies(),
      );
      assert.equal(result?.error?.code, 'task_input_invalid');
    }
  });

  it('requires at least one updatable field', async () => {
    const result = await handleTaskToolCall(
      'update_task',
      { task_id: 'ct1.task', expected_version: 1 },
      dependencies(),
    );
    assert.equal(result?.error?.code, 'task_input_invalid');
    assert.match(result?.error?.message ?? '', /at least one/);
  });
});

describe('transition_task', () => {
  it('POSTs the transition with expected_version and to_status', async () => {
    const captured: CapturedRequest[] = [];
    const result = await handleTaskToolCall(
      'transition_task',
      { task_id: 'ct1.task', expected_version: 2, to_status: 'waiting', waiting_on: 'review', review_at: '2026-08-02T00:00:00Z' },
      dependencies({ fetch: capturingFetch(captured) }),
    );
    assert.equal(result?.status, 'ok');
    assert.equal(captured[0].url, 'https://tasks.test/api/companion/tasks/ct1.task/transitions');
    assert.equal(captured[0].method, 'POST');
    assert.deepEqual(captured[0].body, {
      expected_version: 2,
      to_status: 'waiting',
      waiting_on: 'review',
      review_at: '2026-08-02T00:00:00Z',
    });
  });

  it('rejects an invalid to_status', async () => {
    const result = await handleTaskToolCall(
      'transition_task',
      { task_id: 'ct1.task', expected_version: 1, to_status: 'cancelled' },
      dependencies(),
    );
    assert.equal(result?.status, 'error');
    assert.equal(result?.error?.code, 'task_input_invalid');
  });
});

describe('error mapping', () => {
  it('maps API 4xx responses to structured errors with the server code', async () => {
    const result = await handleTaskToolCall(
      'transition_task',
      { task_id: 'ct1.task', expected_version: 1, to_status: 'completed' },
      dependencies({
        fetch: async () => new Response(
          JSON.stringify({ code: 'version_conflict', message: 'expected_version mismatch' }),
          { status: 409, headers: { 'content-type': 'application/json' } },
        ),
      }),
    );
    assert.equal(result?.status, 'error');
    assert.equal(result?.error?.code, 'version_conflict');
    assert.equal(result?.error?.http_status, 409);
  });

  it('maps API 5xx responses to unavailable', async () => {
    const result = await handleTaskToolCall(
      'create_task',
      { title: 'x' },
      dependencies({ fetch: async () => new Response('oops', { status: 503, statusText: 'Service Unavailable' }) }),
    );
    assert.equal(result?.status, 'unavailable');
    assert.equal(result?.error?.code, 'task_api_unavailable');
    assert.equal(result?.error?.http_status, 503);
  });

  it('maps network failures to unavailable', async () => {
    const result = await handleTaskToolCall(
      'create_task',
      { title: 'x' },
      dependencies({ fetch: async () => { throw new Error('connect ECONNREFUSED'); } }),
    );
    assert.equal(result?.status, 'unavailable');
    assert.equal(result?.error?.code, 'task_api_unavailable');
  });

  it('flags non-object success payloads as contract errors', async () => {
    const result = await handleTaskToolCall(
      'create_task',
      { title: 'x' },
      dependencies({ fetch: async () => new Response('[]', { status: 200 }) }),
    );
    assert.equal(result?.status, 'error');
    assert.equal(result?.error?.code, 'task_contract_error');
  });
});
