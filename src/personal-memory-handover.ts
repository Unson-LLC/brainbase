import { createHash } from 'node:crypto';
import { appendFile, chmod, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveDataDir } from './paths.js';
import {
  createPersonalKnowledgeClient,
  isPersonalKnowledgeTimestamp,
  normalizePersonalKnowledgeApiUrl,
  normalizePersonalKnowledgeEvent,
  PERSONAL_KNOWLEDGE_CONTEXT_VERSION_HEADER,
  PERSONAL_KNOWLEDGE_CONTRACT_VERSION,
  PersonalKnowledgeClientError,
  readLocalPersonalKnowledgeEvents,
  validatePersonalKnowledgeContext,
  type PersonalKnowledgeContext,
  type PersonalKnowledgeStorageMode
} from './personal-knowledge.js';
import { loadPersonalOs } from './ssot.js';

/**
 * Handover of personal memories from OSS Personal to an organization.
 *
 * The owner lists the memories kept on this machine and re-registers only the
 * ones they choose into the organization's personal KG (organization_private,
 * readable by the owner only). Nothing moves automatically: listing and the
 * default preview never touch the network, and only selected memories are sent.
 */

/** Local record of what the organization confirmed, relative to the data directory. */
export const MEMORY_REGISTRATION_RECEIPTS_FILE = join('handover', 'personal-memory-registrations.jsonl');

const EVENT_ID_PURPOSE = 'brainbase-oss-memory-registration/v1';
const PREVIEW_LENGTH = 80;
const REQUEST_TIMEOUT_MS = 10_000;
const SAFE_ERROR_CODE = /^[a-z0-9_:-]{1,120}$/u;

export type LocalMemoryStore = 'personal-knowledge-v1' | 'personal-kg';
export type MemoryRegistrationStatus = 'unregistered' | 'registered' | 'changed';

/**
 * The event content sent for one memory. The organization event ID is added
 * only when the destination is known (see organizationMemoryEventId).
 * Local provenance such as file paths, local metadata, and local episode IDs
 * is deliberately not part of it.
 */
export interface MemoryRegistrationContent {
  body: string;
  body_hash: string;
  source: { system: 'brainbase-oss'; store: LocalMemoryStore };
  source_pointer: { memory_id: string };
  occurred_at?: string;
  captured_at?: string;
  kind?: string;
  type?: string;
  tags?: string[];
  sensitivity?: string;
}

export interface MemoryRegistrationReceipt {
  schema_version: 1;
  memory_id: string;
  memory_digest: string;
  event_id: string;
  body_hash: string;
  organization_id: string;
  owner_person_id: string;
  registered_at: string;
}

export interface LocalMemory {
  /** Stable selection ID: `v1:<event_id>` or `legacy:<id>`. */
  id: string;
  store: LocalMemoryStore;
  type: string | null;
  preview: string;
  /** Digest of exactly the content that would be sent; it changes when the memory changes. */
  memoryDigest: string;
  content: MemoryRegistrationContent;
  status: MemoryRegistrationStatus;
  /** Latest receipt for this memory: the matching one when registered, otherwise the newest. */
  lastRegistration?: MemoryRegistrationReceipt;
}

export interface RegisteredMemory {
  id: string;
  eventId: string;
  memoryDigest: string;
  bodyHash: string;
}

export interface MemoryRegistrationResult {
  organizationId: string;
  ownerPersonId: string;
  registered: RegisteredMemory[];
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RegisterSelectedMemoriesOptions {
  dataDir?: string;
  ids: readonly string[];
  /** Organization base URL and the member's signed Bearer token. */
  organization: { url: string; token: string };
  fetch?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
}

export class PersonalMemoryRegistrationError extends Error {
  readonly memoryId: string;
  readonly registered: RegisteredMemory[];

