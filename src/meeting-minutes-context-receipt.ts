import { createHash } from 'node:crypto';

// Keep the persisted schema identifier byte-for-byte compatible with the
// existing Unson service.  The package export has its own version constant.
export const MEETING_MINUTES_CONTEXT_RECEIPT_VERSION = 'meeting_minutes_context_receipt.v1' as const;
export const MEETING_MINUTES_CONTEXT_RECEIPT_MAX_BYTES = 128 * 1024;

type UnknownRecord = Record<string, unknown>;
type MaybePromise<T> = T | Promise<T>;

export type MeetingMinutesContextReceiptStatus = 'resolved' | 'confirmed_empty' | 'partial' | 'unavailable';

export interface MeetingMinutesContextIdentity {
  readonly run_id: string;
  readonly project_code: string;
  readonly transcript_sha256: string;
}
export interface MeetingMinutesContextReceipt {
  readonly schema_version: typeof MEETING_MINUTES_CONTEXT_RECEIPT_VERSION;
  readonly receipt_id: string;
  readonly identity: MeetingMinutesContextIdentity;
  readonly status: MeetingMinutesContextReceiptStatus;
  readonly source_status: { readonly graph: string; readonly tasks: string };
  readonly resolved_at: string;
  readonly context: UnknownRecord;
  readonly errors: readonly UnknownRecord[];
  readonly checksum: string;
  readonly [key: string]: unknown;
}

export interface MeetingMinutesContextReceiptClaimRequest {
  readonly receipt_id: string;
  readonly fingerprint: string;
  readonly scope: UnknownRecord | null;
  readonly execute: () => MaybePromise<MeetingMinutesContextReceipt>;
}

export interface MeetingMinutesContextReceiptClaimResult {
  readonly status: 'persisted' | 'replayed';
  readonly receipt: MeetingMinutesContextReceipt;
}

export interface MeetingMinutesContextReceiptPorts {
  readonly graph?: (input: { identity: MeetingMinutesContextIdentity; retrieval_context: UnknownRecord }) => MaybePromise<UnknownRecord | null>;
  readonly tasks?: (input: { identity: MeetingMinutesContextIdentity }) => MaybePromise<UnknownRecord | readonly UnknownRecord[] | null>;
  /** Identity/authentication/tenant/project checks remain host-owned ports. */
  readonly actor: {
    readonly resolve: (input: { identity: MeetingMinutesContextIdentity; request: UnknownRecord }) => MaybePromise<UnknownRecord>;
  };
  readonly auth: {
    readonly authorize: (input: { actor: UnknownRecord; identity: MeetingMinutesContextIdentity }) => MaybePromise<void>;
  };
  readonly tenant: {
    readonly authorize: (input: { actor: UnknownRecord; identity: MeetingMinutesContextIdentity }) => MaybePromise<void>;
  };
  readonly project: {
    readonly authorize: (input: { actor: UnknownRecord; identity: MeetingMinutesContextIdentity }) => MaybePromise<void>;
  };
  readonly repository: {
    /** Durable claim prevents two workers from both fetching and writing. */
    readonly claimOrReplay: (request: MeetingMinutesContextReceiptClaimRequest) => MaybePromise<MeetingMinutesContextReceiptClaimResult>;
    put: (receipt: MeetingMinutesContextReceipt, scope?: UnknownRecord | null) => MaybePromise<MeetingMinutesContextReceipt | void>;
    get: (receiptId: string, scope?: UnknownRecord | null) => MaybePromise<MeetingMinutesContextReceipt | null>;
  };
  readonly scope?: UnknownRecord | null;
  readonly now?: () => Date;
  readonly max_attempts?: number;
  readonly is_retryable?: (error: unknown) => boolean;
}

export class MeetingMinutesContextReceiptError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: UnknownRecord;

  constructor(code: string, message: string, statusCode = 400, details: UnknownRecord = {}) {
    super(message);
    this.name = 'MeetingMinutesContextReceiptError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as UnknownRecord).sort().map((key) => [key, stable((value as UnknownRecord)[key])]));
}

export function digestMeetingMinutesContext(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function compact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 4000);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 4) return String(value).slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => compact(item, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, compact(item, depth + 1)]));
  return String(value).slice(0, 500);
}

