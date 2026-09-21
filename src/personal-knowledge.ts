import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { hostname, userInfo } from 'node:os';
import { chmod, open, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { resolveDataDir } from './paths.js';

/** The context header used by the v1 register and search contracts. */
export const PERSONAL_KNOWLEDGE_CONTEXT_HEADER = 'X-Brainbase-Personal-Context';
export const PERSONAL_KNOWLEDGE_CONTEXT_VERSION_HEADER = 'X-Brainbase-Personal-Context-Version';
/** Short alias retained for consumers that call this a personal context header. */
export const PERSONAL_CONTEXT_HEADER = PERSONAL_KNOWLEDGE_CONTEXT_HEADER;
export const PERSONAL_KNOWLEDGE_CONTRACT_VERSION = 1 as const;
export const PERSONAL_KNOWLEDGE_LOCAL_DIRECTORY = 'personal-knowledge-v1';

export type PersonalKnowledgeScope = 'personal_owned' | 'organization_private';
export type PersonalKnowledgeStorageMode = 'local' | 'managed_cloud';

export interface PersonalKnowledgeContext {
  contract_version: typeof PERSONAL_KNOWLEDGE_CONTRACT_VERSION;
  scope: PersonalKnowledgeScope;
  owner_person_id: string;
  organization_id: string | null;
  source_id: string;
}

export class PersonalKnowledgeContextError extends Error {
  readonly code: string;
  readonly field?: string;

  constructor(message: string, code = 'invalid_personal_knowledge_context', field?: string) {
    super(message);
    this.name = 'PersonalKnowledgeContextError';
    this.code = code;
    this.field = field;
  }
}

const CONTEXT_FIELDS = [
  'contract_version',
  'scope',
  'owner_person_id',
  'organization_id',
  'source_id'
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PersonalKnowledgeContextError(`${field} must be a non-empty string.`, 'invalid_context_field', field);
  }
  return value;
}

/** Validate and return a copy of a strict v1 context object. */
export function validatePersonalKnowledgeContext(value: unknown): PersonalKnowledgeContext {
  if (!isRecord(value)) {
    throw new PersonalKnowledgeContextError('Personal knowledge context must be an object.');
  }
  const unknown = Object.keys(value).filter((key) => !(CONTEXT_FIELDS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    throw new PersonalKnowledgeContextError(
      `Personal knowledge context contains unsupported fields: ${unknown.join(', ')}.`,
      'unsupported_context_fields',
      unknown[0]
    );
  }
  for (const field of CONTEXT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new PersonalKnowledgeContextError(`Personal knowledge context is missing ${field}.`, 'missing_context_field', field);
    }
  }
  if (value.contract_version !== PERSONAL_KNOWLEDGE_CONTRACT_VERSION) {
    throw new PersonalKnowledgeContextError('Personal knowledge context contract_version must be 1.', 'invalid_context_field', 'contract_version');
  }
  if (value.scope !== 'personal_owned' && value.scope !== 'organization_private') {
    throw new PersonalKnowledgeContextError('Personal knowledge context scope is invalid.', 'invalid_context_field', 'scope');
  }
  const owner = nonEmptyString(value.owner_person_id, 'owner_person_id');
  const source = nonEmptyString(value.source_id, 'source_id');
  if (value.scope === 'personal_owned') {
    if (value.organization_id !== null) {
      throw new PersonalKnowledgeContextError(
        'organization_id must be null for personal_owned context.',
        'invalid_context_scope',
        'organization_id'
      );
    }
  } else {
    nonEmptyString(value.organization_id, 'organization_id');
  }
  return {
    contract_version: PERSONAL_KNOWLEDGE_CONTRACT_VERSION,
    scope: value.scope,
    owner_person_id: owner,
    organization_id: value.organization_id as string | null,
    source_id: source
  };
}

export const assertPersonalKnowledgeContext = validatePersonalKnowledgeContext;

function canonicalContextJson(context: PersonalKnowledgeContext): string {
  const validated = validatePersonalKnowledgeContext(context);
  return JSON.stringify({
    contract_version: validated.contract_version,
    scope: validated.scope,
    owner_person_id: validated.owner_person_id,
    organization_id: validated.organization_id,
    source_id: validated.source_id
  });
}

