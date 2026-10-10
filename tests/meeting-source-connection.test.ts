import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import {
  createMcpOAuthConnectionAdapter,
  createMeetingSourceConnectionId,
  FileMeetingSourceCredentialStore,
  findSameMeetingCandidates,
  MemoryMeetingSourceCredentialStore,
  MemoryMeetingSourceSyncStateStore,
  NativeMcpRuntime,
  normalizeMeetingSourceConnectionRecord,
  probeMeetingSourceConnection,
  syncMeetingSourceConnection,
  type ConnectionRuntime,
  type MeetingSourceConnectionRecord,
  type MeetingSourceDelivery,
  type StoredMeetingSourceCredentials,
} from '../src/meeting-source-connection.js';
import { createTactiqTranscriptBudget, type MeetingSourceCallTool } from '../src/meeting-source-reader.js';
import {
  OrganizationConnectionService,
  type OrganizationConnectionStateRecord,
  type OrganizationConnectionStateRepository,
} from '../src/organization-connection.js';

// ---------------------------------------------------------------------------
// Fakes shaped like the official Plaud and Tactiq MCP responses

const textResult = (payload: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
const errorResult = (text: string) => ({ isError: true, content: [{ type: 'text', text }] });

interface PlaudFile {
  id: string;
  start_at: string;
  /** `null` while Plaud is still transcribing. */
  segments: Array<{ speaker: string; content: string }> | null;
}

interface PlaudAccount {
  files: PlaudFile[];
  unauthorized?: boolean;
  calls: string[];
}

function plaudHandler(account: PlaudAccount) {
  return (name: string, args: Record<string, unknown>) => {
    account.calls.push(name);
    if (account.unauthorized) return errorResult('Not authenticated. Please login first.');
    if (name === 'list_files') {
      const page = Number(args.page ?? 1);
      const size = Number(args.page_size ?? 20);
      return textResult({ data: account.files.slice((page - 1) * size, page * size).map(({ id, start_at }) => ({ id, name: id, start_at })) });
    }
    if (name === 'get_transcript') {
      const file = account.files.find((entry) => entry.id === args.file_id);
      if (!file) return errorResult('file not found');
      const segments = (file.segments ?? []).map((segment, i) => ({ ...segment, start_time: i * 1000, end_time: i * 1000 + 900 }));
      const limit = Number(args.limit ?? 50);
      const offset = args.cursor ? Number(args.cursor) : 0;
      const page = segments.slice(offset, offset + limit);
      const next = offset + limit < segments.length ? String(offset + limit) : null;
      return textResult({ file_id: file.id, block: 'transaction', total: segments.length, next_cursor: next, segments: page });
    }
    return errorResult(`unknown tool ${name}`);
  };
}

function fakeRuntime(handlerFor: (connection: MeetingSourceConnectionRecord) => (name: string, args: Record<string, unknown>) => unknown): ConnectionRuntime {
  const runtime: ConnectionRuntime = {
    async callTool(connection, tool, args) {
      return handlerFor(connection)(tool, args);
    },
    async verify(connection, options) {
      return probeMeetingSourceConnection({ provider: connection.provider, callTool: (n, a) => runtime.callTool(connection, n, a), budget: options?.budget });
    },
    async disconnect() {},
  };
  return runtime;
}

function connection(overrides: Partial<MeetingSourceConnectionRecord> = {}): MeetingSourceConnectionRecord {
  return {
    connectionId: createMeetingSourceConnectionId(),
    tenantId: 'tenant-unson',
    provider: 'plaud',
    scope: 'personal',
    ownerPersonId: 'per_sato',
    orgId: null,
    backend: { kind: 'native', ref: null },
    capabilities: ['meetings:list', 'transcript:read'],
    status: 'connected',
    revision: 1,
    lastVerifiedAt: '2026-10-09T00:00:00.000Z',
    ...overrides,
  };
}

const NOW = new Date('2026-10-09T12:00:00.000Z');
const clock = (time = NOW) => () => new Date(time);
const words = (n: number) => Array.from({ length: n }, (_, i) => ({ speaker: 'Speaker 1', content: `発話 ${i}` }));

function collector() {
  const deliveries: MeetingSourceDelivery[] = [];
  return { deliveries, deliver: async (delivery: MeetingSourceDelivery) => void deliveries.push(delivery) };
}

/** A real SDK MCP server per account, linked to the client through an in-memory transport. */
function inMemoryServer(handler: (name: string, args: Record<string, unknown>) => unknown) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new Server({ name: 'fake-meeting-source', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => handler(request.params.name, request.params.arguments ?? {}) as never);
  void server.connect(serverTransport);
  return clientTransport;
}

function storedCredentials(accessToken: string, overrides: Partial<StoredMeetingSourceCredentials> = {}): StoredMeetingSourceCredentials {
  return {
    provider: 'plaud',
    binding: { tenantId: 'tenant-unson', personId: 'per_sato' },
    serverUrl: 'https://mcp.plaud.test/mcp',
    clientInformation: { client_id: 'client-1' },
    tokens: { access_token: accessToken, refresh_token: `${accessToken}-refresh`, token_type: 'Bearer' },
    connectedAt: '2026-10-09T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe('connection record (AC-01)', () => {
  it('accepts a Brainbase-issued record and keeps an external backend ID only as a reference', () => {
    const record = normalizeMeetingSourceConnectionRecord(connection({ backend: { kind: 'nango', ref: { connection_ref: 'nango-conn-42' } } }));
    expect(record.connectionId).toMatch(/^msc_[0-9a-f]{32}$/);
    expect(record.backend).toEqual({ kind: 'nango', ref: { connection_ref: 'nango-conn-42' } });
  });

  it('rejects secrets, missing owners, and IDs not issued by Brainbase', () => {
    expect(() => normalizeMeetingSourceConnectionRecord(connection({ backend: { kind: 'native', ref: { access_token: 'x' } } }))).toThrow(/looks like a secret/);
    expect(() => normalizeMeetingSourceConnectionRecord(connection({ backend: { kind: 'native', ref: { header: 'Bearer abc.def' } } }))).toThrow(/looks like a secret/);
    expect(() => normalizeMeetingSourceConnectionRecord(connection({ backend: { kind: 'native', ref: { id: 'eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl' } } }))).toThrow(/looks like a secret/);
    expect(() => normalizeMeetingSourceConnectionRecord(connection({ ownerPersonId: null }))).toThrow(/ownerPersonId/);
    expect(() => normalizeMeetingSourceConnectionRecord(connection({ scope: 'org', ownerPersonId: null }))).toThrow(/orgId/);
    expect(() => normalizeMeetingSourceConnectionRecord(connection({ connectionId: 'nango-conn-42' }))).toThrow(/issued by Brainbase/);
  });
});

describe('NativeMcpRuntime (AC-02, AC-03)', () => {
  it('gives each connection only its own credentials, and disconnect removes only that connection', async () => {
    const credentials = new MemoryMeetingSourceCredentialStore();
    const a = connection();
    const b = connection();
    await credentials.write(a.connectionId, storedCredentials('token-account-a'));
    await credentials.write(b.connectionId, storedCredentials('token-account-b'));
    const accounts: Record<string, PlaudAccount> = {
      'token-account-a': { files: [{ id: 'a-1', start_at: '2026-10-08T01:00:00Z', segments: words(3) }], calls: [] },
      'token-account-b': { files: [{ id: 'b-1', start_at: '2026-10-08T02:00:00Z', segments: words(3) }], calls: [] },
    };
    // Route by the access token the SDK would send for this connection.
    const runtime = new NativeMcpRuntime({
      credentials,
      createTransport: ({ connection: target }) => {
        const token = target.connectionId === a.connectionId ? 'token-account-a' : 'token-account-b';
        return inMemoryServer(plaudHandler(accounts[token]));
      },
    });
    const tokenFor = async (target: MeetingSourceConnectionRecord) => {
      let seen: string | undefined;
      const probe = new NativeMcpRuntime({
        credentials,
        createTransport: ({ authProvider }) => {
          const transport = inMemoryServer(plaudHandler({ files: [], calls: [] }));
          void Promise.resolve(authProvider.tokens()).then((tokens) => { seen = tokens?.access_token; });
          return transport;
        },
      });
      await probe.callTool(target, 'list_files', {});
      return seen;
    };
    expect(await tokenFor(a)).toBe('token-account-a');
    expect(await tokenFor(b)).toBe('token-account-b');

    const listA = await runtime.callTool(a, 'list_files', { page: 1, page_size: 10 });
    const listB = await runtime.callTool(b, 'list_files', { page: 1, page_size: 10 });
    expect(JSON.stringify(listA)).toContain('a-1');
    expect(JSON.stringify(listA)).not.toContain('b-1');
    expect(JSON.stringify(listB)).toContain('b-1');

    await runtime.disconnect(a);
    expect(await credentials.read(a.connectionId)).toBeNull();
    expect(await credentials.read(b.connectionId)).not.toBeNull();
    await expect(runtime.callTool(a, 'list_files', {})).rejects.toThrow(/OAuth authorization is required/);
  });

  it('hands the SDK a per-connection OAuth provider that stores refreshed tokens and never starts an interactive login', async () => {
    const credentials = new MemoryMeetingSourceCredentialStore();
    const a = connection();
    await credentials.write(a.connectionId, storedCredentials('token-old'));
    let captured: Parameters<NonNullable<ConstructorParameters<typeof NativeMcpRuntime>[0]['createTransport']>>[0]['authProvider'] | null = null;
    const runtime = new NativeMcpRuntime({
      credentials,
      createTransport: ({ authProvider }) => {
        captured = authProvider;
        return inMemoryServer(plaudHandler({ files: [], calls: [] }));
      },
    });
    await runtime.callTool(a, 'list_files', {});
    const provider = captured!;
    expect((await provider.tokens())?.access_token).toBe('token-old');
    await provider.saveTokens({ access_token: 'token-new', token_type: 'Bearer' });
    expect((await credentials.read(a.connectionId))?.tokens?.access_token).toBe('token-new');
    expect(() => provider.redirectToAuthorization(new URL('https://auth.test/authorize?state=s'))).toThrow(/OAuth authorization is required$/);
    await provider.invalidateCredentials?.('tokens');
    expect((await credentials.read(a.connectionId))?.tokens).toBeNull();
  });

  it('removes token values from errors', async () => {
    const credentials = new MemoryMeetingSourceCredentialStore();
    const a = connection();
    await credentials.write(a.connectionId, storedCredentials('sk-live-token-123456789'));
    const runtime = new NativeMcpRuntime({
      credentials,
      createTransport: () => ({
        start: async () => {
          throw new Error('401 from server: Authorization: Bearer sk-live-token-123456789 refresh=sk-live-token-123456789-refresh');
        },
        send: async () => {},
        close: async () => {},
      }),
    });
    const error = await runtime.callTool(a, 'list_files', {}).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain('sk-live-token-123456789');
    expect(String((error as Error).message)).toContain('[redacted]');
  });

  it('reports connected only when meetings list, and adds transcript:read only when the first page reads', async () => {
    const credentials = new MemoryMeetingSourceCredentialStore();
    const a = connection();
    await credentials.write(a.connectionId, storedCredentials('token-a'));
    const account: PlaudAccount = { files: [{ id: 'f-1', start_at: '2026-10-08T01:00:00Z', segments: words(12) }], calls: [] };
    const runtime = new NativeMcpRuntime({ credentials, now: clock(), createTransport: () => inMemoryServer(plaudHandler(account)) });

    const ok = await runtime.verify(a);
    expect(ok).toMatchObject({ status: 'connected', capabilities: ['meetings:list', 'transcript:read'], failure: null, notes: [] });
    expect(account.calls).toEqual(['list_files', 'get_transcript']);

    account.unauthorized = true;
    const expired = await runtime.verify(a);
    expect(expired).toMatchObject({ status: 'reauth_required', capabilities: [], failure: { reason: 'reauth_required' } });

    account.unauthorized = false;
    account.files = [];
    const empty = await runtime.verify(a);
    expect(empty).toMatchObject({ status: 'connected', capabilities: ['meetings:list'], notes: [{ capability: 'transcript:read', reason: 'no_meetings' }] });
  });

  it('keeps transcript:read out when Tactiq requires access, with the reason, and spends one hourly read', async () => {
    const calls: string[] = [];
    const callTool: MeetingSourceCallTool = async (name) => {
      calls.push(name);
      if (name === 'search_meetings') return textResult({ results: [{ id: 'mtg-1', title: 'Weekly', createdAt: '2026-10-08T01:00:00Z', attendees: [] }] });
      if (name === 'get_access_options') return { structuredContent: { access: { action: 'upgrade', title: 'Upgrade to Team', message: 'Full transcripts need a Team seat.', url: 'https://tactiq.io/buy' } } };
      return errorResult(JSON.stringify({ error: 'access_required', message: 'Reading meeting details requires a Team plan.' }));
    };
    const budget = createTactiqTranscriptBudget();
    const health = await probeMeetingSourceConnection({ provider: 'tactiq', callTool, budget, now: clock() });
    expect(health).toMatchObject({
      status: 'connected',
      capabilities: ['meetings:list'],
      notes: [{ capability: 'transcript:read', reason: 'access_required', access: { action: 'upgrade', cause: 'plan' } }],
    });
    expect(calls).toEqual(['search_meetings', 'get_transcript', 'get_access_options']);
    expect(budget.reads(NOW)).toHaveLength(1);
  });

  it('keeps credentials per connection in a 0600 file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'meeting-source-credentials-'));
    const file = join(dir, 'credentials.json');
    const store = new FileMeetingSourceCredentialStore(file);
    await store.write('msc_a', storedCredentials('token-a'));
    await store.write('msc_b', storedCredentials('token-b'));
    await store.remove('msc_a');
    expect(await store.read('msc_a')).toBeNull();
    expect((await store.read('msc_b'))?.tokens?.access_token).toBe('token-b');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await store.savePendingAuthorization('hash', { provider: 'plaud' } as never);
    expect(await store.takePendingAuthorization('hash')).toMatchObject({ provider: 'plaud' });
    expect(await store.takePendingAuthorization('hash')).toBeNull();
    expect(JSON.parse(await readFile(file, 'utf8')).pending).toEqual({});
  });
});

