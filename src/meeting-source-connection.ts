import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  registerClient,
  startAuthorization,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import {
  createTactiqTranscriptBudget,
  listMeetings,
  probeTranscript,
  readTranscript,
  type MeetingSourceAccessDetail,
  type MeetingSourceCallTool,
  type MeetingSourceFailure,
  type MeetingSourceFailureReason,
  type MeetingSourceMeeting,
  type MeetingSourceProvider,
  type MeetingSourceSegment,
  type TactiqTranscriptBudget,
  type TactiqTranscriptRead,
} from './meeting-source-reader.js';
import type {
  OrganizationConnectionBinding,
  OrganizationConnectionProviderAdapter,
  OrganizationConnectionReadback,
} from './organization-connection.js';

/**
 * Connections to meeting sources (Plaud, Tactiq) and per-connection sync.
 * Persistence, tenant and owner authorization, scheduling, and the delivery
 * target are ports supplied by the caller (the organization product).
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PROVIDERS: readonly MeetingSourceProvider[] = ['plaud', 'tactiq'];
const CAPABILITIES: readonly MeetingSourceCapability[] = ['meetings:list', 'transcript:read'];
const STATUSES: readonly MeetingSourceConnectionStatus[] = ['pending', 'connected', 'reauth_required', 'disabled', 'revoked'];
const SECRET_KEY_PATTERN = /(?:access|refresh|id)?[_-]?(?:token|secret)|credential|password|private[_-]?key|authorization[_-]?code|client[_-]?secret|code[_-]?verifier/i;
const SECRET_VALUE_PATTERN = /^\s*bearer\s|^eyJ[\w-]+\.[\w-]+\.[\w-]+$/i;
const AUTHORIZATION_REQUIRED = 'OAuth authorization is required';

// ---------------------------------------------------------------------------
// Connection record (AC-01)

export type MeetingSourceCapability = 'meetings:list' | 'transcript:read';
export type MeetingSourceConnectionStatus = 'pending' | 'connected' | 'reauth_required' | 'disabled' | 'revoked';

export interface MeetingSourceConnectionRecord {
  /** Issued by Brainbase. An external connection platform's ID lives only in `backend.ref`. */
  connectionId: string;
  tenantId: string;
  provider: MeetingSourceProvider;
  scope: 'personal' | 'org';
  ownerPersonId: string | null;
  orgId: string | null;
  backend: { kind: string; ref: Record<string, string> | null };
  capabilities: MeetingSourceCapability[];
  status: MeetingSourceConnectionStatus;
  revision: number;
  lastVerifiedAt: string | null;
}

export class MeetingSourceConnectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MeetingSourceConnectionError';
    this.code = code;
  }
}

export function createMeetingSourceConnectionId(): string {
  return `msc_${randomBytes(16).toString('hex')}`;
}

export function normalizeMeetingSourceConnectionRecord(value: unknown): MeetingSourceConnectionRecord {
  const record = asRecord(value);
  if (!record) throw invalid('connection record must be an object');
  const connectionId = requiredString(record.connectionId, 'connectionId');
  if (!/^msc_[0-9a-f]{32}$/.test(connectionId)) throw invalid('connectionId must be issued by Brainbase (msc_…)');
  const provider = record.provider;
  if (!PROVIDERS.includes(provider as MeetingSourceProvider)) throw invalid('provider must be plaud or tactiq');
  const scope = record.scope;
  if (scope !== 'personal' && scope !== 'org') throw invalid('scope must be personal or org');
  const ownerPersonId = optionalString(record.ownerPersonId, 'ownerPersonId');
  const orgId = optionalString(record.orgId, 'orgId');
  if (scope === 'personal' && !ownerPersonId) throw invalid('a personal connection needs ownerPersonId');
  if (scope === 'org' && !orgId) throw invalid('an org connection needs orgId');
  const backend = asRecord(record.backend);
  if (!backend) throw invalid('backend must be an object');
  const kind = requiredString(backend.kind, 'backend.kind');
  let ref: Record<string, string> | null = null;
  if (backend.ref !== null && backend.ref !== undefined) {
    const raw = asRecord(backend.ref);
    if (!raw) throw invalid('backend.ref must be an object');
    ref = {};
    for (const [key, entry] of Object.entries(raw)) {
      if (SECRET_KEY_PATTERN.test(key)) throw invalid(`backend.ref.${key} looks like a secret`);
      if (typeof entry !== 'string') throw invalid(`backend.ref.${key} must be a string`);
      if (SECRET_VALUE_PATTERN.test(entry)) throw invalid(`backend.ref.${key} looks like a secret`);
      ref[key] = entry;
    }
  }
  const capabilities = Array.isArray(record.capabilities) ? record.capabilities : [];
  for (const capability of capabilities) {
    if (!CAPABILITIES.includes(capability as MeetingSourceCapability)) throw invalid(`unknown capability ${String(capability)}`);
  }
  const status = record.status;
  if (!STATUSES.includes(status as MeetingSourceConnectionStatus)) throw invalid('unknown connection status');
  const revision = record.revision;
  if (!Number.isInteger(revision) || (revision as number) < 0) throw invalid('revision must be a non-negative integer');
  return {
    connectionId,
    tenantId: requiredString(record.tenantId, 'tenantId'),
    provider: provider as MeetingSourceProvider,
    scope,
    ownerPersonId,
    orgId,
    backend: { kind, ref },
    capabilities: [...new Set(capabilities as MeetingSourceCapability[])],
    status: status as MeetingSourceConnectionStatus,
    revision: revision as number,
    lastVerifiedAt: optionalString(record.lastVerifiedAt, 'lastVerifiedAt'),
  };
}