export function normalizeMeetingMinutesContextIdentity(input: UnknownRecord = {}): MeetingMinutesContextIdentity {
  const identity = {
    run_id: typeof input.run_id === 'string' ? input.run_id.trim() : '',
    project_code: typeof input.project_code === 'string' ? input.project_code.trim() : '',
    transcript_sha256: typeof input.transcript_sha256 === 'string' ? input.transcript_sha256.trim().toLowerCase() : '',
  };
  if (!/^[a-zA-Z0-9._:-]{1,200}$/.test(identity.run_id)) throw new MeetingMinutesContextReceiptError('meeting_minutes_context_input_invalid', 'run_id is invalid');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(identity.project_code)) throw new MeetingMinutesContextReceiptError('meeting_minutes_context_input_invalid', 'project_code is invalid');
  if (!/^[a-f0-9]{64}$/.test(identity.transcript_sha256)) throw new MeetingMinutesContextReceiptError('meeting_minutes_context_input_invalid', 'transcript_sha256 must be a lowercase SHA-256 digest');
  return identity;
}

export function normalizeMeetingMinutesRetrievalContext(input: UnknownRecord = {}): UnknownRecord {
  const retrieval = input.retrieval_context ?? input.retrievalContext ?? {};
  const raw = retrieval && typeof retrieval === 'object'
    ? (retrieval as UnknownRecord).mention_candidates ?? (retrieval as UnknownRecord).mentionCandidates ?? (retrieval as UnknownRecord).mentions
    : undefined;
  const mentions = (Array.isArray(raw)
    ? raw.map((candidate) => {
      if (typeof candidate === 'string') return { surface_form: candidate.trim().slice(0, 160), entity_types: ['person', 'org', 'brand', 'glossary_term'] };
      if (!candidate || typeof candidate !== 'object') return null;
      const item = candidate as UnknownRecord;
      const surface = String(item.surface_form ?? item.surfaceForm ?? item.text ?? item.term ?? item.value ?? '').trim().slice(0, 160);
      if (!surface) return null;
      const rawTypes = item.entity_types ?? item.entityTypes ?? item.types;
      const types = Array.isArray(rawTypes) ? rawTypes.map((type) => String(type).trim().toLowerCase()).filter(Boolean) : ['person', 'org', 'brand', 'glossary_term'];
      return { surface_form: surface, entity_types: [...new Set(types)].slice(0, 4) };
    }).filter((candidate) => Boolean(candidate && typeof candidate === 'object' && 'surface_form' in candidate && candidate.surface_form))
    : []) as UnknownRecord[];
  const seen = new Set<string>();
  return {
    mention_candidates: mentions.filter((mention) => {
      const key = `${String(mention.surface_form).toLocaleLowerCase('ja-JP')}|${(mention.entity_types as string[]).join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 12),
  };
}

function flattenEntities(graph: UnknownRecord | null): UnknownRecord[] {
  if (!graph) return [];
  const entities = graph.entities;
  if (Array.isArray(entities)) return entities.map((item) => compact(item) as UnknownRecord);
  if (!entities || typeof entities !== 'object') return [];
  return Object.values(entities as UnknownRecord).flatMap((items) => Array.isArray(items) ? items.map((item) => compact(item) as UnknownRecord) : []);
}

function normalizeTasks(tasks: UnknownRecord | readonly UnknownRecord[] | null): UnknownRecord[] {
  const taskRecord = tasks && !Array.isArray(tasks) ? tasks as UnknownRecord : null;
  const items: readonly UnknownRecord[] = Array.isArray(tasks)
    ? tasks
    : (Array.isArray(taskRecord?.items) ? taskRecord.items as readonly UnknownRecord[] : []);
  return items.filter((task) => task.status !== 'completed').slice(0, 50).map((task) => compact(task) as UnknownRecord);
}

function sourceRefs(
  entities: readonly UnknownRecord[],
  tasks: readonly UnknownRecord[],
  minutes: readonly UnknownRecord[],
): UnknownRecord[] {
  return [
    ...entities.map((entity) => ({ type: 'graph_entity', id: entity.id ?? entity.entity_id ?? null })),
    ...tasks.map((task) => ({ type: 'canonical_task', id: task.id ?? task.task_id ?? null })),
    ...minutes.map((minute) => ({ type: 'meeting_minutes', id: minute.id ?? minute.entity_id ?? null })),
  ].filter((item) => Boolean(item.id));
}

function approvedMinutes(entities: readonly UnknownRecord[]): UnknownRecord[] {
  return entities
    .filter((entity) => entity.entity_type === 'meeting_minutes' && Boolean(entity.id ?? entity.entity_id))
    .slice(0, 3)
    .map((entity) => ({ id: entity.id ?? entity.entity_id, title: entity.title ?? entity.name ?? null }));
}

function boundedReceipt(receipt: MeetingMinutesContextReceipt): MeetingMinutesContextReceipt {
  const candidate = structuredClone(receipt) as MeetingMinutesContextReceipt;
  const context = candidate.context;
  while (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > MEETING_MINUTES_CONTEXT_RECEIPT_MAX_BYTES) {
    const entities = Array.isArray(context.entities) ? context.entities as unknown[] : [];
    const tasks = Array.isArray(context.open_tasks) ? context.open_tasks as unknown[] : [];
    const refs = Array.isArray(context.source_refs) ? context.source_refs as unknown[] : [];
    if (entities.length) entities.pop();
    else if (tasks.length) tasks.pop();
    else if (refs.length) refs.pop();
    else throw new MeetingMinutesContextReceiptError('meeting_minutes_context_too_large', 'meeting minutes context receipt exceeds 128 KiB', 503);
  }
  return candidate;
}

async function persistWithRetry(receipt: MeetingMinutesContextReceipt, ports: MeetingMinutesContextReceiptPorts): Promise<MeetingMinutesContextReceipt> {
  const maxAttempts = Math.max(1, Math.min(5, ports.max_attempts ?? 2));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const saved = await ports.repository.put(receipt, ports.scope);
      return saved ?? receipt;
    } catch (error) {
      if (!(ports.is_retryable?.(error) ?? Boolean((error as { retryable?: boolean } | null)?.retryable)) || attempt >= maxAttempts) throw error;
    }
  }
  throw new MeetingMinutesContextReceiptError('persist_failed', 'meeting minutes context receipt could not be persisted', 503);
}

export async function createMeetingMinutesContextReceipt(
  input: UnknownRecord,
  ports: MeetingMinutesContextReceiptPorts,
): Promise<MeetingMinutesContextReceipt> {
  const identity = normalizeMeetingMinutesContextIdentity(input);
  const retrievalContext = normalizeMeetingMinutesRetrievalContext(input);
  if (!ports?.actor?.resolve || !ports?.auth?.authorize || !ports?.tenant?.authorize || !ports?.project?.authorize) {
    throw new MeetingMinutesContextReceiptError(
      'meeting_minutes_context_invalid_ports',
      'actor, auth, tenant, and project ports are required',
      500,
    );
  }
  if (!ports?.repository?.claimOrReplay || !ports?.repository?.get || !ports?.repository?.put) {
    throw new MeetingMinutesContextReceiptError(
      'meeting_minutes_context_invalid_ports',
      'repository claimOrReplay, put, and durable get ports are required',
      500,
    );
  }
  const actor = await ports.actor.resolve({ identity, request: input });
  await ports.auth.authorize({ actor, identity });
  await ports.tenant.authorize({ actor, identity });
  await ports.project.authorize({ actor, identity });
  const errors: UnknownRecord[] = [];
  const scope = ports.scope ?? null;
  const receiptId = `mmctx_${digestMeetingMinutesContext({ identity, scope }).slice(0, 32)}`;
  const fingerprint = digestMeetingMinutesContext({ identity, scope });
  const claim = await ports.repository.claimOrReplay({
    receipt_id: receiptId,
    fingerprint,
    scope,
    execute: async () => {
      let graph: UnknownRecord | null = null;
      let graphRetrieval: UnknownRecord | null = null;
      let graphStatus = 'unavailable';
      let graphFetched = false;
      let tasks: UnknownRecord | readonly UnknownRecord[] | null = null;
      let tasksFetched = false;
      try {
        graphFetched = typeof ports.graph === 'function';
        const graphResult = await ports.graph?.({ identity, retrieval_context: retrievalContext }) ?? null;
        if (graphResult && typeof graphResult === 'object' && 'graph' in graphResult) {
          graph = (graphResult.graph && typeof graphResult.graph === 'object' ? graphResult.graph : null) as UnknownRecord | null;
          graphRetrieval = (graphResult.retrieval && typeof graphResult.retrieval === 'object' ? graphResult.retrieval : null) as UnknownRecord | null;
          graphStatus = typeof graphResult.status === 'string' ? graphResult.status : (graph ? 'resolved' : 'unavailable');
          if (Array.isArray(graphResult.errors)) errors.push(...graphResult.errors.filter((item): item is UnknownRecord => Boolean(item && typeof item === 'object')));
        } else {
          graph = graphResult;
          graphStatus = graph ? 'resolved' : 'unavailable';
        }
      } catch (error) {
        errors.push({ source: 'graph', code: 'graph_context_unavailable', message: error instanceof Error ? error.message : String(error) });
      }
      try {
        tasksFetched = typeof ports.tasks === 'function';
        tasks = await ports.tasks?.({ identity }) ?? null;
      } catch (error) {
        errors.push({ source: 'tasks', code: 'canonical_tasks_unavailable', message: error instanceof Error ? error.message : String(error) });
      }
      const entities = flattenEntities(graph);
      const openTasks = normalizeTasks(tasks);
      const minutes = approvedMinutes(entities);
      const context: UnknownRecord = {
        project: entities.filter((entity) => entity.entity_type === 'project'),
        people: entities.filter((entity) => entity.entity_type === 'person'),
        organizations: entities.filter((entity) => entity.entity_type === 'org'),
        decisions: entities.filter((entity) => entity.entity_type === 'decision'),
        glossary: entities.filter((entity) => entity.entity_type === 'glossary_term'),
        entities,
        edges: compact(graph?.edges ?? []),
        open_tasks: openTasks,
        source_refs: sourceRefs(entities, openTasks, minutes),
        approved_minutes_refs: minutes,
        retrieval: graphRetrieval ?? retrievalContext,
      };
      const graphAvailable = graphFetched && Boolean(graph) && graphStatus !== 'unavailable';
      const tasksAvailable = tasksFetched && tasks !== null;
      const sourceStatus = {
        graph: graphAvailable ? graphStatus : 'unavailable',
        tasks: tasksAvailable ? 'resolved' : 'unavailable',
      };
      // Empty is a positive result only when both host sources were fetched
      // successfully. Missing ports and unavailable responses must remain
      // observable as unavailable/partial rather than confirmed_empty.
      const status: MeetingMinutesContextReceiptStatus = !graphAvailable && !tasksAvailable
        ? 'unavailable'
        : errors.length || !graphAvailable || !tasksAvailable
          ? 'partial'
          : (entities.length || openTasks.length) ? 'resolved' : 'confirmed_empty';
      const base = {
        schema_version: MEETING_MINUTES_CONTEXT_RECEIPT_VERSION,
        receipt_id: receiptId,
        identity,
        status,
        source_status: sourceStatus,
        searched_scope: {
          project_code: identity.project_code,
          entity_types: ['project', 'person', 'org', 'brand', 'decision', 'glossary_term', 'document'],
          entity_limit: 80,
          task_limit: 50,
          approved_minutes_limit: 3,
        },
        resolved_at: (ports.now ?? (() => new Date()))().toISOString(),
        context,
        errors,
      } as Omit<MeetingMinutesContextReceipt, 'checksum'>;
      const bounded = boundedReceipt({ ...base, checksum: digestMeetingMinutesContext(base) } as MeetingMinutesContextReceipt);
      const receipt = { ...bounded, checksum: digestMeetingMinutesContext({ ...bounded, checksum: undefined }) };
      return persistWithRetry(receipt, ports);
    },
  });
  const persisted = claim.receipt;
  const readback = await ports.repository.get(persisted.receipt_id, ports.scope);
  if (!readback || readback.checksum !== persisted.checksum) {
    throw new MeetingMinutesContextReceiptError('meeting_minutes_context_readback_mismatch', 'meeting minutes context receipt readback did not match the persisted receipt', 503, { receipt_id: persisted.receipt_id });
  }
  return readback;
}

export async function readMeetingMinutesContextReceipt(
  receiptId: string,
  input: UnknownRecord,
  ports: MeetingMinutesContextReceiptPorts,
): Promise<MeetingMinutesContextReceipt> {
  const identity = normalizeMeetingMinutesContextIdentity(input);
  if (!ports?.actor?.resolve || !ports?.auth?.authorize || !ports?.tenant?.authorize || !ports?.project?.authorize) {
    throw new MeetingMinutesContextReceiptError(
      'meeting_minutes_context_invalid_ports',
      'actor, auth, tenant, and project ports are required',
      500,
    );
  }
  const actor = await ports.actor.resolve({ identity, request: input });
  await ports.auth.authorize({ actor, identity });
  await ports.tenant.authorize({ actor, identity });
  await ports.project.authorize({ actor, identity });
  if (!ports?.repository?.get) {
    throw new MeetingMinutesContextReceiptError(
      'meeting_minutes_context_invalid_ports',
      'repository get port is required',
      500,
    );
  }
  const receipt = await ports.repository.get(receiptId, ports.scope);
  if (!receipt) throw new MeetingMinutesContextReceiptError('meeting_minutes_context_receipt_not_found', 'meeting minutes context receipt was not found', 404);
  if (JSON.stringify(receipt.identity) !== JSON.stringify(identity)) throw new MeetingMinutesContextReceiptError('meeting_minutes_context_identity_mismatch', 'meeting minutes context receipt identity does not match', 409);
  return receipt;
}
