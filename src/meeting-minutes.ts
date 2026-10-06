import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';

/** Provider-independent native meeting and minutes lifecycle. */
export const MEETING_MINUTES_CONTRACT_VERSION = 'brainbase.meeting-minutes.v1' as const;
export const MEETING_MINUTES_SNAPSHOT_VERSION = 1 as const;
export const MEETING_MINUTES_SIDECAR = 'meeting-minutes.json' as const;
export const MEETING_MINUTES_BODY_DIGEST_ALGORITHM = 'sha256' as const;

export type MeetingId = string;
export type MinutesId = string;
export type MinutesVersionId = string;

export interface MeetingMinutesSourceRef {
  /** Stable provider name supplied by an adapter, never used as the native id. */
  readonly provider: string;
  readonly locator: string;
  /** Provider revision at which the source was observed. */
  readonly revision: string;
  /** Exact provider content digest for duplicate suppression and readback. */
  readonly digest: string;
  /** Adapter supplied provenance is retained as part of the source reference. */
  readonly provenance?: Readonly<Record<string, unknown>>;
  /** Provider adapters may carry additional opaque locator details. */
  readonly [key: string]: unknown;
}

export interface MeetingMinutesAcl {
  readonly owner_id: string;
  readonly reader_ids: readonly string[];
  readonly writer_ids: readonly string[];
}

export interface MeetingRecord {
  readonly meeting_id: MeetingId;
  readonly title: string;
  readonly scheduled_at?: string;
  readonly ended_at?: string;
  readonly participant_ids: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly acl: MeetingMinutesAcl;
  readonly created_at: string;
  readonly created_actor_id: string;
  readonly revision: number;
}

export interface MinutesConfirmationReceipt {
  readonly version_id: MinutesVersionId;
  readonly actor_id: string;
  readonly confirmed_at: string;
}

export interface MinutesVersionRecord {
  readonly version_id: MinutesVersionId;
  readonly minutes_id: MinutesId;
  readonly meeting_id: MeetingId;
  readonly predecessor_version_id?: MinutesVersionId;
  /** Native versions carry the writable Brainbase body. External versions omit it. */
  readonly body?: string;
  readonly body_digest?: string;
  readonly created_at: string;
  readonly created_actor_id: string;
  readonly confirmation?: MinutesConfirmationReceipt;
  readonly source_ref?: MeetingMinutesSourceRef;
}

export interface MinutesDocumentRecord {
  readonly minutes_id: MinutesId;
  readonly meeting_id: MeetingId;
  readonly title: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly acl: MeetingMinutesAcl;
  readonly version_ids: readonly MinutesVersionId[];
  readonly current_version_id: MinutesVersionId;
  readonly created_at: string;
  readonly created_actor_id: string;
  readonly updated_at: string;
  readonly revision: number;
}

export interface MeetingMinutesSnapshot {
  readonly schema_version: typeof MEETING_MINUTES_SNAPSHOT_VERSION;
  /** Aggregate revision used by the storage port's compare-and-swap. */
  readonly revision: number;
  readonly meetings: readonly MeetingRecord[];
  readonly documents: readonly MinutesDocumentRecord[];
  readonly versions: readonly MinutesVersionRecord[];
  readonly idempotency: readonly MeetingMinutesIdempotencyRecord[];
}

export type MeetingMinutesIdempotencyOperation = 'create_meeting' | 'create_minutes' | 'save_version' | 'confirm_version';

/** Durable write receipt.  It lets a retried mutation find its exact target after restart. */
export interface MeetingMinutesIdempotencyRecord {
  readonly key: string;
  readonly principal_id: string;
  readonly fingerprint: string;
  readonly operation: MeetingMinutesIdempotencyOperation;
  readonly meeting_id: MeetingId;
  readonly minutes_id?: MinutesId;
  readonly version_id?: MinutesVersionId;
}

export interface MeetingMinutesRequestContext {
  /** Resolved by the host or organization auth boundary. Never read from input JSON. */
  readonly principal_id: string;
}

export type MeetingMinutesResource = MeetingRecord | MinutesDocumentRecord | MinutesVersionRecord;

export interface MeetingMinutesAuthorizer {
  can_read?(resource: MeetingMinutesResource, context: MeetingMinutesRequestContext): boolean | Promise<boolean>;
  can_write?(resource: MeetingMinutesResource, context: MeetingMinutesRequestContext): boolean | Promise<boolean>;
}

/** Minimal seam for organization storage adapters and future durable stores. */
export interface MeetingMinutesStoragePort {
  read(): Promise<MeetingMinutesSnapshot>;
  /** Implementations must compare the on-disk/current revision before replacing the snapshot. */
  write(next: MeetingMinutesSnapshot, expected_revision: number): Promise<void>;
}

export interface MeetingCreateInput {
  readonly title: string;
  readonly scheduled_at?: string;
  readonly ended_at?: string;
  readonly participant_ids?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly minutes_title?: string;
  readonly minutes_metadata?: Readonly<Record<string, unknown>>;
  readonly initial_body?: string;
  readonly source_ref?: MeetingMinutesSourceRef;
  readonly idempotency_key?: string;
  readonly idempotency_fingerprint?: string;
}

export interface CreateMinutesInput {
  readonly title?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Exactly one of body and source_ref is required. */
  readonly body?: string;
  readonly source_ref?: MeetingMinutesSourceRef;
  /** Aggregate snapshot revision observed by the caller. */
  readonly expected_revision: number;
  readonly idempotency_key?: string;
  readonly idempotency_fingerprint?: string;
}

export interface SaveMinutesVersionInput {
  readonly minutes_id: MinutesId;
  /** Exactly one of body and source_ref is required. */
  readonly body?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly source_ref?: MeetingMinutesSourceRef;
  readonly expected_revision: number;
  readonly predecessor_version_id?: MinutesVersionId;
  readonly idempotency_key?: string;
  readonly idempotency_fingerprint?: string;
}

export interface ConfirmMinutesVersionInput {
  readonly minutes_id: MinutesId;
  readonly version_id: MinutesVersionId;
  readonly expected_revision: number;
  readonly idempotency_key?: string;
  readonly idempotency_fingerprint?: string;
}

export interface MeetingMinutesSummary {
  readonly meeting: MeetingRecord;
  readonly minutes: readonly MinutesDocumentRecord[];
}

export interface MeetingMinutesDetail extends MeetingMinutesSummary {
  readonly versions: readonly MinutesVersionRecord[];
  readonly snapshot_revision: number;
}

export type MeetingMinutesErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'revision_conflict'
  | 'authorization_denied'
  | 'corrupt_record'
  | 'storage_unavailable'
  | 'readback_mismatch'
  | 'idempotency_conflict';

export class MeetingMinutesError extends Error {
  readonly code: MeetingMinutesErrorCode;

  constructor(code: MeetingMinutesErrorCode, message: string) {
    super(message);
    this.name = 'MeetingMinutesError';
    this.code = code;
  }
}

export interface MeetingMinutesStoreOptions {
  readonly data_dir?: string;
  readonly storage?: MeetingMinutesStoragePort;
  readonly now?: () => Date;
  /** Test and adapter hook; generated IDs remain Brainbase-owned. */
  readonly id_factory?: () => string;
  readonly authorizer?: MeetingMinutesAuthorizer;
  /** Optional external registration/deduplication seam. Native-only stores omit it. */
  readonly external_source_hook?: MeetingMinutesExternalSourceHook;
}

export interface MeetingMinutesExternalSourceIdentity {
  readonly meeting_id: MeetingId;
  readonly minutes_id: MinutesId;
  readonly version_id: MinutesVersionId;
}

