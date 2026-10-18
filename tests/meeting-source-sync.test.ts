import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  dedupeMeetingSourceArtifacts,
  normalizeMeetingSourceArtifact,
  runMeetingSourceSync,
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
    let saveAttempts = 0;
    const ports = {
      provider: async () => [{ id: 'source-1', title: 'Meeting', text: 'Transcript', updated_at: '2026-10-18T01:05:00.000Z' }],
      sink: {
        findByIdempotencyKey: async (key: string) => results.get(key) ?? null,
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
    const first = await runMeetingSourceSync(input, ports);
    expect(first.artifacts).toHaveLength(1);
    expect(first.cursor.updated_since).toBe('2026-10-18T01:05:00.000Z');
    expect(saveAttempts).toBe(2);
    const replay = await runMeetingSourceSync(input, ports);
    expect(replay).toEqual(first);
    expect(saveAttempts).toBe(2);
  });
});