// ---------------------------------------------------------------------------
// Credential port (AC-02, AC-09)

export interface StoredMeetingSourceCredentials {
  provider: MeetingSourceProvider;
  binding: OrganizationConnectionBinding;
  serverUrl: string;
  clientInformation: OAuthClientInformationMixed;
  tokens: OAuthTokens | null;
  connectedAt: string;
}

export interface PendingMcpAuthorization {
  provider: MeetingSourceProvider;
  binding: OrganizationConnectionBinding;
  serverUrl: string;
  authorizationServerUrl: string;
  authorizationServerMetadata: AuthorizationServerMetadata | null;
  clientInformation: OAuthClientInformationMixed;
  codeVerifier: string;
  redirectUrl: string;
  resource: string | null;
  createdAt: string;
}

export interface MeetingSourceCredentialStore {
  read(connectionId: string): Promise<StoredMeetingSourceCredentials | null>;
  write(connectionId: string, value: StoredMeetingSourceCredentials): Promise<void>;
  remove(connectionId: string): Promise<void>;
  savePendingAuthorization(stateHash: string, value: PendingMcpAuthorization): Promise<void>;
  /** Returns the pending authorization once and forgets it. */
  takePendingAuthorization(stateHash: string): Promise<PendingMcpAuthorization | null>;
}

interface CredentialFile {
  version: 2;
  connections: Record<string, StoredMeetingSourceCredentials>;
  pending: Record<string, PendingMcpAuthorization>;
}

function emptyCredentialFile(): CredentialFile {
  return { version: 2, connections: {}, pending: {} };
}

export class MemoryMeetingSourceCredentialStore implements MeetingSourceCredentialStore {
  private data = emptyCredentialFile();

  async read(connectionId: string) {
    const value = this.data.connections[connectionId];
    return value ? structuredClone(value) : null;
  }

  async write(connectionId: string, value: StoredMeetingSourceCredentials) {
    this.data.connections[connectionId] = structuredClone(value);
  }

  async remove(connectionId: string) {
    delete this.data.connections[connectionId];
  }

  async savePendingAuthorization(stateHash: string, value: PendingMcpAuthorization) {
    this.data.pending[stateHash] = structuredClone(value);
  }

  async takePendingAuthorization(stateHash: string) {
    const value = this.data.pending[stateHash];
    delete this.data.pending[stateHash];
    return value ? structuredClone(value) : null;
  }
}

/**
 * One JSON file (mode 0600) holding credentials per connection ID. Writes go
 * through a temporary file and a rename. Calls are serialized in-process.
 */
