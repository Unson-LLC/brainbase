import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Organization member invite kernel (spec: organization-member-invite-v1).
 *
 * The kernel owns the invite rules: token issue, atomic two-phase accept,
 * expiry, revoke, reissue, and role grant hand-off. Storage, mail delivery,
 * tenant authorization, login method resolution, the accept URL base, and the
 * membership write all stay outside the kernel behind injected ports.
 */

type JsonRecord = Record<string, unknown>;

export type OrganizationMemberInviteAction =
  | 'create'
  | 'accept'
  | 'revoke'
  | 'resend'
  | 'reissue'
  | 'read';

export type OrganizationMemberInviteStatus =
  | 'pending'
  | 'accepting'
  | 'accepted'
  | 'revoked'
  | 'expired';

/** The authenticated operator of an administrative operation. */
export interface OrganizationMemberInviteActor {
  tenantId: string;
  personId: string;
}

/**
 * The person produced by the consumer's organization-selected login method.
 * Only a verified email is ever compared with the invitee email.
 */
export interface OrganizationMemberInviteAuthenticatedPerson {
  personId: string;
  email?: string | null;
  emailVerified?: boolean;
}

export interface OrganizationMemberInviteMetadata extends JsonRecord {}

export interface OrganizationMemberInviteReservation {
  personId: string;
  reservedAt: string;
}

/** The stored record. `tokenHash` and `reservation` never leave the kernel. */
export interface OrganizationMemberInviteRecord {
  inviteId: string;
  tokenHash: string;
  tenantId: string;
  inviterPersonId: string;
  inviterDisplayName?: string | null;
  inviteeEmail: string;
  role: string;
  status: OrganizationMemberInviteStatus;
  issuedAt: string;
  expiresAt: string;
  metadata: OrganizationMemberInviteMetadata;
  reservation?: OrganizationMemberInviteReservation | null;
  acceptedAt?: string | null;
  acceptedByPersonId?: string | null;
  revokedAt?: string | null;
  supersededByInviteId?: string | null;
}

/** The readback projection returned to authorized same-tenant callers. */
export interface OrganizationMemberInviteReadback {
  inviteId: string;
  tenantId: string;
  inviterPersonId: string;
  inviterDisplayName?: string | null;
  inviteeEmail: string;
  role: string;
  status: OrganizationMemberInviteStatus;
  issuedAt: string;
  expiresAt: string;
  metadata: OrganizationMemberInviteMetadata;
  acceptedAt?: string | null;
  acceptedByPersonId?: string | null;
  revokedAt?: string | null;
  supersededByInviteId?: string | null;
}

export type OrganizationMemberInviteReserveResult =
  | { status: 'reserved'; record: OrganizationMemberInviteRecord; resumed?: boolean }
  | { status: 'missing' }
  | { status: 'expired'; record?: OrganizationMemberInviteRecord }
  | { status: 'revoked'; record?: OrganizationMemberInviteRecord }
  | { status: 'replayed'; record?: OrganizationMemberInviteRecord }
  | { status: 'consumed'; record?: OrganizationMemberInviteRecord };

export type OrganizationMemberInviteFinalizeResult =
  | { status: 'accepted'; record: OrganizationMemberInviteRecord }
  | { status: 'conflict' };

export type OrganizationMemberInviteReleaseResult =
  | { status: 'released'; record: OrganizationMemberInviteRecord }
  | { status: 'conflict' };

export type OrganizationMemberInviteRevokeResult =
  | { status: 'revoked'; record: OrganizationMemberInviteRecord }
  | { status: 'missing' }
  | { status: 'accept_in_progress' }
  | { status: 'already_accepted' }
  | { status: 'already_revoked' };

export type OrganizationMemberInviteReissueResult =
  | {
      status: 'reissued';
      previous: OrganizationMemberInviteRecord;
      record: OrganizationMemberInviteRecord;
    }
  | { status: 'missing' }
  | { status: 'accept_in_progress' }
  | { status: 'already_accepted' }
  | { status: 'already_revoked' };

export interface OrganizationMemberInviteRepository {
  /** Serialize the callback for this tenant and normalized email across all
   * service instances using this repository. Durable adapters must coordinate
   * across processes and propagate callback errors without changing them.
   */
  withPendingEmailLock<T>(
    input: { tenantId: string; inviteeEmail: string },
    operation: () => Promise<T>,
  ): Promise<T>;
  save(record: OrganizationMemberInviteRecord): Promise<void>;
  get(input: { tenantId: string; inviteId: string }): Promise<OrganizationMemberInviteRecord | null>;
  findPendingByEmail(input: {
    tenantId: string;
    inviteeEmail: string;
    now: string;
  }): Promise<OrganizationMemberInviteRecord[]>;

  /**
   * Atomically move a `pending`, unexpired invite to `accepting` and record
   * the reservation owner. A record already `accepting` for the same person
   * returns `reserved` with `resumed: true` so an unknown binding outcome can
   * be recovered idempotently; any other person receives `replayed`.
   * A token of another tenant must return `missing` without any state change.
   */
  reserveForAccept(input: {
    tenantId: string;
    tokenHash: string;
    personId: string;
    now: string;
  }): Promise<OrganizationMemberInviteReserveResult>;

  /** Atomically move `accepting` (owned by personId) to `accepted`. */
  finalizeAccept(input: {
    tenantId: string;
    inviteId: string;
    personId: string;
    now: string;
  }): Promise<OrganizationMemberInviteFinalizeResult>;