/** Encode a trusted expected context for `X-Brainbase-Personal-Context`. */
export function encodePersonalKnowledgeContextHeader(value: unknown): string {
  const context = validatePersonalKnowledgeContext(value);
  return Buffer.from(canonicalContextJson(context), 'utf8').toString('base64url');
}

export const encodeExpectedPersonalKnowledgeContextHeader = encodePersonalKnowledgeContextHeader;

/** Decode and strictly validate a v1 context header. */
export function decodePersonalKnowledgeContextHeader(value: unknown): PersonalKnowledgeContext {
  if (typeof value !== 'string' || value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new PersonalKnowledgeContextError('Personal knowledge context header must be unpadded base64url.', 'invalid_context_header');
  }
  let decoded: string;
  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8');
    if (!decoded || Buffer.from(value, 'base64url').toString('base64url') !== value) {
      throw new Error('invalid base64url');
    }
  } catch {
    throw new PersonalKnowledgeContextError('Personal knowledge context header is not valid base64url.', 'invalid_context_header');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new PersonalKnowledgeContextError('Personal knowledge context header does not contain JSON.', 'invalid_context_header');
  }
  return validatePersonalKnowledgeContext(parsed);
}

export const decodeExpectedPersonalKnowledgeContextHeader = decodePersonalKnowledgeContextHeader;

/** Assert that two contexts identify exactly the same source of truth. */
export function assertPersonalKnowledgeContextMatch(expected: unknown, actual: unknown): PersonalKnowledgeContext {
  const expectedContext = validatePersonalKnowledgeContext(expected);
  const actualContext = validatePersonalKnowledgeContext(actual);
  for (const field of CONTEXT_FIELDS) {
    if (expectedContext[field] !== actualContext[field]) {
      throw new PersonalKnowledgeContextError(
        `Personal knowledge context mismatch for ${field}.`,
        'personal_knowledge_context_mismatch',
        field
      );
    }
  }
  return actualContext;
}

export interface PersonalKnowledgeEvent {
  event_id: string;
  body: string;
  body_hash: string;
  occurred_at?: string;
  captured_at?: string;
  source?: unknown;
  source_pointer?: unknown;
  parent_episode_id?: string | null;
  permission_snapshot?: Record<string, unknown>;
  sensitivity?: string;
  kind?: string;
  type?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export type PersonalKnowledgeEventInput = Omit<PersonalKnowledgeEvent, 'body_hash'> & {
  body_hash?: string;
  content?: string;
};

const EVENT_FIELDS = new Set([
  'event_id',
  'occurred_at',
  'captured_at',
  'source',
  'source_pointer',
  'body_hash',
  'body',
  'content',
  'parent_episode_id',
  'permission_snapshot',
  'sensitivity',
  'kind',
  'type',
  'tags',
  'metadata'
]);

const FORBIDDEN_EVENT_IDENTITY_FIELDS = new Set([
  'owner_person_id',
  'ownerPersonId',
  'organization_id',
  'organizationId',
  'person_entity_id',
  'company_authority_response',
  'destination',
  'context',
  'source_id',
  'sourceId',
  'dataDir',
  'data_dir',
  'path',
  'storage_path'
]);

const ISO8601_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/;

function eventError(message: string): Error {
  return new Error(`Personal knowledge event ${message}`);
}

function validateOptionalString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw eventError(`${field} must be a non-empty string.`);
  return value;
}

function validateTimestamp(value: unknown, field: string): string {
  const timestamp = validateOptionalString(value, field);
  const match = ISO8601_TIMESTAMP_PATTERN.exec(timestamp);
  if (!match) throw eventError(`${field} must be a valid ISO 8601 timestamp.`);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (
    month < 1 || month > 12 || day < 1 || day > (daysInMonth ?? 0)
    || hour > 23 || minute > 59 || second > 59
    || (zone !== 'Z' && (offsetHour > 23 || offsetMinute > 59))
  ) {
    throw eventError(`${field} must be a valid ISO 8601 timestamp.`);
  }
  return timestamp;
}

