import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  assertPersonalKnowledgeContextMatch,
  createLocalPersonalKnowledgeStore,
  createPersonalKnowledgeClient,
  decodePersonalKnowledgeContextHeader,
  encodePersonalKnowledgeContextHeader,
  normalizePersonalKnowledgeEvent,
  normalizePersonalKnowledgeSearchInput,
  PERSONAL_KNOWLEDGE_CONTEXT_HEADER,
  PERSONAL_KNOWLEDGE_CONTEXT_VERSION_HEADER,
  PERSONAL_KNOWLEDGE_CONTRACT_VERSION,
  normalizePersonalKnowledgeApiUrl,
  type PersonalKnowledgeContext
} from '../src/personal-knowledge.js';

const context: PersonalKnowledgeContext = {
  contract_version: PERSONAL_KNOWLEDGE_CONTRACT_VERSION,
  scope: 'personal_owned',
  owner_person_id: 'person-test',
  organization_id: null,
  source_id: 'source-test'
};

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'brainbase-personal-knowledge-'));
}

describe('personal knowledge v1 common contract', () => {
  it('validates exact context fields and round-trips the expected header', () => {
    const header = encodePersonalKnowledgeContextHeader(context);
    expect(decodePersonalKnowledgeContextHeader(header)).toEqual(context);
    expect(() => decodePersonalKnowledgeContextHeader(`${header}=`)).toThrow(/base64url/);
    expect(() => assertPersonalKnowledgeContextMatch(context, {
      ...context,
      source_id: 'another-source'
    })).toThrow(/mismatch/);
    expect(() => encodePersonalKnowledgeContextHeader({ ...context, path: '/tmp' })).toThrow(/unsupported/);
  });

  it('normalizes event body hashes and rejects caller-controlled identity', () => {
    const event = normalizePersonalKnowledgeEvent({ event_id: 'event-1', body: 'hello', source: 'test' });
    expect(event.body_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(() => normalizePersonalKnowledgeEvent({ event_id: 'event-1', body: 'hello', owner_person_id: 'other' })).toThrow(/authentication-derived/);
    expect(() => normalizePersonalKnowledgeEvent({ event_id: 'event-1', body: 'hello', body_hash: 'sha256:bad' })).toThrow(/does not match/);
    expect(normalizePersonalKnowledgeSearchInput(' hello ', 2)).toEqual({ query: 'hello', limit: 2 });
  });

  it('accepts strict ISO timestamps and rejects invalid dates before local or managed storage', () => {
    const event = normalizePersonalKnowledgeEvent({
      event_id: 'event-time',
      body: 'timestamped fact',
      occurred_at: '2026-02-28T09:00:00.000Z',
      captured_at: '2026-02-28T18:00:00+09:00'
    });
    expect(event.occurred_at).toBe('2026-02-28T09:00:00.000Z');
    expect(event.captured_at).toBe('2026-02-28T18:00:00+09:00');
    for (const timestamp of ['not-a-date', 'July 1, 2026', '2026-02-30T09:00:00.000Z', '2026-01-01']) {
      expect(() => normalizePersonalKnowledgeEvent({ event_id: 'event-time', body: 'fact', occurred_at: timestamp })).toThrow(/ISO 8601/);
    }
  });
});

describe('local personal knowledge store', () => {
  it('keeps a durable independent store and makes same-id retries idempotent', async () => {
    const parent = await temporaryDirectory();
    try {
      const event = { event_id: 'event-1', body: 'local durable fact' };
      const store = createLocalPersonalKnowledgeStore({ dataDir: parent, context });
      const [first, retry, concurrentA, concurrentB] = await Promise.all([
        store.register(event),
        store.register(event),
        store.register({ event_id: 'event-2', body: 'second fact' }),
        store.register({ event_id: 'event-2', body: 'second fact' })
      ]);
      expect(first.event).toEqual(retry.event);
      expect(concurrentA.event).toEqual(concurrentB.event);
      await expect(store.register({ event_id: 'event-1', body: 'different fact' })).rejects.toThrow(/identity_conflict/);

      const restarted = createLocalPersonalKnowledgeStore({ dataDir: parent, context });
      await expect(restarted.getContext()).resolves.toEqual({ context });
      const searched = await restarted.search('durable', 10);
      expect(searched.context).toEqual(context);
      expect(searched.results.map((item) => item.event_id)).toEqual(['event-1']);
      const eventsPath = join(parent, 'personal-knowledge-v1', 'events.jsonl');
      expect((await readFile(eventsPath, 'utf8')).trim().split('\n')).toHaveLength(2);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('does not permit an organization context in OSS local storage', async () => {
    const parent = await temporaryDirectory();
    try {
      expect(() => createLocalPersonalKnowledgeStore({
        dataDir: parent,
        context: {
          ...context,
          scope: 'organization_private',
          organization_id: 'org-test'
        }
      })).toThrow(/personal_owned/);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

describe('managed personal knowledge client', () => {
  it('preflights context and sends exact version/context headers for register', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createPersonalKnowledgeClient({
      mode: 'local',
      apiUrl: 'http://127.0.0.1:31099',
      expectedContext: context,
      token: 'token-test',
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        if (requests.length === 1) return new Response(JSON.stringify({ context }), { status: 200 });
        return new Response(JSON.stringify({ context, event: normalizePersonalKnowledgeEvent({ event_id: 'event-1', body: 'managed fact' }) }), { status: 200 });
      }
    });

    const result = await client.register({ event_id: 'event-1', body: 'managed fact' });
    expect(result.context).toEqual(context);
    expect(requests).toHaveLength(2);
    expect(requests[0].url).toBe('http://127.0.0.1:31099/api/personal-knowledge/context');
    expect(requests[1].url).toBe('http://127.0.0.1:31099/api/personal-knowledge/events');
    const firstHeaders = new Headers(requests[0].init?.headers);
    const secondHeaders = new Headers(requests[1].init?.headers);
    expect(firstHeaders.get(PERSONAL_KNOWLEDGE_CONTEXT_VERSION_HEADER)).toBe('1');
    expect(firstHeaders.get(PERSONAL_KNOWLEDGE_CONTEXT_HEADER)).toBeNull();
    expect(secondHeaders.get(PERSONAL_KNOWLEDGE_CONTEXT_VERSION_HEADER)).toBe('1');
    expect(secondHeaders.get(PERSONAL_KNOWLEDGE_CONTEXT_HEADER)).toBe(encodePersonalKnowledgeContextHeader(context));
    expect(secondHeaders.get('authorization')).toBe('Bearer token-test');
  });

  it('rejects non-loopback local URLs and non-HTTPS managed URLs', () => {
    expect(() => normalizePersonalKnowledgeApiUrl('http://example.test', 'local')).toThrow(/loopback/);
    expect(() => normalizePersonalKnowledgeApiUrl('http://example.test', 'managed_cloud')).toThrow(/HTTPS/);
    for (const host of [
      '127.0.0.1',
      '127.42.99.7',
      '127.255.255.254',
      'localhost.',
      '[::1]',
      '[0:0:0:0:0:0:0:1]',
      '[::ffff:127.0.0.1]',
      '[::ffff:7f00:1]'
    ]) {
      expect(() => normalizePersonalKnowledgeApiUrl(`https://${host}:3100`, 'managed_cloud')).toThrow(/loopback/);
    }
    expect(normalizePersonalKnowledgeApiUrl('https://128.0.0.1:3100', 'managed_cloud')).toBe('https://128.0.0.1:3100');
  });
});
