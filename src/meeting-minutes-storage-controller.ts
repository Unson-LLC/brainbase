import {
  MeetingMinutesReadResult,
  MeetingMinutesStorageAdapter,
  MeetingMinutesStorageCapabilities,
  MeetingMinutesStorageRequestContext,
  MeetingMinutesRegisterResult,
} from './meeting-minutes-storage.js';
import { createHash } from 'node:crypto';

/** Provider-independent storage placement and re-import boundary. */
export const MEETING_MINUTES_STORAGE_CONTROLLER_CONTRACT_VERSION = 'brainbase.meeting-minutes-storage-controller.v1' as const;

export interface MeetingMinutesControllerSourceRef {
  readonly provider: string;
  readonly locator: string;
  readonly revision: string;
  readonly digest: string;
  /** Adapter provenance is retained with the source ref, but is not part of identity. */
  readonly provenance?: Readonly<Record<string, unknown>>;
}

export interface MeetingMinutesControllerRequestContext extends MeetingMinutesStorageRequestContext {}

export interface MeetingMinutesControllerMeetingRecord {
  readonly meeting_id: string;
}

export interface MeetingMinutesControllerDocumentRecord {
  readonly minutes_id: string;
  readonly meeting_id: string;
  readonly current_version_id: string;
  readonly revision: number;
}

export interface MeetingMinutesControllerVersionRecord {
  readonly version_id: string;
  readonly minutes_id: string;
  readonly meeting_id: string;
  readonly predecessor_version_id?: string;
  readonly body?: string;
  readonly body_digest?: string;
  readonly source_ref?: MeetingMinutesControllerSourceRef;
}

export interface MeetingMinutesControllerDetail {
  readonly meeting: MeetingMinutesControllerMeetingRecord;
  readonly minutes: readonly MeetingMinutesControllerDocumentRecord[];
  readonly versions: readonly MeetingMinutesControllerVersionRecord[];
  readonly snapshot_revision: number;
}

export interface MeetingMinutesControllerCreateMeetingInput {
  readonly title: string;
  readonly scheduled_at?: string;
  readonly ended_at?: string;
  readonly participant_ids?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly minutes_title?: string;
  readonly minutes_metadata?: Readonly<Record<string, unknown>>;
  /** Optional durable retry receipt supplied by an HTTP host. */
  readonly idempotency_key?: string;
  readonly idempotency_fingerprint?: string;
}

export interface MeetingMinutesControllerCreateMinutesInput {
  readonly title?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly expected_revision: number;
  readonly idempotency_key?: string;
  readonly idempotency_fingerprint?: string;
}

export interface MeetingMinutesControllerSaveVersionInput {
  readonly minutes_id: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly expected_revision: number;
  readonly predecessor_version_id?: string;
  readonly idempotency_key?: string;
  readonly idempotency_fingerprint?: string;
}

export interface MeetingMinutesControllerRebindInput extends MeetingMinutesControllerSaveVersionInput {
  readonly meeting_id: string;
}

export interface MeetingMinutesControllerConfirmVersionInput {
  readonly meeting_id: string;
  readonly minutes_id: string;
  readonly version_id: string;
  readonly expected_revision: number;
  readonly idempotency_key?: string;
  readonly idempotency_fingerprint?: string;
}

/** This port is structurally compatible with `MeetingMinutesStore`. */
export interface MeetingMinutesControllerCorePort {
  create_meeting(
    input: MeetingMinutesControllerCreateMeetingInput & {
      readonly initial_body?: string;
      readonly source_ref?: MeetingMinutesControllerSourceRef;
    },
    context: MeetingMinutesControllerRequestContext,
  ): Promise<MeetingMinutesControllerDetail>;
  create_minutes(
    meeting_id: string,
    input: MeetingMinutesControllerCreateMinutesInput & {
      readonly body?: string;
      readonly source_ref?: MeetingMinutesControllerSourceRef;
    },
    context: MeetingMinutesControllerRequestContext,
  ): Promise<MeetingMinutesControllerDetail>;
  get_meeting(meeting_id: string, context: MeetingMinutesControllerRequestContext): Promise<MeetingMinutesControllerDetail>;
  get_version(
    meeting_id: string,
    minutes_id: string,
    version_id: string,
    context: MeetingMinutesControllerRequestContext,
  ): Promise<MeetingMinutesControllerVersionRecord>;
  save_version(
    input: MeetingMinutesControllerSaveVersionInput & {
      readonly body?: string;
      readonly source_ref?: MeetingMinutesControllerSourceRef;
    },
    context: MeetingMinutesControllerRequestContext,
  ): Promise<MeetingMinutesControllerDetail>;
  /** Optional on older ports; required when confirmation is exposed. */
  confirm_version?(
    input: MeetingMinutesControllerConfirmVersionInput,
    context: MeetingMinutesControllerRequestContext,
  ): Promise<MeetingMinutesControllerDetail>;
}