function bodyDigest(body: string): string {
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

/** Normalize a caller event without allowing caller-controlled identity fields. */
export function normalizePersonalKnowledgeEvent(value: unknown): PersonalKnowledgeEvent {
  if (!isRecord(value)) throw eventError('must be an object.');
  const forbidden = Object.keys(value).filter((field) => FORBIDDEN_EVENT_IDENTITY_FIELDS.has(field));
  if (forbidden.length > 0) throw eventError(`owner, organization, context, path, and destination fields are authentication-derived: ${forbidden.join(', ')}.`);
  const unknown = Object.keys(value).filter((field) => !EVENT_FIELDS.has(field));
  if (unknown.length > 0) throw eventError(`contains unsupported fields: ${unknown.join(', ')}.`);

  const eventId = validateOptionalString(value.event_id, 'event_id');
  const bodyValue = value.body;
  const contentValue = value.content;
  if (bodyValue !== undefined && typeof bodyValue !== 'string') throw eventError('body must be a string.');
  if (contentValue !== undefined && typeof contentValue !== 'string') throw eventError('content must be a string.');
  if (bodyValue !== undefined && contentValue !== undefined && bodyValue !== contentValue) {
    throw eventError('body and content must match when both are supplied.');
  }
  const body = (bodyValue ?? contentValue) as string | undefined;
  if (typeof body !== 'string' || !body.trim()) throw eventError('body must be a non-empty string.');

  const providedHash = value.body_hash;
  if (providedHash !== undefined && (typeof providedHash !== 'string' || !providedHash.trim())) {
    throw eventError('body_hash must be a non-empty string.');
  }
  const calculatedHash = bodyDigest(body);
  if (providedHash !== undefined && providedHash !== calculatedHash) {
    throw eventError('body_hash does not match the SHA-256 digest of body.');
  }
  if (value.parent_episode_id !== undefined && value.parent_episode_id !== null) {
    validateOptionalString(value.parent_episode_id, 'parent_episode_id');
  }
  for (const field of ['occurred_at', 'captured_at'] as const) {
    if (value[field] !== undefined) validateTimestamp(value[field], field);
  }
  for (const field of ['sensitivity', 'kind', 'type'] as const) {
    if (value[field] !== undefined) validateOptionalString(value[field], field);
  }
  if (value.tags !== undefined && (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== 'string' || !tag.trim()))) {
    throw eventError('tags must be an array of non-empty strings.');
  }
  if (value.permission_snapshot !== undefined && !isRecord(value.permission_snapshot)) {
    throw eventError('permission_snapshot must be an object.');
  }
  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    throw eventError('metadata must be an object.');
  }

  const normalized: PersonalKnowledgeEvent = {
    event_id: eventId,
    body,
    body_hash: calculatedHash
  };
  for (const field of [
    'occurred_at',
    'captured_at',
    'source',
    'source_pointer',
    'parent_episode_id',
    'permission_snapshot',
    'sensitivity',
    'kind',
    'type',
    'tags',
    'metadata'
  ] as const) {
    if (value[field] !== undefined) (normalized as Record<string, unknown>)[field] = value[field];
  }
  return normalized;
}

export function normalizePersonalKnowledgeSearchInput(query: string, limit?: number): { query: string; limit: number } {
  if (typeof query !== 'string' || !query.trim()) throw new Error('Personal knowledge search query must be a non-empty string.');
  if (query.length > 4000) throw new Error('Personal knowledge search query must be at most 4000 characters.');
  const resolvedLimit = limit === undefined ? 10 : limit;
  if (!Number.isInteger(resolvedLimit) || resolvedLimit < 1 || resolvedLimit > 50) {
    throw new Error('Personal knowledge search limit must be an integer between 1 and 50.');
  }
  return { query: query.trim(), limit: resolvedLimit };
}

export interface PersonalKnowledgeContextEnvelope {
  context: PersonalKnowledgeContext;
}

export interface PersonalKnowledgeRegisterEnvelope extends PersonalKnowledgeContextEnvelope {
  event: PersonalKnowledgeEvent;
}

export interface PersonalKnowledgeSearchEnvelope extends PersonalKnowledgeContextEnvelope {
  results: PersonalKnowledgeEvent[];
}

export interface PersonalKnowledgeStore {
  readonly mode: 'local';
  readonly dataDir: string;
  getContext(): Promise<PersonalKnowledgeContextEnvelope>;
  register(event: PersonalKnowledgeEventInput): Promise<PersonalKnowledgeRegisterEnvelope>;
  search(query: string, limit?: number): Promise<PersonalKnowledgeSearchEnvelope>;
}

export interface PersonalKnowledgeStoreOptions {
  /** Parent Personal OS directory. The v1 store always uses a child directory. */
  dataDir?: string;
  /** Trusted context from configuration; never a model-controlled MCP argument. */
  context?: PersonalKnowledgeContext;
  ownerPersonId?: string;
  sourceId?: string;
}