export interface MeetingMinutesExternalSourceHook {
  /** Return the exact previously registered identity, if any. */
  find_existing(source_ref: MeetingMinutesSourceRef): Promise<MeetingMinutesExternalSourceIdentity | undefined>;
  /** Register a successfully persisted external version for future deduplication. */
  register(source_ref: MeetingMinutesSourceRef, identity: MeetingMinutesExternalSourceIdentity): Promise<void>;
}

export interface MeetingMinutesStore {
  list_meetings(context: MeetingMinutesRequestContext): Promise<readonly MeetingMinutesSummary[]>;
  create_meeting(input: MeetingCreateInput, context: MeetingMinutesRequestContext): Promise<MeetingMinutesDetail>;
  create_minutes(meeting_id: MeetingId, input: CreateMinutesInput, context: MeetingMinutesRequestContext): Promise<MeetingMinutesDetail>;
  get_meeting(meeting_id: MeetingId, context: MeetingMinutesRequestContext): Promise<MeetingMinutesDetail>;
  get_version(
    meeting_id: MeetingId,
    minutes_id: MinutesId,
    version_id: MinutesVersionId,
    context: MeetingMinutesRequestContext
  ): Promise<MinutesVersionRecord>;
  save_version(input: SaveMinutesVersionInput, context: MeetingMinutesRequestContext): Promise<MeetingMinutesDetail>;
  confirm_version(input: ConfirmMinutesVersionInput, context: MeetingMinutesRequestContext): Promise<MeetingMinutesDetail>;
}

/**
 * Provider-neutral exact-version seam used by lineage and other read-only
 * consumers.  The shape intentionally mirrors the lineage contract without
 * importing that optional module into the native lifecycle.
 */
export interface MeetingMinutesVersionPortReference {
  readonly meetingId: MeetingId;
  readonly minutesId: MinutesId;
  readonly versionId: MinutesVersionId;
  readonly contentDigest: string | null;
  readonly locator: unknown;
  readonly provenance: Readonly<Record<string, unknown>>;
}

export interface MeetingMinutesVersionPortAccess {
  readonly principal: string;
  readonly [key: string]: unknown;
}

export interface MeetingMinutesVersionPort {
  readExact(reference: MeetingMinutesVersionPortReference, access: MeetingMinutesVersionPortAccess): Promise<{
    readonly reference: MeetingMinutesVersionPortReference;
  } | null>;
}

interface MutableSnapshot {
  schema_version: typeof MEETING_MINUTES_SNAPSHOT_VERSION;
  revision: number;
  meetings: MeetingRecord[];
  documents: MinutesDocumentRecord[];
  versions: MinutesVersionRecord[];
  idempotency: MeetingMinutesIdempotencyRecord[];
}

const EMPTY_SNAPSHOT: MeetingMinutesSnapshot = Object.freeze({
  schema_version: MEETING_MINUTES_SNAPSHOT_VERSION,
  revision: 0,
  meetings: Object.freeze([]),
  documents: Object.freeze([]),
  versions: Object.freeze([]),
  idempotency: Object.freeze([])
});
const LOCK_WAIT_MS = 10;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function freezeClone<T>(value: T): T {
  return deepFreeze(cloneJson(value));
}

