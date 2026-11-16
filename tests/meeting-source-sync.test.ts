import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  dedupeMeetingSourceArtifacts,
  normalizeMeetingSourceArtifact,
  runMeetingSourceSync,
  stableMeetingSourceHash,
  type MeetingSourceSyncResult,
} from '../src/meeting-source-sync.js';

describe('meeting source sync common core', () => {
  it('keeps provider normalization and transcript hashing equivalent', () => {
    const artifact = normalizeMeetingSourceArtifact({
      id: 'tactiq-1',
      title: 'Weekly sync',
      text: '[{"speaker":"A","content":"Hello   world"}]',
      started_at: '2026-10-18T01:00:00.000Z',
      updated_at: '2026-10-18T01:05:00.000Z',
      conference_url: 'https://example.test/meet',
    }, 'tactiq');
    expect(artifact.source_text).toBe('A: Hello world');
    expect(artifact.transcript_hash).toBe(createHash('sha256').update('A: Hello world').digest('hex'));
    expect(artifact.raw_metadata.provider_role).toBe('online_primary');
    expect(artifact.dedupe_key).toBe(`hash:${artifact.transcript_hash}`);
    expect(dedupeMeetingSourceArtifacts([artifact, { ...artifact, provider: 'plaud', external_id: 'plaud-1' }])).toHaveLength(1);
  });

  it('retries sync persistence, reads back, and rejects conflicting replay', async () => {
    const results = new Map<string, MeetingSourceSyncResult>();
    const claims = new Map<string, MeetingSourceSyncResult>();
    const effects = new Map<string, MeetingSourceSyncResult>();
    let claimTail = Promise.resolve();
    let saveAttempts = 0;
    let providerCalls = 0;
    const ports = {
      provider: async () => {
        providerCalls += 1;
        return [{ id: 'source-1', title: 'Meeting', text: 'Transcript', updated_at: '2026-10-18T01:05:00.000Z' }];
      },
      sink: {
        findByIdempotencyKey: async (key: string) => results.get(key) ?? null,
        claimOrReplay: async (request: {
          idempotency_key: string;
          execute: () => Promise<MeetingSourceSyncResult>;
        }) => {
          const previous = claimTail;
          let release!: () => void;
          claimTail = new Promise<void>((resolve) => { release = resolve; });
          await previous;
          try {
            const replay = claims.get(request.idempotency_key);
            if (replay) return { status: 'replayed' as const, result: replay };
            const result = await request.execute();
            claims.set(request.idempotency_key, result);
            effects.set(request.idempotency_key, result);
            return { status: 'persisted' as const, result };
          } finally {
            release();
          }
        },
        save: async (result: MeetingSourceSyncResult) => {
          saveAttempts += 1;
          if (saveAttempts === 1) throw Object.assign(new Error('temporary sync failure'), { retryable: true });
          results.set(result.idempotency_key, result);
          return result;
        },
        readback: async (key: string) => results.get(key) ?? null,
      },
      is_retryable: (error: unknown) => Boolean((error as { retryable?: boolean }).retryable),
      now: () => new Date('2026-10-18T00:00:00.000Z'),
    };
    const input = { provider: 'tactiq' as const, idempotency_key: 'sync-test-1' };
    const [first, concurrentReplay] = await Promise.all([
      runMeetingSourceSync(input, ports),
      runMeetingSourceSync(input, ports),
    ]);
    expect(first.artifacts).toHaveLength(1);
    expect(first.cursor.updated_since).toBe('2026-10-18T01:05:00.000Z');
    expect(saveAttempts).toBe(2);
    const replay = await runMeetingSourceSync(input, ports);
    expect(replay).toEqual(first);
    expect(saveAttempts).toBe(2);
    expect(providerCalls).toBe(1);
    expect(effects.get(input.idempotency_key)).toEqual(first);
  });

  it('keeps timestamp-less provider payloads stable across moving clocks and rejects object text hashing', async () => {
    const first = normalizeMeetingSourceArtifact({ id: 'timestamp-less', title: 'Meeting', text: 'Transcript' }, 'tactiq', {
      now: () => new Date('2026-10-18T01:00:00.000Z'),
    });
    const second = normalizeMeetingSourceArtifact({ id: 'timestamp-less', title: 'Meeting', text: 'Transcript' }, 'tactiq', {
      now: () => new Date('2026-10-18T02:00:00.000Z'),
    });
    expect(first.updated_at).toBeNull();
    expect(second.updated_at).toBeNull();
    expect(first).toEqual(second);
    expect(() => stableMeetingSourceHash({} as unknown as string)).toThrow(/text only/);
  });

  it('keeps the persisted fingerprint stable across different retry clocks and rejects missing readback', async () => {
    const makeSink = () => {
      const results = new Map<string, MeetingSourceSyncResult>();
      return {
        claimOrReplay: async (request: { idempotency_key: string; execute: () => Promise<MeetingSourceSyncResult> }) => {
          const existing = results.get(request.idempotency_key);
          if (existing) return { status: 'replayed' as const, result: existing };
          const result = await request.execute();
          results.set(request.idempotency_key, result);
          return { status: 'persisted' as const, result };
        },
        save: async (result: MeetingSourceSyncResult) => {
          results.set(result.idempotency_key, result);
          return result;
        },
        readback: async (key: string) => results.get(key) ?? null,
      };
    };
    const provider = async () => [{ id: 'clock-independent', title: 'Clock independent', text: 'Same payload' }];
    const first = await runMeetingSourceSync({ provider: 'tactiq', idempotency_key: 'clock-1' }, {
      provider,
      sink: makeSink(),
      now: () => new Date('2026-10-18T01:00:00.000Z'),
    });
    const second = await runMeetingSourceSync({ provider: 'tactiq', idempotency_key: 'clock-2' }, {
      provider,
      sink: makeSink(),
      now: () => new Date('2026-10-18T02:00:00.000Z'),
    });
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.synced_at).not.toBe(second.synced_at);

    const missingReadbackSink = makeSink();
    missingReadbackSink.readback = async () => null;
    await expect(runMeetingSourceSync({ provider: 'tactiq', idempotency_key: 'missing-readback' }, {
      provider,
      sink: missingReadbackSink,
    })).rejects.toThrow(/readback mismatch/);
  });

  it('rejects a durable replay for the same key with a different provider window', async () => {
    const results = new Map<string, MeetingSourceSyncResult>();
    const sink = {
      claimOrReplay: async (request: {
        idempotency_key: string;
        execute: () => Promise<MeetingSourceSyncResult>;
      }) => {
        const replay = results.get(request.idempotency_key);
        if (replay) return { status: 'replayed' as const, result: replay };
        const result = await request.execute();
        results.set(request.idempotency_key, result);
        return { status: 'persisted' as const, result };
      },
      save: async (result: MeetingSourceSyncResult) => {
        results.set(result.idempotency_key, result);
        return result;
      },
      readback: async (key: string) => results.get(key) ?? null,
    };
    const provider = async ({ since }: { since?: string | null }) => [{
      id: since ?? 'source-window',
      title: 'Windowed meeting',
      text: 'Windowed transcript',
    }];
    await runMeetingSourceSync({
      provider: 'tactiq',
      idempotency_key: 'sync-window-conflict',
      since: '2026-10-18T00:00:00.000Z',
    }, { provider, sink });
    await expect(runMeetingSourceSync({
      provider: 'tactiq',
      idempotency_key: 'sync-window-conflict',
      since: '2026-10-19T00:00:00.000Z',
    }, { provider, sink })).rejects.toThrow(/idempotency conflict/);
  });
});
