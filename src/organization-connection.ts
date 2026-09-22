import { createHash, randomBytes } from 'node:crypto';

type JsonRecord = Record<string, unknown>;

export type OrganizationConnectionAction = 'authorize' | 'complete' | 'read';

export type OrganizationConnectionStatus =
  | 'active'
  | 'pending'
  | 'disconnected'
  | 'error';

export interface OrganizationConnectionBinding {
  tenantId: string;
  personId: string;
}

/**
 * Provider-specific intent is kept opaque to the kernel. It is persisted only
 * after the kernel has rejected secret-shaped keys and unsupported values.
 */
export interface OrganizationConnectionIntent extends JsonRecord {}

export interface OrganizationConnectionStateRecord {
  id: string;
  stateHash: string;
  provider: string;
  binding: OrganizationConnectionBinding;
  intent: OrganizationConnectionIntent;
  issuedAt: string;
  expiresAt: string;
}

export type OrganizationConnectionStateConsumeResult =
  | {
      status: 'consumed';
      record: OrganizationConnectionStateRecord;
      consumedAt: string;
    }
  | { status: 'missing' }
  | { status: 'expired'; record?: OrganizationConnectionStateRecord }
  | { status: 'replayed'; record?: OrganizationConnectionStateRecord };

export interface OrganizationConnectionStateRepository {
  save(record: OrganizationConnectionStateRecord): Promise<void>;

  /**
   * Consume a state token atomically. Implementations must persist the
   * consumed marker as part of the same operation that returns `consumed` so
   * two callbacks cannot both exchange the authorization code.
   */
  consume(input: {
    stateHash: string;
    now: string;
  }): Promise<OrganizationConnectionStateConsumeResult>;
}

export interface OrganizationConnectionReadback {
  provider: string;
  connectionId: string;
  status: OrganizationConnectionStatus;
  displayName?: string | null;
  externalId?: string | null;
  scopes?: string[];
  connectedAt?: string | null;
  updatedAt?: string | null;
}

export interface OrganizationConnectionProviderAdapter {
  /**
   * Build the provider authorization URL. The raw opaque state is supplied
   * so the adapter can put it in the provider request; the kernel never logs
   * or audits it.
   */
  createAuthorization(input: {
    provider: string;
    binding: OrganizationConnectionBinding;
    state: string;
    intent: OrganizationConnectionIntent;
  }): Promise<{ authorizationUrl: string }>;

  /** Exchange a code and return a safe connection projection only. */
  exchangeAuthorizationCode(input: {
    provider: string;
    binding: OrganizationConnectionBinding;
    state: OrganizationConnectionStateRecord;
    code: string;
  }): Promise<OrganizationConnectionReadback>;

  /** Read a tenant/person-bound connection without returning credentials. */
  readConnection(input: {
    provider: string;
    binding: OrganizationConnectionBinding;
    connectionId?: string | null;
  }): Promise<OrganizationConnectionReadback | null>;
}

export interface OrganizationConnectionAuthorizationRequest {
  action: OrganizationConnectionAction;
  provider: string;
  binding: OrganizationConnectionBinding;
  intent?: OrganizationConnectionIntent;
  connectionId?: string | null;
}

export interface OrganizationConnectionPolicy {
  authorize(
    request: OrganizationConnectionAuthorizationRequest,
  ): void | Promise<void>;
}

export interface OrganizationConnectionAuditEntry {
  action: OrganizationConnectionAction;
  provider: string;
  binding: OrganizationConnectionBinding;
  stateId?: string;
  connectionId?: string;
  status?: OrganizationConnectionStatus;
  occurredAt: string;
}

export interface OrganizationConnectionAudit {
  record(entry: OrganizationConnectionAuditEntry): Promise<void>;
}

export type OrganizationConnectionClock = () => Date;