export interface MeetingMinutesExternalAdapterBinding {
  /** Must equal the provider returned by `register` and stored in source_ref. */
  readonly provider: string;
  readonly adapter: MeetingMinutesStorageAdapter;
}

export interface MeetingMinutesExternalSourceIdentity {
  readonly meeting_id: string;
  readonly minutes_id: string;
  readonly version_id: string;
}

/**
 * The host can back this registry with the same durable registry passed to the
 * core's `external_source_hook`. The in-memory implementation is intentionally
 * process-scoped and is suitable only for an explicitly short-lived host.
 */
export interface MeetingMinutesExternalSourceRegistry {
  find_existing(source_ref: MeetingMinutesControllerSourceRef): Promise<MeetingMinutesExternalSourceIdentity | undefined>;
  register(source_ref: MeetingMinutesControllerSourceRef, identity: MeetingMinutesExternalSourceIdentity): Promise<void>;
}

export class InMemoryMeetingMinutesExternalSourceRegistry implements MeetingMinutesExternalSourceRegistry {
  private readonly entries = new Map<string, MeetingMinutesExternalSourceIdentity>();

  async find_existing(source_ref: MeetingMinutesControllerSourceRef): Promise<MeetingMinutesExternalSourceIdentity | undefined> {
    const identity = this.entries.get(sourceKey(source_ref));
    return identity ? { ...identity } : undefined;
  }

  async register(source_ref: MeetingMinutesControllerSourceRef, identity: MeetingMinutesExternalSourceIdentity): Promise<void> {
    const key = sourceKey(source_ref);
    const existing = this.entries.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(identity)) {
      throw new MeetingMinutesStorageControllerError('idempotency_conflict', 'The external source is already bound to another minutes identity');
    }
    this.entries.set(key, { ...identity });
  }
}

export type MeetingMinutesStoragePlacement =
  | { readonly kind: 'native'; readonly body?: string }
  | { readonly kind: 'external'; readonly provider: string; readonly locator: string };

export type MeetingMinutesStorageReadStatus =
  | 'native'
  | 'available'
  | 'denied'
  | 'unavailable'
  | 'historical_unavailable';

export interface MeetingMinutesResolvedVersion {
  readonly version: MeetingMinutesControllerVersionRecord;
  readonly placement: 'native' | 'external' | 'unknown';
  readonly source_status: MeetingMinutesStorageReadStatus;
  readonly body?: string;
  readonly source_result?: MeetingMinutesReadResult;
  readonly capabilities?: MeetingMinutesStorageCapabilities;
  readonly reason?: string;
}

export interface MeetingMinutesStorageControllerOptions {
  readonly core: MeetingMinutesControllerCorePort;
  readonly external_adapters?: readonly MeetingMinutesExternalAdapterBinding[];
  readonly external_registry?: MeetingMinutesExternalSourceRegistry;
}

export type MeetingMinutesStorageControllerErrorCode =
  | 'invalid_configuration'
  | 'source_denied'
  | 'source_unavailable'
  | 'source_changed'
  | 'idempotency_conflict'
  | 'storage_unavailable';

export class MeetingMinutesStorageControllerError extends Error {
  readonly code: MeetingMinutesStorageControllerErrorCode;
  readonly source_result?: MeetingMinutesReadResult | MeetingMinutesRegisterResult;

