import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJudgmentJournalTurnPublisher } from '../src/judgment-journal-turn-publisher.js';
import { handleRemoteJudgmentHookRequest } from '../src/remote-judgment-hook-http.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const input = { sessionId: 'session', turnId: 'turn', projectCode: 'project', trustedToken: 'verified-user-jwt',
  trustedPrincipal: { personId: 'person', tenantId: 'tenant' } };
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(sequenceField = 'event_sequence') {
  const root = await mkdtemp(join(tmpdir(), 'journal-publisher-'));
  roots.push(root);
  const prefix = join(root, hash(input.sessionId), hash(input.turnId));
  await mkdir(`${prefix}.events`, { recursive: true });
  // Owner fields are optional for the current host; newer hosts can supply them.
  const identity = sequenceField === 'sequence' ? { session_ref: hash(input.sessionId), turn_id: input.turnId } : {};
  const episode = { ...identity, owner_person_id: 'person', tenant_id: 'tenant', initial_route_receipt: { resolution_id: 'resolution', project_code: 'project', turn_id: input.turnId } };
  const final = { ...identity, event_count: 1, finalized_at: '2026-11-11T00:00:00.000Z' };
  const event = { [sequenceField]: sequenceField === 'sequence' ? 1 : 0,
    event_fingerprint: 'a'.repeat(64), tool_use_id: 'tool-1', content: 'private journal content' };
  for (const [suffix, value] of Object.entries({ '.episode.json': episode, '.final.json': final,
    '.events/event.json': event, '.turn-input.json': { text: 'private prompt' }, '.value-proof.json': { status: 'candidate' } })) {
    await writeFile(`${prefix}${suffix}`, JSON.stringify(value));
  }
  return { root, prefix, episode, final, event };
}
function request(publisher?: (value: typeof input) => Promise<void>) {
  return {
    method: 'POST', url: '/host/judgment/hook', authorization: 'Bearer shared', bearerToken: 'shared',
    isAuthorized: () => true,
    body: Buffer.from(JSON.stringify({ hook_event_name: 'Stop', session_id: input.sessionId, turn_id: input.turnId })),
    declaredHost: 'claude-code', personHostedClaudeCodeAllowed: true, trustedAuthKind: 'brainbase-jwt' as const,
    trustedPrincipal: { personId: 'person', organizationId: 'organization', tenantId: 'tenant', projectCodes: ['project'] },
    trustedToken: input.trustedToken, projectCode: input.projectCode,
    dispatch: async () => ({ output: { systemMessage: 'finished' } }), journalTurnPublisher: publisher,
  };
}