export interface OrganizationConnectionServiceOptions {
  stateRepository: OrganizationConnectionStateRepository;
  providerAdapter: OrganizationConnectionProviderAdapter;
  policy?: OrganizationConnectionPolicy;
  audit?: OrganizationConnectionAudit;
  clock?: OrganizationConnectionClock;
  stateTtlSeconds?: number;
}

export interface StartOrganizationConnectionInput {
  provider: string;
  binding: OrganizationConnectionBinding;
  intent?: unknown;
}

export interface StartOrganizationConnectionResult {
  provider: string;
  binding: OrganizationConnectionBinding;
  state: string;
  expiresAt: string;
  authorizationUrl: string;
}

export interface CompleteOrganizationConnectionInput {
  provider: string;
  binding: OrganizationConnectionBinding;
  state: string;
  code: string;
}

export interface CompleteOrganizationConnectionResult {
  connection: OrganizationConnectionReadback;
  consumedAt: string;
}

export interface ReadOrganizationConnectionInput {
  provider: string;
  binding: OrganizationConnectionBinding;
  connectionId?: string | null;
}

export class OrganizationConnectionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: JsonRecord;

  constructor(
    code: string,
    message: string,
    status = 400,
    details: JsonRecord = {},
  ) {
    super(message);
    this.name = 'OrganizationConnectionError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const DEFAULT_STATE_TTL_SECONDS = 10 * 60;
const MAX_STATE_TTL_SECONDS = 60 * 60;
const MAX_INTENT_BYTES = 8 * 1024;
const MAX_CODE_LENGTH = 4 * 1024;
const MAX_AUTHORIZATION_URL_LENGTH = 8 * 1024;
const MAX_CONNECTION_ID_LENGTH = 256;
const SECRET_KEY_PATTERN = /(?:access|refresh|id)?[_-]?(?:token|secret)|credential|password|private[_-]?key|authorization[_-]?code|client[_-]?secret/i;

function fail(
  code: string,
  message: string,
  status = 400,
  details: JsonRecord = {},
): never {
  throw new OrganizationConnectionError(code, message, status, details);
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
  if (/[\u0000-\u001f\u007f]/u.test(normalized)) {
    fail('validation_error', `${field} contains control characters`, 400, { field });
  }
  if (options.max && normalized.length > options.max) {
    fail('validation_error', `${field} exceeds the maximum length`, 400, {
      field,
      max: options.max,
    });
  }
  return normalized;
}

function normalizeProvider(value: unknown): string {
  const provider = normalizeString(value, 'provider', { required: true, max: 64 })!.toLowerCase();
  if (!/^[a-z][a-z0-9._-]*$/u.test(provider)) {
    fail('validation_error', 'provider has an invalid format', 400, { field: 'provider' });
  }
  return provider;
}

function normalizeBinding(value: unknown): OrganizationConnectionBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('validation_error', 'binding is required', 400, { field: 'binding' });
  }
  const binding = value as Record<string, unknown>;
  return {
    tenantId: normalizeString(binding.tenantId, 'binding.tenantId', {
      required: true,
      max: 256,
    })!,
    personId: normalizeString(binding.personId, 'binding.personId', {
      required: true,
      max: 256,
    })!,
  };
}

function normalizeState(value: unknown): string {
  return normalizeString(value, 'state', { required: true, max: 512 })!;
}

function normalizeCode(value: unknown): string {
  return normalizeString(value, 'code', { required: true, max: MAX_CODE_LENGTH })!;
}

function normalizeConnectionId(value: unknown): string | null {
  return normalizeString(value, 'connectionId', { max: MAX_CONNECTION_ID_LENGTH });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeIntentValue(value: unknown, path: string, depth: number): unknown {
  if (depth > 5) {
    fail('validation_error', 'intent is too deeply nested', 400, { field: 'intent' });
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('validation_error', 'intent contains a non-finite number', 400, { field: path });
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => sanitizeIntentValue(entry, `${path}[${index}]`, depth + 1));
  }
  if (!isPlainRecord(value)) {
    fail('validation_error', 'intent contains an unsupported value', 400, { field: path });
  }
  const sanitized: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      fail('validation_error', 'intent contains a sensitive field', 400, { field: path });
    }
    sanitized[key] = sanitizeIntentValue(entry, `${path}.${key}`, depth + 1);
  }
  return sanitized;
}

