import { createHash } from 'node:crypto';
import {
  nativeMeetingMinutesVersionReference,
  type NativeMeetingMinutesVersionRecord,
} from './meeting-minutes-lineage-adapters.js';
import {
  MeetingMinutesLineageError,
  type MinutesLineageAccess,
  type MinutesLineageActor,
  type MinutesLineageCorrection,
  type MinutesLineageStore,
  type MinutesVersionReference,
} from './meeting-minutes-lineage.js';

/**
 * Lifecycle bridge between the native minutes save transaction and the
 * lineage correction ledger.  The native store remains the owner of version
 * records; this module only records the relationship after a successful
 * save.
 */
export const MEETING_MINUTES_LINEAGE_LIFECYCLE_CONTRACT_VERSION =
  'brainbase.meeting-minutes-lineage-lifecycle.v1' as const;

export interface MeetingMinutesLineageVersionSavedEvent {
  /** The exact version that the saved version supersedes. */
  readonly previousVersion: NativeMeetingMinutesVersionRecord;
  /** The exact version returned by the native save readback. */
  readonly replacementVersion: NativeMeetingMinutesVersionRecord;
  readonly access: MinutesLineageAccess;
  readonly actor: MinutesLineageActor;
  readonly reason: string;
}

/**
 * The retry payload intentionally contains no resolved access context.  A
 * host must re-resolve current authorization before retrying a failed
 * lineage write; it must never replay a stale authorization decision.
 */
export interface MeetingMinutesLineageCorrectionRetry {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly previousVersion: MinutesVersionReference;
  readonly replacementVersion: MinutesVersionReference;
  readonly reason: string;
}

export interface MeetingMinutesLineageCorrectionHookSuccess {
  readonly status: 'recorded';
  readonly correction: MinutesLineageCorrection;
  readonly retry: MeetingMinutesLineageCorrectionRetry;
}