export class FileMeetingSourceCredentialStore implements MeetingSourceCredentialStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  read(connectionId: string) {
    return this.run(async (data) => data.connections[connectionId] ?? null);
  }

  write(connectionId: string, value: StoredMeetingSourceCredentials) {
    return this.mutate((data) => {
      data.connections[connectionId] = value;
    });
  }

  remove(connectionId: string) {
    return this.mutate((data) => {
      delete data.connections[connectionId];
    });
  }

  savePendingAuthorization(stateHash: string, value: PendingMcpAuthorization) {
    return this.mutate((data) => {
      data.pending[stateHash] = value;
    });
  }

  takePendingAuthorization(stateHash: string) {
    return this.run(async (data) => {
      const value = data.pending[stateHash] ?? null;
      if (value) {
        delete data.pending[stateHash];
        await this.save(data);
      }
      return value;
    });
  }

  private mutate(change: (data: CredentialFile) => void): Promise<void> {
    return this.run(async (data) => {
      change(data);
      await this.save(data);
    });
  }

  private run<T>(task: (data: CredentialFile) => Promise<T>): Promise<T> {
    const next = this.queue.then(async () => task(await this.load()));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async load(): Promise<CredentialFile> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyCredentialFile();
      throw error;
    }
    const parsed = asRecord(JSON.parse(text));
    if (!parsed || parsed.version !== 2) {
      throw new MeetingSourceConnectionError('credential_store_invalid', 'Meeting source credential file has an unknown format');
    }
    return {
      version: 2,
      connections: (asRecord(parsed.connections) ?? {}) as CredentialFile['connections'],
      pending: (asRecord(parsed.pending) ?? {}) as CredentialFile['pending'],
    };
  }

  private async save(data: CredentialFile) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}

// ---------------------------------------------------------------------------
// Connection runtime (AC-02, AC-03)

export interface MeetingSourceConnectionNote {
  capability: MeetingSourceCapability;
  reason: MeetingSourceFailureReason | 'no_meetings';
  message: string;
  access?: MeetingSourceAccessDetail;
}

export interface MeetingSourceConnectionHealth {
  status: 'connected' | 'reauth_required' | 'error';
  capabilities: MeetingSourceCapability[];
  checkedAt: string;
  failure: MeetingSourceFailure | null;
  notes: MeetingSourceConnectionNote[];
}

export interface ConnectionRuntime {
  verify(connection: MeetingSourceConnectionRecord, options?: { budget?: TactiqTranscriptBudget }): Promise<MeetingSourceConnectionHealth>;
  callTool(connection: MeetingSourceConnectionRecord, tool: string, args: Record<string, unknown>): Promise<unknown>;
  disconnect(connection: MeetingSourceConnectionRecord): Promise<void>;
}

/**
 * Checks that a connection can actually list meetings and read the first page
 * of a full transcript. Shared by every runtime so the result does not depend
 * on how the connection is executed.
 */
export async function probeMeetingSourceConnection(input: {
  provider: MeetingSourceProvider;
  callTool: MeetingSourceCallTool;
  budget?: TactiqTranscriptBudget;
  now?: () => Date;
  lookbackMs?: number;
}): Promise<MeetingSourceConnectionHealth> {
  const now = input.now ?? (() => new Date());
  const checked = now();
  const listed = await listMeetings({
    provider: input.provider,
    callTool: input.callTool,
    since: new Date(checked.getTime() - (input.lookbackMs ?? 30 * DAY_MS)).toISOString(),
    until: checked.toISOString(),
    now,
  });
  const checkedAt = checked.toISOString();
  if (listed.status === 'failed') {
    return {
      status: listed.failure.reason === 'reauth_required' ? 'reauth_required' : 'error',
      capabilities: [],
      checkedAt,
      failure: listed.failure,
      notes: [],
    };
  }
  const capabilities: MeetingSourceCapability[] = ['meetings:list'];
  const notes: MeetingSourceConnectionNote[] = [];
  const newest = newestFirst(listed.meetings)[0];
  if (!newest) {
    notes.push({ capability: 'transcript:read', reason: 'no_meetings', message: 'No meeting in the checked period to read a transcript from' });
  } else {
    const probe = await probeTranscript({
      provider: input.provider,
      callTool: input.callTool,
      meetingId: newest.externalId,
      budget: input.budget,
      now,
    });
    if (probe.status === 'readable') {
      capabilities.push('transcript:read');
    } else {
      notes.push({
        capability: 'transcript:read',
        reason: probe.failure.reason,
        message: probe.failure.message,
        ...(probe.failure.access ? { access: probe.failure.access } : {}),
      });
    }
  }
  return { status: 'connected', capabilities, checkedAt, failure: null, notes };
}

export interface NativeMcpRuntimeOptions {
  credentials: MeetingSourceCredentialStore;
  /** MCP server URL per provider, used when the stored credentials have none. */
  serverUrlFor?: (provider: MeetingSourceProvider) => string;
  /** Replaces the Streamable HTTP transport, e.g. for tests. */
  createTransport?: (input: { url: URL; authProvider: OAuthClientProvider; connection: MeetingSourceConnectionRecord }) => Transport;
  clientName?: string;
  now?: () => Date;
}