function normalizeIntent(value: unknown): OrganizationConnectionIntent {
  const candidate = value == null ? {} : sanitizeIntentValue(value, 'intent', 0);
  if (!isPlainRecord(candidate)) {
    fail('validation_error', 'intent must be an object', 400, { field: 'intent' });
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(candidate);
  } catch {
    fail('validation_error', 'intent is not serializable', 400, { field: 'intent' });
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_INTENT_BYTES) {
    fail('validation_error', 'intent exceeds the maximum size', 400, {
      field: 'intent',
      maxBytes: MAX_INTENT_BYTES,
    });
  }
  return candidate;
}

function toIsoDate(value: Date, field: string): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    fail('connection_clock_invalid', 'Connection clock returned an invalid date', 503, { field });
  }
  return value.toISOString();
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function hashState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}

function sameBinding(left: OrganizationConnectionBinding, right: OrganizationConnectionBinding): boolean {
  return left.tenantId === right.tenantId && left.personId === right.personId;
}

function isSensitiveKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

function assertNoSensitiveFields(value: unknown, depth = 0): void {
  if (depth > 5 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) assertNoSensitiveFields(entry, depth + 1);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      fail('connection_provider_response_invalid', 'Provider response contains a sensitive field', 502);
    }
    assertNoSensitiveFields(entry, depth + 1);
  }
}

function normalizeOptionalDate(value: unknown, field: string): string | null | undefined {
  if (value == null) return value === null ? null : undefined;
  const date = new Date(normalizeString(value, field, { required: true })!);
  if (Number.isNaN(date.getTime())) {
    fail('connection_provider_response_invalid', 'Provider response contains an invalid date', 502, { field });
  }
  return date.toISOString();
}

function normalizeReadback(
  value: unknown,
  expectedProvider: string,
): OrganizationConnectionReadback {
  if (!isPlainRecord(value)) {
    fail('connection_provider_response_invalid', 'Provider response is invalid', 502);
  }
  assertNoSensitiveFields(value);
  const provider = normalizeProvider(value.provider);
  if (provider !== expectedProvider) {
    fail('connection_provider_response_invalid', 'Provider response does not match the request', 502);
  }
  const connectionId = normalizeString(value.connectionId, 'connectionId', {
    required: true,
    max: MAX_CONNECTION_ID_LENGTH,
  })!;
  const status = normalizeString(value.status, 'status', { required: true, max: 32 });
  if (!['active', 'pending', 'disconnected', 'error'].includes(status!)) {
    fail('connection_provider_response_invalid', 'Provider response contains an invalid status', 502, {
      field: 'status',
    });
  }
  const displayName = normalizeString(value.displayName, 'displayName', { max: 200 });
  const externalId = normalizeString(value.externalId, 'externalId', { max: 500 });
  let scopes: string[] | undefined;
  if (value.scopes !== undefined) {
    if (!Array.isArray(value.scopes)) {
      fail('connection_provider_response_invalid', 'Provider response contains invalid scopes', 502, {
        field: 'scopes',
      });
    }
    scopes = value.scopes.map((scope, index) => normalizeString(scope, `scopes[${index}]`, {
      required: true,
      max: 200,
    })!);
  }
  return {
    provider,
    connectionId,
    status: status as OrganizationConnectionStatus,
    ...(displayName !== undefined ? { displayName } : {}),
    ...(externalId !== undefined ? { externalId } : {}),
    ...(scopes !== undefined ? { scopes } : {}),
    ...(value.connectedAt !== undefined
      ? { connectedAt: normalizeOptionalDate(value.connectedAt, 'connectedAt') }
      : {}),
    ...(value.updatedAt !== undefined
      ? { updatedAt: normalizeOptionalDate(value.updatedAt, 'updatedAt') }
      : {}),
  };
}