function invalid(message: string): MeetingMinutesError {
  return new MeetingMinutesError('invalid_input', message);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${label} is required`);
  return value.trim();
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return nonEmptyString(value, label);
}

function validDateString(value: unknown, label: string): string | undefined {
  const text = optionalString(value, label);
  if (text === undefined) return undefined;
  if (!Number.isFinite(Date.parse(text))) throw invalid(`${label} must be a valid date-time`);
  return text;
}

function assertPrincipal(context: MeetingMinutesRequestContext): string {
  return nonEmptyString(context?.principal_id, 'principal_id');
}

function assertJsonValue(value: unknown, path: string, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid(`${path} must contain finite numbers`);
    return;
  }
  if (typeof value !== 'object') throw invalid(`${path} must be JSON data`);
  if (seen.has(value)) throw invalid(`${path} must not contain circular data`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (key.trim() === '') throw invalid(`${path} contains an empty key`);
      assertJsonValue(child, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function metadata(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === undefined) return Object.freeze({});
  if (!isRecord(value)) throw invalid(`${label} must be an object`);
  assertJsonValue(value, label);
  return freezeClone(value);
}

function participantIds(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw invalid('participant_ids must be an array');
  const ids = value.map((item) => nonEmptyString(item, 'participant_ids item'));
  if (new Set(ids).size !== ids.length) throw invalid('participant_ids must not contain duplicates');
  return Object.freeze(ids);
}

function sourceRef(value: unknown, label = 'source_ref'): MeetingMinutesSourceRef | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw invalid(`${label} must be an object`);
  assertJsonValue(value, label);
  const provider = nonEmptyString(value.provider, `${label}.provider`);
  const locator = nonEmptyString(value.locator, `${label}.locator`);
  const revision = nonEmptyString(value.revision, `${label}.revision`);
  const digest = nonEmptyString(value.digest, `${label}.digest`);
  return freezeClone({ ...value, provider, locator, revision, digest } as MeetingMinutesSourceRef);
}

function contentInput(body: unknown, source: unknown, label: string): { body?: string; source_ref?: MeetingMinutesSourceRef } {
  const hasBody = body !== undefined;
  const hasSource = source !== undefined;
  if (hasBody === hasSource) throw invalid(`${label} must provide exactly one of body or source_ref`);
  if (hasBody && typeof body !== 'string') throw invalid(`${label}.body must be a string`);
  const sourceRefValue = hasSource ? sourceRef(source, `${label}.source_ref`) : undefined;
  return hasBody ? { body: body as string } : { source_ref: sourceRefValue };
}

function isoNow(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new MeetingMinutesError('storage_unavailable', 'The clock returned an invalid date');
  return value.toISOString();
}

function digestBody(body: string): string {
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

function id(prefix: string, idFactory: () => string): string {
  const suffix = nonEmptyString(idFactory(), 'generated id');
  return `${prefix}_${suffix}`;
}

function aclFor(ownerId: string): MeetingMinutesAcl {
  return freezeClone({ owner_id: ownerId, reader_ids: [], writer_ids: [] });
}

function defaultAuthorizer(): MeetingMinutesAuthorizer {
  return {
    can_read(resource, context) {
      if (!('acl' in resource)) return false;
      return resource.acl.owner_id === context.principal_id
        || resource.acl.reader_ids.includes(context.principal_id);
    },
    can_write(resource, context) {
      if (!('acl' in resource)) return false;
      return resource.acl.owner_id === context.principal_id
        || resource.acl.writer_ids.includes(context.principal_id);
    }
  };
}

function snapshotMutable(snapshot: MeetingMinutesSnapshot): MutableSnapshot {
  return cloneJson(snapshot) as MutableSnapshot;
}

interface IdempotencyToken {
  readonly key: string;
  readonly fingerprint: string;
}

function idempotencyToken(input: unknown): IdempotencyToken | undefined {
  if (!isRecord(input)) throw invalid('idempotency input must be an object');
  const keyValue = input.idempotency_key;
  const fingerprintValue = input.idempotency_fingerprint;
  if (keyValue === undefined && fingerprintValue === undefined) return undefined;
  if (keyValue === undefined || fingerprintValue === undefined) {
    throw invalid('idempotency_key and idempotency_fingerprint must be provided together');
  }
  const key = nonEmptyString(keyValue, 'idempotency_key');
  if (key.length > 200) throw invalid('idempotency_key must be at most 200 characters');
  const fingerprint = nonEmptyString(fingerprintValue, 'idempotency_fingerprint');
  if (fingerprint.length > 512) throw invalid('idempotency_fingerprint must be at most 512 characters');
  return { key, fingerprint };
}

function findIdempotencyRecord(
  snapshot: MeetingMinutesSnapshot,
  principalId: string,
  key: string
): MeetingMinutesIdempotencyRecord | undefined {
  return snapshot.idempotency.find((candidate) => candidate.principal_id === principalId && candidate.key === key);
}

function addIdempotencyRecord(
  snapshot: MutableSnapshot,
  token: IdempotencyToken | undefined,
  operation: MeetingMinutesIdempotencyOperation,
  identity: { meeting_id: MeetingId; minutes_id?: MinutesId; version_id?: MinutesVersionId },
  principalId: string
): void {
  if (!token) return;
  snapshot.idempotency.push({
    key: token.key,
    principal_id: principalId,
    fingerprint: token.fingerprint,
    operation,
    ...identity
  });
}

function assertSnapshotShape(value: unknown): MeetingMinutesSnapshot {
  if (!isRecord(value) || value.schema_version !== MEETING_MINUTES_SNAPSHOT_VERSION
    || !Number.isInteger(value.revision) || (value.revision as number) < 0
    || !Array.isArray(value.meetings) || !Array.isArray(value.documents) || !Array.isArray(value.versions)
    || (value.idempotency !== undefined && !Array.isArray(value.idempotency))) {
    throw new MeetingMinutesError('corrupt_record', 'Meeting minutes snapshot has an invalid top-level shape');
  }
  const meetings = value.meetings as unknown[];
  const documents = value.documents as unknown[];
  const versions = value.versions as unknown[];
  const idempotency = (value.idempotency ?? []) as unknown[];
  const ids = new Set<string>();
  const checkId = (candidate: unknown, label: string): string => {
    // Provider-independent IDs may be generated by an organization adapter;
    // only reject empty/control-like values here.  The native generator still
    // uses the stable meeting_/minutes_/version_ prefixes.
    if (typeof candidate !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(candidate)) {
      throw new MeetingMinutesError('corrupt_record', `${label} is invalid`);
    }
    if (ids.has(candidate)) throw new MeetingMinutesError('corrupt_record', `Duplicate ${label} ${candidate}`);
    ids.add(candidate);
    return candidate;
  };
  const checkAcl = (value: unknown, label: string): MeetingMinutesAcl => {
    if (!isRecord(value) || typeof value.owner_id !== 'string' || !Array.isArray(value.reader_ids) || !Array.isArray(value.writer_ids)
      || value.reader_ids.some((item) => typeof item !== 'string') || value.writer_ids.some((item) => typeof item !== 'string')) {
      throw new MeetingMinutesError('corrupt_record', `${label} is invalid`);
    }
    return freezeClone(value as unknown as MeetingMinutesAcl);
  };
  const checkMeta = (value: unknown, label: string): Readonly<Record<string, unknown>> => {
    if (!isRecord(value)) throw new MeetingMinutesError('corrupt_record', `${label} is invalid`);
    try {
      assertJsonValue(value, label);
    } catch (error) {
      throw new MeetingMinutesError('corrupt_record', error instanceof Error ? error.message : `${label} is invalid`);
    }
    return freezeClone(value);
  };
  const checkDate = (candidate: unknown, label: string): string => {
    if (typeof candidate !== 'string' || !Number.isFinite(Date.parse(candidate))) {
      throw new MeetingMinutesError('corrupt_record', `${label} is invalid`);
    }
    return candidate;
  };
  const meetingIds = new Set<string>();
  for (const raw of meetings) {
    if (!isRecord(raw)) throw new MeetingMinutesError('corrupt_record', 'Meeting record is invalid');
    const meetingId = checkId(raw.meeting_id, 'meeting_id');
    meetingIds.add(meetingId);
    if (typeof raw.title !== 'string' || !Array.isArray(raw.participant_ids)
      || raw.participant_ids.some((item) => typeof item !== 'string') || !Number.isInteger(raw.revision) || (raw.revision as number) < 1) {
      throw new MeetingMinutesError('corrupt_record', `Meeting ${meetingId} is invalid`);
    }
    checkMeta(raw.metadata, `Meeting ${meetingId}.metadata`);
    checkAcl(raw.acl, `Meeting ${meetingId}.acl`);
    checkDate(raw.created_at, `Meeting ${meetingId}.created_at`);
    if (typeof raw.created_actor_id !== 'string' || !raw.created_actor_id.trim()) throw new MeetingMinutesError('corrupt_record', `Meeting ${meetingId}.created_actor_id is invalid`);
    if (raw.scheduled_at !== undefined) checkDate(raw.scheduled_at, `Meeting ${meetingId}.scheduled_at`);
    if (raw.ended_at !== undefined) checkDate(raw.ended_at, `Meeting ${meetingId}.ended_at`);
  }
  const documentIds = new Set<string>();
  const documentById = new Map<string, Record<string, unknown>>();
  for (const raw of documents) {
    if (!isRecord(raw)) throw new MeetingMinutesError('corrupt_record', 'Minutes document is invalid');
    const minutesId = checkId(raw.minutes_id, 'minutes_id');
    documentIds.add(minutesId);
    documentById.set(minutesId, raw);
    if (typeof raw.meeting_id !== 'string' || !meetingIds.has(raw.meeting_id)
      || typeof raw.title !== 'string' || !Array.isArray(raw.version_ids) || raw.version_ids.some((item) => typeof item !== 'string')
      || typeof raw.current_version_id !== 'string' || !raw.version_ids.includes(raw.current_version_id)
      || !Number.isInteger(raw.revision) || (raw.revision as number) < 1) {
      throw new MeetingMinutesError('corrupt_record', `Minutes document ${minutesId} is invalid`);
    }
    checkMeta(raw.metadata, `Minutes document ${minutesId}.metadata`);
    checkAcl(raw.acl, `Minutes document ${minutesId}.acl`);
    checkDate(raw.created_at, `Minutes document ${minutesId}.created_at`);
    checkDate(raw.updated_at, `Minutes document ${minutesId}.updated_at`);
    if (typeof raw.created_actor_id !== 'string' || !raw.created_actor_id.trim()) throw new MeetingMinutesError('corrupt_record', `Minutes document ${minutesId}.created_actor_id is invalid`);
  }
  const versionIds = new Set<string>();
  const versionById = new Map<string, Record<string, unknown>>();
  for (const raw of versions) {
    if (!isRecord(raw)) throw new MeetingMinutesError('corrupt_record', 'Minutes version is invalid');
    const versionId = checkId(raw.version_id, 'version_id');
    versionIds.add(versionId);
    versionById.set(versionId, raw);
    if (typeof raw.minutes_id !== 'string' || !documentIds.has(raw.minutes_id)
      || typeof raw.meeting_id !== 'string' || !meetingIds.has(raw.meeting_id)
      || typeof raw.created_actor_id !== 'string' || !raw.created_actor_id.trim()) {
      throw new MeetingMinutesError('corrupt_record', `Minutes version ${versionId} is invalid`);
    }
    const doc = documentById.get(raw.minutes_id);
    if (doc?.meeting_id !== raw.meeting_id) throw new MeetingMinutesError('corrupt_record', `Minutes version ${versionId} has a mismatched meeting_id`);
    checkDate(raw.created_at, `Minutes version ${versionId}.created_at`);
    if (raw.predecessor_version_id !== undefined && typeof raw.predecessor_version_id !== 'string') {
      throw new MeetingMinutesError('corrupt_record', `Minutes version ${versionId}.predecessor_version_id is invalid`);
    }
    if (raw.confirmation !== undefined) {
      if (!isRecord(raw.confirmation) || raw.confirmation.version_id !== versionId
        || typeof raw.confirmation.actor_id !== 'string' || !raw.confirmation.actor_id.trim()) {
        throw new MeetingMinutesError('corrupt_record', `Minutes version ${versionId}.confirmation is invalid`);
      }
      checkDate(raw.confirmation.confirmed_at, `Minutes version ${versionId}.confirmation.confirmed_at`);
    }
    const hasBody = raw.body !== undefined;
    const hasSource = raw.source_ref !== undefined;
    if (hasBody && hasSource || !hasBody && !hasSource) {
      throw new MeetingMinutesError('corrupt_record', `Minutes version ${versionId} must contain native body or external source_ref`);
    }
    if (hasBody && (typeof raw.body_digest !== 'string' || raw.body_digest !== digestBody(raw.body as string))) {
      throw new MeetingMinutesError('corrupt_record', `Minutes version ${versionId}.body_digest is invalid`);
    }
    if (!hasBody && raw.body_digest !== undefined) {
      throw new MeetingMinutesError('corrupt_record', `Minutes version ${versionId}.body_digest is invalid`);
    }
    if (hasSource) sourceRef(raw.source_ref, `Minutes version ${versionId}.source_ref`);
  }
  for (const raw of versions) {
    if (!isRecord(raw)) continue;
    if (raw.predecessor_version_id !== undefined && !versionIds.has(raw.predecessor_version_id as string)) {
      throw new MeetingMinutesError('corrupt_record', `Minutes version ${raw.version_id as string}.predecessor_version_id is invalid`);
    }
  }
  for (const raw of documents) {
    if (!isRecord(raw)) throw new MeetingMinutesError('corrupt_record', 'Minutes document is invalid');
    const minutesId = raw.minutes_id as string;
    const idsForDocument = raw.version_ids as string[];
    if (new Set(idsForDocument).size !== idsForDocument.length || idsForDocument.some((versionId) => !versionIds.has(versionId))) {
      throw new MeetingMinutesError('corrupt_record', `Minutes document ${minutesId}.version_ids is invalid`);
    }
    for (const versionId of idsForDocument) {
      if (versionById.get(versionId)?.minutes_id !== minutesId) throw new MeetingMinutesError('corrupt_record', `Minutes document ${minutesId} references another document's version`);
    }
  }
  const idempotencyKeys = new Set<string>();
  for (const raw of idempotency) {
    if (!isRecord(raw)) throw new MeetingMinutesError('corrupt_record', 'Idempotency record is invalid');
    const key = raw.key;
    const principalId = raw.principal_id;
    const fingerprint = raw.fingerprint;
    const operation = raw.operation;
    const meetingId = raw.meeting_id;
    if (typeof key !== 'string' || key.trim() === '' || key.length > 200
      || typeof principalId !== 'string' || principalId.trim() === ''
      || typeof fingerprint !== 'string' || fingerprint.trim() === '' || fingerprint.length > 512
      || (operation !== 'create_meeting' && operation !== 'create_minutes' && operation !== 'save_version' && operation !== 'confirm_version')
      || typeof meetingId !== 'string' || !meetingIds.has(meetingId)) {
      throw new MeetingMinutesError('corrupt_record', 'Idempotency record is invalid');
    }
    const keyIdentity = `${principalId}\u0000${key}`;
    if (idempotencyKeys.has(keyIdentity)) throw new MeetingMinutesError('corrupt_record', `Duplicate idempotency key ${key}`);
    idempotencyKeys.add(keyIdentity);
    const minutesId = raw.minutes_id;
    const versionId = raw.version_id;
    if (operation === 'create_meeting') {
      if (minutesId !== undefined || versionId !== undefined) {
        throw new MeetingMinutesError('corrupt_record', 'create_meeting idempotency record has unexpected target ids');
      }
      continue;
    }
    if (typeof minutesId !== 'string' || !documentIds.has(minutesId)
      || documentById.get(minutesId)?.meeting_id !== meetingId) {
      throw new MeetingMinutesError('corrupt_record', 'Idempotency record minutes_id is invalid');
    }
    if (operation === 'create_minutes') {
      if (versionId !== undefined) throw new MeetingMinutesError('corrupt_record', 'create_minutes idempotency record has an unexpected version_id');
      continue;
    }
    if (typeof versionId !== 'string' || !versionIds.has(versionId)
      || versionById.get(versionId)?.minutes_id !== minutesId
      || versionById.get(versionId)?.meeting_id !== meetingId) {
      throw new MeetingMinutesError('corrupt_record', 'Idempotency record version_id is invalid');
    }
  }
  return freezeClone({
    schema_version: MEETING_MINUTES_SNAPSHOT_VERSION,
    revision: value.revision as number,
    meetings: meetings as MeetingRecord[],
    documents: documents as MinutesDocumentRecord[],
    versions: versions as MinutesVersionRecord[],
    idempotency: idempotency as MeetingMinutesIdempotencyRecord[]
  });
}

