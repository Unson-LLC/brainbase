import { describe, expect, it } from 'vitest';

import {
  createDefaultMeetingSourceSyncCommonAdapter,
  createMeetingSourceSyncCommonAdapter,
} from '../src/meeting-source-sync-common-adapter.js';
import { dedupeMeetingSourceArtifacts, normalizeMeetingSourceArtifact, runMeetingSourceSync } from '../src/meeting-source-sync.js';

describe('meeting source sync common adapter', () => {
  it('delegates normalization, dedupe, and durable sync to the OSS core', async () => {
    const adapter = createDefaultMeetingSourceSyncCommonAdapter();
    const artifact = adapter.normalizeSourceArtifact({ id: 'one', text: 'hello' }, 'tactiq');
    expect(artifact).toEqual(normalizeMeetingSourceArtifact({ id: 'one', text: 'hello' }, 'tactiq'));
    expect(adapter.dedupeSourceArtifacts([artifact])).toEqual(dedupeMeetingSourceArtifacts([artifact]));

    const saved = new Map<string, Awaited<ReturnType<typeof runMeetingSourceSync>>>();
    const result = await adapter.sync({ provider: 'tactiq', idempotency_key: 'common-adapter-1' }, {
      provider: async () => [{ id: 'one', text: 'hello', updated_at: '2026-10-20T01:00:00.000Z' }],
      sink: {
        claimOrReplay: async (request) => {
          const existing = saved.get(request.idempotency_key);
          if (existing) return { status: 'replayed' as const, result: existing };
          const next = await request.execute();
          saved.set(request.idempotency_key, next);
          return { status: 'persisted' as const, result: next };
        },
        save: async (next) => {
          saved.set(next.idempotency_key, next);
          return next;
        },
        readback: async (key) => saved.get(key) ?? null,
      },
    });
    expect(result.artifacts).toHaveLength(1);
    expect(result.fingerprint).toBe(saved.get('common-adapter-1')?.fingerprint);
  });

  it('rejects a core that cannot provide each delegated operation', () => {
    expect(() => createMeetingSourceSyncCommonAdapter({
      runMeetingSourceSync,
      normalizeMeetingSourceArtifact,
      dedupeMeetingSourceArtifacts: undefined as never,
    })).toThrow(/dedupe export/);
  });
});