  /** Atomically move `accepting` (owned by personId) back to `pending`. */
  releaseReservation(input: {
    tenantId: string;
    inviteId: string;
    personId: string;
  }): Promise<OrganizationMemberInviteReleaseResult>;

  /** Atomically move `pending` (expired or not) to `revoked`. */
  revoke(input: {
    tenantId: string;
    inviteId: string;
    now: string;
  }): Promise<OrganizationMemberInviteRevokeResult>;

  /**
   * Atomically save `record` and mark the previous `pending` invite revoked
   * with `supersededByInviteId`. Must be serialized with reserve and revoke.
   */
  reissue(input: {
    tenantId: string;
    inviteId: string;
    record: OrganizationMemberInviteRecord;
    now: string;
  }): Promise<OrganizationMemberInviteReissueResult>;
}

export interface OrganizationMemberInviteAuthorizationRequest {
  action: OrganizationMemberInviteAction;
  tenantId: string;
  actorPersonId: string;
  role?: string;
  inviteId?: string;
}

export interface OrganizationMemberInvitePolicy {
  /** Throw (or reject) to deny. Denial stops before any port side effect. */
  authorize(request: OrganizationMemberInviteAuthorizationRequest): void | Promise<void>;

  /**
   * Allow a link holder whose verified email does not match the invitee to
   * accept. Absent or `false` keeps the strict default.
   */
  allowLinkHolderAccept?(input: {
    tenantId: string;
    inviteId: string;
    role: string;
    personId: string;
  }): boolean | Promise<boolean>;

  /**
   * Decide what to do when a pending invite already exists for the same
   * tenant and email. Default: `reject`. `reissue` replaces a single existing
   * invite with a new token, keeping its role and metadata. A role change or
   * multiple existing pending invites is rejected. For the same raw token,
   * callers must use resendInvite explicitly.
   */
  onDuplicatePending?(input: {
    tenantId: string;
    actorPersonId: string;
    role: string;
    existingInviteIds: string[];
  }): 'reject' | 'reissue' | Promise<'reject' | 'reissue'>;
}

export interface OrganizationMemberInviteEnvelope {
  kind: 'invite' | 'resend' | 'reissue';
  inviteId: string;
  tenantId: string;
  to: string;
  acceptUrl: string;
  inviterDisplayName: string | null;
  expiresAt: string;
  role: string;
}

export interface OrganizationMemberInviteDelivery {
  /** Send the envelope. The consumer owns the mail system and must not log it. */
  send(envelope: OrganizationMemberInviteEnvelope): Promise<void>;
}

export type OrganizationMemberInviteBindingResult =
  | { outcome: 'bound' }
  /** The binding was refused and is known to have caused no side effect. */
  | { outcome: 'rejected' };

export interface OrganizationMemberInviteAcceptBinding {
  /**
   * Bind the person to the tenant with the role. `inviteId` is the
   * idempotency key: a retry with the same person and role must not create a
   * second membership. Throwing means the outcome is unknown.
   */
  bind(input: {
    inviteId: string;
    tenantId: string;
    personId: string;
    role: string;
  }): Promise<OrganizationMemberInviteBindingResult>;
}

export interface OrganizationMemberInviteAuditEntry {
  action: OrganizationMemberInviteAction | 'audit_failed';
  tenantId: string;
  actorPersonId: string;
  inviteId: string;
  role?: string;
  status?: OrganizationMemberInviteStatus;
  supersededByInviteId?: string;
  failedAction?: OrganizationMemberInviteAction;
  occurredAt: string;
}

export interface OrganizationMemberInviteAudit {
  record(entry: OrganizationMemberInviteAuditEntry): Promise<void>;
}

export type OrganizationMemberInviteClock = () => Date;

export type OrganizationMemberInviteAcceptUrlBuilder = (input: {
  token: string;
  inviteId: string;
  tenantId: string;
}) => string;

export interface OrganizationMemberInviteServiceOptions {
  repository: OrganizationMemberInviteRepository;
  policy: OrganizationMemberInvitePolicy;
  acceptBinding: OrganizationMemberInviteAcceptBinding;
  buildAcceptUrl: OrganizationMemberInviteAcceptUrlBuilder;
  delivery?: OrganizationMemberInviteDelivery;
  audit?: OrganizationMemberInviteAudit;
  clock?: OrganizationMemberInviteClock;
  /** Default 7 days; 1 second to 30 days. */
  inviteTtlSeconds?: number;
}

export interface CreateOrganizationMemberInviteInput {
  actor: OrganizationMemberInviteActor;
  inviteeEmail: string;
  role: string;
  inviterDisplayName?: string | null;
  metadata?: unknown;
}

export interface OrganizationMemberInviteIssueResult {
  invite: OrganizationMemberInviteReadback;
  /** The raw token. Returned once; never stored. */
  token: string;
  acceptUrl: string;
  delivered: boolean;
}

export interface AcceptOrganizationMemberInviteInput {
  /** The tenant whose login method authenticated the person. */
  tenantId: string;
  token: string;
  person: OrganizationMemberInviteAuthenticatedPerson;
}

export interface AcceptOrganizationMemberInviteResult {
  invite: OrganizationMemberInviteReadback;
  acceptedAt: string;
}

export interface OrganizationMemberInviteTargetInput {
  actor: OrganizationMemberInviteActor;
  inviteId: string;
}