class LocalMeetingMinutesStorage implements MeetingMinutesStoragePort {
  private readonly filePath: string;
  private readonly lockPath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, MEETING_MINUTES_SIDECAR);
    this.lockPath = `${this.filePath}.lock`;
  }

  async read(): Promise<MeetingMinutesSnapshot> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_SNAPSHOT;
      throw new MeetingMinutesError('storage_unavailable', `Could not read ${this.filePath}`);
    }
    try {
      return assertSnapshotShape(JSON.parse(raw));
    } catch (error) {
      if (error instanceof MeetingMinutesError) throw error;
      throw new MeetingMinutesError('corrupt_record', `Could not parse ${this.filePath}`);
    }
  }

  async write(next: MeetingMinutesSnapshot, expected_revision: number): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const owner = await acquireLock(this.lockPath);
    try {
      const current = await this.read();
      if (current.revision !== expected_revision) throw new MeetingMinutesError('revision_conflict', 'Meeting minutes changed while saving');
      if (next.revision !== expected_revision + 1) throw new MeetingMinutesError('invalid_input', 'The next snapshot revision is invalid');
      const normalized = assertSnapshotShape(next);
      const temporary = `${this.filePath}.tmp-${randomUUID()}`;
      try {
        await writeFile(temporary, `${JSON.stringify(normalized)}\n`, { encoding: 'utf8', mode: 0o600 });
        await rename(temporary, this.filePath);
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
    } finally {
      await releaseLock(this.lockPath, owner).catch(() => undefined);
    }
  }
}

interface MeetingMinutesLockOwner {
  readonly token: string;
  readonly pid: number;
  readonly hostname: string;
}