interface LocalStoreState {
  context: PersonalKnowledgeContext;
  events: PersonalKnowledgeEvent[];
}

const LOCAL_LOCK_FILE = '.personal-knowledge.lock';
const LOCAL_CONTEXT_FILE = 'context.json';
const LOCAL_EVENTS_FILE = 'events.jsonl';
const LOCK_TIMEOUT_MS = 30_000;

function ownerFromEnvironment(): string {
  const configured = process.env.BRAINBASE_PERSONAL_KNOWLEDGE_OWNER_PERSON_ID;
  if (configured?.trim()) return configured;
  try {
    return userInfo().username;
  } catch {
    return process.env.USER?.trim() || 'local-owner';
  }
}

function sourceFromEnvironment(): string | undefined {
  const configured = process.env.BRAINBASE_PERSONAL_KNOWLEDGE_SOURCE_ID;
  return configured?.trim() || undefined;
}

function contextForLocalOptions(options: PersonalKnowledgeStoreOptions): { context?: PersonalKnowledgeContext; ownerPersonId?: string; sourceId?: string } {
  if (options.context !== undefined) {
    const context = validatePersonalKnowledgeContext(options.context);
    if (context.scope !== 'personal_owned' || context.organization_id !== null) {
      throw new Error('OSS local Personal Knowledge storage requires a personal_owned context.');
    }
    return { context };
  }
  const ownerPersonId = options.ownerPersonId?.trim() || ownerFromEnvironment();
  if (!ownerPersonId) throw new Error('OSS local Personal Knowledge storage requires an OS owner identity.');
  return { ownerPersonId, sourceId: options.sourceId?.trim() || sourceFromEnvironment() };
}

class LocalPersonalKnowledgeStore implements PersonalKnowledgeStore {
  readonly mode = 'local' as const;
  readonly dataDir: string;
  private readonly requestedContext?: PersonalKnowledgeContext;
  private readonly requestedOwner?: string;
  private readonly requestedSource?: string;

  constructor(options: PersonalKnowledgeStoreOptions = {}) {
    const resolved = contextForLocalOptions(options);
    this.dataDir = join(resolveDataDir(options.dataDir), PERSONAL_KNOWLEDGE_LOCAL_DIRECTORY);
    this.requestedContext = resolved.context;
    this.requestedOwner = resolved.ownerPersonId;
    this.requestedSource = resolved.sourceId;
  }

  async getContext(): Promise<PersonalKnowledgeContextEnvelope> {
    return withFileLock(this.dataDir, async () => {
      const state = await this.ensureState();
      return { context: state.context };
    });
  }

  async register(input: PersonalKnowledgeEventInput): Promise<PersonalKnowledgeRegisterEnvelope> {
    await this.getContext();
    const event = normalizePersonalKnowledgeEvent(input);
    return withFileLock(this.dataDir, async () => {
      const state = await this.ensureState();
      const existing = state.events.find((candidate) => candidate.event_id === event.event_id);
      if (existing) {
        if (canonicalJson(existing) !== canonicalJson(event)) {
          throw new Error(`personal_knowledge_event_identity_conflict: event_id ${event.event_id} already has different content.`);
        }
        return { context: state.context, event: existing };
      }
      const next = [...state.events, event];
      await writeEventsFile(this.dataDir, next);
      return { context: state.context, event };
    });
  }

  async search(query: string, limit?: number): Promise<PersonalKnowledgeSearchEnvelope> {
    await this.getContext();
    const input = normalizePersonalKnowledgeSearchInput(query, limit);
    return withFileLock(this.dataDir, async () => {
      const state = await this.ensureState();
      const needle = input.query.toLocaleLowerCase();
      const results = state.events.filter((event) => canonicalJson(event).toLocaleLowerCase().includes(needle)).slice(0, input.limit);
      return { context: state.context, results };
    });
  }