  constructor(
    code: MeetingMinutesStorageControllerErrorCode,
    message: string,
    source_result?: MeetingMinutesReadResult | MeetingMinutesRegisterResult,
  ) {
    super(message);
    this.name = 'MeetingMinutesStorageControllerError';
    this.code = code;
    this.source_result = source_result;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new MeetingMinutesStorageControllerError('invalid_configuration', `${label} is required`);
  }
  return value.trim();
}

function sourceKey(source: MeetingMinutesControllerSourceRef): string {
  return JSON.stringify([source.provider, source.locator, source.revision, source.digest]);
}

function sourceFromReference(reference: {
  readonly provider: string;
  readonly locator: string;
  readonly revision: string;
  readonly digest: string;
  readonly provenance?: object;
}): MeetingMinutesControllerSourceRef {
  const provenance = isRecord(reference.provenance) ? Object.freeze({ ...reference.provenance }) : undefined;
  return {
    provider: requiredText(reference.provider, 'source_ref.provider'),
    locator: requiredText(reference.locator, 'source_ref.locator'),
    revision: requiredText(reference.revision, 'source_ref.revision'),
    digest: requiredText(reference.digest, 'source_ref.digest'),
    ...(provenance ? { provenance } : {}),
  };
}

function coreErrorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
}

function sourceStatus(result: MeetingMinutesReadResult): MeetingMinutesStorageReadStatus {
  if (result.status === 'available') return 'available';
  if (result.status === 'denied') return 'denied';
  if (result.status === 'integrity_mismatch') return 'historical_unavailable';
  return 'unavailable';
}

function sourceFailureCode(result: MeetingMinutesReadResult | MeetingMinutesRegisterResult): MeetingMinutesStorageControllerErrorCode {
  if (result.status === 'denied') return 'source_denied';
  if (result.status === 'integrity_mismatch') return 'source_changed';
  return 'source_unavailable';
}

function sourceFailureMessage(result: MeetingMinutesReadResult | MeetingMinutesRegisterResult): string {
  if ('reason' in result && typeof result.reason === 'string' && result.reason.trim()) return result.reason;
  if (result.status === 'integrity_mismatch') return 'The external source changed and its historical revision is unavailable';
  return 'The external source could not be resolved';
}

function versionFor(detail: MeetingMinutesControllerDetail, minutesId: string, versionId: string): MeetingMinutesControllerVersionRecord {
  const version = detail.versions.find((candidate) => candidate.minutes_id === minutesId && candidate.version_id === versionId);
  if (!version) throw new MeetingMinutesStorageControllerError('storage_unavailable', 'The core did not return the requested minutes version');
  return version;
}

function documentFor(detail: MeetingMinutesControllerDetail, minutesId: string): MeetingMinutesControllerDocumentRecord {
  const document = detail.minutes.find((candidate) => candidate.minutes_id === minutesId);
  if (!document) throw new MeetingMinutesStorageControllerError('storage_unavailable', 'The core did not return the requested minutes document');
  return document;
}

function identityForMeeting(detail: MeetingMinutesControllerDetail): MeetingMinutesExternalSourceIdentity {
  const document = detail.minutes.find((candidate) => candidate.meeting_id === detail.meeting.meeting_id);
  if (!document) throw new MeetingMinutesStorageControllerError('storage_unavailable', 'The core did not return a minutes document for the new meeting');
  return {
    meeting_id: detail.meeting.meeting_id,
    minutes_id: document.minutes_id,
    version_id: document.current_version_id,
  };
}

function identityForCreatedMinutes(
  before: MeetingMinutesControllerDetail,
  after: MeetingMinutesControllerDetail,
  meetingId: string,
): MeetingMinutesExternalSourceIdentity {
  const beforeIds = new Set(before.minutes.map((candidate) => candidate.minutes_id));
  const document = after.minutes.find((candidate) => candidate.meeting_id === meetingId && !beforeIds.has(candidate.minutes_id));
  if (!document) throw new MeetingMinutesStorageControllerError('storage_unavailable', 'The core did not return the newly created minutes document');
  return { meeting_id: meetingId, minutes_id: document.minutes_id, version_id: document.current_version_id };
}

function identityForSavedVersion(
  detail: MeetingMinutesControllerDetail,
  minutesId: string,
): MeetingMinutesExternalSourceIdentity {
  const document = documentFor(detail, minutesId);
  return { meeting_id: document.meeting_id, minutes_id: minutesId, version_id: document.current_version_id };
}

