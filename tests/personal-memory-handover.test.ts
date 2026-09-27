import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../src/cli.js';
import {
  createLocalPersonalKnowledgeStore,
  decodePersonalKnowledgeContextHeader,
  PERSONAL_KNOWLEDGE_CONTEXT_HEADER,
  PERSONAL_KNOWLEDGE_CONTEXT_VERSION_HEADER,
  type PersonalKnowledgeContext
} from '../src/personal-knowledge.js';
import { MEMORY_REGISTRATION_RECEIPTS_FILE, organizationMemoryEventId } from '../src/personal-memory-handover.js';
import { createFixturePersonalOs } from './fixtures.js';

const localContext: PersonalKnowledgeContext = {
  contract_version: 1,
  scope: 'personal_owned',
  owner_person_id: 'local-owner',
  organization_id: null,
  source_id: 'local-source'
};

const organizationContext: PersonalKnowledgeContext = {
  contract_version: 1,
  scope: 'organization_private',
  owner_person_id: 'person-member',
  organization_id: 'org-test',
  source_id: 'managed-source'
};

const organizationSettings = {
  BRAINBASE_ORGANIZATION_URL: 'https://org.example.test',
  BRAINBASE_ORGANIZATION_TOKEN: 'member-signed-test-token',
  BRAINBASE_ORGANIZATION_PROJECT: 'authorized-project',
  BRAINBASE_ORGANIZATION_GRAPH_ID: 'snapshot'
};

interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body?: Record<string, unknown>;
}

/**
 * A stand-in for the organization's canonical route. It keeps the server's
 * idempotency rule: the same event_id with the same content returns the
 * stored event, and the same event_id with other content is a 409.
 */
function fakeOrganization(options: { context?: PersonalKnowledgeContext; failPost?: (body: Record<string, unknown>) => Response | undefined } = {}) {
  const context = options.context ?? organizationContext;
  const stored = new Map<string, Record<string, unknown>>();
  const requests: RecordedRequest[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    requests.push({ url, method: init?.method ?? 'GET', headers, body });
    if (headers.get('authorization') !== `Bearer ${organizationSettings.BRAINBASE_ORGANIZATION_TOKEN}`) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }
    if (url.endsWith('/api/personal-knowledge/context') && init?.method === 'GET') {
      return new Response(JSON.stringify({ context }), { status: 200 });
    }
    if (url.endsWith('/api/personal-knowledge/events') && init?.method === 'POST' && body) {
      expect(headers.get(PERSONAL_KNOWLEDGE_CONTEXT_VERSION_HEADER)).toBe('1');
      expect(decodePersonalKnowledgeContextHeader(headers.get(PERSONAL_KNOWLEDGE_CONTEXT_HEADER))).toEqual(context);
      const failure = options.failPost?.(body);
      if (failure) return failure;
      const eventId = String(body.event_id);
      const existing = stored.get(eventId);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(body)) {
          return new Response(JSON.stringify({ error: 'personal_knowledge_event_identity_conflict' }), { status: 409 });
        }
        return new Response(JSON.stringify({ context, event: existing }), { status: 201 });
      }
      stored.set(eventId, body);
      return new Response(JSON.stringify({ context, event: body }), { status: 201 });
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  });
  return { fetch, requests, stored, posts: () => requests.filter((request) => request.method === 'POST') };
}

async function run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const code = await runCli(args, {
    stdout: { write: (chunk: string) => { stdout += chunk; return true; } },
    stderr: { write: (chunk: string) => { stderr += chunk; return true; } }
  });
  return { code, stdout, stderr };
}

function stubOrganization(): void {
  for (const [key, value] of Object.entries(organizationSettings)) vi.stubEnv(key, value);
}