async function acquireLock(lockPath: string): Promise<MeetingMinutesLockOwner> {
  const started = Date.now();
  const owner: MeetingMinutesLockOwner = { token: randomUUID(), pid: process.pid, hostname: hostname() };
  for (;;) {
    let created = false;
    try {
      await mkdir(lockPath, { recursive: false });
      created = true;
      await writeFile(join(lockPath, 'owner'), `${JSON.stringify(owner)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      return owner;
    } catch (error) {
      if (created) await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new MeetingMinutesError('storage_unavailable', 'Could not acquire meeting minutes storage lock');
      await quarantineDeadLock(lockPath);
      if (Date.now() - started > LOCK_TIMEOUT_MS) throw new MeetingMinutesError('storage_unavailable', 'Timed out waiting for meeting minutes storage lock');
      await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
    }
  }
}

async function quarantineDeadLock(lockPath: string): Promise<void> {
  try {
    const lockStat = await stat(lockPath);
    if (Date.now() - lockStat.mtimeMs <= LOCK_STALE_MS) return;
    const owner = await readLockOwner(lockPath);
    // Missing, malformed, foreign-host, and live owner metadata is never
    // safe to steal. A stale lock is removable only after the recorded PID is
    // confirmed dead on this host.
    if (!owner || owner.hostname !== hostname() || isProcessAlive(owner.pid)) return;
    const quarantine = `${lockPath}.stale-${randomUUID()}`;
    try {
      await rename(lockPath, quarantine);
      await rm(quarantine, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function readLockOwner(lockPath: string): Promise<MeetingMinutesLockOwner | undefined> {
  try {
    const value = JSON.parse(await readFile(join(lockPath, 'owner'), 'utf8')) as Partial<MeetingMinutesLockOwner>;
    if (typeof value.token === 'string' && value.token.length > 0
      && typeof value.pid === 'number' && Number.isInteger(value.pid) && value.pid > 0
      && typeof value.hostname === 'string' && value.hostname.length > 0) {
      return value as MeetingMinutesLockOwner;
    }
  } catch {
    // Incomplete or malformed owner metadata is left for bounded retry.
  }
  return undefined;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

async function releaseLock(lockPath: string, owner: MeetingMinutesLockOwner): Promise<void> {
  const current = await readLockOwner(lockPath);
  if (current?.token !== owner.token) return;
  await rm(lockPath, { recursive: true, force: true });
}

function defaultStorage(options: MeetingMinutesStoreOptions): MeetingMinutesStoragePort {
  if (options.storage) return options.storage;
  if (!options.data_dir) throw new TypeError('data_dir is required when storage is not provided');
  return new LocalMeetingMinutesStorage(options.data_dir);
}

async function authorized(
  authorizer: MeetingMinutesAuthorizer,
  operation: 'read' | 'write',
  resource: MeetingMinutesResource,
  context: MeetingMinutesRequestContext
): Promise<void> {
  const check = operation === 'read' ? authorizer.can_read : authorizer.can_write;
  if (typeof check !== 'function' || !(await check(resource, context))) {
    throw new MeetingMinutesError('authorization_denied', 'The current principal cannot access this record');
  }
}

function findMeeting(snapshot: MeetingMinutesSnapshot, meetingId: string): MeetingRecord {
  const meeting = snapshot.meetings.find((candidate) => candidate.meeting_id === meetingId);
  if (!meeting) throw new MeetingMinutesError('not_found', `Meeting ${meetingId} was not found`);
  return meeting;
}

function findDocument(snapshot: MeetingMinutesSnapshot, minutesId: string): MinutesDocumentRecord {
  const document = snapshot.documents.find((candidate) => candidate.minutes_id === minutesId);
  if (!document) throw new MeetingMinutesError('not_found', `Minutes document ${minutesId} was not found`);
  return document;
}

function detail(snapshot: MeetingMinutesSnapshot, meeting: MeetingRecord): MeetingMinutesDetail {
  const minutes = snapshot.documents.filter((candidate) => candidate.meeting_id === meeting.meeting_id);
  const minuteIds = new Set(minutes.flatMap((candidate) => candidate.version_ids));
  const versions = snapshot.versions.filter((candidate) => minuteIds.has(candidate.version_id));
  return freezeClone({ meeting, minutes, versions, snapshot_revision: snapshot.revision });
}

function summary(snapshot: MeetingMinutesSnapshot, meeting: MeetingRecord): MeetingMinutesSummary {
  return freezeClone({ meeting, minutes: snapshot.documents.filter((candidate) => candidate.meeting_id === meeting.meeting_id) });
}

function ensureRevision(actual: number, expected: number): void {
  if (!Number.isInteger(expected) || expected < 1) throw invalid('expected_revision must be a positive integer');
  if (actual !== expected) throw new MeetingMinutesError('revision_conflict', `Expected revision ${expected}, current revision is ${actual}`);
}

function sameExternalSource(left: MeetingMinutesSourceRef, right: MeetingMinutesSourceRef): boolean {
  return left.provider === right.provider
    && left.locator === right.locator
    && left.revision === right.revision
    && left.digest === right.digest;
}

function findExternalSourceIdentity(
  snapshot: MeetingMinutesSnapshot,
  source: MeetingMinutesSourceRef
): MeetingMinutesExternalSourceIdentity | undefined {
  const match = snapshot.versions.find((candidate) => candidate.source_ref !== undefined && sameExternalSource(candidate.source_ref, source));
  if (!match) return undefined;
  return { meeting_id: match.meeting_id, minutes_id: match.minutes_id, version_id: match.version_id };
}

export function createMeetingMinutesStore(options: MeetingMinutesStoreOptions): MeetingMinutesStore {
  const storage = defaultStorage(options);
  const now = options.now ?? (() => new Date());
  const idFactory = options.id_factory ?? randomUUID;
  // A supplied partial authorizer is fail-closed for the omitted operation.
  // The built-in authorizer is the only implementation whose explicit read
  // and write rules are both allowed by default.
  const suppliedAuthorizer = options.authorizer;
  const authorizer: MeetingMinutesAuthorizer = suppliedAuthorizer === undefined
    ? defaultAuthorizer()
    : {
      can_read: suppliedAuthorizer.can_read ?? (() => false),
      can_write: suppliedAuthorizer.can_write ?? (() => false),
    };
  const externalSourceHook = options.external_source_hook;

  async function readSnapshot(): Promise<MeetingMinutesSnapshot> {
    try {
      return assertSnapshotShape(await storage.read());
    } catch (error) {
      if (error instanceof MeetingMinutesError) throw error;
      throw new MeetingMinutesError('storage_unavailable', 'Could not read meeting minutes storage');
    }
  }

  async function writeSnapshot(next: MutableSnapshot, expectedRevision: number): Promise<MeetingMinutesSnapshot> {
    const normalized = assertSnapshotShape(next);
    try {
      await storage.write(normalized, expectedRevision);
    } catch (error) {
      if (error instanceof MeetingMinutesError) throw error;
      throw new MeetingMinutesError('storage_unavailable', 'Could not write meeting minutes storage');
    }
    const readback = await readSnapshot();
    // Another writer may have committed immediately after our atomic rename.
    // The storage CAS already established that our write won; callers verify
    // their exact record below, so a newer aggregate revision is acceptable.
    if (readback.revision < normalized.revision) throw new MeetingMinutesError('readback_mismatch', 'Meeting minutes storage revision did not read back');
    return readback;
  }

  async function assertExternalUnique(snapshot: MeetingMinutesSnapshot, source: MeetingMinutesSourceRef): Promise<void> {
    // The native snapshot is the canonical duplicate boundary.  An adapter
    // index can accelerate cross-store lookup, but it cannot replace this
    // exact source identity check.
    const local = findExternalSourceIdentity(snapshot, source);
    if (local) throw new MeetingMinutesError('idempotency_conflict', `External source is already registered as ${local.version_id}`);
    if (!externalSourceHook) return;
    try {
      const existing = await externalSourceHook.find_existing(source);
      if (existing) throw new MeetingMinutesError('idempotency_conflict', `External source is already registered as ${existing.version_id}`);
    } catch (error) {
      // The hook is an auxiliary index.  A temporarily unavailable index must
      // not turn a successfully writable native source into a retry hazard.
      if (error instanceof MeetingMinutesError && error.code === 'idempotency_conflict') throw error;
    }
  }

  async function registerExternal(source: MeetingMinutesSourceRef | undefined, identity: MeetingMinutesExternalSourceIdentity): Promise<void> {
    if (!source || !externalSourceHook) return;
    try {
      await externalSourceHook.register(source, identity);
    } catch {
      // Canonical persistence already succeeded.  This best-effort index must
      // never make the caller retry a write that is already durable.
    }
  }

  async function list_meetings(context: MeetingMinutesRequestContext): Promise<readonly MeetingMinutesSummary[]> {
    assertPrincipal(context);
    const snapshot = await readSnapshot();
    const output: MeetingMinutesSummary[] = [];
    for (const meeting of snapshot.meetings) {
      if (!(await canReadMeeting(snapshot, meeting, context))) continue;
      output.push(summary(snapshot, meeting));
    }
    return freezeClone(output);
  }

  async function canReadMeeting(snapshot: MeetingMinutesSnapshot, meeting: MeetingRecord, context: MeetingMinutesRequestContext): Promise<boolean> {
    if (!(await allowed(authorizer, 'read', meeting, context))) return false;
    const documents = snapshot.documents.filter((candidate) => candidate.meeting_id === meeting.meeting_id);
    for (const document of documents) {
      if (!(await allowed(authorizer, 'read', document, context))) return false;
      const documentVersionIds = new Set(document.version_ids);
      for (const version of snapshot.versions) {
        if (version.meeting_id !== meeting.meeting_id || version.minutes_id !== document.minutes_id
          || !documentVersionIds.has(version.version_id)) continue;
        // Versions do not own a second ACL.  Pass the document ACL alongside
        // the immutable version so adapters can apply version-specific rules
        // without changing the returned canonical record shape.
        const versionResource = { ...version, acl: document.acl } as MeetingMinutesResource;
        if (!(await allowed(authorizer, 'read', versionResource, context))) return false;
      }
    }
    return true;
  }

  async function detailForCaller(snapshot: MeetingMinutesSnapshot, meeting: MeetingRecord, context: MeetingMinutesRequestContext): Promise<MeetingMinutesDetail> {
    if (!(await canReadMeeting(snapshot, meeting, context))) {
      throw new MeetingMinutesError('authorization_denied', 'The current principal cannot read this meeting');
    }
    return detail(snapshot, meeting);
  }

  async function allowed(
    access: MeetingMinutesAuthorizer,
    operation: 'read' | 'write',
    resource: MeetingMinutesResource,
    context: MeetingMinutesRequestContext
  ): Promise<boolean> {
    try {
      await authorized(access, operation, resource, context);
      return true;
    } catch (error) {
      if (error instanceof MeetingMinutesError && error.code === 'authorization_denied') return false;
      throw error;
    }
  }

  async function replayIdempotency(
    snapshot: MeetingMinutesSnapshot,
    record: MeetingMinutesIdempotencyRecord,
    context: MeetingMinutesRequestContext
  ): Promise<MeetingMinutesDetail> {
    const meeting = findMeeting(snapshot, record.meeting_id);
    // A receipt is safe to replay only while the principal can still read the
    // current target.  This check deliberately runs after every restart and
    // every retry; the receipt itself is never an authorization grant.
    return detailForCaller(snapshot, meeting, context);
  }

  async function resolveIdempotency(
    snapshot: MeetingMinutesSnapshot,
    principal: string,
    input: unknown,
    operation: MeetingMinutesIdempotencyOperation,
    context: MeetingMinutesRequestContext,
    target: { meeting_id?: string; minutes_id?: string } = {}
  ): Promise<{ token?: IdempotencyToken; replay?: MeetingMinutesDetail }> {
    const token = idempotencyToken(input);
    if (!token) return {};
    const record = findIdempotencyRecord(snapshot, principal, token.key);
    if (!record) return { token };
    if (record.operation !== operation || record.fingerprint !== token.fingerprint
      || (target.meeting_id !== undefined && record.meeting_id !== target.meeting_id)
      || (target.minutes_id !== undefined && record.minutes_id !== target.minutes_id)) {
      throw new MeetingMinutesError('idempotency_conflict', 'Idempotency-Key was reused with a different request');
    }
    return { token, replay: await replayIdempotency(snapshot, record, context) };
  }

  async function replayAfterConflict(
    error: unknown,
    token: IdempotencyToken | undefined,
    principal: string,
    operation: MeetingMinutesIdempotencyOperation,
    context: MeetingMinutesRequestContext,
    target: { meeting_id?: string; minutes_id?: string } = {}
  ): Promise<MeetingMinutesDetail | undefined> {
    if (!token || !(error instanceof MeetingMinutesError) || error.code !== 'revision_conflict') throw error;
    const latest = await readSnapshot();
    const record = findIdempotencyRecord(latest, principal, token.key);
    if (!record) return undefined;
    if (record.operation !== operation || record.fingerprint !== token.fingerprint
      || (target.meeting_id !== undefined && record.meeting_id !== target.meeting_id)
      || (target.minutes_id !== undefined && record.minutes_id !== target.minutes_id)) {
      throw new MeetingMinutesError('idempotency_conflict', 'Idempotency-Key was reused with a different request');
    }
    return replayIdempotency(latest, record, context);
  }

  async function create_meeting(input: MeetingCreateInput, context: MeetingMinutesRequestContext): Promise<MeetingMinutesDetail> {
    const principal = assertPrincipal(context);
    if (!isRecord(input)) throw invalid('meeting input must be an object');
    const current = await readSnapshot();
    const idempotency = await resolveIdempotency(current, principal, input, 'create_meeting', context);
    if (idempotency.replay) return idempotency.replay;
    const title = nonEmptyString(input.title, 'title');
    const scheduledAt = validDateString(input.scheduled_at, 'scheduled_at');
    const endedAt = validDateString(input.ended_at, 'ended_at');
    const participantIds = participantIdsInput(input.participant_ids);
    const meetingMetadata = metadata(input.metadata, 'metadata');
    const minutesTitle = input.minutes_title === undefined ? '議事録' : nonEmptyString(input.minutes_title, 'minutes_title');
    const minutesMetadata = metadata(input.minutes_metadata, 'minutes_metadata');
    const source = sourceRef(input.source_ref);
    const body = input.initial_body === undefined && source === undefined ? '' : input.initial_body;
    if (source && input.initial_body !== undefined) throw invalid('initial_body and source_ref are mutually exclusive');
    if (body !== undefined && typeof body !== 'string') throw invalid('initial_body must be a string');
    if (source) await assertExternalUnique(current, source);
    const timestamp = isoNow(now);
    const meetingId = id('meeting', idFactory);
    const minutesId = id('minutes', idFactory);
    const versionId = id('version', idFactory);
    const acl = aclFor(principal);
    const meeting: MeetingRecord = freezeClone({
      meeting_id: meetingId,
      title,
      ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
      ...(endedAt ? { ended_at: endedAt } : {}),
      participant_ids: participantIds,
      metadata: meetingMetadata,
      acl,
      created_at: timestamp,
      created_actor_id: principal,
      revision: 1
    });
    const version: MinutesVersionRecord = freezeClone({
      version_id: versionId,
      minutes_id: minutesId,
      meeting_id: meetingId,
      created_at: timestamp,
      created_actor_id: principal,
      ...(body === undefined ? {} : { body, body_digest: digestBody(body) }),
      ...(source ? { source_ref: source } : {})
    });
    const document: MinutesDocumentRecord = freezeClone({
      minutes_id: minutesId,
      meeting_id: meetingId,
      title: minutesTitle,
      metadata: minutesMetadata,
      acl,
      version_ids: Object.freeze([versionId]),
      current_version_id: versionId,
      created_at: timestamp,
      created_actor_id: principal,
      updated_at: timestamp,
      revision: 1
    });
    await authorized(authorizer, 'write', meeting, context);
    await authorized(authorizer, 'write', document, context);
    const next: MutableSnapshot = snapshotMutable(current);
    next.revision += 1;
    next.meetings.push(meeting);
    next.documents.push(document);
    next.versions.push(version);
    addIdempotencyRecord(next, idempotency.token, 'create_meeting', { meeting_id: meetingId }, principal);
    let readback: MeetingMinutesSnapshot;
    try {
      readback = await writeSnapshot(next, current.revision);
    } catch (error) {
      const replay = await replayAfterConflict(error, idempotency.token, principal, 'create_meeting', context);
      if (replay) return replay;
      throw error;
    }
    const saved = readback.meetings.find((candidate) => candidate.meeting_id === meetingId);
    const savedVersion = readback.versions.find((candidate) => candidate.version_id === versionId);
    if (!saved || !savedVersion || savedVersion.version_id !== versionId
      || (body !== undefined && (savedVersion.body !== body || savedVersion.body_digest !== digestBody(body)))
      || (source && JSON.stringify(savedVersion.source_ref) !== JSON.stringify(source))) {
      throw new MeetingMinutesError('readback_mismatch', 'Created meeting minutes did not read back');
    }
    await registerExternal(source, { meeting_id: meetingId, minutes_id: minutesId, version_id: versionId });
    return detailForCaller(readback, saved, context);
  }

  async function create_minutes(meeting_id: MeetingId, input: CreateMinutesInput, context: MeetingMinutesRequestContext): Promise<MeetingMinutesDetail> {
    const principal = assertPrincipal(context);
    if (!isRecord(input)) throw invalid('minutes document input must be an object');
    const meetingId = nonEmptyString(meeting_id, 'meeting_id');
    const snapshot = await readSnapshot();
    const idempotency = await resolveIdempotency(snapshot, principal, input, 'create_minutes', context, { meeting_id: meetingId });
    if (idempotency.replay) return idempotency.replay;
    const title = input.title === undefined ? '議事録' : nonEmptyString(input.title, 'title');
    const documentMetadata = metadata(input.metadata, 'metadata');
    const content = contentInput(input.body, input.source_ref, 'minutes');
    const source = content.source_ref;
    if (source) await assertExternalUnique(snapshot, source);
    const meeting = findMeeting(snapshot, meetingId);
    await authorized(authorizer, 'write', meeting, context);
    ensureRevision(snapshot.revision, input.expected_revision);
    const timestamp = isoNow(now);
    const minutesId = id('minutes', idFactory);
    const versionId = id('version', idFactory);
    const version: MinutesVersionRecord = freezeClone({
      version_id: versionId,
      minutes_id: minutesId,
      meeting_id: meetingId,
      created_at: timestamp,
      created_actor_id: principal,
      ...(content.body === undefined ? {} : { body: content.body, body_digest: digestBody(content.body) }),
      ...(source ? { source_ref: source } : {})
    });
    const document: MinutesDocumentRecord = freezeClone({
      minutes_id: minutesId,
      meeting_id: meetingId,
      title,
      metadata: documentMetadata,
      acl: meeting.acl,
      version_ids: Object.freeze([versionId]),
      current_version_id: versionId,
      created_at: timestamp,
      created_actor_id: principal,
      updated_at: timestamp,
      revision: 1
    });
    const next: MutableSnapshot = snapshotMutable(snapshot);
    next.revision += 1;
    next.documents.push(document);
    next.versions.push(version);
    addIdempotencyRecord(next, idempotency.token, 'create_minutes', { meeting_id: meetingId, minutes_id: minutesId }, principal);
    let readback: MeetingMinutesSnapshot;
    try {
      readback = await writeSnapshot(next, snapshot.revision);
    } catch (error) {
      const replay = await replayAfterConflict(error, idempotency.token, principal, 'create_minutes', context, { meeting_id: meetingId });
      if (replay) return replay;
      throw error;
    }
    const savedMeeting = findMeeting(readback, meetingId);
    const savedDocument = findDocument(readback, minutesId);
    const savedVersion = readback.versions.find((candidate) => candidate.version_id === versionId);
    if (!savedVersion || savedDocument.current_version_id !== versionId
      || (content.body !== undefined && (savedVersion.body !== content.body || savedVersion.body_digest !== digestBody(content.body)))
      || (source && JSON.stringify(savedVersion.source_ref) !== JSON.stringify(source))) {
      throw new MeetingMinutesError('readback_mismatch', 'Created minutes document did not read back');
    }
    await registerExternal(source, { meeting_id: meetingId, minutes_id: minutesId, version_id: versionId });
    return detailForCaller(readback, savedMeeting, context);
  }

  async function get_meeting(meeting_id: MeetingId, context: MeetingMinutesRequestContext): Promise<MeetingMinutesDetail> {
    assertPrincipal(context);
    const snapshot = await readSnapshot();
    const meeting = findMeeting(snapshot, nonEmptyString(meeting_id, 'meeting_id'));
    return detailForCaller(snapshot, meeting, context);
  }

  async function get_version(meeting_id: MeetingId, minutes_id: MinutesId, version_id: MinutesVersionId, context: MeetingMinutesRequestContext): Promise<MinutesVersionRecord> {
    const current = await get_meeting(meeting_id, context);
    const document = current.minutes.find((candidate) => candidate.minutes_id === minutes_id);
    if (!document) throw new MeetingMinutesError('not_found', `Minutes document ${minutes_id} was not found`);
    const version = current.versions.find((candidate) => candidate.version_id === version_id && candidate.minutes_id === minutes_id);
    if (!version) throw new MeetingMinutesError('not_found', `Minutes version ${version_id} was not found`);
    return freezeClone(version);
  }

  async function save_version(input: SaveMinutesVersionInput, context: MeetingMinutesRequestContext): Promise<MeetingMinutesDetail> {
    const principal = assertPrincipal(context);
    if (!isRecord(input)) throw invalid('minutes input must be an object');
    const minutesId = nonEmptyString(input.minutes_id, 'minutes_id');
    const snapshot = await readSnapshot();
    const idempotency = await resolveIdempotency(snapshot, principal, input, 'save_version', context, { minutes_id: minutesId });
    if (idempotency.replay) return idempotency.replay;
    const nextMetadata = input.metadata === undefined ? undefined : metadata(input.metadata, 'metadata');
    const content = contentInput(input.body, input.source_ref, 'minutes');
    const source = content.source_ref;
    if (source) await assertExternalUnique(snapshot, source);
    const document = findDocument(snapshot, minutesId);
    const meeting = findMeeting(snapshot, document.meeting_id);
    await authorized(authorizer, 'write', meeting, context);
    await authorized(authorizer, 'write', document, context);
    ensureRevision(document.revision, input.expected_revision);
    const predecessor = input.predecessor_version_id === undefined ? document.current_version_id : nonEmptyString(input.predecessor_version_id, 'predecessor_version_id');
    if (predecessor !== document.current_version_id) throw invalid('predecessor_version_id must be the current version');
    const timestamp = isoNow(now);
    const versionId = id('version', idFactory);
    const version: MinutesVersionRecord = freezeClone({
      version_id: versionId,
      minutes_id: document.minutes_id,
      meeting_id: document.meeting_id,
      predecessor_version_id: predecessor,
      created_at: timestamp,
      created_actor_id: principal,
      ...(content.body === undefined ? {} : { body: content.body, body_digest: digestBody(content.body) }),
      ...(source ? { source_ref: source } : {})
    });
    const next: MutableSnapshot = snapshotMutable(snapshot);
    next.revision += 1;
    const nextDocument: MinutesDocumentRecord = freezeClone({
      ...document,
      ...(nextMetadata === undefined ? {} : { metadata: nextMetadata }),
      version_ids: [...document.version_ids, versionId],
      current_version_id: versionId,
      updated_at: timestamp,
      revision: document.revision + 1
    });
    next.documents = next.documents.map((candidate) => candidate.minutes_id === document.minutes_id ? nextDocument : candidate);
    next.versions.push(version);
    addIdempotencyRecord(next, idempotency.token, 'save_version', {
      meeting_id: meeting.meeting_id,
      minutes_id: document.minutes_id,
      version_id: versionId
    }, principal);
    let readback: MeetingMinutesSnapshot;
    try {
      readback = await writeSnapshot(next, snapshot.revision);
    } catch (error) {
      const replay = await replayAfterConflict(error, idempotency.token, principal, 'save_version', context, { minutes_id: minutesId });
      if (replay) return replay;
      throw error;
    }
    const savedMeeting = findMeeting(readback, meeting.meeting_id);
    const savedDocument = findDocument(readback, document.minutes_id);
    const savedVersion = readback.versions.find((candidate) => candidate.version_id === versionId);
    if (!savedVersion
      || (content.body !== undefined && (savedVersion.body !== content.body || savedVersion.body_digest !== digestBody(content.body)))
      || (source && JSON.stringify(savedVersion.source_ref) !== JSON.stringify(source))
      || savedDocument.current_version_id !== versionId || savedDocument.revision !== document.revision + 1) {
      throw new MeetingMinutesError('readback_mismatch', 'Saved minutes version did not read back');
    }
    await registerExternal(source, { meeting_id: meeting.meeting_id, minutes_id: document.minutes_id, version_id: versionId });
    return detailForCaller(readback, savedMeeting, context);
  }

  async function confirm_version(input: ConfirmMinutesVersionInput, context: MeetingMinutesRequestContext): Promise<MeetingMinutesDetail> {
    const principal = assertPrincipal(context);
    if (!isRecord(input)) throw invalid('confirmation input must be an object');
    const minutesId = nonEmptyString(input.minutes_id, 'minutes_id');
    const versionId = nonEmptyString(input.version_id, 'version_id');
    const snapshot = await readSnapshot();
    const idempotency = await resolveIdempotency(snapshot, principal, input, 'confirm_version', context, { minutes_id: minutesId });
    if (idempotency.replay) return idempotency.replay;
    const document = findDocument(snapshot, minutesId);
    const meeting = findMeeting(snapshot, document.meeting_id);
    await authorized(authorizer, 'write', meeting, context);
    await authorized(authorizer, 'write', document, context);
    const version = snapshot.versions.find((candidate) => candidate.version_id === versionId && candidate.minutes_id === minutesId);
    if (!version) throw new MeetingMinutesError('not_found', `Minutes version ${versionId} was not found`);
    ensureRevision(document.revision, input.expected_revision);
    if (version.confirmation) {
      if (!idempotency.token) return detailForCaller(snapshot, meeting, context);
      const next = snapshotMutable(snapshot);
      next.revision += 1;
      addIdempotencyRecord(next, idempotency.token, 'confirm_version', {
        meeting_id: meeting.meeting_id,
        minutes_id: minutesId,
        version_id: versionId
      }, principal);
      let readback: MeetingMinutesSnapshot;
      try {
        readback = await writeSnapshot(next, snapshot.revision);
      } catch (error) {
        const replay = await replayAfterConflict(error, idempotency.token, principal, 'confirm_version', context, { minutes_id: minutesId });
        if (replay) return replay;
        throw error;
      }
      return detailForCaller(readback, findMeeting(readback, meeting.meeting_id), context);
    }
    const timestamp = isoNow(now);
    const confirmed: MinutesVersionRecord = freezeClone({
      ...version,
      confirmation: { version_id: versionId, actor_id: principal, confirmed_at: timestamp }
    });
    const next: MutableSnapshot = snapshotMutable(snapshot);
    next.revision += 1;
    next.versions = next.versions.map((candidate) => candidate.version_id === versionId ? confirmed : candidate);
    next.documents = next.documents.map((candidate) => candidate.minutes_id === minutesId
      ? { ...candidate, updated_at: timestamp, revision: candidate.revision + 1 }
      : candidate);
    addIdempotencyRecord(next, idempotency.token, 'confirm_version', {
      meeting_id: meeting.meeting_id,
      minutes_id: minutesId,
      version_id: versionId
    }, principal);
    let readback: MeetingMinutesSnapshot;
    try {
      readback = await writeSnapshot(next, snapshot.revision);
    } catch (error) {
      const replay = await replayAfterConflict(error, idempotency.token, principal, 'confirm_version', context, { minutes_id: minutesId });
      if (replay) return replay;
      throw error;
    }
    const savedMeeting = findMeeting(readback, meeting.meeting_id);
    const saved = readback.versions.find((candidate) => candidate.version_id === versionId);
    if (!saved?.confirmation || saved.confirmation.version_id !== versionId || saved.confirmation.actor_id !== principal
      || saved.confirmation.confirmed_at !== timestamp) throw new MeetingMinutesError('readback_mismatch', 'Confirmation did not read back');
    return detailForCaller(readback, savedMeeting, context);
  }

  return { list_meetings, create_meeting, create_minutes, get_meeting, get_version, save_version, confirm_version };
}

function participantIdsInput(value: unknown): readonly string[] {
  return participantIds(value);
}

/** Exposes the native file adapter for consumers that need an explicit port. */
export function createMeetingMinutesStorage(data_dir: string): MeetingMinutesStoragePort {
  return new LocalMeetingMinutesStorage(nonEmptyString(data_dir, 'data_dir'));
}

/** Stable body digest used by version readback and external source references. */
export function meetingMinutesBodyDigest(body: string): string {
  if (typeof body !== 'string') throw invalid('body must be a string');
  return digestBody(body);
}

function exactSourceMatches(reference: MeetingMinutesVersionPortReference, version: MinutesVersionRecord): boolean {
  if (version.body !== undefined) return version.body_digest === reference.contentDigest;
  const source = version.source_ref;
  if (!source || source.digest !== reference.contentDigest || source.locator !== reference.locator) return false;
  const provenance = reference.provenance;
  if (!isRecord(provenance)) return false;
  const sourceProvenance = isRecord(source.provenance) ? source.provenance : {};
  const providerId = typeof sourceProvenance.providerId === 'string' ? sourceProvenance.providerId : source.provider;
  const providerKind = typeof sourceProvenance.providerKind === 'string' ? sourceProvenance.providerKind : source.provider;
  const revision = typeof sourceProvenance.revision === 'string' ? sourceProvenance.revision : source.revision;
  const digest = typeof sourceProvenance.digest === 'string' ? sourceProvenance.digest : source.digest;
  return provenance.providerId === providerId
    && provenance.providerKind === providerKind
    && provenance.revision === revision
    && provenance.digest === digest;
}

/**
 * Adapt one native store to the exact-version port. Every call delegates to
 * `get_version`, so current ACL is evaluated by the same store instance that
 * owns the native snapshot. The caller's reference is returned only after all
 * stable source identity fields match the persisted version.
 */
export function createMeetingMinutesVersionPort(store: MeetingMinutesStore): MeetingMinutesVersionPort {
  if (!store || typeof store.get_version !== 'function') throw new TypeError('store.get_version is required');
  return {
    async readExact(reference, access) {
      if (!reference || !isRecord(reference) || !access || typeof access.principal !== 'string' || !access.principal.trim()) {
        throw new MeetingMinutesError('invalid_input', 'An exact minutes reference and access principal are required');
      }
      const meetingId = nonEmptyString(reference.meetingId, 'reference.meetingId');
      const minutesId = nonEmptyString(reference.minutesId, 'reference.minutesId');
      const versionId = nonEmptyString(reference.versionId, 'reference.versionId');
      if (reference.contentDigest !== null && typeof reference.contentDigest !== 'string') {
        throw new MeetingMinutesError('invalid_input', 'reference.contentDigest must be a string or null');
      }
      try {
        const version = await store.get_version(meetingId, minutesId, versionId, { principal_id: access.principal });
        if (!exactSourceMatches(reference, version)) return null;
        return { reference };
      } catch (error) {
        if (error instanceof MeetingMinutesError && error.code === 'not_found') return null;
        throw error;
      }
    }
  };
}