function withSource(
  input: MeetingMinutesControllerVersionRecord,
  source: MeetingMinutesControllerSourceRef,
): MeetingMinutesControllerVersionRecord {
  return { ...input, source_ref: source };
}

/**
 * Service boundary for native and external minutes placement.
 *
 * It owns placement selection, adapter registration, source re-read and
 * deduplication orchestration. The core remains the owner of Brainbase IDs,
 * ACLs, CAS revisions and immutable version records.
 */
export class MeetingMinutesStorageController {
  readonly contract_version = MEETING_MINUTES_STORAGE_CONTROLLER_CONTRACT_VERSION;

  private readonly core: MeetingMinutesControllerCorePort;
  private readonly adapters: ReadonlyMap<string, MeetingMinutesExternalAdapterBinding>;
  private readonly registry: MeetingMinutesExternalSourceRegistry;

  constructor(options: MeetingMinutesStorageControllerOptions) {
    if (!options || !options.core || typeof options.core.create_meeting !== 'function'
      || typeof options.core.create_minutes !== 'function' || typeof options.core.get_meeting !== 'function'
      || typeof options.core.get_version !== 'function' || typeof options.core.save_version !== 'function') {
      throw new MeetingMinutesStorageControllerError('invalid_configuration', 'A compatible meeting minutes core port is required');
    }
    const entries = new Map<string, MeetingMinutesExternalAdapterBinding>();
    for (const binding of options.external_adapters ?? []) {
      const provider = requiredText(binding?.provider, 'external adapter provider');
      if (!binding.adapter || typeof binding.adapter.register !== 'function' || typeof binding.adapter.read !== 'function') {
        throw new MeetingMinutesStorageControllerError('invalid_configuration', `Adapter ${provider} does not implement register/read`);
      }
      if (entries.has(provider)) throw new MeetingMinutesStorageControllerError('invalid_configuration', `Adapter ${provider} is configured more than once`);
      entries.set(provider, binding);
    }
    this.core = options.core;
    this.adapters = entries;
    this.registry = options.external_registry ?? new InMemoryMeetingMinutesExternalSourceRegistry();
  }

  async create_meeting(
    input: MeetingMinutesControllerCreateMeetingInput,
    placement: MeetingMinutesStoragePlacement,
    context: MeetingMinutesControllerRequestContext,
  ): Promise<MeetingMinutesControllerDetail> {
    if (placement.kind === 'native') {
      return this.core.create_meeting({ ...input, initial_body: placement.body ?? '' }, context);
    }
    const registered = await this.registerExternal(placement, context);
    const existing = await this.findExisting(registered.source, context);
    if (existing) return existing.detail;
    try {
      const detail = await this.core.create_meeting({ ...input, source_ref: registered.source }, context);
      await this.registry.register(registered.source, identityForMeeting(detail));
      return detail;
    } catch (error) {
      const recovered = await this.recoverIdempotency(registered.source, context, error);
      if (recovered) return recovered;
      throw error;
    }
  }

  async create_minutes(
    meetingId: string,
    input: MeetingMinutesControllerCreateMinutesInput,
    placement: MeetingMinutesStoragePlacement,
    context: MeetingMinutesControllerRequestContext,
  ): Promise<MeetingMinutesControllerDetail> {
    const before = await this.core.get_meeting(meetingId, context);
    if (placement.kind === 'native') {
      return this.core.create_minutes(meetingId, { ...input, body: placement.body ?? '' }, context);
    }
    const registered = await this.registerExternal(placement, context);
    const existing = await this.findExisting(registered.source, context);
    if (existing) {
      if (existing.identity.meeting_id !== meetingId) {
        throw new MeetingMinutesStorageControllerError('idempotency_conflict', 'The external source is already bound to another meeting');
      }
      return existing.detail;
    }
    try {
      const detail = await this.core.create_minutes(meetingId, { ...input, source_ref: registered.source }, context);
      await this.registry.register(registered.source, identityForCreatedMinutes(before, detail, meetingId));
      return detail;
    } catch (error) {
      const recovered = await this.recoverIdempotency(registered.source, context, error);
      if (recovered) return recovered;
      throw error;
    }
  }