export interface ResendOrganizationMemberInviteInput extends OrganizationMemberInviteTargetInput {
  token: string;
}

export interface ReissueOrganizationMemberInviteResult extends OrganizationMemberInviteIssueResult {
  previous: OrganizationMemberInviteReadback;
}

export class OrganizationMemberInviteError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: JsonRecord;

  constructor(code: string, message: string, status = 400, details: JsonRecord = {}) {
    super(message);
    this.name = 'OrganizationMemberInviteError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_METADATA_BYTES = 8 * 1024;
const MAX_URL_LENGTH = 8 * 1024;
const INVITE_ID_PATTERN = /^omi_[A-Za-z0-9_-]{16,64}$/u;
const ROLE_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const SECRET_KEY_PATTERN =
  /(?:access|refresh|id)?[_-]?(?:token|secret)|credential|password|private[_-]?key|authorization[_-]?code|client[_-]?secret|api[_-]?key|session/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function fail(code: string, message: string, status = 400, details: JsonRecord = {}): never {
  throw new OrganizationMemberInviteError(code, message, status, details);
}

function normalizeString(
  value: unknown,
  field: string,
  options: { required?: boolean; max?: number } = {},
): string | null {
  const normalized = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  if (!normalized) {
    if (options.required) fail('validation_error', `${field} is required`, 400, { field });
    return null;
  }
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    fail('validation_error', `${field} contains control characters`, 400, { field });
  }
  if (options.max && normalized.length > options.max) {
    fail('validation_error', `${field} exceeds the maximum length`, 400, { field, max: options.max });
  }
  return normalized;
}

function requiredString(value: unknown, field: string, max = 256): string {
  return normalizeString(value, field, { required: true, max })!;
}

function normalizeActor(value: unknown): OrganizationMemberInviteActor {
  if (!isPlainRecord(value)) fail('validation_error', 'actor is required', 400, { field: 'actor' });
  return {
    tenantId: requiredString(value.tenantId, 'actor.tenantId'),
    personId: requiredString(value.personId, 'actor.personId'),
  };
}

/** Lower-case and trim. Exported so consumers normalize lookups identically. */
export function normalizeOrganizationMemberInviteEmail(value: unknown): string {
  const email = requiredString(value, 'inviteeEmail', 320).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    fail('validation_error', 'inviteeEmail has an invalid format', 400, { field: 'inviteeEmail' });
  }
  return email;
}

function normalizeRole(value: unknown): string {
  const role = requiredString(value, 'role', 64);
  if (!ROLE_PATTERN.test(role)) fail('validation_error', 'role has an invalid format', 400, { field: 'role' });
  return role;
}

function normalizeInviteId(value: unknown): string {
  const inviteId = requiredString(value, 'inviteId', 128);
  if (!INVITE_ID_PATTERN.test(inviteId)) {
    fail('validation_error', 'inviteId has an invalid format', 400, { field: 'inviteId' });
  }
  return inviteId;
}

function normalizeToken(value: unknown): string {
  return requiredString(value, 'token', 512);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeMetadataValue(value: unknown, path: string, depth: number): unknown {
  if (depth > 5) fail('validation_error', 'metadata is too deeply nested', 400, { field: 'metadata' });
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('validation_error', 'metadata contains a non-finite number', 400, { field: path });
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => sanitizeMetadataValue(entry, `${path}[${index}]`, depth + 1));
  }
  if (!isPlainRecord(value)) {
    fail('validation_error', 'metadata contains an unsupported value', 400, { field: path });
  }
  const sanitized: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      fail('validation_error', 'metadata contains a sensitive field', 400, { field: path });
    }
    sanitized[key] = sanitizeMetadataValue(entry, `${path}.${key}`, depth + 1);
  }
  return sanitized;
}

function normalizeMetadata(value: unknown): OrganizationMemberInviteMetadata {
  const candidate = value == null ? {} : sanitizeMetadataValue(value, 'metadata', 0);
  if (!isPlainRecord(candidate)) fail('validation_error', 'metadata must be an object', 400, { field: 'metadata' });
  if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MAX_METADATA_BYTES) {
    fail('validation_error', 'metadata exceeds the maximum size', 400, {
      field: 'metadata',
      maxBytes: MAX_METADATA_BYTES,
    });
  }
  return candidate;
}

function normalizeTtl(value: number | undefined): number {
  const ttl = value ?? DEFAULT_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_TTL_SECONDS) {
    fail('validation_error', 'inviteTtlSeconds is outside the supported range', 400, {
      field: 'inviteTtlSeconds',
      min: 1,
      max: MAX_TTL_SECONDS,
    });
  }
  return ttl;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Issue a new invite id. Ids start with `omi_` and carry no secret. */
export function createOrganizationMemberInviteId(): string {
  return `omi_${randomBytes(16).toString('base64url')}`;
}

function isExpired(record: OrganizationMemberInviteRecord, now: string): boolean {
  return Date.parse(now) >= Date.parse(record.expiresAt);
}

function effectiveStatus(record: OrganizationMemberInviteRecord, now: string): OrganizationMemberInviteStatus {
  return record.status === 'pending' && isExpired(record, now) ? 'expired' : record.status;
}