describe('per-connection sync (AC-04, AC-05, AC-06, AC-08)', () => {
  it('keeps a not-ready transcript pending until it can be read, then delivers it once', async () => {
    const account: PlaudAccount = {
      files: [
        { id: 'ready', start_at: '2026-10-09T01:00:00Z', segments: words(3) },
        { id: 'later', start_at: '2026-10-09T02:00:00Z', segments: null },
      ],
      calls: [],
    };
    const conn = connection();
    const runtime = fakeRuntime(() => plaudHandler(account));
    const stateStore = new MemoryMeetingSourceSyncStateStore();
    const { deliveries, deliver } = collector();

    const first = await syncMeetingSourceConnection({ connection: conn, runtime, stateStore, deliver, now: clock() });
    expect(first.status).toBe('ok');
    expect(first.delivered).toEqual([{ meetingId: 'ready', version: 1 }]);
    expect(first.state.pending).toMatchObject([{ meeting: { externalId: 'later' }, reason: 'not_ready', attempts: 0 }]);
    expect(first.state.listedThrough).toBe(NOW.toISOString());
    expect(JSON.stringify(first.state)).not.toContain('発話');

    account.files[1].segments = words(2);
    const second = await syncMeetingSourceConnection({ connection: conn, runtime, stateStore, deliver, now: clock(new Date('2026-10-09T12:15:00Z')) });
    expect(second.delivered).toEqual([{ meetingId: 'later', version: 1 }]);
    expect(second.state.pending).toEqual([]);
    expect(deliveries.map((delivery) => delivery.meeting.externalId)).toEqual(['ready', 'later']);
    expect(deliveries[0]).toMatchObject({ connectionId: conn.connectionId, tenantId: 'tenant-unson', ownerPersonId: 'per_sato', transcript: { digest: expect.stringMatching(/^[0-9a-f]{64}$/) } });
  });

  it('records a failed run with the reason and does not move the read position when listing fails', async () => {
    const account: PlaudAccount = { files: [{ id: 'f', start_at: '2026-10-09T01:00:00Z', segments: words(1) }], calls: [] };
    const conn = connection();
    const runtime = fakeRuntime(() => plaudHandler(account));
    const stateStore = new MemoryMeetingSourceSyncStateStore();
    const { deliver } = collector();
    await syncMeetingSourceConnection({ connection: conn, runtime, stateStore, deliver, now: clock() });

    account.unauthorized = true;
    const failed = await syncMeetingSourceConnection({ connection: conn, runtime, stateStore, deliver, now: clock(new Date('2026-10-09T13:00:00Z')) });
    expect(failed).toMatchObject({ status: 'failed', failure: { reason: 'reauth_required' }, delivered: [] });
    expect(failed.state.lastError).toMatchObject({ reason: 'reauth_required', at: '2026-10-09T13:00:00.000Z' });
    expect(failed.state.listedThrough).toBe(NOW.toISOString());
    expect(failed.state.lastSuccessAt).toBe(NOW.toISOString());
  });

  it('keeps a meeting pending and fails the run when delivery fails', async () => {
    const account: PlaudAccount = { files: [{ id: 'f', start_at: '2026-10-09T01:00:00Z', segments: words(1) }], calls: [] };
    const conn = connection();
    const stateStore = new MemoryMeetingSourceSyncStateStore();
    const result = await syncMeetingSourceConnection({
      connection: conn,
      runtime: fakeRuntime(() => plaudHandler(account)),
      stateStore,
      deliver: async () => {
        throw new Error('intake unavailable');
      },
      now: clock(),
    });
    expect(result).toMatchObject({ status: 'failed', failure: { reason: 'delivery_failed' } });
    expect(result.state.pending).toMatchObject([{ meeting: { externalId: 'f' }, reason: 'delivery_failed', attempts: 1 }]);
    expect(result.state.delivered).toEqual({});
  });

  it('never delivers the same digest twice and delivers a changed transcript as a new version', async () => {
    const account: PlaudAccount = { files: [{ id: 'f', start_at: '2026-10-09T01:00:00Z', segments: words(2) }], calls: [] };
    const conn = connection();
    const runtime = fakeRuntime(() => plaudHandler(account));
    const stateStore = new MemoryMeetingSourceSyncStateStore();
    const { deliveries, deliver } = collector();
    await syncMeetingSourceConnection({ connection: conn, runtime, stateStore, deliver, now: clock() });
    await syncMeetingSourceConnection({ connection: conn, runtime, stateStore, deliver, now: clock(), recheckDelivered: true });
    expect(deliveries).toHaveLength(1);

    account.files[0].segments = words(3); // Plaud re-transcribed the recording.
    const changed = await syncMeetingSourceConnection({ connection: conn, runtime, stateStore, deliver, now: clock(), recheckDelivered: true });
    expect(changed.delivered).toEqual([{ meetingId: 'f', version: 2 }]);
    expect(deliveries.map((delivery) => delivery.version)).toEqual([1, 2]);
    expect(deliveries[0].transcript.digest).not.toBe(deliveries[1].transcript.digest);
  });

  it('re-fetches a stopped period without duplicating delivered meetings or moving the position (AC-08)', async () => {
    const account: PlaudAccount = {
      files: [
        { id: 'aug', start_at: '2026-08-30T01:00:00Z', segments: words(1) },
        { id: 'sep', start_at: '2026-09-15T01:00:00Z', segments: words(1) },
        { id: 'oct', start_at: '2026-10-08T01:00:00Z', segments: words(1) },
      ],
      calls: [],
    };
    const conn = connection();
    const runtime = fakeRuntime(() => plaudHandler(account));
    const stateStore = new MemoryMeetingSourceSyncStateStore();
    const { deliveries, deliver } = collector();
    await syncMeetingSourceConnection({ connection: conn, runtime, stateStore, deliver, now: clock() });
    expect(deliveries.map((delivery) => delivery.meeting.externalId)).toEqual(['oct']);

    const window = { since: '2026-09-01T00:00:00Z', until: NOW.toISOString() };
    const backfill = await syncMeetingSourceConnection({ connection: conn, runtime, stateStore, deliver, now: clock(), window });
    expect(backfill.delivered).toEqual([{ meetingId: 'sep', version: 1 }]);
    const again = await syncMeetingSourceConnection({ connection: conn, runtime, stateStore, deliver, now: clock(), window, recheckDelivered: true });
    expect(again.delivered).toEqual([]);
    expect(deliveries.map((delivery) => delivery.meeting.externalId)).toEqual(['oct', 'sep']);
    expect(again.state.listedThrough).toBe(NOW.toISOString());
  });

  it('reads Tactiq newest first within the hourly budget and leaves the rest pending without failing', async () => {
    const meetings = Array.from({ length: 12 }, (_, i) => ({
      id: `m-${String(i).padStart(2, '0')}`,
      title: `M${i}`,
      createdAt: new Date(Date.parse('2026-10-09T00:00:00Z') + i * 60_000).toISOString(),
      attendees: [],
    }));
    const transcriptCalls: string[] = [];
    const runtime = fakeRuntime(() => (name, args) => {
      if (name === 'search_meetings') return textResult({ results: meetings });
      transcriptCalls.push(String(args.meetingId));
      return textResult({ meetingId: args.meetingId, page: 1, totalPages: 1, hasMore: false, entries: [{ speaker: 'A', text: 'hi', startSeconds: 0, endSeconds: 1 }] });
    });
    const conn = connection({ provider: 'tactiq' });
    const stateStore = new MemoryMeetingSourceSyncStateStore();
    const { deliver } = collector();
    const first = await syncMeetingSourceConnection({ connection: conn, runtime, stateStore, deliver, now: clock() });
    expect(first.status).toBe('ok');
    expect(first.delivered).toHaveLength(10);
    expect(transcriptCalls[0]).toBe('m-11');
    expect(first.state.pending.map((entry) => entry.meeting.externalId).sort()).toEqual(['m-00', 'm-01']);
    expect(first.state.pending[0]).toMatchObject({ reason: 'rate_limited', retryAt: '2026-10-09T13:00:00.000Z' });
    expect(first.state.tactiqReads).toHaveLength(10);

    const sameHour = await syncMeetingSourceConnection({ connection: conn, runtime, stateStore, deliver, now: clock(new Date('2026-10-09T12:30:00Z')) });
    expect(sameHour.delivered).toEqual([]);
    const nextHour = await syncMeetingSourceConnection({ connection: conn, runtime, stateStore, deliver, now: clock(new Date('2026-10-09T13:01:00Z')) });
    expect(nextHour.delivered.map((entry) => entry.meetingId).sort()).toEqual(['m-00', 'm-01']);
  });

  it('waits until the retry time of a rate-limited meeting even when it is listed again', async () => {
    const account: PlaudAccount = { files: [{ id: 'f', start_at: '2026-10-09T01:00:00Z', segments: words(1) }], calls: [] };
    let limited = true;
    const handler = plaudHandler(account);
    const runtime = fakeRuntime(() => (name, args) => (limited && name === 'get_transcript' ? errorResult('429 Too Many Requests') : handler(name, args)));
    const conn = connection();
    const stateStore = new MemoryMeetingSourceSyncStateStore();
    const { deliver } = collector();
    const first = await syncMeetingSourceConnection({ connection: conn, runtime, stateStore, deliver, now: clock() });
    expect(first).toMatchObject({ status: 'failed', failure: { reason: 'rate_limited' } });
    expect(first.state.pending).toMatchObject([{ meeting: { externalId: 'f' }, retryAt: '2026-10-09T13:00:00.000Z' }]);

    limited = false;
    account.calls.length = 0;
    const early = await syncMeetingSourceConnection({ connection: conn, runtime, stateStore, deliver, now: clock(new Date('2026-10-09T12:10:00Z')) });
    expect(account.calls).toEqual(['list_files']);
    expect(early).toMatchObject({ status: 'ok', delivered: [], pending: 1 });
    const due = await syncMeetingSourceConnection({ connection: conn, runtime, stateStore, deliver, now: clock(new Date('2026-10-09T13:00:01Z')) });
    expect(due.delivered).toEqual([{ meetingId: 'f', version: 1 }]);
  });

  it('suggests the same meeting across providers only within one tenant and owner, without merging', () => {
    const plaud = connection();
    const tactiq = connection({ provider: 'tactiq' });
    const otherTenant = connection({ provider: 'tactiq', tenantId: 'tenant-techknight' });
    const meeting = (provider: 'plaud' | 'tactiq', id: string, startedAt: string, participants: string[]) => ({
      provider, externalId: id, title: null, startedAt, durationSeconds: 1800, participants, url: null,
    });
    const candidates = findSameMeetingCandidates([
      { connection: plaud, meeting: meeting('plaud', 'p-1', '2026-10-08T01:00:00Z', []) },
      { connection: tactiq, meeting: meeting('tactiq', 't-1', '2026-10-08T01:02:00Z', ['佐藤 圭吾']) },
      { connection: otherTenant, meeting: meeting('tactiq', 'x-1', '2026-10-08T01:01:00Z', ['佐藤 圭吾']) },
      { connection: tactiq, meeting: meeting('tactiq', 't-2', '2026-10-08T05:00:00Z', []) },
    ]);
    expect(candidates.map((candidate) => [candidate.first.meeting.externalId, candidate.second.meeting.externalId])).toEqual([['p-1', 't-1']]);
  });
});

