import {
  dedupeMeetingSourceArtifacts,
  normalizeMeetingSourceArtifact,
  runMeetingSourceSync,
  type MeetingSourceArtifact,
  type MeetingSourceProvider,
  type MeetingSourceSyncPorts,
  type MeetingSourceSyncResult,
} from './meeting-source-sync.js';

/**
 * Host composition seam for the already implemented provider-neutral sync
 * core.  It deliberately delegates every operation; normalization, dedupe,
 * durable claim/save/readback, and retry behavior remain owned by the core.
 */
export const MEETING_SOURCE_SYNC_COMMON_ADAPTER_VERSION = 'brainbase.meeting-source-sync-common-adapter.v1' as const;

export interface MeetingSourceSyncCommonCore {
  readonly normalizeMeetingSourceArtifact: typeof normalizeMeetingSourceArtifact;
  readonly dedupeMeetingSourceArtifacts: typeof dedupeMeetingSourceArtifacts;
  readonly runMeetingSourceSync: typeof runMeetingSourceSync;
}

export interface MeetingSourceSyncCommonAdapter {
  normalizeSourceArtifact(raw: Record<string, unknown>, provider: MeetingSourceProvider): MeetingSourceArtifact;
  dedupeSourceArtifacts(artifacts: readonly MeetingSourceArtifact[]): ReturnType<typeof dedupeMeetingSourceArtifacts>;
  sync(
    input: Parameters<typeof runMeetingSourceSync>[0],
    ports: MeetingSourceSyncPorts,
  ): Promise<MeetingSourceSyncResult>;
}

export function createMeetingSourceSyncCommonAdapter(
  commonCore: MeetingSourceSyncCommonCore,
): MeetingSourceSyncCommonAdapter {
  if (!commonCore || typeof commonCore.runMeetingSourceSync !== 'function') {
    throw new TypeError('meeting source sync common core is required');
  }
  if (typeof commonCore.normalizeMeetingSourceArtifact !== 'function') {
    throw new TypeError('meeting source sync normalization export is required');
  }
  if (typeof commonCore.dedupeMeetingSourceArtifacts !== 'function') {
    throw new TypeError('meeting source sync dedupe export is required');
  }
  return Object.freeze({
    normalizeSourceArtifact(raw: Record<string, unknown>, provider: MeetingSourceProvider) {
      return commonCore.normalizeMeetingSourceArtifact(raw, provider);
    },
    dedupeSourceArtifacts(artifacts: readonly MeetingSourceArtifact[]) {
      return commonCore.dedupeMeetingSourceArtifacts(artifacts);
    },
    sync(input: Parameters<typeof runMeetingSourceSync>[0], ports: MeetingSourceSyncPorts) {
      return commonCore.runMeetingSourceSync(input, ports);
    },
  });
}

export const createDefaultMeetingSourceSyncCommonAdapter = (): MeetingSourceSyncCommonAdapter => createMeetingSourceSyncCommonAdapter({
  normalizeMeetingSourceArtifact,
  dedupeMeetingSourceArtifacts,
  runMeetingSourceSync,
});