export interface MeetingMinutesLineageCorrectionHookFailure {
  readonly status: 'failed';
  readonly retry: MeetingMinutesLineageCorrectionRetry;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export type MeetingMinutesLineageCorrectionHookResult =
  | MeetingMinutesLineageCorrectionHookSuccess
  | MeetingMinutesLineageCorrectionHookFailure;

export interface MeetingMinutesLineageCorrectionHook {
  /**
   * Call only after the native minutes save has read back successfully.
   * Failure is returned as data so the host can show a retry action while
   * keeping the saved version, adopted target, and Task state unchanged.
   */
  onVersionSaved(
    event: MeetingMinutesLineageVersionSavedEvent,
  ): Promise<MeetingMinutesLineageCorrectionHookResult>;
}

export interface MeetingMinutesLineageCorrectionHookOptions {
  readonly store: Pick<MinutesLineageStore, 'markCorrection'>;
  /** Organizations may preserve provider-specific source provenance here. */
  readonly referenceFor?: (record: NativeMeetingMinutesVersionRecord) => MinutesVersionReference;
}

export function createMeetingMinutesLineageCorrectionHook(
  options: MeetingMinutesLineageCorrectionHookOptions,
): MeetingMinutesLineageCorrectionHook {
  if (!options?.store || typeof options.store.markCorrection !== 'function') {
    throw new TypeError('store.markCorrection is required');
  }
  const referenceFor = options.referenceFor ?? nativeMeetingMinutesVersionReference;

  return {
    async onVersionSaved(event): Promise<MeetingMinutesLineageCorrectionHookResult> {
      const retry = buildRetry(event, referenceFor);
      try {
        validateVersionSavedEvent(event, retry);
        const correction = await options.store.markCorrection({
          id: retry.id,
          idempotencyKey: retry.idempotencyKey,
          previousVersion: retry.previousVersion,
          replacementVersion: retry.replacementVersion,
          actor: event.actor,
          reason: retry.reason,
          access: event.access,
        });
        return { status: 'recorded', correction, retry };
      } catch (error) {
        return { status: 'failed', retry, error: publicLifecycleError(error) };
      }
    },
  };
}

function buildRetry(
  event: MeetingMinutesLineageVersionSavedEvent,
  referenceFor: (record: NativeMeetingMinutesVersionRecord) => MinutesVersionReference,
): MeetingMinutesLineageCorrectionRetry {
  // Build the key from both full exact references, rather than a transport
  // request key.  A host retry after a network failure therefore cannot
  // create a second correction by choosing a different request key.
  let previousVersion: MinutesVersionReference;
  let replacementVersion: MinutesVersionReference;
  try {
    previousVersion = referenceFor(event.previousVersion);
  } catch {
    previousVersion = invalidReference('previous');
  }
  try {
    replacementVersion = referenceFor(event.replacementVersion);
  } catch {
    replacementVersion = invalidReference('replacement');
  }
  const pairDigest = digestJson({ previousVersion, replacementVersion });
  const idempotencyKey = `meeting-minutes:correction:${pairDigest}`;
  return {
    id: idempotencyKey,
    idempotencyKey,
    previousVersion,
    replacementVersion,
    reason: typeof event?.reason === 'string' ? event.reason : '',
  };
}

function validateVersionSavedEvent(
  event: MeetingMinutesLineageVersionSavedEvent,
  retry: MeetingMinutesLineageCorrectionRetry,
): void {
  if (!event || typeof event !== 'object') throw new MeetingMinutesLineageError('invalid_input', 'A saved version event is required');
  if (!event.previousVersion || !event.replacementVersion) {
    throw new MeetingMinutesLineageError('invalid_input', 'Both previous and replacement versions are required');
  }
  requireRecordString(event.previousVersion.meeting_id, 'previousVersion.meeting_id');
  requireRecordString(event.previousVersion.minutes_id, 'previousVersion.minutes_id');
  requireRecordString(event.previousVersion.version_id, 'previousVersion.version_id');
  requireRecordString(event.replacementVersion.meeting_id, 'replacementVersion.meeting_id');
  requireRecordString(event.replacementVersion.minutes_id, 'replacementVersion.minutes_id');
  requireRecordString(event.replacementVersion.version_id, 'replacementVersion.version_id');
  if (event.previousVersion.meeting_id !== event.replacementVersion.meeting_id
    || event.previousVersion.minutes_id !== event.replacementVersion.minutes_id) {
    throw new MeetingMinutesLineageError('invalid_input', 'A correction must use versions from the same minutes document');
  }
  if (event.previousVersion.version_id === event.replacementVersion.version_id) {
    throw new MeetingMinutesLineageError('invalid_input', 'A correction must point to different exact versions');
  }
  if (event.replacementVersion.predecessor_version_id !== event.previousVersion.version_id) {
    throw new MeetingMinutesLineageError('invalid_input', 'The replacement version must directly supersede the previous version');
  }
  if (!event.access || typeof event.access.principal !== 'string' || event.access.principal.trim() === '') {
    throw new MeetingMinutesLineageError('authorization_denied', 'A current lineage access context is required');
  }
  if (!event.actor || typeof event.actor.id !== 'string' || event.actor.id.trim() === '') {
    throw new MeetingMinutesLineageError('invalid_input', 'A saved version actor is required');
  }
  if (!event.reason || typeof event.reason !== 'string' || event.reason.trim() === '') {
    throw new MeetingMinutesLineageError('invalid_input', 'A correction reason is required');
  }
  if (!isValidReference(retry.previousVersion) || !isValidReference(retry.replacementVersion)) {
    throw new MeetingMinutesLineageError('integrity_mismatch', 'Saved versions did not produce exact lineage references');
  }
}

function isValidReference(value: MinutesVersionReference): boolean {
  return Boolean(value && typeof value.meetingId === 'string' && value.meetingId.trim()
    && typeof value.minutesId === 'string' && value.minutesId.trim()
    && typeof value.versionId === 'string' && value.versionId.trim()
    && (value.contentDigest === null || typeof value.contentDigest === 'string')
    && value.provenance && typeof value.provenance.providerKind === 'string'
    && typeof value.provenance.providerId === 'string');
}

function invalidReference(label: string): MinutesVersionReference {
  return {
    meetingId: '',
    minutesId: '',
    versionId: `invalid-${label}`,
    contentDigest: null,
    locator: null,
    provenance: { providerKind: '', providerId: '' },
  };
}

function requireRecordString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new MeetingMinutesLineageError('invalid_input', `${label} is required`);
  }
  return value;
}

function publicLifecycleError(error: unknown): { code: string; message: string } {
  if (error instanceof MeetingMinutesLineageError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'provider_unavailable',
    message: 'The minutes version was saved, but its lineage correction could not be recorded. Retry after the lineage provider is available.',
  };
}

function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`;
}