  async save_version(
    input: MeetingMinutesControllerSaveVersionInput,
    placement: MeetingMinutesStoragePlacement,
    context: MeetingMinutesControllerRequestContext,
  ): Promise<MeetingMinutesControllerDetail> {
    if (placement.kind === 'native') {
      return this.core.save_version({ ...input, body: placement.body ?? '' }, context);
    }
    const registered = await this.registerExternal(placement, context);
    const existing = await this.findExisting(registered.source, context);
    if (existing) {
      if (existing.identity.minutes_id !== input.minutes_id) {
        throw new MeetingMinutesStorageControllerError('idempotency_conflict', 'The external source is already bound to another minutes document');
      }
      return existing.detail;
    }
    try {
      const detail = await this.core.save_version({ ...input, source_ref: registered.source }, context);
      await this.registry.register(registered.source, identityForSavedVersion(detail, input.minutes_id));
      return detail;
    } catch (error) {
      const recovered = await this.recoverIdempotency(registered.source, context, error, input.minutes_id);
      if (recovered) return recovered;
      throw error;
    }
  }

  /** Read native bodies directly and external bodies through the current ACL. */
  async get_version(
    meetingId: string,
    minutesId: string,
    versionId: string,
    context: MeetingMinutesControllerRequestContext,
  ): Promise<MeetingMinutesResolvedVersion> {
    const version = await this.core.get_version(meetingId, minutesId, versionId, context);
    if (version.body !== undefined && version.source_ref === undefined) {
      return {
        version,
        placement: 'native',
        source_status: 'native',
        body: version.body,
      };
    }
    if (!version.source_ref) {
      return {
        version,
        placement: 'unknown',
        source_status: 'unavailable',
        reason: 'The core version has neither a native body nor an external source reference',
      };
    }
    const binding = this.adapters.get(version.source_ref.provider);
    if (!binding) {
      return {
        version,
        placement: 'external',
        source_status: 'unavailable',
        reason: `No adapter is configured for provider ${version.source_ref.provider}`,
      };
    }
    let result: MeetingMinutesReadResult;
    try {
      result = binding.adapter.read_source
        ? await binding.adapter.read_source({ source_ref: version.source_ref, request_context: context })
        : {
            status: 'unavailable',
            reason: 'The configured adapter cannot resolve a persisted source reference',
            capabilities: binding.adapter.capabilities,
          };
    } catch {
      return {
        version,
        placement: 'external',
        source_status: 'unavailable',
        capabilities: binding.adapter.capabilities,
        reason: 'The configured adapter could not read the external source',
      };
    }
    if (result.status === 'available') {
      return {
        version: withSource(version, sourceFromReference(result.reference)),
        placement: 'external',
        source_status: 'available',
        body: result.body,
        source_result: result,
        capabilities: result.capabilities,
      };
    }
    return {
      version,
      placement: 'external',
      source_status: sourceStatus(result),
      source_result: result,
      capabilities: result.capabilities,
      reason: sourceFailureMessage(result),
    };
  }

  /**
   * Move the current minutes document to an explicit placement. The core's
   * minutes_id remains the identity; this creates an immutable successor
   * version and never writes the external provider.
   */
  async rebind(
    input: MeetingMinutesControllerRebindInput,
    placement: MeetingMinutesStoragePlacement,
    context: MeetingMinutesControllerRequestContext,
  ): Promise<MeetingMinutesControllerDetail> {
    if (placement.kind === 'external') return this.save_version(input, placement, context);
    const current = await this.core.get_meeting(
      requiredText(input.meeting_id, 'meeting_id'),
      context,
    );
    const document = documentFor(current, input.minutes_id);
    const currentVersion = versionFor(current, input.minutes_id, document.current_version_id);
    let body = placement.body;
    if (body === undefined && currentVersion.body !== undefined) body = currentVersion.body;
    if (body === undefined && currentVersion.source_ref) {
      const resolved = await this.get_version(current.meeting.meeting_id, input.minutes_id, currentVersion.version_id, context);
      if (resolved.source_status !== 'available' || resolved.body === undefined) {
        throw new MeetingMinutesStorageControllerError(
          resolved.source_status === 'denied' ? 'source_denied' : 'source_unavailable',
          resolved.reason ?? 'The external source cannot be read for native rebind',
          resolved.source_result,
        );
      }
      body = resolved.body;
    }
    if (body === undefined) {
      throw new MeetingMinutesStorageControllerError('source_unavailable', 'The current minutes version has no readable body');
    }
    return this.core.save_version({ ...input, body }, context);
  }