function normalizeAuthorizationUrl(value: unknown): string {
  if (typeof value !== 'string') {
    fail('connection_provider_response_invalid', 'Provider response is invalid', 502);
  }
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || /[\u0000-\u001f\u007f]/u.test(normalized) ||
      normalized.length > MAX_AUTHORIZATION_URL_LENGTH) {
    fail('connection_provider_response_invalid', 'Provider response is invalid', 502);
  }
  return normalized;
}

function normalizeTtl(value: number | undefined): number {
  const ttl = value ?? DEFAULT_STATE_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_STATE_TTL_SECONDS) {
    fail('validation_error', 'stateTtlSeconds is outside the supported range', 400, {
      field: 'stateTtlSeconds',
      min: 1,
      max: MAX_STATE_TTL_SECONDS,
    });
  }
  return ttl;
}

export class OrganizationConnectionService {
  private readonly stateRepository: OrganizationConnectionStateRepository;
  private readonly providerAdapter: OrganizationConnectionProviderAdapter;
  private readonly policy?: OrganizationConnectionPolicy;
  private readonly audit?: OrganizationConnectionAudit;
  private readonly clock: OrganizationConnectionClock;
  private readonly stateTtlSeconds: number;

  constructor(options: OrganizationConnectionServiceOptions) {
    this.stateRepository = options.stateRepository;
    this.providerAdapter = options.providerAdapter;
    this.policy = options.policy;
    this.audit = options.audit;
    this.clock = options.clock ?? (() => new Date());
    this.stateTtlSeconds = normalizeTtl(options.stateTtlSeconds);
  }

  async startAuthorization(
    input: StartOrganizationConnectionInput,
  ): Promise<StartOrganizationConnectionResult> {
    const provider = normalizeProvider(input.provider);
    const binding = normalizeBinding(input.binding);
    const intent = normalizeIntent(input.intent);
    await this.authorize({ action: 'authorize', provider, binding, intent });

    const issuedAtDate = this.clock();
    const issuedAt = toIsoDate(issuedAtDate, 'issuedAt');
    const expiresAt = toIsoDate(addSeconds(issuedAtDate, this.stateTtlSeconds), 'expiresAt');
    const state = randomBytes(32).toString('base64url');
    const stateHash = hashState(state);
    const record: OrganizationConnectionStateRecord = {
      id: `org-connection-state-${stateHash.slice(0, 24)}`,
      stateHash,
      provider,
      binding,
      intent,
      issuedAt,
      expiresAt,
    };

    try {
      await this.stateRepository.save(record);
    } catch {
      fail('connection_state_store_unavailable', 'Connection state store is unavailable', 503);
    }

    let authorizationResult: { authorizationUrl: string };
    try {
      authorizationResult = await this.providerAdapter.createAuthorization({
        provider,
        binding,
        state,
        intent,
      });
    } catch {
      fail('connection_provider_unavailable', 'Connection provider is unavailable', 503);
    }
    const authorizationUrl = normalizeAuthorizationUrl(authorizationResult?.authorizationUrl);

    await this.writeAudit({
      action: 'authorize',
      provider,
      binding,
      stateId: record.id,
      occurredAt: issuedAt,
    });
    return { provider, binding, state, expiresAt, authorizationUrl };
  }