  constructor(memoryId: string, reason: string, registered: RegisteredMemory[]) {
    const done = registered.length > 0
      ? `registered in this run before the failure: ${registered.map((memory) => memory.id).join(', ')}`
      : 'no memory was registered in this run';
    super(`personal_memory_registration_failed: ${memoryId}: ${reason}; ${done}; later selections were not sent`);
    this.name = 'PersonalMemoryRegistrationError';
    this.memoryId = memoryId;
    this.registered = registered;
  }
}

/** Read both local memory stores and each memory's registration state. Never uses the network. */
export async function listLocalMemories(dataDirInput?: string): Promise<LocalMemory[]> {
  const dataDir = resolveDataDir(dataDirInput);
  const [current, legacy, receipts] = await Promise.all([
    readCurrentStore(dataDir),
    readLegacyStore(dataDir),
    readMemoryRegistrationReceipts(dataDir)
  ]);
  return [...current, ...legacy].map((memory) => withStatus(memory, receipts));
}

/** Pick exactly the requested memories, in request order, or fail before anything is sent. */
export function selectLocalMemories(memories: readonly LocalMemory[], ids: readonly string[]): LocalMemory[] {
  const requested = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (requested.length === 0) throw new Error('personal_memory_selection_required: choose memories with --id (see brainbase memory:list)');
  const unknown = requested.filter((id) => !memories.some((memory) => memory.id === id));
  if (unknown.length > 0) {
    throw new Error(`personal_memory_unknown_id: ${unknown.join(', ')} (see brainbase memory:list); nothing was sent`);
  }
  const ambiguous = requested.filter((id) => memories.filter((memory) => memory.id === id).length > 1);
  if (ambiguous.length > 0) {
    throw new Error(`personal_memory_ambiguous_id: ${ambiguous.join(', ')} appears more than once in the local store; nothing was sent`);
  }
  return requested.map((id) => memories.find((memory) => memory.id === id)!);
}

/**
 * The organization event ID for a memory. It is derived from the memory's
 * content and origin (memoryDigest) and from the authenticated destination,
 * so re-sending the same memory to the same owner produces the same event,
 * and another owner or organization never collides with it.
 */
export function organizationMemoryEventId(context: PersonalKnowledgeContext, memoryDigest: string): string {
  const destination = validatePersonalKnowledgeContext(context);
  const identity = canonicalJson({
    purpose: EVENT_ID_PURPOSE,
    organization_id: destination.organization_id,
    owner_person_id: destination.owner_person_id,
    source_id: destination.source_id,
    memory_digest: memoryDigest
  });
  return `pke_oss_${sha256(identity).slice(0, 40)}`;
}

/** Send only the selected memories and record a receipt for each one the organization confirmed. */
export async function registerSelectedMemories(options: RegisterSelectedMemoriesOptions): Promise<MemoryRegistrationResult> {
  const dataDir = resolveDataDir(options.dataDir);
  const selected = selectLocalMemories(await listLocalMemories(dataDir), options.ids);
  const mode = storageMode(options.organization.url);
  const apiUrl = normalizePersonalKnowledgeApiUrl(options.organization.url, mode);
  const fetchImpl = withRequestTimeout(options.fetch ?? ((input, init) => globalThis.fetch(input, init)), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const context = await discoverOrganizationContext(apiUrl, options.organization.token, fetchImpl);
  const client = createPersonalKnowledgeClient({
    mode,
    apiUrl,
    expectedContext: context,
    token: options.organization.token,
    fetch: fetchImpl
  });
  const now = options.now ?? (() => new Date());
  const registered: RegisteredMemory[] = [];
  for (const memory of selected) {
    const eventId = organizationMemoryEventId(context, memory.memoryDigest);
    let confirmed: { event_id: string; body_hash: string };
    try {
      confirmed = (await client.register({ event_id: eventId, ...memory.content })).event;
    } catch (error) {
      throw new PersonalMemoryRegistrationError(memory.id, describeFailure(error), registered);
    }
    if (confirmed.event_id !== eventId || confirmed.body_hash !== memory.content.body_hash) {
      throw new PersonalMemoryRegistrationError(memory.id, 'personal_memory_registration_readback_mismatch', registered);
    }
    await appendReceipt(dataDir, {
      schema_version: 1,
      memory_id: memory.id,
      memory_digest: memory.memoryDigest,
      event_id: eventId,
      body_hash: memory.content.body_hash,
      organization_id: context.organization_id!,
      owner_person_id: context.owner_person_id,
      registered_at: now().toISOString()
    });
    registered.push({ id: memory.id, eventId, memoryDigest: memory.memoryDigest, bodyHash: memory.content.body_hash });
  }
  return { organizationId: context.organization_id!, ownerPersonId: context.owner_person_id, registered };
}

export async function readMemoryRegistrationReceipts(dataDirInput?: string): Promise<MemoryRegistrationReceipt[]> {
  const path = join(resolveDataDir(dataDirInput), MEMORY_REGISTRATION_RECEIPTS_FILE);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const receipts: MemoryRegistrationReceipt[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      value = undefined;
    }
    if (!isReceipt(value)) throw new Error(`Invalid memory registration receipt in ${MEMORY_REGISTRATION_RECEIPTS_FILE} at line ${index + 1}.`);
    receipts.push(value);
  }
  return receipts;
}

export function renderMemoryList(memories: readonly LocalMemory[]): string {
  if (memories.length === 0) {
    return 'No local memories were found in personal-knowledge-v1/ or personal-kg.jsonl.\n';
  }
  const lines = memories.map((memory) => `${memory.id}  ${memory.store}  ${memory.type ?? '-'}  ${memory.status}  ${memory.preview}`);
  const notes = [
    'A local memory is searchable in the organization only after you register it:',
    '  brainbase memory:register --id <id> [--id <id>...]           # preview, sends nothing',
    '  brainbase memory:register --id <id> [--id <id>...] --write   # sends only the selected memories'
  ];
  if (memories.some((memory) => memory.status === 'changed')) {
    notes.push('changed: registered before, but the local memory has changed since. Registering again sends the new version as a new event; the earlier one stays.');
  }
  return `${lines.join('\n')}\n\n${notes.join('\n')}\n`;
}

export function memoryListJson(memories: readonly LocalMemory[]): unknown {
  return {
    memories: memories.map((memory) => ({
      id: memory.id,
      store: memory.store,
      type: memory.type,
      preview: memory.preview,
      memoryDigest: memory.memoryDigest,
      status: memory.status,
      ...(memory.lastRegistration ? {
        lastRegistration: {
          eventId: memory.lastRegistration.event_id,
          organizationId: memory.lastRegistration.organization_id,
          registeredAt: memory.lastRegistration.registered_at
        }
      } : {})
    }))
  };
}

export function registrationPreviewJson(memories: readonly LocalMemory[]): unknown {
  return {
    status: 'preview',
    sent: false,
    memories: memories.map((memory) => ({ id: memory.id, status: memory.status, memoryDigest: memory.memoryDigest, event: memory.content }))
  };
}

export function renderRegistrationPreview(memories: readonly LocalMemory[]): string {
  const lines = memories.map((memory) => `- ${memory.id}  ${memory.type ?? '-'}  ${memory.status}\n  ${memory.content.body.replace(/\s+/gu, ' ').trim()}`);
  return [
    'Preview only. Nothing was sent.',
    `With --write, ${countMemories(memories.length)} would be registered in your personal KG in the organization (only you can read them; they do not become organization facts):`,
    ...lines,
    'Unselected memories are never sent. The organization event ID is fixed from each memory and your signed-in owner, so sending the same memory again does not create a duplicate.',
    ''
  ].join('\n');
}

export function renderRegistrationResult(result: MemoryRegistrationResult): string {
  return [
    `Registered ${countMemories(result.registered.length)} in the personal KG of organization ${result.organizationId} (owner ${result.ownerPersonId}). Only you can read them.`,
    ...result.registered.map((memory) => `- ${memory.id}  ->  ${memory.eventId}`),
    ''
  ].join('\n');
}

async function readCurrentStore(dataDir: string): Promise<StoredMemory[]> {
  const snapshot = await readLocalPersonalKnowledgeEvents({ dataDir });
  return (snapshot?.events ?? []).map((event) => localMemory('personal-knowledge-v1', `v1:${event.event_id}`, {
    body: event.body,
    occurred_at: event.occurred_at,
    captured_at: event.captured_at,
    kind: event.kind,
    type: event.type,
    tags: event.tags,
    sensitivity: event.sensitivity
  }));
}

async function readLegacyStore(dataDir: string): Promise<StoredMemory[]> {
  if (!(await exists(join(dataDir, 'personal-kg.jsonl')))) return [];
  const os = await loadPersonalOs(dataDir);
  return os.personalKg.map((entry) => {
    const tags = (entry.tags ?? []).map((tag) => tag.trim()).filter(Boolean);
    return localMemory('personal-kg', `legacy:${entry.id}`, {
      body: entry.text,
      type: entry.type,
      tags: tags.length > 0 ? tags : undefined,
      occurred_at: isPersonalKnowledgeTimestamp(entry.updatedAt) ? entry.updatedAt : undefined
    });
  });
}

type ContentFields = Omit<MemoryRegistrationContent, 'body_hash' | 'source' | 'source_pointer'>;
type StoredMemory = Omit<LocalMemory, 'status' | 'lastRegistration'>;

function localMemory(store: LocalMemoryStore, id: string, fields: ContentFields): StoredMemory {
  const draft: Record<string, unknown> = {
    event_id: id,
    source: { system: 'brainbase-oss', store },
    source_pointer: { memory_id: id }
  };
  for (const [field, value] of Object.entries(fields)) {
    if (value !== undefined) draft[field] = value;
  }
  let normalized: Record<string, unknown>;
  try {
    // Validate against the same v1 event contract the organization applies.
    normalized = normalizePersonalKnowledgeEvent(draft);
  } catch (error) {
    throw new Error(`Local memory ${id} cannot be registered: ${error instanceof Error ? error.message : String(error)}`);
  }
  const { event_id: _eventId, ...content } = normalized;
  const typed = content as unknown as MemoryRegistrationContent;
  return {
    id,
    store,
    type: typed.type ?? null,
    preview: preview(typed.body),
    memoryDigest: `sha256:${sha256(canonicalJson(typed))}`,
    content: typed
  };
}

function withStatus(memory: StoredMemory, receipts: readonly MemoryRegistrationReceipt[]): LocalMemory {
  const own = receipts.filter((receipt) => receipt.memory_id === memory.id);
  const matching = own.filter((receipt) => receipt.memory_digest === memory.memoryDigest);
  if (matching.length > 0) return { ...memory, status: 'registered', lastRegistration: matching[matching.length - 1] };
  if (own.length > 0) return { ...memory, status: 'changed', lastRegistration: own[own.length - 1] };
  return { ...memory, status: 'unregistered' };
}

async function discoverOrganizationContext(apiUrl: string, token: string, fetchImpl: FetchLike): Promise<PersonalKnowledgeContext> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}/api/personal-knowledge/context`, {
      method: 'GET',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        [PERSONAL_KNOWLEDGE_CONTEXT_VERSION_HEADER]: String(PERSONAL_KNOWLEDGE_CONTRACT_VERSION)
      }
    });
  } catch {
    throw new Error('personal_memory_destination_unavailable: the organization personal KG could not be reached; nothing was sent');
  }
  const body = await response.text().catch(() => '');
  let value: unknown;
  try {
    value = body.trim() ? JSON.parse(body) : null;
  } catch {
    value = null;
  }
  if (!response.ok) {
    const code = errorCode(value);
    throw new Error(`personal_memory_destination_unavailable: organization returned HTTP ${response.status}${code ? ` (${code})` : ''}; nothing was sent`);
  }
  let context: PersonalKnowledgeContext;
  try {
    context = validatePersonalKnowledgeContext(isRecord(value) ? value.context : undefined);
  } catch {
    throw new Error('personal_memory_destination_invalid: the organization returned an invalid personal KG context; nothing was sent');
  }
  if (context.scope !== 'organization_private' || context.organization_id === null) {
    throw new Error('personal_memory_destination_not_organization: the destination is not an organization-private personal KG; nothing was sent');
  }
  return context;
}

async function appendReceipt(dataDir: string, receipt: MemoryRegistrationReceipt): Promise<void> {
  const path = join(dataDir, MEMORY_REGISTRATION_RECEIPTS_FILE);
  await mkdir(join(dataDir, 'handover'), { recursive: true, mode: 0o700 });
  await appendFile(path, `${JSON.stringify(receipt)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(path, 0o600);
}

function storageMode(url: string): PersonalKnowledgeStorageMode {
  const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' ? 'local' : 'managed_cloud';
}

function withRequestTimeout(fetchImpl: FetchLike, timeoutMs: number): FetchLike {
  return (input, init) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

function describeFailure(error: unknown): string {
  if (error instanceof PersonalKnowledgeClientError) {
    const code = errorCode(error.responseBody);
    return `${error.message}${code ? ` (${code})` : ''}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function errorCode(value: unknown): string | undefined {
  const code = isRecord(value) ? value.error : undefined;
  return typeof code === 'string' && SAFE_ERROR_CODE.test(code) ? code : undefined;
}

function isReceipt(value: unknown): value is MemoryRegistrationReceipt {
  if (!isRecord(value) || value.schema_version !== 1) return false;
  return ['memory_id', 'memory_digest', 'event_id', 'body_hash', 'organization_id', 'owner_person_id', 'registered_at']
    .every((field) => typeof value[field] === 'string' && (value[field] as string).length > 0);
}

function countMemories(count: number): string {
  return `${count} ${count === 1 ? 'memory' : 'memories'}`;
}

function preview(body: string): string {
  const flat = body.replace(/\s+/gu, ' ').trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
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

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