/** Runs MCP tools with the SDK client, reading credentials through the credential port. */
export class NativeMcpRuntime implements ConnectionRuntime {
  private readonly options: NativeMcpRuntimeOptions;

  constructor(options: NativeMcpRuntimeOptions) {
    this.options = options;
  }

  async verify(connection: MeetingSourceConnectionRecord, options: { budget?: TactiqTranscriptBudget } = {}) {
    return probeMeetingSourceConnection({
      provider: connection.provider,
      callTool: (name, args) => this.callTool(connection, name, args),
      budget: options.budget,
      now: this.options.now,
    });
  }

  async callTool(connection: MeetingSourceConnectionRecord, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const stored = await this.options.credentials.read(connection.connectionId);
    if (!stored || !stored.tokens) {
      throw new MeetingSourceConnectionError('reauth_required', `${connection.provider} ${AUTHORIZATION_REQUIRED}`);
    }
    if (stored.provider !== connection.provider) {
      throw new MeetingSourceConnectionError('connection_mismatch', 'Stored credentials belong to another provider');
    }
    const serverUrl = stored.serverUrl || this.options.serverUrlFor?.(connection.provider);
    if (!serverUrl) throw new MeetingSourceConnectionError('server_url_missing', `${connection.provider} MCP server URL is not configured`);
    const secrets = secretValues(stored);
    const authProvider = new ConnectionOAuthProvider(this.options.credentials, connection);
    const url = new URL(serverUrl);
    const transport = this.options.createTransport
      ? this.options.createTransport({ url, authProvider, connection })
      : new StreamableHTTPClientTransport(url, { authProvider });
    const client = new Client({ name: this.options.clientName ?? 'brainbase-meeting-source', version: '1.0.0' });
    try {
      await client.connect(transport);
      return await client.callTool({ name: tool, arguments: args });
    } catch (error) {
      throw redactError(error, [...secrets, ...secretValues(await this.options.credentials.read(connection.connectionId))]);
    } finally {
      await Promise.resolve(client.close()).catch(() => undefined);
    }
  }

  async disconnect(connection: MeetingSourceConnectionRecord) {
    await this.options.credentials.remove(connection.connectionId);
  }
}

/** The SDK's OAuth provider for one connection. It never starts an interactive authorization. */
class ConnectionOAuthProvider implements OAuthClientProvider {
  constructor(
    private readonly store: MeetingSourceCredentialStore,
    private readonly connection: MeetingSourceConnectionRecord,
  ) {}

  get redirectUrl(): string | undefined {
    return undefined;
  }

  get clientMetadata(): OAuthClientMetadata {
    return { redirect_uris: [], client_name: 'Brainbase Meeting Source' };
  }

  async clientInformation() {
    return (await this.store.read(this.connection.connectionId))?.clientInformation;
  }

  async tokens() {
    return (await this.store.read(this.connection.connectionId))?.tokens ?? undefined;
  }

  async saveTokens(tokens: OAuthTokens) {
    const stored = await this.store.read(this.connection.connectionId);
    if (!stored) throw new MeetingSourceConnectionError('reauth_required', `${this.connection.provider} ${AUTHORIZATION_REQUIRED}`);
    await this.store.write(this.connection.connectionId, { ...stored, tokens });
  }

  redirectToAuthorization(): void {
    throw new MeetingSourceConnectionError('reauth_required', `${this.connection.provider} ${AUTHORIZATION_REQUIRED}`);
  }

  saveCodeVerifier(): void {
    throw new MeetingSourceConnectionError('reauth_required', `${this.connection.provider} ${AUTHORIZATION_REQUIRED}`);
  }

  codeVerifier(): string {
    throw new MeetingSourceConnectionError('reauth_required', `${this.connection.provider} ${AUTHORIZATION_REQUIRED}`);
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope !== 'all' && scope !== 'tokens') return;
    const stored = await this.store.read(this.connection.connectionId);
    if (stored) await this.store.write(this.connection.connectionId, { ...stored, tokens: null });
  }
}

function secretValues(stored: StoredMeetingSourceCredentials | null): string[] {
  if (!stored) return [];
  const client = stored.clientInformation as { client_secret?: unknown };
  return [stored.tokens?.access_token, stored.tokens?.refresh_token, client.client_secret]
    .filter((value): value is string => typeof value === 'string' && value.length >= 8);
}