describe('two connections of the same provider stay separate (AC-07)', () => {
  it('keeps credentials, positions, pending meetings, failures, and deliveries apart, and one disconnect does not stop the other', async () => {
    const credentials = new MemoryMeetingSourceCredentialStore();
    const a = connection();
    const b = connection({ ownerPersonId: 'per_other' });
    await credentials.write(a.connectionId, storedCredentials('token-a'));
    await credentials.write(b.connectionId, storedCredentials('token-b', { binding: { tenantId: 'tenant-unson', personId: 'per_other' } }));
    const accounts: Record<string, PlaudAccount> = {
      [a.connectionId]: { files: [{ id: 'a-ready', start_at: '2026-10-09T01:00:00Z', segments: words(2) }, { id: 'a-wait', start_at: '2026-10-09T02:00:00Z', segments: null }], calls: [] },
      [b.connectionId]: { files: [{ id: 'b-ready', start_at: '2026-10-09T03:00:00Z', segments: words(2) }], calls: [] },
    };
    const runtime = new NativeMcpRuntime({
      credentials,
      now: clock(),
      createTransport: ({ connection: target }) => inMemoryServer(plaudHandler(accounts[target.connectionId])),
    });
    const stateStore = new MemoryMeetingSourceSyncStateStore();
    const { deliveries, deliver } = collector();

    await syncMeetingSourceConnection({ connection: a, runtime, stateStore, deliver, now: clock() });
    await syncMeetingSourceConnection({ connection: b, runtime, stateStore, deliver, now: clock(new Date('2026-10-09T12:05:00Z')) });
    const stateA = await stateStore.load(a.connectionId);
    const stateB = await stateStore.load(b.connectionId);
    expect(Object.keys(stateA!.delivered)).toEqual(['a-ready']);
    expect(stateA!.pending.map((entry) => entry.meeting.externalId)).toEqual(['a-wait']);
    expect(Object.keys(stateB!.delivered)).toEqual(['b-ready']);
    expect(stateB!.pending).toEqual([]);
    expect(stateA!.listedThrough).toBe('2026-10-09T12:00:00.000Z');
    expect(stateB!.listedThrough).toBe('2026-10-09T12:05:00.000Z');
    expect(deliveries.map((delivery) => [delivery.connectionId, delivery.ownerPersonId, delivery.meeting.externalId])).toEqual([
      [a.connectionId, 'per_sato', 'a-ready'],
      [b.connectionId, 'per_other', 'b-ready'],
    ]);

    // B's account fails; A is unaffected.
    accounts[b.connectionId].unauthorized = true;
    const failedB = await syncMeetingSourceConnection({ connection: b, runtime, stateStore, deliver, now: clock() });
    expect(failedB.status).toBe('failed');
    expect((await stateStore.load(a.connectionId))!.lastError).toBeNull();

    // Disconnect A: its credentials go, its sync stops, and B keeps going.
    await runtime.disconnect(a);
    const revokedA = { ...a, status: 'revoked' as const };
    expect(await credentials.read(a.connectionId)).toBeNull();
    expect((await syncMeetingSourceConnection({ connection: revokedA, runtime, stateStore, deliver, now: clock() })).status).toBe('skipped');
    accounts[b.connectionId].unauthorized = false;
    accounts[b.connectionId].files.push({ id: 'b-new', start_at: '2026-10-09T11:00:00Z', segments: words(1) });
    const resumedB = await syncMeetingSourceConnection({ connection: b, runtime, stateStore, deliver, now: clock(new Date('2026-10-09T12:30:00Z')) });
    expect(resumedB).toMatchObject({ status: 'ok', delivered: [{ meetingId: 'b-new', version: 1 }] });
  });
});