describe('judgment journal turn publisher', () => {
  it('AC-W1 hosted Claude Code Stop posts the turn with the caller own JWT', async () => {
    const { root, episode, final, event } = await fixture();
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 201 }));
    const publisher = createJudgmentJournalTurnPublisher({ apiBaseUrl: 'https://api.example.test/', journalRoot: root, fetch });
    expect((await handleRemoteJudgmentHookRequest(request(publisher)))?.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.example.test/api/organization/judgment-journal/turns');
    expect(init?.headers).toEqual({ Authorization: `Bearer ${input.trustedToken}`, 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toEqual({
      resolution_id: 'resolution', turn_id: 'turn', project_code: 'project',
      entrypoint: 'claude_code', turn_ref: `${hash(input.sessionId)}/${hash(input.turnId)}`,
      receipt: episode.initial_route_receipt, episode, final,
      events: [{ event_sequence: 0, event_fingerprint: event.event_fingerprint, tool_use_id: 'tool-1', event }],
      turn_input: { text: 'private prompt' }, value_proof: { status: 'candidate' }, recorded_at: final.finalized_at,
    });
  });

  for (const mode of ['throw', '503', 'network', '409', 'logger-throw', 'unconfigured'] as const) {
    it(`AC-W2 a failed journal post does not change the hook response: ${mode}`, async () => {
      const { root } = await fixture();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onError = vi.fn((_: string) => { if (mode === 'logger-throw') throw new Error('private error'); });
      const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
        if (mode === 'network') throw new Error('private network detail');
        return new Response(null, { status: mode === '409' ? 409 : 503 });
      });
      const publisher = mode === 'throw' ? async () => { throw new Error('private payload'); }
        : createJudgmentJournalTurnPublisher({ apiBaseUrl: mode === 'unconfigured' ? undefined : 'https://api.example.test', journalRoot: root, fetch, onError });
      const baseline = await handleRemoteJudgmentHookRequest(request());
      warn.mockClear();
      expect(await handleRemoteJudgmentHookRequest(request(publisher))).toEqual(baseline);
      if (mode === 'throw') expect(warn.mock.calls).toEqual([['judgment_journal_publish_failed']]);
      else expect(onError.mock.calls).toEqual([[mode === 'network' ? 'judgment_journal_network_failed'
        : mode === '409' ? 'judgment_journal_conflict' : mode === 'unconfigured'
          ? 'judgment_journal_not_configured' : 'judgment_journal_http_failed']]);
    });
  }

  it('AC-W3 shared-bearer, local-loopback and remote hosts do not post', async () => {
    const publisher = vi.fn();
    for (const overrides of [
      { trustedAuthKind: undefined, personHostedClaudeCodeAllowed: false, localClaudeCodeAllowed: true },
      { declaredHost: undefined },
      { localClaudeCodeAllowed: true },
      { trustedAuthKind: undefined, personHostedClaudeCodeAllowed: false },
    ]) await handleRemoteJudgmentHookRequest({ ...request(publisher), ...overrides });
    expect(publisher).not.toHaveBeenCalled();
  });

  it('only posts after a successful Stop dispatch with a verified token', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const publisher = vi.fn();
    await handleRemoteJudgmentHookRequest({ ...request(publisher), dispatch: async () => { throw new Error('failed'); } });
    await handleRemoteJudgmentHookRequest({ ...request(publisher), trustedToken: undefined });
    await handleRemoteJudgmentHookRequest({ ...request(publisher), body: Buffer.from(JSON.stringify({
      hook_event_name: 'PreToolUse', session_id: input.sessionId, turn_id: input.turnId,
    })) });
    expect(publisher).not.toHaveBeenCalled();
  });

  it('AC-W4 supports the local host one-based event sequence and absent optional files', async () => {
    const { root, prefix } = await fixture('sequence');
    await rm(`${prefix}.turn-input.json`);
    await rm(`${prefix}.value-proof.json`);
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    await createJudgmentJournalTurnPublisher({ apiBaseUrl: 'https://api.example.test', journalRoot: root, fetch })(input);
    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body.events[0].event_sequence).toBe(0);
    expect(body).not.toHaveProperty('turn_input');
    expect(body).not.toHaveProperty('value_proof');
  });

  for (const mode of ['person', 'tenant'] as const) {
    it(`AC-W5 does not post a turn owned by another person: ${mode}`, async () => {
      const { root } = await fixture();
      const fetch = vi.fn<typeof globalThis.fetch>();
      const onError = vi.fn();
      const publisher = createJudgmentJournalTurnPublisher({ apiBaseUrl: 'https://api.example.test', journalRoot: root, fetch, onError });
      const caller = { ...request(publisher), trustedPrincipal: { ...request().trustedPrincipal,
        ...(mode === 'person' ? { personId: 'other-person' } : {}),
        ...(mode === 'tenant' ? { tenantId: 'other-tenant' } : {}),
      } };
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await handleRemoteJudgmentHookRequest(caller)).toEqual(
        await handleRemoteJudgmentHookRequest({ ...caller, journalTurnPublisher: undefined }));
      expect(fetch).not.toHaveBeenCalled();
      expect(onError.mock.calls).toEqual([['judgment_journal_files_invalid']]);
    });
  }

  for (const fields of ['none', 'person', 'tenant'] as const) {
    it(`posts with a valid principal and optional episode owner fields: ${fields}`, async () => {
      const { root, prefix, episode } = await fixture('sequence');
      const owner = { ...episode } as Record<string, unknown>;
      if (fields !== 'person') delete owner.owner_person_id;
      if (fields !== 'tenant') delete owner.tenant_id;
      await writeFile(`${prefix}.episode.json`, JSON.stringify(owner));
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 201 }));
      const publisher = createJudgmentJournalTurnPublisher({ apiBaseUrl: 'https://api.example.test', journalRoot: root, fetch });
      expect(await handleRemoteJudgmentHookRequest(request(publisher))).toEqual(await handleRemoteJudgmentHookRequest(request()));
      expect(fetch).toHaveBeenCalledOnce();
      expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).episode).toEqual(owner);
    });
  }

  for (const principal of [undefined, { personId: ' ', tenantId: 'tenant' }, { personId: 'person', tenantId: ' ' }]) {
    it(`does not post with a missing or blank principal: ${JSON.stringify(principal)}`, async () => {
      const { root, prefix, episode } = await fixture();
      const owner = { ...episode } as Record<string, unknown>;
      delete owner.owner_person_id;
      delete owner.tenant_id;
      await writeFile(`${prefix}.episode.json`, JSON.stringify(owner));
      const fetch = vi.fn<typeof globalThis.fetch>();
      const onError = vi.fn();
      const publisher = createJudgmentJournalTurnPublisher({ apiBaseUrl: 'https://api.example.test', journalRoot: root, fetch, onError });
      await publisher({ ...input, trustedPrincipal: principal! });
      expect(fetch).not.toHaveBeenCalled();
      expect(onError.mock.calls).toEqual([['judgment_journal_files_invalid']]);
    });
  }

  for (const mode of ['missing', 'malformed', 'sequence', 'count', 'scope'] as const) {
    it(`AC-W4 rejects invalid journal files with a safe reason: ${mode}`, async () => {
      const { root, prefix } = await fixture();
      if (mode === 'missing') await rm(`${prefix}.episode.json`);
      if (mode === 'malformed') await writeFile(`${prefix}.episode.json`, 'private invalid json');
      if (mode === 'sequence') await writeFile(`${prefix}.events/event.json`, JSON.stringify({ event_sequence: 5 }));
      if (mode === 'count') await rm(`${prefix}.events`, { recursive: true });
      if (mode === 'scope') await writeFile(`${prefix}.episode.json`, JSON.stringify({ initial_route_receipt: { project_code: 'other' } }));
      const onError = vi.fn();
      const fetch = vi.fn<typeof globalThis.fetch>();
      const publisher = createJudgmentJournalTurnPublisher({ apiBaseUrl: 'https://api.example.test', journalRoot: root, fetch, onError });
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await handleRemoteJudgmentHookRequest(request(publisher))).toEqual(await handleRemoteJudgmentHookRequest(request()));
      expect(fetch).not.toHaveBeenCalled();
      expect(onError.mock.calls).toEqual([[mode === 'missing' ? 'judgment_journal_files_missing' : 'judgment_journal_files_invalid']]);
    });
  }
});