async function receipts(dir: string): Promise<Array<Record<string, unknown>>> {
  try {
    const text = await readFile(join(dir, MEMORY_REGISTRATION_RECEIPTS_FILE), 'utf8');
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

describe('H7 local memory re-registration', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'brainbase-memory-handover-'));
    await createFixturePersonalOs(dir);
    const store = createLocalPersonalKnowledgeStore({ dataDir: dir, context: localContext });
    await store.register({
      event_id: 'event-judgment',
      body: 'Decide with the owner before promising a delivery date.',
      type: 'judgment',
      tags: ['delivery'],
      occurred_at: '2026-09-01T09:00:00.000Z',
      source_pointer: { path: '/Users/private/notes/delivery.md' },
      metadata: { local_file: '/Users/private/notes/delivery.md' }
    });
    await store.register({ event_id: 'event-private', body: 'Private reflection that must stay on this machine.' });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  it('lists memories from both local stores with stable ids and registration state, without network access', async () => {
    stubOrganization();
    const organization = fakeOrganization();
    vi.stubGlobal('fetch', organization.fetch);

    const json = await run(['memory:list', '--dir', dir, '--format', 'json']);
    expect(json.code).toBe(0);
    const listed = JSON.parse(json.stdout) as { memories: Array<Record<string, unknown>> };
    expect(listed.memories.map((memory) => [memory.id, memory.store, memory.type, memory.status])).toEqual([
      ['v1:event-judgment', 'personal-knowledge-v1', 'judgment', 'unregistered'],
      ['v1:event-private', 'personal-knowledge-v1', null, 'unregistered'],
      ['legacy:self-1', 'personal-kg', 'self', 'unregistered'],
      ['legacy:work-1', 'personal-kg', 'work', 'unregistered'],
      ['legacy:judgment-1', 'personal-kg', 'judgment', 'unregistered'],
      ['legacy:sns-context-1', 'personal-kg', 'sns_context', 'unregistered']
    ]);
    expect(listed.memories[0]?.preview).toBe('Decide with the owner before promising a delivery date.');

    const text = await run(['memory:list', '--dir', dir]);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain('v1:event-judgment');
    expect(text.stdout).toContain('legacy:work-1');
    expect(text.stdout).toContain('searchable in the organization only after you register it');
    expect(organization.fetch).not.toHaveBeenCalled();
    expect((await run(['memory:list', '--dir', dir, '--format', 'xml'])).code).not.toBe(0);
  });

  it('previews only the selected memories and sends nothing without --write', async () => {
    stubOrganization();
    const organization = fakeOrganization();
    vi.stubGlobal('fetch', organization.fetch);

    const result = await run(['memory:register', '--dir', dir, '--id', 'legacy:work-1', '--format', 'json']);
    expect(result.code).toBe(0);
    const preview = JSON.parse(result.stdout) as { status: string; sent: boolean; memories: Array<{ id: string; event: Record<string, unknown> }> };
    expect(preview.status).toBe('preview');
    expect(preview.sent).toBe(false);
    expect(preview.memories.map((memory) => memory.id)).toEqual(['legacy:work-1']);
    expect(preview.memories[0]?.event.body).toBe('Brainbase v1 should provide local MCP context without UI.');
    expect(result.stdout).not.toContain('Private reflection');
    expect(organization.fetch).not.toHaveBeenCalled();
    expect(await receipts(dir)).toEqual([]);

    const text = await run(['memory:register', '--dir', dir, '--id', 'legacy:work-1']);
    expect(text.stdout).toContain('Nothing was sent');
    expect(organization.fetch).not.toHaveBeenCalled();
  });

  it('sends only the selected memories and records a receipt after the organization confirms', async () => {
    stubOrganization();
    const organization = fakeOrganization();
    vi.stubGlobal('fetch', organization.fetch);

    const result = await run(['memory:register', '--dir', dir, '--id', 'v1:event-judgment', '--id', 'legacy:self-1', '--write', '--format', 'json']);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);

    const posts = organization.posts();
    expect(posts.map((post) => (post.body?.source_pointer as { memory_id: string }).memory_id)).toEqual(['v1:event-judgment', 'legacy:self-1']);
    const sentText = JSON.stringify(organization.requests.map((request) => request.body ?? null));
    expect(sentText).not.toContain('Private reflection');
    expect(sentText).not.toContain('Brainbase v1 should provide local MCP context');
    // Local paths and local-only metadata never leave the machine.
    expect(sentText).not.toContain('/Users/private');
    expect(posts[0]?.body).toMatchObject({
      body: 'Decide with the owner before promising a delivery date.',
      type: 'judgment',
      tags: ['delivery'],
      occurred_at: '2026-09-01T09:00:00.000Z',
      source: { system: 'brainbase-oss', store: 'personal-knowledge-v1' }
    });
    expect(posts[0]?.body).not.toHaveProperty('metadata');
    for (const forbidden of ['owner_person_id', 'organization_id', 'source_id']) {
      expect(posts[0]?.body).not.toHaveProperty(forbidden);
    }

    const recorded = await receipts(dir);
    expect(recorded.map((receipt) => [receipt.memory_id, receipt.event_id, receipt.organization_id, receipt.owner_person_id])).toEqual([
      ['v1:event-judgment', posts[0]?.body?.event_id, 'org-test', 'person-member'],
      ['legacy:self-1', posts[1]?.body?.event_id, 'org-test', 'person-member']
    ]);
    expect((await stat(join(dir, MEMORY_REGISTRATION_RECEIPTS_FILE))).mode & 0o777).toBe(0o600);

    const listed = JSON.parse((await run(['memory:list', '--dir', dir, '--format', 'json'])).stdout) as { memories: Array<Record<string, unknown>> };
    expect(Object.fromEntries(listed.memories.map((memory) => [memory.id, memory.status]))).toEqual({
      'v1:event-judgment': 'registered',
      'v1:event-private': 'unregistered',
      'legacy:self-1': 'registered',
      'legacy:work-1': 'unregistered',
      'legacy:judgment-1': 'unregistered',
      'legacy:sns-context-1': 'unregistered'
    });
  });

  it('re-sending the same memory produces the same organization event', async () => {
    stubOrganization();
    const organization = fakeOrganization();
    vi.stubGlobal('fetch', organization.fetch);

    expect((await run(['memory:register', '--dir', dir, '--id', 'legacy:self-1', '--write'])).code).toBe(0);
    expect((await run(['memory:register', '--dir', dir, '--id', 'legacy:self-1', '--write'])).code).toBe(0);

    const posts = organization.posts();
    expect(posts).toHaveLength(2);
    expect(posts[1]?.body).toEqual(posts[0]?.body);
    expect(organization.stored.size).toBe(1);
    const recorded = await receipts(dir);
    expect(recorded).toHaveLength(2);
    expect(recorded[1]?.event_id).toBe(recorded[0]?.event_id);

    // The key is derived from the memory and its destination, so another
    // owner or organization never collides with this owner's event.
    const digest = String(recorded[0]?.memory_digest);
    expect(organizationMemoryEventId(organizationContext, digest)).toBe(recorded[0]?.event_id);
    expect(organizationMemoryEventId({ ...organizationContext, owner_person_id: 'person-other' }, digest)).not.toBe(recorded[0]?.event_id);
    expect(organizationMemoryEventId({ ...organizationContext, organization_id: 'org-other' }, digest)).not.toBe(recorded[0]?.event_id);
  });

  it('shows a changed memory and registers the new content as a new event', async () => {
    stubOrganization();
    const organization = fakeOrganization();
    vi.stubGlobal('fetch', organization.fetch);
    expect((await run(['memory:register', '--dir', dir, '--id', 'legacy:work-1', '--write'])).code).toBe(0);

    const kgPath = join(dir, 'personal-kg.jsonl');
    const lines = (await readFile(kgPath, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
    await writeFile(kgPath, `${lines.map((line) => JSON.stringify(line.id === 'work-1' ? { ...line, text: 'Brainbase v1 now has a local Web UI.' } : line)).join('\n')}\n`);

    const listed = JSON.parse((await run(['memory:list', '--dir', dir, '--format', 'json'])).stdout) as { memories: Array<Record<string, unknown>> };
    expect(listed.memories.find((memory) => memory.id === 'legacy:work-1')?.status).toBe('changed');

    expect((await run(['memory:register', '--dir', dir, '--id', 'legacy:work-1', '--write'])).code).toBe(0);
    const recorded = await receipts(dir);
    expect(recorded).toHaveLength(2);
    expect(recorded[1]?.event_id).not.toBe(recorded[0]?.event_id);
    expect(organization.stored.size).toBe(2);
  });

  it('leaves no receipt for a memory the organization did not confirm', async () => {
    stubOrganization();
    const organization = fakeOrganization({
      failPost: (body) => (body.source_pointer as { memory_id: string }).memory_id === 'legacy:work-1'
        ? new Response(JSON.stringify({ error: 'personal_knowledge_event_identity_conflict' }), { status: 409 })
        : undefined
    });
    vi.stubGlobal('fetch', organization.fetch);

    const failed = await run(['memory:register', '--dir', dir, '--id', 'legacy:work-1', '--write']);
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain('legacy:work-1');
    expect(failed.stderr).not.toContain(organizationSettings.BRAINBASE_ORGANIZATION_TOKEN);
    expect(await receipts(dir)).toEqual([]);

    const partial = await run(['memory:register', '--dir', dir, '--id', 'legacy:self-1', '--id', 'legacy:work-1', '--id', 'v1:event-judgment', '--write']);
    expect(partial.code).toBe(1);
    expect(partial.stderr).toContain('legacy:self-1');
    expect((await receipts(dir)).map((receipt) => receipt.memory_id)).toEqual(['legacy:self-1']);
    // Registration stops at the first failure; later selections are not sent.
    expect(organization.posts().some((post) => (post.body?.source_pointer as { memory_id: string }).memory_id === 'v1:event-judgment')).toBe(false);
  });

  it('refuses a server that does not echo the requested event and records nothing', async () => {
    stubOrganization();
    const organization = fakeOrganization({
      failPost: (body) => new Response(JSON.stringify({ context: organizationContext, event: { ...body, event_id: 'pke_other' } }), { status: 201 })
    });
    vi.stubGlobal('fetch', organization.fetch);
    const result = await run(['memory:register', '--dir', dir, '--id', 'legacy:self-1', '--write']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('personal_memory_registration_readback_mismatch');
    expect(await receipts(dir)).toEqual([]);
  });

  it('checks the selection and the destination before sending anything', async () => {
    const organization = fakeOrganization();
    vi.stubGlobal('fetch', organization.fetch);

    const noSelection = await run(['memory:register', '--dir', dir, '--write']);
    expect(noSelection.code).toBe(1);
    expect(noSelection.stderr).toContain('--id');

    const noSettings = await run(['memory:register', '--dir', dir, '--id', 'legacy:self-1', '--write']);
    expect(noSettings.code).toBe(1);
    expect(noSettings.stderr).toContain('BRAINBASE_ORGANIZATION_');

    stubOrganization();
    const unknown = await run(['memory:register', '--dir', dir, '--id', 'legacy:self-1', '--id', 'legacy:missing', '--write']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('legacy:missing');
    expect(organization.fetch).not.toHaveBeenCalled();

    const personalDestination = fakeOrganization({ context: localContext });
    vi.stubGlobal('fetch', personalDestination.fetch);
    const refused = await run(['memory:register', '--dir', dir, '--id', 'legacy:self-1', '--write']);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('personal_memory_destination_not_organization');
    expect(personalDestination.posts()).toEqual([]);
    expect(await receipts(dir)).toEqual([]);
  });

  it('rejects a malformed receipt file instead of guessing registration state', async () => {
    await mkdir(join(dir, 'handover'), { recursive: true });
    await appendFile(join(dir, MEMORY_REGISTRATION_RECEIPTS_FILE), 'not json\n');
    const result = await run(['memory:list', '--dir', dir]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(MEMORY_REGISTRATION_RECEIPTS_FILE);
  });

  it('lists nothing and creates nothing for an empty data directory', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'brainbase-memory-empty-'));
    try {
      const result = await run(['memory:list', '--dir', empty]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('No local memories');
      await expect(stat(join(empty, 'personal-knowledge-v1'))).rejects.toThrow();
      await expect(stat(join(empty, 'handover'))).rejects.toThrow();
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