  /**
   * Confirm only an exact, currently readable external version.  The core
   * receipt is written after the adapter has re-read the source, so an ACL
   * revocation, source change, or missing historical revision cannot be
   * turned into a confirmation by reusing a newer body.
   */
  async confirm_version(
    input: MeetingMinutesControllerConfirmVersionInput,
    context: MeetingMinutesControllerRequestContext,
  ): Promise<MeetingMinutesControllerDetail> {
    if (typeof this.core.confirm_version !== 'function') {
      throw new MeetingMinutesStorageControllerError('invalid_configuration', 'The core does not implement confirm_version');
    }
    const version = await this.core.get_version(input.meeting_id, input.minutes_id, input.version_id, context);
    if (version.source_ref) {
      const resolved = await this.get_version(input.meeting_id, input.minutes_id, input.version_id, context);
      if (resolved.source_status !== 'available' || typeof resolved.body !== 'string') {
        const code = resolved.source_status === 'denied' ? 'source_denied'
          : resolved.source_status === 'historical_unavailable' ? 'source_changed' : 'source_unavailable';
        throw new MeetingMinutesStorageControllerError(
          code,
          resolved.reason ?? 'The exact external minutes version is not currently readable',
          resolved.source_result,
        );
      }
      const digest = `sha256:${createHash('sha256').update(resolved.body, 'utf8').digest('hex')}`;
      if (digest !== version.source_ref.digest) {
        throw new MeetingMinutesStorageControllerError('source_changed', 'The exact external minutes digest does not match the stored revision', resolved.source_result);
      }
    }
    return this.core.confirm_version(input, context);
  }

  private async registerExternal(
    placement: Extract<MeetingMinutesStoragePlacement, { kind: 'external' }>,
    context: MeetingMinutesControllerRequestContext,
  ): Promise<{ source: MeetingMinutesControllerSourceRef; capabilities: MeetingMinutesStorageCapabilities }> {
    const provider = requiredText(placement.provider, 'external placement provider');
    const locator = requiredText(placement.locator, 'external placement locator');
    const binding = this.adapters.get(provider);
    if (!binding) throw new MeetingMinutesStorageControllerError('invalid_configuration', `No adapter is configured for provider ${provider}`);
    let result: MeetingMinutesRegisterResult;
    try {
      result = await binding.adapter.register({ locator, request_context: context });
    } catch {
      throw new MeetingMinutesStorageControllerError('source_unavailable', 'The configured adapter could not register the external source');
    }
    if (result.status !== 'registered') {
      throw new MeetingMinutesStorageControllerError(sourceFailureCode(result), sourceFailureMessage(result), result);
    }
    if (result.reference.provider !== provider) {
      throw new MeetingMinutesStorageControllerError('storage_unavailable', 'The adapter returned a provider different from its binding');
    }
    return { source: sourceFromReference(result.reference), capabilities: result.capabilities };
  }

  private async findExisting(
    source: MeetingMinutesControllerSourceRef,
    context: MeetingMinutesControllerRequestContext,
  ): Promise<{ identity: MeetingMinutesExternalSourceIdentity; detail: MeetingMinutesControllerDetail } | undefined> {
    const identity = await this.registry.find_existing(source);
    if (!identity) return undefined;
    return { identity, detail: await this.core.get_meeting(identity.meeting_id, context) };
  }

  private async recoverIdempotency(
    source: MeetingMinutesControllerSourceRef,
    context: MeetingMinutesControllerRequestContext,
    error: unknown,
    minutesId?: string,
  ): Promise<MeetingMinutesControllerDetail | undefined> {
    if (coreErrorCode(error) !== 'idempotency_conflict') throw error;
    const identity = await this.registry.find_existing(source);
    if (!identity || (minutesId && identity.minutes_id !== minutesId)) return undefined;
    return this.core.get_meeting(identity.meeting_id, context);
  }
}