function toReadback(record: OrganizationMemberInviteRecord, now: string): OrganizationMemberInviteReadback {
  return {
    inviteId: record.inviteId,
    tenantId: record.tenantId,
    inviterPersonId: record.inviterPersonId,
    inviterDisplayName: record.inviterDisplayName ?? null,
    inviteeEmail: record.inviteeEmail,
    role: record.role,
    status: effectiveStatus(record, now),
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    metadata: structuredClone(record.metadata ?? {}),
    acceptedAt: record.acceptedAt ?? null,
    acceptedByPersonId: record.acceptedByPersonId ?? null,
    revokedAt: record.revokedAt ?? null,
    supersededByInviteId: record.supersededByInviteId ?? null,
  };
}

function isStoredRecord(value: unknown): value is OrganizationMemberInviteRecord {
  if (!isPlainRecord(value)) return false;
  try {
    if (normalizeInviteId(value.inviteId) !== value.inviteId
        || requiredString(value.tenantId, 'tenantId') !== value.tenantId
        || requiredString(value.inviterPersonId, 'inviterPersonId') !== value.inviterPersonId
        || typeof value.tokenHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.tokenHash)
        || normalizeOrganizationMemberInviteEmail(value.inviteeEmail) !== value.inviteeEmail
        || normalizeRole(value.role) !== value.role
        || !['pending', 'accepting', 'accepted', 'revoked', 'expired'].includes(String(value.status))
        || typeof value.issuedAt !== 'string' || !Number.isFinite(Date.parse(value.issuedAt))
        || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))
        || Date.parse(value.expiresAt) <= Date.parse(value.issuedAt)
        || !isPlainRecord(value.metadata)) return false;
    normalizeMetadata(value.metadata);
    if (value.status === 'accepting' && (!isPlainRecord(value.reservation)
        || requiredString(value.reservation.personId, 'reservation.personId') !== value.reservation.personId
        || typeof value.reservation.reservedAt !== 'string'
        || !Number.isFinite(Date.parse(value.reservation.reservedAt)))) return false;
    return true;
  } catch { return false; }
}

const STORE_UNAVAILABLE = ['invite_store_unavailable', 'Invite store is unavailable', 503] as const;

export class OrganizationMemberInviteService {
  private readonly repository: OrganizationMemberInviteRepository;
  private readonly policy: OrganizationMemberInvitePolicy;
  private readonly acceptBinding: OrganizationMemberInviteAcceptBinding;
  private readonly buildAcceptUrl: OrganizationMemberInviteAcceptUrlBuilder;
  private readonly delivery?: OrganizationMemberInviteDelivery;
  private readonly audit?: OrganizationMemberInviteAudit;
  private readonly clock: OrganizationMemberInviteClock;
  private readonly ttlSeconds: number;

  constructor(options: OrganizationMemberInviteServiceOptions) {
    if (!options?.repository || !options.policy || !options.acceptBinding ||
        typeof options.buildAcceptUrl !== 'function') {
      throw new TypeError('repository, policy, acceptBinding and buildAcceptUrl are required');
    }
    this.repository = options.repository;
    this.policy = options.policy;
    this.acceptBinding = options.acceptBinding;
    this.buildAcceptUrl = options.buildAcceptUrl;
    this.delivery = options.delivery;
    this.audit = options.audit;
    this.clock = options.clock ?? (() => new Date());
    this.ttlSeconds = normalizeTtl(options.inviteTtlSeconds);
  }

  async createInvite(input: CreateOrganizationMemberInviteInput): Promise<OrganizationMemberInviteIssueResult> {
    const actor = normalizeActor(input?.actor);
    const inviteeEmail = normalizeOrganizationMemberInviteEmail(input.inviteeEmail);
    const role = normalizeRole(input.role);
    const inviterDisplayName = normalizeString(input.inviterDisplayName, 'inviterDisplayName', { max: 200 });
    const metadata = normalizeMetadata(input.metadata);
    await this.authorize({ action: 'create', tenantId: actor.tenantId, actorPersonId: actor.personId, role });

    try {
      return await this.repository.withPendingEmailLock({ tenantId: actor.tenantId, inviteeEmail }, async () => {
        const now = this.now();
        const existing = await this.store(() => this.repository.findPendingByEmail({
          tenantId: actor.tenantId,
          inviteeEmail,
          now,
        }));
        if (!Array.isArray(existing) || existing.some((record) => !isStoredRecord(record)
            || record.tenantId !== actor.tenantId || record.inviteeEmail !== inviteeEmail)) fail(...STORE_UNAVAILABLE);
        const duplicates = existing.filter((record) => record.status === 'pending' && !isExpired(record, now));
        if (duplicates.length > 0) {
          const decision = await this.policyCall(() => this.policy.onDuplicatePending?.({
            tenantId: actor.tenantId,
            actorPersonId: actor.personId,
            role,
            existingInviteIds: duplicates.map((record) => record.inviteId),
          }));
          if (decision === 'reissue' && duplicates.length === 1 && duplicates[0].role === role) {
            return this.reissue({ actor, inviteId: duplicates[0].inviteId });
          }
          fail('invite_duplicate', 'A pending invite already exists for this email', 409, {
            existingInviteIds: duplicates.map((record) => record.inviteId),
          });
        }

        const { record, token } = this.issueRecord({ actor, inviteeEmail, role, inviterDisplayName, metadata });
        const acceptUrl = this.acceptUrl(token, record);
        await this.store(() => this.repository.save(record));
        return this.finishIssue('invite', record, token, acceptUrl, actor, 'create');
      });
    } catch (error) {
      if (error instanceof OrganizationMemberInviteError) throw error;
      fail(...STORE_UNAVAILABLE);
    }
  }