  private async ensureState(): Promise<LocalStoreState> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await enforcePrivateDirectory(this.dataDir);
    const contextPath = join(this.dataDir, LOCAL_CONTEXT_FILE);
    const eventsPath = join(this.dataDir, LOCAL_EVENTS_FILE);
    const contextExists = await exists(contextPath);
    const eventsExists = await exists(eventsPath);
    if (contextExists !== eventsExists) {
      throw new Error(`Partial Personal Knowledge v1 store in ${this.dataDir}.`);
    }
    let context: PersonalKnowledgeContext;
    let events: PersonalKnowledgeEvent[];
    if (!contextExists) {
      context = this.initialContext();
      await writeFileAtomic(contextPath, `${canonicalContextJson(context)}\n`);
      await writeFileAtomic(eventsPath, '');
      return { context, events: [] };
    }
    context = validatePersonalKnowledgeContext(JSON.parse(await readFile(contextPath, 'utf8')));
    this.assertRequestedContext(context);
    await enforcePrivateFile(contextPath);
    await enforcePrivateFile(eventsPath);
    events = await readEventsFile(eventsPath);
    return { context, events };
  }

  private initialContext(): PersonalKnowledgeContext {
    if (this.requestedContext) return this.requestedContext;
    return validatePersonalKnowledgeContext({
      contract_version: PERSONAL_KNOWLEDGE_CONTRACT_VERSION,
      scope: 'personal_owned',
      owner_person_id: this.requestedOwner,
      organization_id: null,
      source_id: this.requestedSource || `local-${randomUUID()}`
    });
  }

  private assertRequestedContext(actual: PersonalKnowledgeContext): void {
    if (this.requestedContext) {
      assertPersonalKnowledgeContextMatch(this.requestedContext, actual);
      return;
    }
    if (this.requestedOwner && actual.owner_person_id !== this.requestedOwner) {
      throw new PersonalKnowledgeContextError('Persisted local owner does not match the trusted OS owner.', 'personal_knowledge_context_mismatch', 'owner_person_id');
    }
    if (this.requestedSource && actual.source_id !== this.requestedSource) {
      throw new PersonalKnowledgeContextError('Persisted local source does not match the trusted configured source.', 'personal_knowledge_context_mismatch', 'source_id');
    }
  }
}

export function createLocalPersonalKnowledgeStore(options: PersonalKnowledgeStoreOptions = {}): PersonalKnowledgeStore {
  return new LocalPersonalKnowledgeStore(options);
}

export const createPersonalKnowledgeStore = createLocalPersonalKnowledgeStore;

async function readEventsFile(path: string): Promise<PersonalKnowledgeEvent[]> {
  const serialized = await readFile(path, 'utf8');
  const events: PersonalKnowledgeEvent[] = [];
  const ids = new Set<string>();
  for (const [index, line] of serialized.split('\n').entries()) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Invalid Personal Knowledge event at line ${index + 1}.`);
    }
    const event = normalizePersonalKnowledgeEvent(parsed);
    if (ids.has(event.event_id)) throw new Error(`Duplicate Personal Knowledge event_id ${event.event_id}.`);
    ids.add(event.event_id);
    events.push(event);
  }
  return events;
}

async function writeEventsFile(dataDir: string, events: PersonalKnowledgeEvent[]): Promise<void> {
  const content = events.map((event) => `${canonicalJson(event)}\n`).join('');
  await writeFileAtomic(join(dataDir, LOCAL_EVENTS_FILE), content);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function enforcePrivateDirectory(path: string): Promise<void> {
  await chmod(path, 0o700);
}

async function enforcePrivateFile(path: string): Promise<void> {
  await chmod(path, 0o600);
}

async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function withFileLock<T>(dataDir: string, operation: () => Promise<T>): Promise<T> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const lockPath = join(dataDir, LOCAL_LOCK_FILE);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let lock: FileHandle | undefined;
  const token = randomUUID();
  while (!lock) {
    let lockCreated = false;
    try {
      lock = await open(lockPath, 'wx', 0o600);
      lockCreated = true;
      await lock.writeFile(JSON.stringify({ token, pid: process.pid, hostname: hostname(), created_at: new Date().toISOString() }), 'utf8');
      await lock.sync();
    } catch (error) {
      await lock?.close().catch(() => undefined);
      lock = undefined;
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        if (lockCreated) await rm(lockPath, { force: true }).catch(() => undefined);
        throw error;
      }
      if (Date.now() >= deadline) throw new Error(`Timed out acquiring Personal Knowledge lock ${lockPath}.`);
      await delay(10 + Math.floor(Math.random() * 25));
    }
  }
  try {
    return await operation();
  } finally {
    await lock.close().catch(() => undefined);
    await removeOwnedLock(lockPath, token);
  }
}

/** Remove a lock only when its ownership token still belongs to this holder. */
async function removeOwnedLock(lockPath: string, token: string): Promise<void> {
  try {
    const current = JSON.parse(await readFile(lockPath, 'utf8')) as { token?: unknown };
    if (current.token !== token) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    return;
  }
  await rm(lockPath, { force: true }).catch(() => undefined);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export interface PersonalKnowledgeClientOptions {
  mode: PersonalKnowledgeStorageMode;
  apiUrl: string;
  expectedContext: PersonalKnowledgeContext;
  token?: string;
  getToken?: () => Promise<string>;
  tokenManager?: { getToken(): Promise<string> };
  fetch?: FetchLike;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class PersonalKnowledgeClientError extends Error {
  readonly status: number | null;
  readonly responseBody: unknown;

  constructor(message: string, options: { status?: number | null; responseBody?: unknown } = {}) {
    super(message);
    this.name = 'PersonalKnowledgeClientError';
    this.status = options.status ?? null;
    this.responseBody = options.responseBody ?? null;
  }
}

function parseIPv6Words(host: string): number[] | null {
  if (isIP(host) !== 6) return null;
  let normalized = host.toLowerCase();
  if (normalized.includes('.')) {
    const separator = normalized.lastIndexOf(':');
    const ipv4 = normalized.slice(separator + 1);
    if (isIP(ipv4) !== 4) return null;
    const octets = ipv4.split('.').map(Number);
    normalized = `${normalized.slice(0, separator + 1)}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

function isLoopback(host: string): boolean {
  let normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized.endsWith('.')) normalized = normalized.slice(0, -1);
  if (normalized === 'localhost') return true;
  if (isIP(normalized) === 4) return normalized.split('.')[0] === '127';
  const words = parseIPv6Words(normalized);
  if (!words) return false;
  const isIPv6Loopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  if (isIPv6Loopback) return true;
  const isIPv4Mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  return isIPv4Mapped && (words[6]! >> 8) === 0x7f;
}