describe('UNS-5996 a resolved turn binds to its TurnContract', () => {
  it('AC-R1 one hook and one successful resolve_turn post the resolved receipt, not the bootstrap receipt', async () => {
    // The Host writes episode.json once with the bootstrap route receipt. After a successful
    // brainbase_resolve_turn it records the TurnContract on the event, and finalize writes
    // final.initial_route_receipt_digest from the effective (resolved) episode.
    // The organization history reader accepts a turn only when its receipt equals the last
    // successful resolve_turn contract and the final digest; a bootstrap receipt is rejected.
    const { root, prefix } = await fixture();
    const bootstrap = { resolution_id: 'bootstrap', project_code: 'project', turn_id: input.turnId, classification: 'bootstrap' };
    const turnContract = { resolution_id: 'resolved', project_code: 'project', turn_id: input.turnId, classification: 'question' };
    const canonical = (value: unknown) => JSON.stringify(value, Object.keys(value as object).sort());
    await writeFile(`${prefix}.episode.json`, JSON.stringify({ owner_person_id: 'person', tenant_id: 'tenant', initial_route_receipt: bootstrap }));
    await writeFile(`${prefix}.events/event.json`, JSON.stringify({ event_sequence: 0, event_fingerprint: 'b'.repeat(64),
      tool_use_id: 'resolve-1', success: true, satisfies: ['judgment.resolve_turn'], safe_metadata: { turn_contract: turnContract } }));
    await writeFile(`${prefix}.final.json`, JSON.stringify({ event_count: 1, finalized_at: '2026-11-24T00:00:00.000Z',
      initial_route_receipt_digest: hash(canonical(turnContract)) }));
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 201 }));
    const publisher = createJudgmentJournalTurnPublisher({ apiBaseUrl: 'https://api.example.test', journalRoot: root, fetch });
    expect((await handleRemoteJudgmentHookRequest(request(publisher)))?.status).toBe(200);
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body.receipt).toEqual(turnContract);
    expect(body.resolution_id).toBe('resolved');
  });

  async function resolvedFixture(events: Record<string, unknown>[]) {
    const { root, prefix } = await fixture();
    const bootstrap = { resolution_id: 'bootstrap', project_code: 'project', turn_id: input.turnId };
    await writeFile(`${prefix}.episode.json`, JSON.stringify({ owner_person_id: 'person', tenant_id: 'tenant', initial_route_receipt: bootstrap }));
    await rm(`${prefix}.events`, { recursive: true, force: true });
    await mkdir(`${prefix}.events`, { recursive: true });
    for (const [index, event] of events.entries()) {
      await writeFile(`${prefix}.events/${index}.json`, JSON.stringify({ event_sequence: index,
        event_fingerprint: String(index).repeat(64).slice(0, 64).replace(/\D/g, 'c'), tool_use_id: `tool-${index}`, ...event }));
    }
    await writeFile(`${prefix}.final.json`, JSON.stringify({ event_count: events.length, finalized_at: '2026-11-24T00:00:00.000Z' }));
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 201 }));
    const onError = vi.fn();
    const publisher = createJudgmentJournalTurnPublisher({ apiBaseUrl: 'https://api.example.test', journalRoot: root, fetch, onError });
    expect((await handleRemoteJudgmentHookRequest(request(publisher)))?.status).toBe(200);
    return { bootstrap, fetch, onError, body: () => JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) };
  }
  const resolveEvent = (success: boolean, contract: Record<string, unknown>) => ({ success,
    satisfies: ['judgment.resolve_turn'], safe_metadata: { turn_contract: contract } });

  it('AC-R2 a turn without a successful resolve_turn keeps the bootstrap receipt', async () => {
    const failed = await resolvedFixture([resolveEvent(false, { resolution_id: 'failed', project_code: 'project', turn_id: input.turnId }),
      { success: true, satisfies: ['judgment.frame'], safe_metadata: {} }]);
    expect(failed.body().receipt).toEqual(failed.bootstrap);
    expect(failed.body().resolution_id).toBe('bootstrap');
  });

  it('AC-R3 the last successful resolve_turn wins over an earlier one', async () => {
    const twice = await resolvedFixture([resolveEvent(true, { resolution_id: 'first', project_code: 'project', turn_id: input.turnId }),
      resolveEvent(true, { resolution_id: 'second', project_code: 'project', turn_id: input.turnId }),
      resolveEvent(false, { resolution_id: 'failed', project_code: 'project', turn_id: input.turnId })]);
    expect(twice.body().resolution_id).toBe('second');
  });

  for (const [name, contract] of [
    ['another person', { owner_person_id: 'someone-else' }],
    ['another tenant', { tenant_id: 'other-tenant' }],
    ['another project', { project_code: 'other-project' }],
    ['another turn', { turn_id: 'other-turn' }],
  ] as const) {
    it(`AC-R4 a resolve_turn contract for ${name} is not posted`, async () => {
      const foreign = await resolvedFixture([resolveEvent(true, { resolution_id: 'foreign', project_code: 'project', turn_id: input.turnId, ...contract })]);
      expect(foreign.fetch).not.toHaveBeenCalled();
      expect(foreign.onError.mock.calls).toEqual([['judgment_journal_files_invalid']]);
    });
  }
});