  async acceptInvite(input: AcceptOrganizationMemberInviteInput): Promise<AcceptOrganizationMemberInviteResult> {
    const tenantId = requiredString(input?.tenantId, 'tenantId');
    const token = normalizeToken(input.token);
    if (!isPlainRecord(input.person)) fail('validation_error', 'person is required', 400, { field: 'person' });
    const personId = requiredString(input.person.personId, 'person.personId');
    const verifiedEmail = input.person.emailVerified === true && typeof input.person.email === 'string'
      ? input.person.email.normalize('NFKC').trim().toLowerCase()
      : null;
    await this.authorize({ action: 'accept', tenantId, actorPersonId: personId });

    const now = this.now();
    const reserved = await this.store(() => this.repository.reserveForAccept({
      tenantId,
      tokenHash: hashToken(token),
      personId,
      now,
    }));
    const status = (reserved as { status?: unknown })?.status;
    if (status === 'missing') fail('invite_invalid', 'Invite is invalid', 404);
    if (status === 'expired') fail('invite_expired', 'Invite has expired', 410);
    if (status === 'revoked') fail('invite_revoked', 'Invite has been revoked', 410);
    if (status === 'replayed') fail('invite_replayed', 'Invite is already being accepted', 409);
    if (status === 'consumed') fail('invite_consumed', 'Invite has already been accepted', 409);
    if (status !== 'reserved' || !isStoredRecord((reserved as { record?: unknown }).record)) {
      fail(...STORE_UNAVAILABLE);
    }
    const record = (reserved as { record: OrganizationMemberInviteRecord }).record;
    // A resumed reservation may already have a binding outcome; never release it here.
    const resumed = (reserved as { resumed?: unknown }).resumed === true;
    const releaseIfFresh = () => (resumed ? Promise.resolve() : this.releaseQuietly(record, personId));

    // Tenant isolation: the repository must already scope by tenant. A
    // non-conforming adapter is treated as broken, and its reservation is not
    // released under a tenant it does not belong to.
    if (record.tenantId !== tenantId || !sameHash(record.tokenHash, hashToken(token))
        || record.status !== 'accepting' || record.reservation?.personId !== personId) fail(...STORE_UNAVAILABLE);

    try {
      await this.authorize({
        action: 'accept', tenantId, actorPersonId: personId,
        role: record.role, inviteId: record.inviteId,
      });
      const emailMatches = verifiedEmail !== null && verifiedEmail === record.inviteeEmail;
      if (!emailMatches) {
        const allowed = await this.policyCall(() => this.policy.allowLinkHolderAccept?.({
          tenantId: record.tenantId,
          inviteId: record.inviteId,
          role: record.role,
          personId,
        }));
        if (allowed !== true) {
          fail('email_mismatch', 'The signed-in email does not match the invite', 403);
        }
      }
    } catch (error) {
      // No binding was attempted. Fresh reservations can safely be retried.
      await releaseIfFresh();
      throw error;
    }

    let binding: OrganizationMemberInviteBindingResult;
    try {
      binding = await this.acceptBinding.bind({
        inviteId: record.inviteId,
        tenantId: record.tenantId,
        personId,
        role: record.role,
      });
    } catch {
      // Outcome unknown: keep the reservation for idempotent recovery.
      fail('invite_accept_recovery_required', 'Invite acceptance must be retried', 503, {
        inviteId: record.inviteId,
      });
    }
    const outcome = (binding as { outcome?: unknown })?.outcome;
    if (outcome === 'rejected') {
      await this.releaseQuietly(record, personId);
      fail('invite_binding_rejected', 'Membership could not be granted', 409, { inviteId: record.inviteId });
    }
    if (outcome !== 'bound') {
      fail('invite_accept_recovery_required', 'Invite acceptance must be retried', 503, {
        inviteId: record.inviteId,
      });
    }

    let finalized: OrganizationMemberInviteFinalizeResult;
    try {
      finalized = await this.repository.finalizeAccept({
        tenantId: record.tenantId,
        inviteId: record.inviteId,
        personId,
        now,
      });
    } catch {
      fail('invite_accept_recovery_required', 'Invite acceptance must be retried', 503, {
        inviteId: record.inviteId,
      });
    }
    if (finalized?.status !== 'accepted' || !isStoredRecord(finalized.record)
        || finalized.record.tenantId !== tenantId || finalized.record.inviteId !== record.inviteId
        || finalized.record.status !== 'accepted' || finalized.record.acceptedByPersonId !== personId) {
      fail('invite_accept_recovery_required', 'Invite acceptance must be retried', 503, {
        inviteId: record.inviteId,
      });
    }

    await this.writeAudit({
      action: 'accept',
      tenantId: record.tenantId,
      actorPersonId: personId,
      inviteId: record.inviteId,
      role: record.role,
      status: 'accepted',
      occurredAt: now,
    });
    return { invite: toReadback(finalized.record, now), acceptedAt: finalized.record.acceptedAt ?? now };
  }