export function normalizePersonalKnowledgeApiUrl(apiUrl: string, mode: PersonalKnowledgeStorageMode): string {
  if (typeof apiUrl !== 'string' || !apiUrl.trim()) throw new Error('Personal Knowledge API URL is required.');
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new Error('Personal Knowledge API URL must be absolute HTTP(S).');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Personal Knowledge API URL must use HTTP(S).');
  if (url.username || url.password || url.search || url.hash) throw new Error('Personal Knowledge API URL cannot contain credentials, query, or hash.');
  if (mode === 'managed_cloud') {
    if (url.protocol !== 'https:') throw new Error('managed_cloud Personal Knowledge API requires HTTPS.');
    if (isLoopback(url.hostname)) throw new Error('managed_cloud Personal Knowledge API must not use a loopback host.');
  } else if (!isLoopback(url.hostname)) {
    throw new Error('local Personal Knowledge API test client requires a loopback host.');
  }
  url.pathname = url.pathname.replace(/\/+$/u, '');
  return url.toString().replace(/\/$/u, '');
}

export class PersonalKnowledgeClient {
  readonly mode: PersonalKnowledgeStorageMode;
  readonly apiUrl: string;
  readonly expectedContext: PersonalKnowledgeContext;
  private readonly getToken: () => Promise<string>;
  private readonly fetchImpl: FetchLike;

