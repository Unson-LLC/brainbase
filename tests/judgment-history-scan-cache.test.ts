import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const readPaths: string[] = [];

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      readPaths.push(String(args[0]));
      return actual.readFile(...args);
    }
  };
});

const { JudgmentHistoryJournalScanCache, canonicalJson, createJudgmentHistoryReader, createLocalJudgmentHistorySource } = await import('../src/judgment-history.js');

const roots: string[] = [];

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function adoption(sessionRef: string, turnId: string, resolutionId: string): Record<string, unknown> {
  const request = {
    request: `request-${resolutionId}`,
    turn_id: turnId,
    conversation_context: {
      schema_version: 'brainbase-conversation-context-v1',
      session_ref: sessionRef,
      messages: [],
      prior_receipts: [],
      runtime: { host: 'test', model: null, permission_mode: null, project_binding: null },
      instruction_bindings: [],
      completeness: 'complete',
      source_digest: 'source'
    }
  };
  const receipt = {
    resolution_id: resolutionId,
    resolved_at: '2026-10-07T01:00:00.000Z',
    turn_id: turnId,
    status: 'resolved'
  };
  return {
    schema_version: 'brainbase-judgment-adoption-v2',
    accepted_at: '2026-10-07T01:00:01.000Z',
    request_text_digest: digest(request.request),
    request,
    receipt,
    receipt_digest: digest(canonicalJson(receipt)),
    owner_audit: { decision: `decision-${resolutionId}` }
  };
}

afterEach(async () => {
  readPaths.length = 0;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('judgment history journal scan cache', () => {
  it('reuses a turn until its mtime changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brainbase-history-cache-'));
    roots.push(root);
    const sessionRef = 'c'.repeat(64);
    const fileName = `${digest('turn-cache')}.json`;
    const filePath = join(root, sessionRef, fileName);
    await mkdir(join(root, sessionRef), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(adoption(sessionRef, 'turn-cache', 'resolution-cache'))}\n`);
    const source = createLocalJudgmentHistorySource({ root, entrypoint: 'codex' });
    const reader = createJudgmentHistoryReader({ source });

    readPaths.length = 0;
    const first = await reader.home();
    expect(first.records?.map((record) => record.record_id)).toEqual(['resolution-cache']);
    const firstReads = readPaths.filter((path) => path === filePath);
    expect(firstReads.length).toBeGreaterThan(0);
    expect(source.timings?.()).toMatchObject({ cache_hits: 0, cache_misses: 1 });

    readPaths.length = 0;
    const second = await reader.home();
    expect(second.records?.map((record) => record.record_id)).toEqual(['resolution-cache']);
    expect(readPaths.filter((path) => path === filePath)).toEqual([]);
    expect(source.timings?.()?.cache_hits).toBe(1);
    expect(source.timings?.()?.cache_misses).toBe(0);

    await utimes(filePath, new Date('2026-10-14T03:00:00Z'), new Date('2026-10-14T03:00:00Z'));
    readPaths.length = 0;
    const third = await reader.home();
    expect(third.records?.map((record) => record.record_id)).toEqual(['resolution-cache']);
    expect(readPaths.filter((path) => path === filePath).length).toBeGreaterThan(0);
    expect(source.timings?.()?.cache_hits).toBe(0);
    expect(source.timings?.()?.cache_misses).toBe(1);
  });

  it('drops the least recently used artifact after the cache limit', () => {
    const parsed = (name: string) => ({ value: { name }, missing: false, invalid: false });
    const first = parsed('first');
    const second = parsed('second');
    const third = parsed('third');
    const cache = new JudgmentHistoryJournalScanCache(2);
    cache.store('session', 'turn-1', 'a.json', 1n, first);
    cache.store('session', 'turn-2', 'b.json', 1n, second);
    expect(cache.size).toBe(2);
    cache.store('session', 'turn-3', 'c.json', 1n, third);
    expect(cache.size).toBe(2);
    expect(cache.lookup('session', 'turn-1', 'a.json', 1n)).toBeNull();
    expect(cache.lookup('session', 'turn-2', 'b.json', 1n)).toBe(second);
    expect(cache.lookup('session', 'turn-3', 'c.json', 1n)).toBe(third);

    const refreshed = new JudgmentHistoryJournalScanCache(2);
    refreshed.store('session', 'turn-1', 'a.json', 1n, first);
    refreshed.store('session', 'turn-2', 'b.json', 1n, second);
    expect(refreshed.lookup('session', 'turn-1', 'a.json', 1n)).toBe(first);
    refreshed.store('session', 'turn-3', 'c.json', 1n, third);
    expect(refreshed.lookup('session', 'turn-2', 'b.json', 1n)).toBeNull();
    expect(refreshed.lookup('session', 'turn-1', 'a.json', 1n)).toBe(first);
    expect(refreshed.lookup('session', 'turn-3', 'c.json', 1n)).toBe(third);
    expect(refreshed.size).toBe(2);
  });
});