function redactError(error: unknown, secrets: string[]): Error {
  const message = error instanceof Error ? error.message : String(error);
  let safe = message.replace(/bearer\s+[\w.~+/=-]+/gi, 'Bearer [redacted]');
  for (const secret of secrets) safe = safe.split(secret).join('[redacted]');
  const code = error instanceof MeetingSourceConnectionError ? error.code : 'provider_call_failed';
  return new MeetingSourceConnectionError(code, safe);
}

// ---------------------------------------------------------------------------
// Per-connection sync (AC-04 … AC-08)

export interface MeetingSourcePendingMeeting {
  meeting: MeetingSourceMeeting;
  reason: MeetingSourceFailureReason | 'delivery_failed';
  message: string;
  retryAt: string | null;
  attempts: number;
  firstSeenAt: string;
}

export interface MeetingSourceDeliveredMeeting {
  digest: string;
  version: number;
  deliveredAt: string;
}

export interface MeetingSourceSyncState {
  schemaVersion: 1;
  connectionId: string;
  provider: MeetingSourceProvider;
  syncEnabled: boolean;
  listedThrough: string | null;
  pending: MeetingSourcePendingMeeting[];
  unobtainable: Array<{ meetingId: string; reason: string; message: string; decidedAt: string }>;
  delivered: Record<string, MeetingSourceDeliveredMeeting>;
  tactiqReads: TactiqTranscriptRead[];
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: { reason: string; message: string; at: string } | null;
}

export interface MeetingSourceSyncStateStore {
  load(connectionId: string): Promise<MeetingSourceSyncState | null>;
  save(state: MeetingSourceSyncState): Promise<void>;
}

export interface MeetingSourceDelivery {
  connectionId: string;
  tenantId: string;
  provider: MeetingSourceProvider;
  scope: 'personal' | 'org';
  ownerPersonId: string | null;
  orgId: string | null;
  meeting: MeetingSourceMeeting;
  transcript: { text: string; segments: MeetingSourceSegment[]; digest: string };
  version: number;
  retrievedAt: string;
}

export type MeetingSourceDeliver = (delivery: MeetingSourceDelivery) => Promise<void>;

export interface MeetingSourceSyncResult {
  status: 'ok' | 'failed' | 'skipped';
  skippedReason?: 'not_connected' | 'sync_disabled';
  delivered: Array<{ meetingId: string; version: number }>;
  pending: number;
  failure: { reason: string; message: string } | null;
  state: MeetingSourceSyncState;
}

export function emptyMeetingSourceSyncState(connection: MeetingSourceConnectionRecord): MeetingSourceSyncState {
  return {
    schemaVersion: 1,
    connectionId: connection.connectionId,
    provider: connection.provider,
    syncEnabled: true,
    listedThrough: null,
    pending: [],
    unobtainable: [],
    delivered: {},
    tactiqReads: [],
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
  };
}

export class MemoryMeetingSourceSyncStateStore implements MeetingSourceSyncStateStore {
  private readonly states = new Map<string, MeetingSourceSyncState>();

  async load(connectionId: string) {
    const state = this.states.get(connectionId);
    return state ? structuredClone(state) : null;
  }

  async save(state: MeetingSourceSyncState) {
    this.states.set(state.connectionId, structuredClone(state));
  }
}

const NON_FAILURE_REASONS = new Set<string>(['not_ready', 'access_required', 'rate_limited']);

