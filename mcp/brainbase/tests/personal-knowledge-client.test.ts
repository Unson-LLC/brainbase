import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PersonalKnowledgeClient } from '../src/personal-knowledge-client.js';
import { normalizePersonalKgApiUrl } from '../src/config.js';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: 'pke_client_1',
    body: '個人の判断メモ',
    body_hash: 'sha256:body',
    source: { type: 'codex' },
    source_pointer: { uri: 'codex://session/1' },
    ...overrides,
  };
}

describe('PersonalKnowledgeClient', () => {
  it('normalizes and constrains local and managed cloud endpoints', () => {
    assert.equal(
      normalizePersonalKgApiUrl('http://127.0.0.1:31013/', 'local'),
      'http://127.0.0.1:31013',
    );
    assert.equal(
      normalizePersonalKgApiUrl('https://bb.unson.jp/', 'managed_cloud'),
      'https://bb.unson.jp',
    );
    assert.throws(
      () => normalizePersonalKgApiUrl('http://bb.unson.jp', 'managed_cloud'),
      /HTTPS/,
    );
    assert.throws(
      () => normalizePersonalKgApiUrl('https://127.0.0.1', 'managed_cloud'),
      /managed_cloud|HTTPS/,
    );
    assert.throws(
      () => normalizePersonalKgApiUrl('https://user:pass@bb.unson.jp', 'managed_cloud'),
      /credentials|query|hash/,
    );
    assert.throws(
      () => normalizePersonalKgApiUrl('https://bb.unson.jp?token=secret', 'managed_cloud'),
      /credentials|query|hash/,
    );
    assert.throws(
      () => normalizePersonalKgApiUrl('https://bb.unson.jp/#token', 'managed_cloud'),
      /credentials|query|hash/,
    );
    assert.throws(
      () => normalizePersonalKgApiUrl('http://192.0.2.10:31013', 'local'),
      /loopback/,
    );
  });

  it('searches the canonical endpoint with bounded input and no redirect', async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const client = new PersonalKnowledgeClient({
      mode: 'local',
      apiUrl: 'http://127.0.0.1:31013',
      getToken: async () => 'owner-token',
      fetch: async (input, init) => {
        calls.push({ input, init });
        return jsonResponse([{ event_id: 'pke_1', body: '判断メモ' }]);
      },
    });

    const result = await client.search('  判断基準  ', 2);

    assert.deepEqual(result, [{ event_id: 'pke_1', body: '判断メモ' }]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, 'http://127.0.0.1:31013/api/personal-knowledge/search');
    assert.equal(calls[0].init?.method, 'POST');
    assert.equal(calls[0].init?.redirect, 'error');
    assert.equal(new Headers(calls[0].init?.headers).get('authorization'), 'Bearer owner-token');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { query: '判断基準', limit: 2 });
  });

  it('rejects wrapped or unidentifiable canonical search responses', async () => {
    for (const payload of [
      { events: [] },
      { candidates: [] },
      [{}],
      [{ event_id: 123 }],
    ]) {
      const client = new PersonalKnowledgeClient({
        mode: 'managed_cloud',
        apiUrl: 'https://bb.unson.jp',
        getToken: async () => 'owner-token',
        fetch: async () => jsonResponse(payload),
      });
      await assert.rejects(client.search('判断'), /schema|event_id/i);
    }
  });

  it('registers an event and requires a complete canonical receipt', async () => {
    const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
    const client = new PersonalKnowledgeClient({
      mode: 'managed_cloud',
      apiUrl: 'https://bb.unson.jp',
      getToken: async () => 'owner-token',
      fetch: async (input, init) => {
        calls.push({ input, init });
        return jsonResponse({
          event_id: 'pke_1',
          owner_person_id: 'per_owner',
          organization_id: 'org_owner',
          body_hash: 'sha256:body',
        }, 201);
      },
    });
    const input = event();

    const receipt = await client.register(input);

    assert.deepEqual(receipt, {
      event_id: 'pke_1',
      owner_person_id: 'per_owner',
      organization_id: 'org_owner',
      body_hash: 'sha256:body',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, 'https://bb.unson.jp/api/personal-knowledge/events');
    assert.equal(calls[0].init?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), input);

    for (const payload of [{}, { error: 'accepted' }]) {
      const invalidClient = new PersonalKnowledgeClient({
        mode: 'managed_cloud',
        apiUrl: 'https://bb.unson.jp',
        getToken: async () => 'owner-token',
        fetch: async () => jsonResponse(payload),
      });
      await assert.rejects(invalidClient.register(input), /response field|schema/i);
    }
  });

  it('rejects caller supplied identity and authority fields before network access', async () => {
    let calls = 0;
    const client = new PersonalKnowledgeClient({
      mode: 'local',
      apiUrl: 'http://127.0.0.1:31013',
      getToken: async () => 'owner-token',
      fetch: async () => {
        calls += 1;
        return jsonResponse({});
      },
    });

    for (const field of ['owner_person_id', 'organization_id', 'company_authority_response', 'destination']) {
      await assert.rejects(
        client.register(event({ [field]: 'caller-controlled' })),
        /authentication-derived/,
      );
    }
    assert.equal(calls, 0);
  });

  it('rejects fields that the canonical event table does not persist and empty bodies', async () => {
    let calls = 0;
    const client = new PersonalKnowledgeClient({
      mode: 'local',
      apiUrl: 'http://127.0.0.1:31013',
      getToken: async () => 'owner-token',
      fetch: async () => {
        calls += 1;
        return jsonResponse({});
      },
    });

    await assert.rejects(
      client.register(event({ payload: { summary: 'not persisted' } })),
      /unsupported fields.*payload/,
    );
    await assert.rejects(
      client.register(event({ body: '  ' })),
      /body must be a non-empty string/,
    );
    assert.equal(calls, 0);
  });

  it('enforces query and limit bounds before network access', async () => {
    let calls = 0;
    const client = new PersonalKnowledgeClient({
      mode: 'managed_cloud',
      apiUrl: 'https://bb.unson.jp',
      getToken: async () => 'owner-token',
      fetch: async () => {
        calls += 1;
        return jsonResponse([]);
      },
    });

    await assert.rejects(client.search('x'.repeat(4001)), /4000/);
    await assert.rejects(client.search('x', 0), /between 1 and 50/);
    await assert.rejects(client.search('x', 51), /between 1 and 50/);
    await assert.rejects(client.search('x', 1.5), /between 1 and 50/);
    assert.equal(calls, 0);
  });

  it('does not retry or fall back after a canonical endpoint failure', async () => {
    let calls = 0;
    const client = new PersonalKnowledgeClient({
      mode: 'managed_cloud',
      apiUrl: 'https://bb.unson.jp',
      getToken: async () => 'owner-token',
      fetch: async () => {
        calls += 1;
        return jsonResponse({ error: 'service unavailable' }, 503);
      },
    });

    await assert.rejects(client.search('判断'), /503/);
    assert.equal(calls, 1);
  });
});