  async completeAuthorization(
    input: CompleteOrganizationConnectionInput,
  ): Promise<CompleteOrganizationConnectionResult> {
    const provider = normalizeProvider(input.provider);
    const binding = normalizeBinding(input.binding);
    const state = normalizeState(input.state);
    const code = normalizeCode(input.code);
    await this.authorize({ action: 'complete', provider, binding });

    const nowDate = this.clock();
    const now = toIsoDate(nowDate, 'now');
    let consumed: OrganizationConnectionStateConsumeResult;
    try {
      consumed = await this.stateRepository.consume({ stateHash: hashState(state), now });
    } catch {
      fail('connection_state_store_unavailable', 'Connection state store is unavailable', 503);
    }
    const consumedStatus = (consumed as { status?: unknown })?.status;
    if (!['missing', 'expired', 'replayed', 'consumed'].includes(String(consumedStatus))) {
      fail('connection_state_store_unavailable', 'Connection state store is unavailable', 503);
    }
    if (consumed.status === 'missing') {
      fail('oauth_state_invalid', 'OAuth state is invalid', 400);
    }
    if (consumed.status === 'expired') {
      fail('oauth_state_expired', 'OAuth state has expired', 400);
    }
    if (consumed.status === 'replayed') {
      fail('oauth_state_replayed', 'OAuth state has already been used', 409);
    }
    const record = consumed.record;
    if (!isPlainRecord(record) || typeof record.provider !== 'string' ||
        !isPlainRecord(record.binding) || typeof consumed.consumedAt !== 'string') {
      fail('connection_state_store_unavailable', 'Connection state store is unavailable', 503);
    }
    if (record.provider !== provider || !sameBinding(record.binding as OrganizationConnectionBinding, binding)) {
      fail('oauth_state_binding_mismatch', 'OAuth state does not match the connection request', 403);
    }

    let providerResult: OrganizationConnectionReadback;
    try {
      providerResult = await this.providerAdapter.exchangeAuthorizationCode({
        provider,
        binding,
        state: record,
        code,
      });
    } catch {
      fail('connection_provider_unavailable', 'Connection provider is unavailable', 503);
    }
    let connection: OrganizationConnectionReadback;
    try {
      connection = normalizeReadback(providerResult, provider);
    } catch (error) {
      if (error instanceof OrganizationConnectionError && error.code === 'connection_provider_response_invalid') {
        throw error;
      }
      fail('connection_provider_response_invalid', 'Provider response is invalid', 502);
    }

    await this.writeAudit({
      action: 'complete',
      provider,
      binding,
      stateId: record.id,
      connectionId: connection.connectionId,
      status: connection.status,
      occurredAt: consumed.consumedAt,
    });
    return { connection, consumedAt: consumed.consumedAt };
  }

  async readConnection(
    input: ReadOrganizationConnectionInput,
  ): Promise<OrganizationConnectionReadback | null> {
    const provider = normalizeProvider(input.provider);
    const binding = normalizeBinding(input.binding);
    const connectionId = normalizeConnectionId(input.connectionId);
    await this.authorize({ action: 'read', provider, binding, connectionId });

    let result: OrganizationConnectionReadback | null;
    try {
      result = await this.providerAdapter.readConnection({ provider, binding, connectionId });
    } catch {
      fail('connection_provider_unavailable', 'Connection provider is unavailable', 503);
    }
    if (result === null) return null;
    let connection: OrganizationConnectionReadback;
    try {
      connection = normalizeReadback(result, provider);
    } catch (error) {
      if (error instanceof OrganizationConnectionError && error.code === 'connection_provider_response_invalid') {
        throw error;
      }
      fail('connection_provider_response_invalid', 'Provider response is invalid', 502);
    }
    if (connectionId && connection.connectionId !== connectionId) {
      fail('connection_provider_response_invalid', 'Provider response does not match the request', 502);
    }
    await this.writeAudit({
      action: 'read',
      provider,
      binding,
      connectionId: connection.connectionId,
      status: connection.status,
      occurredAt: toIsoDate(this.clock(), 'occurredAt'),
    });
    return connection;
  }

  private async authorize(
    request: OrganizationConnectionAuthorizationRequest,
  ): Promise<void> {
    if (!this.policy) return;
    try {
      await this.policy.authorize(request);
    } catch {
      fail('connection_forbidden', 'Connection operation is not authorized', 403);
    }
  }

  private async writeAudit(entry: OrganizationConnectionAuditEntry): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.record(entry);
    } catch {
      fail('connection_audit_unavailable', 'Connection audit is unavailable', 503);
    }
  }
}