  async revokeInvite(input: OrganizationMemberInviteTargetInput): Promise<OrganizationMemberInviteReadback> {
    const actor = normalizeActor(input?.actor);
    const inviteId = normalizeInviteId(input.inviteId);
    const current = await this.getOwned(actor, inviteId);
    await this.authorize({
      action: 'revoke',
      tenantId: actor.tenantId,
      actorPersonId: actor.personId,
      role: current.role,
      inviteId,
    });
    const now = this.now();
    const result = await this.store(() => this.repository.revoke({ tenantId: actor.tenantId, inviteId, now }));
    switch (result?.status) {
      case 'revoked':
        break;
      case 'missing':
        fail('invite_not_found', 'Invite was not found', 404);
      case 'accept_in_progress':
        fail('accept_in_progress', 'Invite is being accepted', 409);
      case 'already_accepted':
        fail('invite_consumed', 'Invite has already been accepted', 409);
      case 'already_revoked':
        fail('invite_revoked', 'Invite has been revoked', 410);
      default:
        fail(...STORE_UNAVAILABLE);
    }
    if (!isStoredRecord(result.record) || result.record.tenantId !== actor.tenantId
        || result.record.inviteId !== inviteId || result.record.status !== 'revoked') fail(...STORE_UNAVAILABLE);
    await this.writeAudit({
      action: 'revoke',
      tenantId: actor.tenantId,
      actorPersonId: actor.personId,
      inviteId,
      role: current.role,
      status: 'revoked',
      occurredAt: now,
    });
    return toReadback(result.record, now);
  }

  async resendInvite(input: ResendOrganizationMemberInviteInput): Promise<OrganizationMemberInviteIssueResult> {
    const actor = normalizeActor(input?.actor);
    const inviteId = normalizeInviteId(input.inviteId);
    const token = normalizeToken(input.token);
    const record = await this.getOwned(actor, inviteId);
    await this.authorize({
      action: 'resend',
      tenantId: actor.tenantId,
      actorPersonId: actor.personId,
      role: record.role,
      inviteId,
    });
    const now = this.now();
    this.assertReusable(record, now);
    if (!sameHash(hashToken(token), record.tokenHash)) {
      fail('invite_token_mismatch', 'Token does not belong to this invite; use reissue', 400);
    }
    return this.finishIssue('resend', record, token, this.acceptUrl(token, record), actor, 'resend');
  }

  async reissue(input: OrganizationMemberInviteTargetInput): Promise<ReissueOrganizationMemberInviteResult> {
    const actor = normalizeActor(input?.actor);
    const inviteId = normalizeInviteId(input.inviteId);
    const current = await this.getOwned(actor, inviteId);
    await this.authorize({
      action: 'reissue',
      tenantId: actor.tenantId,
      actorPersonId: actor.personId,
      role: current.role,
      inviteId,
    });
    if (current.status === 'accepting') fail('accept_in_progress', 'Invite is being accepted', 409);
    if (current.status === 'accepted') fail('invite_consumed', 'Invite has already been accepted', 409);
    if (current.status === 'revoked') fail('invite_revoked', 'Invite has been revoked', 410);

    const { record, token } = this.issueRecord({
      actor,
      inviteeEmail: current.inviteeEmail,
      role: current.role,
      inviterDisplayName: current.inviterDisplayName ?? null,
      metadata: current.metadata ?? {},
    });
    const acceptUrl = this.acceptUrl(token, record);
    const now = record.issuedAt;
    const result = await this.store(() => this.repository.reissue({
      tenantId: actor.tenantId,
      inviteId,
      record,
      now,
    }));
    switch (result?.status) {
      case 'reissued':
        break;
      case 'missing':
        fail('invite_not_found', 'Invite was not found', 404);
      case 'accept_in_progress':
        fail('accept_in_progress', 'Invite is being accepted', 409);
      case 'already_accepted':
        fail('invite_consumed', 'Invite has already been accepted', 409);
      case 'already_revoked':
        fail('invite_revoked', 'Invite has been revoked', 410);
      default:
        fail(...STORE_UNAVAILABLE);
    }
    if (!isStoredRecord(result.record) || !isStoredRecord(result.previous)
        || result.record.tenantId !== actor.tenantId || result.previous.tenantId !== actor.tenantId
        || result.record.inviteId !== record.inviteId || result.previous.inviteId !== inviteId
        || result.previous.status !== 'revoked' || result.previous.supersededByInviteId !== record.inviteId
        || result.record.status !== 'pending') {
      fail(...STORE_UNAVAILABLE);
    }
    const issued = await this.finishIssue('reissue', result.record, token, acceptUrl, actor, 'reissue', inviteId);
    return { ...issued, previous: toReadback(result.previous, now) };
  }

  async readInvite(input: OrganizationMemberInviteTargetInput): Promise<OrganizationMemberInviteReadback> {
    const actor = normalizeActor(input?.actor);
    const inviteId = normalizeInviteId(input.inviteId);
    await this.authorize({ action: 'read', tenantId: actor.tenantId, actorPersonId: actor.personId, inviteId });
    const record = await this.getOwned(actor, inviteId);
    await this.authorize({ action: 'read', tenantId: actor.tenantId, actorPersonId: actor.personId, inviteId, role: record.role });
    return toReadback(record, this.now());
  }

