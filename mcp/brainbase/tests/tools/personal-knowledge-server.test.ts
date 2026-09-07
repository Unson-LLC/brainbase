import assert from 'node:assert/strict';
import { mock, describe, it } from 'node:test';
import { __testing } from '../../src/server.js';

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Personal KG MCP server wiring', () => {
  it('uses canonical POST search only when an explicit storage mode is configured', async () => {
    __testing.setPersonalKgStorage('managed_cloud', 'https://bb.unson.jp');
    __testing.setOwnerTokenManager({ getToken: async () => 'owner-token' });
    const fetchMock = mock.method(globalThis, 'fetch', async (_input, init) => {
      assert.equal(init?.method, 'POST');
      assert.equal(init?.redirect, 'error');
      assert.deepEqual(JSON.parse(String(init?.body)), { query: '判断基準', limit: 2 });
      return response([{ event_id: 'pke_1', body: '判断メモ', occurred_at: '2026-09-06T00:00:00.000Z' }]);
    });

    try {
      const output = await __testing.handleToolCall('search_personal_kg', {
        query: '判断基準',
        limit: 2,
      });
      assert.match(output, /判断メモ/);
      assert.match(output, /pke_1/);
      assert.equal(fetchMock.mock.callCount(), 1);
    } finally {
      fetchMock.mock.restore();
      __testing.setPersonalKgStorage(null);
    }
  });

  it('fails explicitly when canonical storage cannot apply the legacy cognitive_type filter', async () => {
    __testing.setPersonalKgStorage('managed_cloud', 'https://bb.unson.jp');
    __testing.setOwnerTokenManager({ getToken: async () => 'owner-token' });
    const fetchMock = mock.method(globalThis, 'fetch', async () => response([]));

    try {
      await assert.rejects(
        __testing.handleToolCall('search_personal_kg', {
          query: '判断基準',
          cognitive_type: 'claim',
        }),
        /cognitive_type.*unavailable|canonical storage/,
      );
      assert.equal(fetchMock.mock.callCount(), 0);
    } finally {
      fetchMock.mock.restore();
      __testing.setPersonalKgStorage(null);
    }
  });

  it('keeps unset search on the legacy candidate route and rejects unset registration', async () => {
    __testing.setPersonalKgStorage(null);
    __testing.setWikiApiBaseUrl('https://bb.example.test');
    __testing.setOwnerTokenManager({ getToken: async () => 'owner-token' });
    const fetchMock = mock.method(globalThis, 'fetch', async () => response({ candidates: [] }));

    try {
      const search = await __testing.handleToolCall('search_personal_kg', { query: '判断基準' });
      assert.match(search, /No personal KG entries/);
      assert.equal(fetchMock.mock.callCount(), 1);
      assert.match(String(fetchMock.mock.calls[0].arguments[0]), /memory-candidates\/search/);
      assert.equal(fetchMock.mock.calls[0].arguments[1]?.redirect, 'error');

      await assert.rejects(
        __testing.handleToolCall('register_personal_kg', {
          event: { body: 'should not write', body_hash: 'sha256:body' },
        }),
        /explicit BRAINBASE_PERSONAL_KG_STORAGE_MODE|no legacy write fallback/,
      );
      assert.equal(fetchMock.mock.callCount(), 1);
    } finally {
      fetchMock.mock.restore();
    }
  });

  it('registers through canonical events and returns the validated receipt', async () => {
    __testing.setPersonalKgStorage('local', 'http://127.0.0.1:31013');
    __testing.setOwnerTokenManager({ getToken: async () => 'owner-token' });
    const fetchMock = mock.method(globalThis, 'fetch', async (_input, init) => {
      assert.equal(init?.method, 'POST');
      assert.equal(init?.redirect, 'error');
      return response({
        event_id: 'pke_1',
        owner_person_id: 'per_owner',
        organization_id: 'org_owner',
        body_hash: 'sha256:body',
      }, 201);
    });

    try {
      const output = await __testing.handleToolCall('register_personal_kg', {
        event: {
          event_id: 'pke_1',
          body: '個人メモ',
          body_hash: 'sha256:body',
          source: { type: 'codex' },
          source_pointer: { uri: 'codex://session/1' },
        },
      });
      const receipt = JSON.parse(output) as Record<string, unknown>;
      assert.deepEqual(receipt, {
        event_id: 'pke_1',
        owner_person_id: 'per_owner',
        organization_id: 'org_owner',
        body_hash: 'sha256:body',
      });
      assert.equal(fetchMock.mock.callCount(), 1);
    } finally {
      fetchMock.mock.restore();
      __testing.setPersonalKgStorage(null);
    }
  });
});