export async function syncMeetingSourceConnection(input: {
  connection: MeetingSourceConnectionRecord;
  runtime: ConnectionRuntime;
  stateStore: MeetingSourceSyncStateStore;
  deliver: MeetingSourceDeliver;
  /** Re-fetch a past period. Does not move `listedThrough`. */
  window?: { since: string; until: string };
  recheckDelivered?: boolean;
  now?: () => Date;
  initialLookbackMs?: number;
  overlapMs?: number;
  maxAttempts?: number;
}): Promise<MeetingSourceSyncResult> {
  const { connection } = input;
  const now = input.now ?? (() => new Date());
  const stored = await input.stateStore.load(connection.connectionId);
  if (stored && (stored.connectionId !== connection.connectionId || stored.provider !== connection.provider)) {
    throw new MeetingSourceConnectionError('sync_state_mismatch', 'Sync state belongs to another connection');
  }
  const state = stored ?? emptyMeetingSourceSyncState(connection);
  if (connection.status !== 'connected') {
    return { status: 'skipped', skippedReason: 'not_connected', delivered: [], pending: state.pending.length, failure: null, state };
  }
  if (!state.syncEnabled) {
    return { status: 'skipped', skippedReason: 'sync_disabled', delivered: [], pending: state.pending.length, failure: null, state };
  }

  const started = now();
  state.lastAttemptAt = started.toISOString();
  const callTool: MeetingSourceCallTool = (name, args) => input.runtime.callTool(connection, name, args);
  const until = input.window ? input.window.until : started.toISOString();
  const since = input.window
    ? input.window.since
    : state.listedThrough
      ? new Date(Date.parse(state.listedThrough) - (input.overlapMs ?? DAY_MS)).toISOString()
      : new Date(started.getTime() - (input.initialLookbackMs ?? 7 * DAY_MS)).toISOString();

  const finish = async (failure: { reason: string; message: string } | null, delivered: MeetingSourceSyncResult['delivered']) => {
    if (failure) {
      state.lastError = { ...failure, at: now().toISOString() };
    } else {
      state.lastError = null;
      state.lastSuccessAt = now().toISOString();
    }
    await input.stateStore.save(state);
    return { status: failure ? 'failed' as const : 'ok' as const, delivered, pending: state.pending.length, failure, state };
  };

  const listed = await listMeetings({ provider: connection.provider, callTool, since, until, now });
  if (listed.status === 'failed') return finish({ reason: listed.failure.reason, message: listed.failure.message }, []);

  const pendingById = new Map(state.pending.map((entry) => [entry.meeting.externalId, entry]));
  const unobtainable = new Set(state.unobtainable.map((entry) => entry.meetingId));
  const currentTime = started.getTime();
  const notYetDue = (meetingId: string) => {
    const retryAt = pendingById.get(meetingId)?.retryAt;
    return Boolean(retryAt && Date.parse(retryAt) > currentTime);
  };
  // Meetings already pending and not yet due stay in the pending list untouched.
  const candidates = new Map<string, MeetingSourceMeeting>();
  for (const meeting of listed.meetings) {
    if (unobtainable.has(meeting.externalId) || notYetDue(meeting.externalId)) continue;
    if (state.delivered[meeting.externalId] && !input.recheckDelivered) continue;
    candidates.set(meeting.externalId, meeting);
  }
  for (const entry of state.pending) {
    if (notYetDue(entry.meeting.externalId)) continue;
    if (!candidates.has(entry.meeting.externalId)) candidates.set(entry.meeting.externalId, entry.meeting);
  }

  const budget = connection.provider === 'tactiq' ? createTactiqTranscriptBudget({ reads: state.tactiqReads }) : undefined;
  const delivered: MeetingSourceSyncResult['delivered'] = [];
  let failure: { reason: string; message: string } | null = null;
  const queue = newestFirst([...candidates.values()]);

  const keepPending = (meeting: MeetingSourceMeeting, reason: MeetingSourcePendingMeeting['reason'], message: string, retryAt: string | null, countAttempt: boolean) => {
    const previous = pendingById.get(meeting.externalId);
    const attempts = (previous?.attempts ?? 0) + (countAttempt ? 1 : 0);
    if (countAttempt && attempts >= (input.maxAttempts ?? 5)) {
      pendingById.delete(meeting.externalId);
      state.unobtainable.push({ meetingId: meeting.externalId, reason, message, decidedAt: now().toISOString() });
      return;
    }
    pendingById.set(meeting.externalId, {
      meeting,
      reason,
      message,
      retryAt,
      attempts,
      firstSeenAt: previous?.firstSeenAt ?? now().toISOString(),
    });
  };

  for (let index = 0; index < queue.length; index += 1) {
    const meeting = queue[index];
    if (budget) {
      const slot = budget.tryAcquire(meeting.externalId, now());
      if (!slot.ok) {
        for (const rest of queue.slice(index)) {
          keepPending(rest, 'rate_limited', 'Tactiq transcript read limit reached for this hour', slot.retryAt, false);
        }
        break;
      }
    }
    const result = await readTranscript({ provider: connection.provider, callTool, meetingId: meeting.externalId, budget, now });
    if (result.status === 'unavailable') {
      const { reason, scope, message, retryAt } = result.failure;
      const isFailure = !NON_FAILURE_REASONS.has(reason);
      if (scope === 'connection') {
        for (const rest of queue.slice(index)) keepPending(rest, reason, message, retryAt, false);
        failure = { reason, message };
        break;
      }
      keepPending(meeting, reason, message, retryAt, isFailure);
      if (isFailure) failure ??= { reason, message };
      continue;
    }
    const previous = state.delivered[meeting.externalId];
    if (previous?.digest === result.digest) {
      pendingById.delete(meeting.externalId);
      continue;
    }
    const version = (previous?.version ?? 0) + 1;
    try {
      await input.deliver({
        connectionId: connection.connectionId,
        tenantId: connection.tenantId,
        provider: connection.provider,
        scope: connection.scope,
        ownerPersonId: connection.ownerPersonId,
        orgId: connection.orgId,
        meeting,
        transcript: { text: result.text, segments: result.segments, digest: result.digest },
        version,
        retrievedAt: now().toISOString(),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      keepPending(meeting, 'delivery_failed', message, null, true);
      failure ??= { reason: 'delivery_failed', message };
      continue;
    }
    state.delivered[meeting.externalId] = { digest: result.digest, version, deliveredAt: now().toISOString() };
    pendingById.delete(meeting.externalId);
    delivered.push({ meetingId: meeting.externalId, version });
  }

  state.pending = [...pendingById.values()];
  if (budget) state.tactiqReads = budget.reads(now());
  if (!listed.complete) {
    failure ??= { reason: 'incomplete', message: 'The meeting list could not be read completely for the period' };
  } else if (!input.window && (!state.listedThrough || Date.parse(until) > Date.parse(state.listedThrough))) {
    state.listedThrough = until;
  }
  return finish(failure, delivered);
}

// ---------------------------------------------------------------------------
// Same meeting recorded by different providers (AC-06)

export interface MeetingSourceListedMeeting {
  connection: MeetingSourceConnectionRecord;
  meeting: MeetingSourceMeeting;
}

export interface SameMeetingCandidate {
  first: MeetingSourceListedMeeting;
  second: MeetingSourceListedMeeting;
  sharedParticipants: string[];
}

/**
 * Suggests pairs that may be the same meeting. Only meetings of the same tenant
 * and the same owner are compared; nothing is merged automatically.
 */
export function findSameMeetingCandidates(entries: readonly MeetingSourceListedMeeting[], options: { toleranceMs?: number } = {}): SameMeetingCandidate[] {
  const tolerance = options.toleranceMs ?? 5 * 60 * 1000;
  const candidates: SameMeetingCandidate[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const first = entries[i];
      const second = entries[j];
      if (first.connection.provider === second.connection.provider) continue;
      if (first.connection.tenantId !== second.connection.tenantId) continue;
      if (ownerKey(first.connection) !== ownerKey(second.connection)) continue;
      const a = interval(first.meeting);
      const b = interval(second.meeting);
      if (!a || !b) continue;
      if (a.start > b.end + tolerance || b.start > a.end + tolerance) continue;
      const names = new Set(first.meeting.participants.map(normalizeName));
      const sharedParticipants = second.meeting.participants.filter((name) => names.has(normalizeName(name)));
      candidates.push({ first, second, sharedParticipants });
    }
  }
  return candidates;
}

function ownerKey(connection: MeetingSourceConnectionRecord): string {
  return connection.scope === 'personal' ? `person:${connection.ownerPersonId}` : `org:${connection.orgId}`;
}

function interval(meeting: MeetingSourceMeeting): { start: number; end: number } | null {
  const start = meeting.startedAt ? Date.parse(meeting.startedAt) : NaN;
  if (!Number.isFinite(start)) return null;
  return { start, end: start + (meeting.durationSeconds ?? 0) * 1000 };
}

function normalizeName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// MCP OAuth for the organization connection kernel (AC-09)

export interface McpOAuthConnectionAdapterOptions {
  credentials: MeetingSourceCredentialStore;
  serverUrlFor: (provider: MeetingSourceProvider) => string;
  redirectUrl: string;
  clientName?: string;
  /** Overrides the scopes requested. Defaults to the protected resource's `scopes_supported`. */
  scopeFor?: (provider: MeetingSourceProvider, supported: string[] | undefined) => string | undefined;
  fetchFn?: typeof fetch;
  now?: () => Date;
  issueConnectionId?: () => string;
}

/**
 * Implements the provider side of `@unson/brainbase-mcp/organization-connection`
 * for MCP servers: discovery (RFC 9728 / RFC 8414), dynamic client
 * registration, PKCE, and the token exchange. Readbacks never carry tokens.
 */
export function createMcpOAuthConnectionAdapter(options: McpOAuthConnectionAdapterOptions): OrganizationConnectionProviderAdapter {
  const now = options.now ?? (() => new Date());
  const issueConnectionId = options.issueConnectionId ?? createMeetingSourceConnectionId;
  const readback = (connectionId: string, stored: StoredMeetingSourceCredentials): OrganizationConnectionReadback => ({
    provider: stored.provider,
    connectionId,
    // A connection becomes `connected` only after a verification reads meetings.
    status: 'pending',
    connectedAt: stored.connectedAt,
    updatedAt: stored.connectedAt,
  });

  return {
    async createAuthorization({ provider, binding, state }) {
      const meetingProvider = toProvider(provider);
      const serverUrl = options.serverUrlFor(meetingProvider);
      const info = await discoverOAuthServerInfo(serverUrl, { fetchFn: options.fetchFn });
      const metadata = info.authorizationServerMetadata;
      const clientMetadata: OAuthClientMetadata = {
        client_name: options.clientName ?? 'Brainbase Meeting Source',
        redirect_uris: [options.redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };
      const clientInformation = await registerClient(info.authorizationServerUrl, {
        metadata,
        clientMetadata,
        fetchFn: options.fetchFn,
      });
      const supported = info.resourceMetadata?.scopes_supported;
      const scope = options.scopeFor ? options.scopeFor(meetingProvider, supported) : supported?.join(' ') || undefined;
      const resource = info.resourceMetadata?.resource ? new URL(info.resourceMetadata.resource) : undefined;
      const { authorizationUrl, codeVerifier } = await startAuthorization(info.authorizationServerUrl, {
        metadata,
        clientInformation,
        redirectUrl: options.redirectUrl,
        scope,
        state,
        resource,
      });
      await options.credentials.savePendingAuthorization(hashState(state), {
        provider: meetingProvider,
        binding,
        serverUrl,
        authorizationServerUrl: info.authorizationServerUrl,
        authorizationServerMetadata: metadata ?? null,
        clientInformation,
        codeVerifier,
        redirectUrl: options.redirectUrl,
        resource: resource?.toString() ?? null,
        createdAt: now().toISOString(),
      });
      return { authorizationUrl: authorizationUrl.toString() };
    },

    async exchangeAuthorizationCode({ provider, binding, state, code }) {
      const pending = await options.credentials.takePendingAuthorization(state.stateHash);
      if (!pending) throw new MeetingSourceConnectionError('authorization_missing', 'No pending authorization for this state');
      if (pending.provider !== provider || !sameBinding(pending.binding, binding)) {
        throw new MeetingSourceConnectionError('authorization_mismatch', 'The pending authorization belongs to another connection request');
      }
      const tokens = await exchangeAuthorization(pending.authorizationServerUrl, {
        metadata: pending.authorizationServerMetadata ?? undefined,
        clientInformation: pending.clientInformation,
        authorizationCode: code,
        codeVerifier: pending.codeVerifier,
        redirectUri: pending.redirectUrl,
        resource: pending.resource ? new URL(pending.resource) : undefined,
        fetchFn: options.fetchFn,
      });
      const connectionId = issueConnectionId();
      const stored: StoredMeetingSourceCredentials = {
        provider: pending.provider,
        binding: pending.binding,
        serverUrl: pending.serverUrl,
        clientInformation: pending.clientInformation,
        tokens,
        connectedAt: now().toISOString(),
      };
      await options.credentials.write(connectionId, stored);
      return readback(connectionId, stored);
    },

    async readConnection({ provider, binding, connectionId }) {
      if (!connectionId) return null;
      const stored = await options.credentials.read(connectionId);
      if (!stored || stored.provider !== provider || !sameBinding(stored.binding, binding)) return null;
      return readback(connectionId, stored);
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers

function toProvider(value: string): MeetingSourceProvider {
  if (!PROVIDERS.includes(value as MeetingSourceProvider)) {
    throw new MeetingSourceConnectionError('provider_unsupported', `Unsupported meeting source provider: ${value}`);
  }
  return value as MeetingSourceProvider;
}

function hashState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}

function sameBinding(left: OrganizationConnectionBinding, right: OrganizationConnectionBinding): boolean {
  return left.tenantId === right.tenantId && left.personId === right.personId;
}

function newestFirst(meetings: MeetingSourceMeeting[]): MeetingSourceMeeting[] {
  const time = (meeting: MeetingSourceMeeting) => (meeting.startedAt ? Date.parse(meeting.startedAt) : Number.NEGATIVE_INFINITY);
  return [...meetings].sort((a, b) => time(b) - time(a));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${field} is required`);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw invalid(`${field} must be a string`);
  return value.trim() || null;
}

function invalid(message: string): MeetingSourceConnectionError {
  return new MeetingSourceConnectionError('connection_record_invalid', message);
}