  private issueRecord(input: {
    actor: OrganizationMemberInviteActor;
    inviteeEmail: string;
    role: string;
    inviterDisplayName: string | null;
    metadata: OrganizationMemberInviteMetadata;
  }): { record: OrganizationMemberInviteRecord; token: string } {
    const issuedAt = this.now();
    const issuedAtDate = new Date(issuedAt);
    const expiresAt = this.iso(new Date(issuedAtDate.getTime() + this.ttlSeconds * 1000));
    const token = randomBytes(32).toString('base64url');
    return {
      token,
      record: {
        inviteId: createOrganizationMemberInviteId(),
        tokenHash: hashToken(token),
        tenantId: input.actor.tenantId,
        inviterPersonId: input.actor.personId,
        inviterDisplayName: input.inviterDisplayName,
        inviteeEmail: input.inviteeEmail,
        role: input.role,
        status: 'pending',
        issuedAt,
        expiresAt,
        metadata: input.metadata,
        reservation: null,
        acceptedAt: null,
        acceptedByPersonId: null,
        revokedAt: null,
        supersededByInviteId: null,
      },
    };
  }

  private async finishIssue(
    kind: OrganizationMemberInviteEnvelope['kind'],
    record: OrganizationMemberInviteRecord,
    token: string,
    acceptUrl: string,
    actor: OrganizationMemberInviteActor,
    action: OrganizationMemberInviteAction,
    supersededInviteId?: string,
  ): Promise<OrganizationMemberInviteIssueResult> {
    let delivered = false;
    if (this.delivery) {
      try {
        await this.delivery.send({
          kind,
          inviteId: record.inviteId,
          tenantId: record.tenantId,
          to: record.inviteeEmail,
          acceptUrl,
          inviterDisplayName: record.inviterDisplayName ?? null,
          expiresAt: record.expiresAt,
          role: record.role,
        });
        delivered = true;
      } catch {
        fail('invite_delivery_unavailable', 'Invite delivery is unavailable', 503, { inviteId: record.inviteId });
      }
    }
    await this.writeAudit({
      action,
      tenantId: record.tenantId,
      actorPersonId: actor.personId,
      inviteId: supersededInviteId ?? record.inviteId,
      role: record.role,
      status: 'pending',
      ...(supersededInviteId ? { supersededByInviteId: record.inviteId } : {}),
      occurredAt: this.now(),
    });
    return { invite: toReadback(record, this.now()), token, acceptUrl, delivered };
  }

  private acceptUrl(token: string, record: OrganizationMemberInviteRecord): string {
    let url: unknown;
    try {
      url = this.buildAcceptUrl({ token, inviteId: record.inviteId, tenantId: record.tenantId });
    } catch {
      fail('invite_accept_url_invalid', 'Invite accept URL could not be built', 500);
    }
    if (typeof url !== 'string' || !url || url.length > MAX_URL_LENGTH ||
        CONTROL_CHARACTER_PATTERN.test(url) || !url.includes(token)) {
      fail('invite_accept_url_invalid', 'Invite accept URL could not be built', 500);
    }
    let parsed: URL;
    try { parsed = new URL(url); } catch { fail('invite_accept_url_invalid', 'Invite accept URL could not be built', 500); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password
        || !parsed.hash.includes(token) || parsed.href.split('#')[0].includes(token)) {
      fail('invite_accept_url_invalid', 'Invite accept URL must use HTTPS without URL credentials and keep the token only in the fragment', 500);
    }
    return url;
  }

  private assertReusable(record: OrganizationMemberInviteRecord, now: string): void {
    if (record.status === 'accepting') fail('accept_in_progress', 'Invite is being accepted', 409);
    if (record.status === 'accepted') fail('invite_consumed', 'Invite has already been accepted', 409);
    if (record.status === 'revoked') fail('invite_revoked', 'Invite has been revoked', 410);
    if (record.status === 'expired' || isExpired(record, now)) {
      fail('invite_expired', 'Invite has expired; use reissue', 410);
    }
  }

  private async getOwned(actor: OrganizationMemberInviteActor, inviteId: string): Promise<OrganizationMemberInviteRecord> {
    const record = await this.store(() => this.repository.get({ tenantId: actor.tenantId, inviteId }));
    if (record === null) fail('invite_not_found', 'Invite was not found', 404);
    if (!isStoredRecord(record)) fail(...STORE_UNAVAILABLE);
    // Tenant isolation: never reveal that another tenant owns the id.
    if (record.tenantId !== actor.tenantId || record.inviteId !== inviteId) {
      fail('invite_not_found', 'Invite was not found', 404);
    }
    return record;
  }

  private async releaseQuietly(record: OrganizationMemberInviteRecord, personId: string): Promise<void> {
    try {
      await this.repository.releaseReservation({ tenantId: record.tenantId, inviteId: record.inviteId, personId });
    } catch {
      // A failed release leaves the reservation owned by this person; the
      // same person can retry. It is never handed to anyone else.
    }
  }

  private async authorize(request: OrganizationMemberInviteAuthorizationRequest): Promise<void> {
    try {
      await this.policy.authorize(request);
    } catch {
      fail('invite_forbidden', 'Invite operation is not authorized', 403);
    }
  }

  private async policyCall<T>(call: () => T | Promise<T>): Promise<T> {
    try {
      return await call();
    } catch {
      fail('invite_forbidden', 'Invite operation is not authorized', 403);
    }
  }