  constructor(options: PersonalKnowledgeClientOptions) {
    if (options.mode !== 'local' && options.mode !== 'managed_cloud') throw new Error('Personal Knowledge storage mode must be local or managed_cloud.');
    this.mode = options.mode;
    this.apiUrl = normalizePersonalKnowledgeApiUrl(options.apiUrl, options.mode);
    this.expectedContext = validatePersonalKnowledgeContext(options.expectedContext);
    if (options.getToken) this.getToken = options.getToken;
    else if (options.tokenManager?.getToken) this.getToken = () => options.tokenManager!.getToken();
    else if (options.token !== undefined) this.getToken = async () => options.token!;
    else throw new Error('Personal Knowledge client requires an authenticated token.');
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async getContext(): Promise<PersonalKnowledgeContextEnvelope> {
    const payload = await this.request('/api/personal-knowledge/context', { method: 'GET' });
    return assertContextEnvelope(payload, this.expectedContext);
  }

  async register(input: PersonalKnowledgeEventInput): Promise<PersonalKnowledgeRegisterEnvelope> {
    await this.getContext();
    const event = normalizePersonalKnowledgeEvent(input);
    const payload = await this.request('/api/personal-knowledge/events', {
      method: 'POST',
      body: event,
      expectedHeader: true
    });
    return assertRegisterEnvelope(payload, this.expectedContext);
  }

  async search(query: string, limit?: number): Promise<PersonalKnowledgeSearchEnvelope> {
    await this.getContext();
    const input = normalizePersonalKnowledgeSearchInput(query, limit);
    const payload = await this.request('/api/personal-knowledge/search', {
      method: 'POST',
      body: input,
      expectedHeader: true
    });
    return assertSearchEnvelope(payload, this.expectedContext);
  }

  private async request(path: string, options: { method: 'GET' | 'POST'; body?: unknown; expectedHeader?: boolean }): Promise<unknown> {
    let token: string;
    try {
      token = await this.getToken();
    } catch (error) {
      throw new PersonalKnowledgeClientError(`Personal Knowledge authentication token retrieval failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof token !== 'string' || !token.trim()) throw new PersonalKnowledgeClientError('Personal Knowledge authentication token is unavailable.');
    const headers = new Headers({
      Authorization: `Bearer ${token}`,
      [PERSONAL_KNOWLEDGE_CONTEXT_VERSION_HEADER]: String(PERSONAL_KNOWLEDGE_CONTRACT_VERSION)
    });
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.expectedHeader) headers.set(PERSONAL_KNOWLEDGE_CONTEXT_HEADER, encodePersonalKnowledgeContextHeader(this.expectedContext));
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.apiUrl}${path}`, {
        method: options.method,
        redirect: 'error',
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
      });
    } catch (error) {
      throw new PersonalKnowledgeClientError(`Personal Knowledge API request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    let raw: string;
    try {
      raw = await response.text();
    } catch (error) {
      throw new PersonalKnowledgeClientError(`Personal Knowledge API response could not be read: ${error instanceof Error ? error.message : String(error)}`);
    }
    const responseBody = raw.trim() ? parseJson(raw) : null;
    if (!response.ok) {
      throw new PersonalKnowledgeClientError(`Personal Knowledge API error: ${response.status} ${response.statusText || 'Request failed'}.`, {
        status: response.status,
        responseBody
      });
    }
    return responseBody;
  }
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new PersonalKnowledgeClientError('Personal Knowledge API returned invalid JSON.', { responseBody: raw });
  }
}

function assertContextEnvelope(value: unknown, expected: PersonalKnowledgeContext): PersonalKnowledgeContextEnvelope {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'context')) throw new PersonalKnowledgeClientError('Personal Knowledge context response schema is invalid.');
  return { context: assertPersonalKnowledgeContextMatch(expected, value.context) };
}

function assertRegisterEnvelope(value: unknown, expected: PersonalKnowledgeContext): PersonalKnowledgeRegisterEnvelope {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'context') || !Object.prototype.hasOwnProperty.call(value, 'event')) {
    throw new PersonalKnowledgeClientError('Personal Knowledge register response schema is invalid.');
  }
  const context = assertPersonalKnowledgeContextMatch(expected, value.context);
  let event: PersonalKnowledgeEvent;
  try {
    event = normalizePersonalKnowledgeEvent(value.event);
  } catch {
    throw new PersonalKnowledgeClientError('Personal Knowledge register response event is invalid.');
  }
  return { context, event };
}

function assertSearchEnvelope(value: unknown, expected: PersonalKnowledgeContext): PersonalKnowledgeSearchEnvelope {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'context') || !Object.prototype.hasOwnProperty.call(value, 'results') || !Array.isArray(value.results)) {
    throw new PersonalKnowledgeClientError('Personal Knowledge search response schema is invalid.');
  }
  const context = assertPersonalKnowledgeContextMatch(expected, value.context);
  const results = value.results.map((event, index) => {
    try {
      return normalizePersonalKnowledgeEvent(event);
    } catch {
      throw new PersonalKnowledgeClientError(`Personal Knowledge search result ${index} is invalid.`);
    }
  });
  return { context, results };
}

export function createPersonalKnowledgeClient(options: PersonalKnowledgeClientOptions): PersonalKnowledgeClient {
  return new PersonalKnowledgeClient(options);
}