describe('MCP OAuth through the organization connection kernel (AC-09)', () => {
  function memoryStateRepository(): OrganizationConnectionStateRepository {
    const records = new Map<string, { record: OrganizationConnectionStateRecord; consumed: boolean }>();
    return {
      async save(record) {
        records.set(record.stateHash, { record, consumed: false });
      },
      async consume({ stateHash, now }) {
        const entry = records.get(stateHash);
        if (!entry) return { status: 'missing' };
        if (entry.consumed) return { status: 'replayed', record: entry.record };
        entry.consumed = true;
        return { status: 'consumed', record: entry.record, consumedAt: now };
      },
    };
  }

  function fakeAuthorizationServer() {
    const requests: Array<{ method: string; url: string; body: string }> = [];
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const body = typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '';
      requests.push({ method: init?.method ?? 'GET', url: url.toString(), body });
      if (url.href === 'https://mcp.plaud.test/.well-known/oauth-protected-resource/mcp') {
        return json({ resource: 'https://mcp.plaud.test/mcp', authorization_servers: ['https://auth.plaud.test'], scopes_supported: ['files:read', 'transcripts:read'] });
      }
      if (url.href === 'https://auth.plaud.test/.well-known/oauth-authorization-server') {
        return json({
          issuer: 'https://auth.plaud.test',
          authorization_endpoint: 'https://auth.plaud.test/authorize',
          token_endpoint: 'https://auth.plaud.test/token',
          registration_endpoint: 'https://auth.plaud.test/register',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        });
      }
      if (url.href === 'https://auth.plaud.test/register') {
        return json({ ...JSON.parse(body), client_id: 'registered-client' }, 201);
      }
      if (url.href === 'https://auth.plaud.test/token') {
        const form = new URLSearchParams(body);
        if (form.get('code') !== 'good-code' || !form.get('code_verifier')) return json({ error: 'invalid_grant' }, 400);
        return json({ access_token: 'issued-access-token-abcdef', refresh_token: 'issued-refresh-token-abcdef', token_type: 'Bearer', expires_in: 3600 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    return { fetchFn, requests };
  }

  it('starts with discovery, registration, and PKCE, completes once, and never returns tokens', async () => {
    const credentials = new MemoryMeetingSourceCredentialStore();
    const { fetchFn, requests } = fakeAuthorizationServer();
    const service = new OrganizationConnectionService({
      stateRepository: memoryStateRepository(),
      providerAdapter: createMcpOAuthConnectionAdapter({
        credentials,
        serverUrlFor: () => 'https://mcp.plaud.test/mcp',
        redirectUrl: 'https://bb.example.test/oauth/meeting-source/callback',
        fetchFn,
        now: clock(),
      }),
      clock: clock(),
    });
    const binding = { tenantId: 'tenant-unson', personId: 'per_sato' };

    const started = await service.startAuthorization({ provider: 'plaud', binding });
    const authorizationUrl = new URL(started.authorizationUrl);
    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe('https://auth.plaud.test/authorize');
    expect(authorizationUrl.searchParams.get('client_id')).toBe('registered-client');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(authorizationUrl.searchParams.get('state')).toBe(started.state);
    expect(authorizationUrl.searchParams.get('scope')).toBe('files:read transcripts:read');
    expect(authorizationUrl.searchParams.get('resource')).toBe('https://mcp.plaud.test/mcp');
    expect(requests.some((request) => request.url === 'https://auth.plaud.test/register')).toBe(true);

    const completed = await service.completeAuthorization({ provider: 'plaud', binding, state: started.state, code: 'good-code' });
    expect(completed.connection).toMatchObject({ provider: 'plaud', status: 'pending', connectionId: expect.stringMatching(/^msc_/) });
    expect(JSON.stringify(completed)).not.toContain('issued-access-token');
    const stored = await credentials.read(completed.connection.connectionId);
    expect(stored).toMatchObject({ provider: 'plaud', binding, serverUrl: 'https://mcp.plaud.test/mcp', tokens: { access_token: 'issued-access-token-abcdef' } });
    const tokenRequest = new URLSearchParams(requests.find((request) => request.url === 'https://auth.plaud.test/token')!.body);
    expect(tokenRequest.get('code_verifier')).toBeTruthy();

    const read = await service.readConnection({ provider: 'plaud', binding, connectionId: completed.connection.connectionId });
    expect(read).toMatchObject({ connectionId: completed.connection.connectionId, status: 'pending' });
    expect(JSON.stringify(read)).not.toContain('token');
    expect(await service.readConnection({ provider: 'plaud', binding: { tenantId: 'tenant-unson', personId: 'per_other' }, connectionId: completed.connection.connectionId })).toBeNull();

    await expect(service.completeAuthorization({ provider: 'plaud', binding, state: started.state, code: 'good-code' })).rejects.toMatchObject({ code: 'oauth_state_replayed' });
  });
});

describe('NativeMcpRuntime refreshes an expired access token (production 2026-10-10)', () => {
  // The SDK treats a provider without a redirect URL as a non-interactive client and never uses
  // the refresh token, so a sync after the access token expired failed with
  // "Either provider.prepareTokenRequest() or authorizationCode is required".
  function refreshServer(refresh: 'ok' | 'invalid_grant') {
    const requests: Array<{ url: string; body: string }> = [];
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      const body = typeof init?.body === 'string' ? init.body : init?.body ? String(init.body) : '';
      requests.push({ url: url.toString(), body });
      if (url.href === 'https://mcp.plaud.test/.well-known/oauth-protected-resource/mcp') {
        return json({ resource: 'https://mcp.plaud.test/mcp', authorization_servers: ['https://auth.plaud.test'] });
      }
      if (url.href === 'https://auth.plaud.test/.well-known/oauth-authorization-server') {
        return json({
          issuer: 'https://auth.plaud.test',
          authorization_endpoint: 'https://auth.plaud.test/authorize',
          token_endpoint: 'https://auth.plaud.test/token',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        });
      }
      if (url.href === 'https://auth.plaud.test/token') {
        const form = new URLSearchParams(body);
        if (refresh === 'ok' && form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'token-old-refresh') {
          return json({ access_token: 'token-renewed', refresh_token: 'token-renewed-refresh', token_type: 'Bearer', expires_in: 3600 });
        }
        return json({ error: 'invalid_grant' }, 400);
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    return { fetchFn, requests };
  }

  async function providerFor(credentials: MemoryMeetingSourceCredentialStore) {
    const a = connection();
    await credentials.write(a.connectionId, storedCredentials('token-old'));
    let captured: Parameters<NonNullable<ConstructorParameters<typeof NativeMcpRuntime>[0]['createTransport']>>[0]['authProvider'] | null = null;
    const runtime = new NativeMcpRuntime({
      credentials,
      createTransport: ({ authProvider }) => {
        captured = authProvider;
        return inMemoryServer(plaudHandler({ files: [], calls: [] }));
      },
    });
    await runtime.callTool(a, 'list_files', {});
    return { provider: captured!, connectionId: a.connectionId };
  }

  it('uses the stored refresh token and keeps the renewed tokens', async () => {
    const credentials = new MemoryMeetingSourceCredentialStore();
    const { provider, connectionId } = await providerFor(credentials);
    const { fetchFn, requests } = refreshServer('ok');
    await expect(auth(provider, { serverUrl: 'https://mcp.plaud.test/mcp', fetchFn })).resolves.toBe('AUTHORIZED');
    const tokenRequest = requests.find((request) => request.url === 'https://auth.plaud.test/token');
    expect(new URLSearchParams(tokenRequest!.body).get('grant_type')).toBe('refresh_token');
    expect((await credentials.read(connectionId))?.tokens?.access_token).toBe('token-renewed');
    expect((await credentials.read(connectionId))?.tokens?.refresh_token).toBe('token-renewed-refresh');
  });

  it('asks for a new authorization when the refresh token is refused, without starting a login', async () => {
    const credentials = new MemoryMeetingSourceCredentialStore();
    const { provider } = await providerFor(credentials);
    const { fetchFn } = refreshServer('invalid_grant');
    await expect(auth(provider, { serverUrl: 'https://mcp.plaud.test/mcp', fetchFn })).rejects.toMatchObject({ code: 'reauth_required' });
  });
});