  private async store<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch {
      fail(...STORE_UNAVAILABLE);
    }
  }

  private async writeAudit(entry: OrganizationMemberInviteAuditEntry): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.record(entry);
    } catch {
      // Best-effort: an audit failure never overturns the operation result.
      try {
        await this.audit.record({
          action: 'audit_failed',
          tenantId: entry.tenantId,
          actorPersonId: entry.actorPersonId,
          inviteId: entry.inviteId,
          failedAction: entry.action === 'audit_failed' ? undefined : entry.action,
          occurredAt: entry.occurredAt,
        });
      } catch {
        // Nothing further the kernel can do without leaking details.
      }
    }
  }

  private now(): string {
    try {
      return this.iso(this.clock());
    } catch {
      fail('invite_clock_invalid', 'Invite clock is unavailable', 503);
    }
  }

  private iso(date: Date): string {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      fail('invite_clock_invalid', 'Invite clock returned an invalid date', 503);
    }
    return date.toISOString();
  }
}

/**
 * Reference in-memory repository for tests, fixtures, and local runs. It is
 * not a persistence adapter. Issuance callbacks serialize per tenant/email in
 * one Node process; state mutation methods run atomically without awaiting.
 */
export function createInMemoryOrganizationMemberInviteRepository(): OrganizationMemberInviteRepository & {
  snapshot(): OrganizationMemberInviteRecord[];
} {
  const pendingEmailLocks = new Map<string, Promise<void>>();
  const byId = new Map<string, OrganizationMemberInviteRecord>();
  const idByHash = new Map<string, string>();
  const clone = (record: OrganizationMemberInviteRecord) => structuredClone(record);
  const owned = (tenantId: string, inviteId: string) => {
    const record = byId.get(inviteId);
    return record && record.tenantId === tenantId ? record : null;
  };

  return {
    async withPendingEmailLock({ tenantId, inviteeEmail }, operation) {
      const key = JSON.stringify([tenantId, inviteeEmail]);
      const previous = pendingEmailLocks.get(key) ?? Promise.resolve();
      let release: () => void = () => {};
      const current = new Promise<void>(resolve => { release = resolve; });
      pendingEmailLocks.set(key, current);
      await previous;
      try {
        return await operation();
      } finally {
        release();
        if (pendingEmailLocks.get(key) === current) pendingEmailLocks.delete(key);
      }
    },
    async save(record) {
      byId.set(record.inviteId, clone(record));
      idByHash.set(record.tokenHash, record.inviteId);
    },
    async get({ tenantId, inviteId }) {
      const record = owned(tenantId, inviteId);
      return record ? clone(record) : null;
    },
    async findPendingByEmail({ tenantId, inviteeEmail, now }) {
      return [...byId.values()]
        .filter((record) => record.tenantId === tenantId && record.inviteeEmail === inviteeEmail &&
          record.status === 'pending' && !isExpired(record, now))
        .map(clone);
    },
    async reserveForAccept({ tenantId, tokenHash, personId, now }) {
      const inviteId = idByHash.get(tokenHash);
      const record = inviteId ? owned(tenantId, inviteId) : null;
      if (!record) return { status: 'missing' };
      if (record.status === 'accepted') return { status: 'consumed', record: clone(record) };
      if (record.status === 'revoked') return { status: 'revoked', record: clone(record) };
      if (record.status === 'accepting') {
        if (record.reservation?.personId === personId) {
          return { status: 'reserved', record: clone(record), resumed: true };
        }
        return { status: 'replayed', record: clone(record) };
      }
      if (record.status === 'expired' || isExpired(record, now)) return { status: 'expired', record: clone(record) };
      record.status = 'accepting';
      record.reservation = { personId, reservedAt: now };
      return { status: 'reserved', record: clone(record) };
    },
    async finalizeAccept({ tenantId, inviteId, personId, now }) {
      const record = owned(tenantId, inviteId);
      if (!record || record.status !== 'accepting' || record.reservation?.personId !== personId) {
        return { status: 'conflict' };
      }
      record.status = 'accepted';
      record.acceptedAt = now;
      record.acceptedByPersonId = personId;
      record.reservation = null;
      return { status: 'accepted', record: clone(record) };
    },
    async releaseReservation({ tenantId, inviteId, personId }) {
      const record = owned(tenantId, inviteId);
      if (!record || record.status !== 'accepting' || record.reservation?.personId !== personId) {
        return { status: 'conflict' };
      }
      record.status = 'pending';
      record.reservation = null;
      return { status: 'released', record: clone(record) };
    },
    async revoke({ tenantId, inviteId, now }) {
      const record = owned(tenantId, inviteId);
      if (!record) return { status: 'missing' };
      if (record.status === 'accepting') return { status: 'accept_in_progress' };
      if (record.status === 'accepted') return { status: 'already_accepted' };
      if (record.status === 'revoked') return { status: 'already_revoked' };
      record.status = 'revoked';
      record.revokedAt = now;
      return { status: 'revoked', record: clone(record) };
    },
    async reissue({ tenantId, inviteId, record: next, now }) {
      const record = owned(tenantId, inviteId);
      if (!record) return { status: 'missing' };
      if (record.status === 'accepting') return { status: 'accept_in_progress' };
      if (record.status === 'accepted') return { status: 'already_accepted' };
      if (record.status === 'revoked') return { status: 'already_revoked' };
      record.status = 'revoked';
      record.revokedAt = now;
      record.supersededByInviteId = next.inviteId;
      byId.set(next.inviteId, clone(next));
      idByHash.set(next.tokenHash, next.inviteId);
      return { status: 'reissued', previous: clone(record), record: clone(next) };
    },
    snapshot() {
      return [...byId.values()].map(clone);
    },
  };
}
