import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJudgmentJournalTurnPublisher } from '../src/judgment-journal-turn-publisher.js';
import { handleRemoteJudgmentHookRequest } from '../src/remote-judgment-hook-http.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const input = { sessionId: 'session', turnId: 'turn', projectCode: 'project', trustedToken: 'verified-user-jwt' };
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(sequenceField = 'event_sequence') {
  const root = await mkdtemp(join(tmpdir(), 'journal-publisher-'));
  roots.push(root);
  const prefix = join(root, hash(input.sessionId), hash(input.turnId));
  await mkdir(`${prefix}.events`, { recursive: true });
  // The hosted reference journal binds identity through its path and route receipt.
  const identity = sequenceField === 'sequence' ? { session_ref: hash(input.sessionId), turn_id: input.turnId } : {};
  const episode = { ...identity, initial_route_receipt: { resolution_id: 'resolution', project_code: 'project', turn_id: input.turnId } };
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
