import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCompanyOsObjectives } from './company-os-objectives.js';
import { foundationCatalogOrEmpty, foundationKey } from './foundation-catalog.js';
import {
  createFoundationHttpRouter,
  createObjectiveFoundationRoute,
  FOUNDATION_HTTP_PREFIX,
  FOUNDATION_OBJECTIVE_ROUTE_PREFIX,
  type FoundationHttpRoute,
  type ObjectiveDefinitionBuilder
} from './foundation-http.js';
import {
  createFoundationRevisionStore,
  FoundationStoreError,
  type FoundationRevisionStore,
  type FoundationStoreContext
} from './foundation-store.js';
import { createGraphWebHttpHandler } from './graph-web-http.js';
import { defaultJudgmentJournalRoot } from './judgment-value-proof-review.js';
import { nodeRequestToFetch, writeFetchResponse } from './local-web-fetch-bridge.js';
import {
  assertSameOrigin,
  isLoopbackHost,
  LOCAL_WEB_CONTENT_SECURITY_POLICY,
  LocalWebHttpError,
  requestUrl,
  tokenMatches,
  writeHttpError,
  writeJson
} from './local-web-security.js';
import type { FoundationRevision, FoundationType, ObjectiveDefinition } from './ontology-foundation.js';
import { resolveDataDir } from './paths.js';
import { loadPersonalOs, readPersonalOsSidecar } from './ssot.js';
import type { FoundationCatalogRecord, PersonalOs } from './types.js';
import { createValueProofReviewHttpHandler, VALUE_PROOF_REVIEW_TOKEN_HEADER } from './value-proof-review-http.js';
import {
  createWorldModelStore,
  WORLD_MODEL_EVIDENCE_SIDECAR,
  WorldModelStoreError,
  type WorldModelRecordStore,
  type WorldModelStoreContext
} from './world-model.js';

/**
 * General local single-owner Web host (`brainbase web:serve`).
 *
 * One loopback server carries every local screen.  The host owns the
 * protections, the trusted principal and the static allowlist; each screen's
 * server side is a `LocalWebModule`.  To add a screen, add its module to
 * `defaultLocalWebModules()` and its nav entry to `LOCAL_WEB_SCREENS` in
 * `ui/local-web-shell.js`.
 */
export const LOCAL_WEB_HOST_VERSION = 'local-web-host.v1' as const;
/** One per-launch token guards every write on this host, including value-proof feedback. */
export const LOCAL_WEB_TOKEN_HEADER = VALUE_PROOF_REVIEW_TOKEN_HEADER;
export const LOCAL_WEB_DEFAULT_PORT = 31080;
/** Onboarding registers the owner as `self`; a graph without an owner id uses the same principal. */
export const LOCAL_WEB_DEFAULT_OWNER_ID = 'self';
export const LOCAL_WEB_STATUS_PATH = '/api/local/status';
export const LOCAL_WEB_WORLD_MODEL_PREFIX = '/api/world-model';
export const LOCAL_WEB_GRAPH_PREFIX = '/api/graph';
/**
 * An Objective is a few KB of text and criteria.  64 KiB leaves room for long
 * Japanese text (about 20k characters) while keeping a loopback request that
 * holds the SSOT lock far below the Fetch router's 1 MiB default.
 */
export const LOCAL_WEB_FOUNDATION_BODY_LIMIT_BYTES = 64 * 1024;
export const LOCAL_WEB_PROVENANCE_SOURCE_ID = 'brainbase-local-web';

const CANONICAL_FILES = ['graph.json', 'relationships.json', 'personal-kg.jsonl', 'decisions.jsonl'] as const;
const BASE_UI_FILES = ['brainbase-tokens.css', 'local-web-shell.js', 'local-web-shell.css'] as const;
const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
});

export type LocalGraphStatus = 'ready' | 'migration_required' | 'not_initialized' | 'unreadable';

export interface LocalGraphState {
  readonly status: LocalGraphStatus;
  readonly format: 'v1' | 'v2' | null;
  /** Trusted principal for Foundation/World Model access. Never read from the browser. */
  readonly ownerId: string | null;
  readonly message?: string;
}

export interface LocalWebModuleContext {
  readonly dataDir: string;
  readonly journalRoot: string;
  readonly token: string;
  readonly now: () => Date;
}

/**
 * Server side of one screen.  The host has already rejected a non-loopback
 * Host and every non-GET request without the launch token and same origin
 * before `handle` runs.  `handle` returns false for a path it does not own.
 */
export interface LocalWebModule {
  readonly id: string;
  /** Packaged `ui/` file names the screen loads.  Only listed files are served. */
  readonly uiFiles: readonly string[];
  handle(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
}

export interface LocalWebHostOptions {
  /** Personal OS data directory. Defaults to `BRAINBASE_PERSONAL_OS_DIR` or `~/.brainbase/personal-os`. */
  readonly dataDir?: string;
  /** Judgment journal root. Defaults to the journal inside the data directory. */
  readonly journalRoot?: string;
  readonly token?: string;
  /** Directory containing the packaged `ui/` files. */
  readonly uiDir?: string;
  readonly now?: () => Date;
}

export interface LocalWebHost {
  readonly server: Server;
  readonly token: string;
  readonly dataDir: string;
  readonly journalRoot: string;
}

/** True only for a write that carries the launch token from this origin. */
export function isTrustedLocalWrite(request: IncomingMessage, token: string): boolean {
  try {
    assertSameOrigin(request);
  } catch {
    return false;
  }
  return tokenMatches(token, request.headers[LOCAL_WEB_TOKEN_HEADER]);
}

function rejectUntrustedWrite(request: IncomingMessage, token: string): LocalWebHttpError | null {
  try {
    assertSameOrigin(request);
  } catch (error) {
    return error instanceof LocalWebHttpError ? error : new LocalWebHttpError(403, 'cross_origin_rejected', 'Origin is not allowed');
  }
  if (!tokenMatches(token, request.headers[LOCAL_WEB_TOKEN_HEADER])) {
    return new LocalWebHttpError(403, 'web_token_required', 'A valid launch token is required');
  }
  return null;
}

/** Reads the Graph format and owner without creating or migrating anything. */
export async function readLocalGraphState(dataDir: string): Promise<LocalGraphState> {
  const present: string[] = [];
  for (const file of CANONICAL_FILES) {
    try {
      await stat(join(dataDir, file));
      present.push(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { status: 'unreadable', format: null, ownerId: null, message: errorMessage(error) };
      }
    }
  }
  if (present.length === 0) return { status: 'not_initialized', format: null, ownerId: null };
  let os: PersonalOs;
  try {
    os = await loadPersonalOs(dataDir);
  } catch (error) {
    return { status: 'unreadable', format: null, ownerId: null, message: errorMessage(error) };
  }
  if (os.graph.version === 1) return { status: 'migration_required', format: 'v1', ownerId: null };
  const ownerId = os.graph.owner?.id;
  return {
    status: 'ready',
    format: 'v2',
    ownerId: typeof ownerId === 'string' && ownerId.trim() ? ownerId : LOCAL_WEB_DEFAULT_OWNER_ID
  };
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value) ? value : JSON.stringify(value);
}

function graphCommands(state: LocalGraphState, dataDir: string): string[] {
  const dir = shellArg(dataDir);
  if (state.status === 'migration_required') {
    // The CLI refuses a write without the digest of a fresh preview.
    return [
      `brainbase ontology:migrate --dir ${dir}`,
      `brainbase ontology:migrate --dir ${dir} --write --expected-input-digest <1行目で表示されたinputDigest>`
    ];
  }
  if (state.status === 'not_initialized') return [`brainbase onboard:init --dir ${dir}`];
  return [];
}

function writeGraphUnavailable(response: ServerResponse, state: LocalGraphState, dataDir: string): void {
  const code = state.status === 'migration_required' ? 'graph_migration_required'
    : state.status === 'not_initialized' ? 'personal_os_not_initialized'
      : 'personal_os_unreadable';
  const message = state.status === 'migration_required'
    ? 'Graph v1 must be migrated to v2 before objectives and the world model can be read or saved. This host never migrates automatically.'
    : state.status === 'not_initialized'
      ? 'The personal OS data directory has not been initialized.'
      : state.message ?? 'The personal OS data could not be read.';
  writeJson(response, 503, { error: { code, message, commands: graphCommands(state, dataDir) } });
}

export function createLocalStatusModule(context: LocalWebModuleContext): LocalWebModule {
  return {
    id: 'local-status',
    uiFiles: [],
    async handle(request, response) {
      if (requestUrl(request).pathname !== LOCAL_WEB_STATUS_PATH) return false;
      if (request.method !== 'GET') {
        writeJson(response, 405, { error: { code: 'method_not_allowed', message: 'Use GET' } });
        return true;
      }
      const graph = await readLocalGraphState(context.dataDir);
      writeJson(response, 200, {
        version: LOCAL_WEB_HOST_VERSION,
        data_dir: context.dataDir,
        journal_root: context.journalRoot,
        graph: {
          status: graph.status,
          format: graph.format,
          ...(graph.message ? { message: graph.message } : {}),
          commands: graphCommands(graph, context.dataDir)
        },
        // This host reads only the local data directory (C1 is not connected here).
        organization_graph: { status: 'not_connected' }
      });
      return true;
    }
  };
}

export function createValueProofModule(context: LocalWebModuleContext): LocalWebModule {
  const handler = createValueProofReviewHttpHandler({
    journalRoot: context.journalRoot,
    dataDir: context.dataDir,
    token: context.token,
    now: context.now
  });
  return {
    id: 'value-proofs',
    uiFiles: ['value-proof-review.js', 'value-proof-review.css'],
    handle: handler
  };
}

interface ReadableCollection<T> {
  readonly records: T[];
  readonly unreadable: { readonly count: number; readonly codes: string[] };
}

const NOTHING_UNREADABLE = Object.freeze({ count: 0, codes: [] as string[] });

function isFoundationDenial(error: unknown): error is FoundationStoreError {
  return error instanceof FoundationStoreError && (error.code === 'authorization_denied' || error.code === 'scope_violation');
}

/** Per-record refusals while reading one observation or adoption (its Variable/Model read included). */
function isWorldModelDenial(error: unknown): error is WorldModelStoreError | FoundationStoreError {
  return (error instanceof WorldModelStoreError && (error.code === 'authorization_denied' || error.code === 'invalid_input'))
    || isFoundationDenial(error);
}

/**
 * `FoundationRevisionStore.list` throws when one record is not readable.  One
 * foreign record must not hide every readable record, so on a denial each
 * latest record is read on its own and the unreadable ones are counted.
 */
async function listReadableFoundation(
  store: FoundationRevisionStore,
  dataDir: string,
  type: FoundationType,
  context: FoundationStoreContext
): Promise<ReadableCollection<FoundationCatalogRecord>> {
  try {
    return { records: await store.list(type, context), unreadable: NOTHING_UNREADABLE };
  } catch (error) {
    if (!isFoundationDenial(error)) throw error;
  }
  const os = await loadPersonalOs(dataDir);
  if (os.graph.version !== 2) throw new FoundationStoreError('unsupported_graph', 'Foundation reads require canonical Graph v2');
  const catalog = foundationCatalogOrEmpty(os.graph.foundation);
  const latest = catalog.records.filter((record) => record.definition.type === type
    && catalog.latest[foundationKey(record.definition)]?.revision === record.definition.revision);
  const records: FoundationCatalogRecord[] = [];
  const codes = new Set<string>();
  let count = 0;
  for (const record of latest) {
    try {
      const readable = await store.readLatest(type, record.definition.id, context);
      if (readable) records.push(readable);
    } catch (error) {
      if (!isFoundationDenial(error)) throw error;
      count += 1;
      codes.add(error.code);
    }
  }
  return { records, unreadable: { count, codes: [...codes] } };
}

function collectionPayload<T>(key: string, collection: ReadableCollection<T>): Record<string, unknown> {
  const { records, unreadable } = collection;
  const state = records.length > 0
    ? unreadable.count > 0 ? 'partial' : 'ready'
    : unreadable.count > 0 ? 'unknown' : 'empty';
  // Absence is confirmed only when every stored record was readable.
  return { state, [key]: records, absence_confirmed: unreadable.count === 0, unreadable };
}

function fetchJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

const OBJECTIVE_DOMAIN_FIELDS = [
  'meaning',
  'beneficiaryIds',
  'desiredState',
  'criteria',
  'evaluationPeriod',
  'accountableId',
  'adoptionState',
  'epistemicState'
] as const;

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

/** Copies only Objective domain fields; authority fields never come from the body. */
function objectiveDomainFields(body: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of OBJECTIVE_DOMAIN_FIELDS) if (body[key] !== undefined) picked[key] = body[key];
  const period = picked.evaluationPeriod;
  // An untouched period in the editor arrives as two empty strings: not set.
  if (period && typeof period === 'object' && !Array.isArray(period)
    && isBlank((period as Record<string, unknown>).from) && isBlank((period as Record<string, unknown>).until)) {
    delete picked.evaluationPeriod;
  }
  if (isBlank(picked.accountableId)) delete picked.accountableId;
  return picked;
}

/**
 * Trusted authority fields for a single owner.  The owner writes through the
 * launch-token browser session, so a new Objective is private to the owner,
 * scoped to the owner, and usable for drafting, judgment and evaluation.  It is
 * never authorized for execution from the Web.  Updates keep every authority
 * field byte-identical to the current revision.
 */
export function createLocalObjectiveDefinitionBuilder(now: () => Date): ObjectiveDefinitionBuilder {
  // Domain fields are proposals; the store validates them as a draft on save.
  return ({ operation, body, context, current }) => {
    const domain = objectiveDomainFields(body);
    if (operation === 'update') {
      if (!current) throw new FoundationStoreError('not_found', 'The current Objective is required for an update');
      return {
        ...domain,
        id: current.id,
        type: 'objective',
        revision: current.revision,
        acl: current.acl,
        scope: current.scope,
        storage: current.storage,
        provenance: current.provenance,
        authorizedUses: current.authorizedUses
      } as unknown as ObjectiveDefinition;
    }
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) throw new FoundationStoreError('invalid_input', 'id is required');
    return {
      ...domain,
      id,
      type: 'objective',
      revision: '1',
      acl: { ownerId: context.principal, visibility: 'private', readerIds: [], writerIds: [] },
      scope: { subjectIds: [context.principal], validFrom: now().toISOString() },
      storage: 'ontology',
      provenance: [{ sourceId: LOCAL_WEB_PROVENANCE_SOURCE_ID, sourceKind: 'document', evidenceIds: [] }],
      authorizedUses: ['draft', 'judgment', 'evaluation']
    } as unknown as ObjectiveDefinition;
  };
}

async function listObjectiveConstraintRefs(
  store: FoundationRevisionStore,
  dataDir: string,
  reference: FoundationRevision,
  context: FoundationStoreContext
): Promise<Record<string, unknown>> {
  const os = await loadPersonalOs(dataDir);
  if (os.graph.version !== 2) throw new FoundationStoreError('unsupported_graph', 'Foundation reads require canonical Graph v2');
  const catalog = foundationCatalogOrEmpty(os.graph.foundation);
  // `applies_to` names an exact Objective revision; it does not extend to other revisions.
  const sources = new Map<string, FoundationRevision>();
  for (const relation of catalog.relations) {
    if (relation.relation !== 'applies_to' || relation.source.type !== 'constraint') continue;
    if (relation.target.type !== 'objective' || relation.target.id !== reference.id || relation.target.revision !== reference.revision) continue;
    if (typeof relation.source.revision !== 'string') continue;
    const source = { id: relation.source.id, type: 'constraint' as const, revision: relation.source.revision };
    sources.set(JSON.stringify([source.id, source.revision]), source);
  }
  const refs: Record<string, unknown>[] = [];
  const codes = new Set<string>();
  let count = 0;
  for (const source of sources.values()) {
    try {
      const record = await store.read(source, context);
      if (!record) {
        count += 1;
        codes.add('not_found');
        continue;
      }
      refs.push({ ...source, digest: record.digest, meaning: record.definition.meaning });
    } catch (error) {
      if (!isFoundationDenial(error)) throw error;
      count += 1;
      codes.add(error.code);
    }
  }
  return collectionPayload('refs', { records: refs, unreadable: { count, codes: [...codes] } });
}

/**
 * Objective routes of `createObjectiveFoundationRoute`, wired to the local
 * Graph.  The principal is the Graph owner; the CSRF verifier is the host's
 * token and same-origin check on the original Node request.  Constraint links
 * are read-only because no OSS writer can replace them.
 */
export function createObjectiveFoundationModule(context: LocalWebModuleContext): LocalWebModule {
  const store = createFoundationRevisionStore({ dataDir: context.dataDir });
  const objectives = createCompanyOsObjectives(store);
  const principals = new WeakMap<Request, FoundationStoreContext>();
  const origins = new WeakMap<Request, IncomingMessage>();

  const listRoute: FoundationHttpRoute = {
    name: 'local-objective-list',
    methods: ['GET'],
    paths: ['GET /api/foundation/objectives'],
    matches(request) {
      return (request.method || 'GET').toUpperCase() === 'GET'
        && new URL(request.url, 'http://localhost').pathname === FOUNDATION_OBJECTIVE_ROUTE_PREFIX;
    },
    async handle(_request, input) {
      const listed = await listReadableFoundation(store, context.dataDir, 'objective', input.context);
      const records: Record<string, unknown>[] = [];
      for (const record of listed.records) {
        try {
          const readiness = await objectives.checkObjectiveReadiness(record.definition.id, input.context, record.definition.revision);
          records.push({ ...record, readiness });
        } catch {
          // Readiness stays unknown for this record; the list is still shown.
          records.push({ ...record });
        }
      }
      return fetchJson(200, collectionPayload('records', { records, unreadable: listed.unreadable }));
    }
  };

  const router = createFoundationHttpRouter({
    resolveContext: (request) => principals.get(request) ?? null,
    csrf: {
      verify(request) {
        const original = origins.get(request);
        return original !== undefined && isTrustedLocalWrite(original, context.token);
      }
    },
    bodyLimitBytes: LOCAL_WEB_FOUNDATION_BODY_LIMIT_BYTES,
    routes: [
      listRoute,
      createObjectiveFoundationRoute({
        objectives: {
          createObjective: objectives.createObjective.bind(objectives),
          readObjective: objectives.readObjective.bind(objectives),
          updateObjective: objectives.updateObjective.bind(objectives),
          checkObjectiveReadiness: objectives.checkObjectiveReadiness.bind(objectives),
          list: (type, listContext) => store.list(type, listContext)
        },
        buildDefinition: createLocalObjectiveDefinitionBuilder(context.now),
        listObjectiveConstraintRefs: (reference, listContext) => listObjectiveConstraintRefs(store, context.dataDir, reference, listContext),
        bodyLimitBytes: LOCAL_WEB_FOUNDATION_BODY_LIMIT_BYTES
      })
    ]
  });

  return {
    id: 'foundation-objectives',
    uiFiles: ['objective-editor.js', 'objective-editor.css', 'objective-editor-http-port.js'],
    async handle(request, response) {
      const path = requestUrl(request).pathname;
      if (path !== FOUNDATION_HTTP_PREFIX && !path.startsWith(`${FOUNDATION_HTTP_PREFIX}/`)) return false;
      const graph = await readLocalGraphState(context.dataDir);
      if (graph.status !== 'ready' || !graph.ownerId) {
        writeGraphUnavailable(response, graph, context.dataDir);
        return true;
      }
      const fetchRequest = await nodeRequestToFetch(request, { limitBytes: LOCAL_WEB_FOUNDATION_BODY_LIMIT_BYTES });
      principals.set(fetchRequest, { principal: graph.ownerId });
      origins.set(fetchRequest, request);
      await writeFetchResponse(response, await router.handle(fetchRequest));
      return true;
    }
  };
}

function worldModelError(error: unknown): LocalWebHttpError {
  if (error instanceof WorldModelStoreError) {
    const status = error.code === 'authorization_denied' ? 403
      : error.code === 'not_found' ? 404
        : error.code === 'unsupported_graph' || error.code === 'approval_reference_unresolved' ? 503
          : error.code === 'invalid_input' ? 400
            : 500;
    return new LocalWebHttpError(status, error.code, error.message);
  }
  if (error instanceof FoundationStoreError) {
    const status = error.code === 'authorization_denied' || error.code === 'scope_violation' ? 403
      : error.code === 'unsupported_graph' ? 503
        : error.code === 'invalid_input' ? 400
          : 500;
    return new LocalWebHttpError(status, error.code, error.message);
  }
  if (error instanceof LocalWebHttpError) return error;
  return new LocalWebHttpError(500, 'internal_error', 'World model read failed');
}

async function listReadableSidecarRecords<T>(input: {
  readonly listAll: () => Promise<readonly T[]>;
  readonly dataDir: string;
  readonly key: 'observations' | 'adoptions';
  readonly idField: 'id' | 'adoptionId';
  readonly readOne: (id: string) => Promise<T | null>;
}): Promise<ReadableCollection<T>> {
  try {
    return { records: [...await input.listAll()], unreadable: NOTHING_UNREADABLE };
  } catch (error) {
    if (!isWorldModelDenial(error)) throw error;
  }
  // The listing stopped at one unreadable record.  Enumerate the stored ids
  // and read each record through the store so its checks still apply.
  const raw = await readPersonalOsSidecar(input.dataDir, WORLD_MODEL_EVIDENCE_SIDECAR);
  const parsed = raw === undefined ? {} : JSON.parse(raw) as Record<string, unknown>;
  const stored = Array.isArray(parsed[input.key]) ? parsed[input.key] as Record<string, unknown>[] : [];
  const records: T[] = [];
  const codes = new Set<string>();
  let count = 0;
  for (const item of stored) {
    const id = item?.[input.idField];
    if (typeof id !== 'string') continue;
    try {
      const record = await input.readOne(id);
      if (record) records.push(record);
    } catch (error) {
      if (!isWorldModelDenial(error)) throw error;
      count += 1;
      codes.add(error.code);
    }
  }
  return { records, unreadable: { count, codes: [...codes] } };
}

/**
 * Read-only World Model routes.  Writes (observations, corrections, model
 * adoption) are not on the Web in v1.  Without an approval reader an approved
 * adoption cannot be verified, so only the adoptions route reports
 * `approval_reference_unresolved`; the other routes stay readable.
 */
export function createWorldModelReadModule(context: LocalWebModuleContext): LocalWebModule {
  const foundationStore = createFoundationRevisionStore({ dataDir: context.dataDir });
  const worldModel: WorldModelRecordStore = createWorldModelStore({ dataDir: context.dataDir, foundationStore });
  const resources = new Set(['variables', 'models', 'observations', 'adoptions']);

  async function read(resource: string, principal: WorldModelStoreContext): Promise<Record<string, unknown>> {
    switch (resource) {
      case 'variables':
        return collectionPayload('records', await listReadableFoundation(foundationStore, context.dataDir, 'variable', principal));
      case 'models':
        return collectionPayload('records', await listReadableFoundation(foundationStore, context.dataDir, 'model', principal));
      case 'observations':
        return collectionPayload('observations', await listReadableSidecarRecords({
          listAll: () => worldModel.listObservations(undefined, principal),
          dataDir: context.dataDir,
          key: 'observations',
          idField: 'id',
          readOne: (id) => worldModel.readObservation(id, principal)
        }));
      default:
        return collectionPayload('adoptions', await listReadableSidecarRecords({
          listAll: () => worldModel.listModelAdoptions(principal),
          dataDir: context.dataDir,
          key: 'adoptions',
          idField: 'adoptionId',
          readOne: (id) => worldModel.readModelAdoption(id, principal)
        }));
    }
  }

  return {
    id: 'world-model',
    uiFiles: ['world-model-view.js', 'world-model-view.css'],
    async handle(request, response) {
      const path = requestUrl(request).pathname;
      if (path !== LOCAL_WEB_WORLD_MODEL_PREFIX && !path.startsWith(`${LOCAL_WEB_WORLD_MODEL_PREFIX}/`)) return false;
      const resource = path.slice(LOCAL_WEB_WORLD_MODEL_PREFIX.length + 1);
      if (!resources.has(resource)) {
        writeJson(response, 404, { error: { code: 'not_found', message: 'Not found' } });
        return true;
      }
      if (request.method !== 'GET') {
        writeJson(response, 405, { error: { code: 'method_not_allowed', message: 'The world model is read-only here' } });
        return true;
      }
      const graph = await readLocalGraphState(context.dataDir);
      if (graph.status !== 'ready' || !graph.ownerId) {
        writeGraphUnavailable(response, graph, context.dataDir);
        return true;
      }
      try {
        writeJson(response, 200, await read(resource, { principal: graph.ownerId }));
      } catch (error) {
        writeHttpError(response, worldModelError(error));
      }
      return true;
    }
  };
}

/**
 * 「プロジェクトと関係者」 and 「情報と関係」: the local Graph read and correction
 * routes under `/api/graph`.  Graph v1 and a missing data set are answered by
 * the handler itself (`migration_required` / `not_initialized`), never as zero
 * items.  The host has already required the launch token and the same origin
 * for every write; the handler checks both again before it reads a body, so a
 * correction is never saved through a path that skipped the host check.
 */
export function createGraphWebModule(context: LocalWebModuleContext): LocalWebModule {
  const handler = createGraphWebHttpHandler({
    dataDir: context.dataDir,
    basePath: LOCAL_WEB_GRAPH_PREFIX,
    now: context.now,
    assertWriteAllowed(request) {
      if (isTrustedLocalWrite(request, context.token)) return;
      throw rejectUntrustedWrite(request, context.token)
        ?? new LocalWebHttpError(403, 'web_token_required', 'A valid launch token is required');
    }
  });
  return {
    id: 'graph',
    uiFiles: [
      'graph-view-shared.js',
      'graph-view-shared.css',
      'graph-projects-view.js',
      'graph-projects-view.css',
      'graph-registry-view.js',
      'graph-registry-view.css'
    ],
    handle: handler
  };
}

/** 今日 (value proofs), 目的と現状 (objectives + world model), プロジェクトと関係者 and 情報と関係 (Graph). */
export function defaultLocalWebModules(context: LocalWebModuleContext): LocalWebModule[] {
  return [
    createLocalStatusModule(context),
    createValueProofModule(context),
    createObjectiveFoundationModule(context),
    createWorldModelReadModule(context),
    createGraphWebModule(context)
  ];
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/gu, (character) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[character] ?? character));
}

function shellHtml(token: string, stylesheets: readonly string[]): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="brainbase-web-token" content="${escapeAttribute(token)}">
<title>Brainbase</title>
${stylesheets.map((file) => `<link rel="stylesheet" href="/ui/${escapeAttribute(file)}">`).join('\n')}
</head>
<body>
<div id="brainbase-local-web"></div>
<script type="module" src="/app.js"></script>
</body>
</html>
`;
}

const BOOTSTRAP_JS = `import { createLocalWebShell } from '/ui/local-web-shell.js';
const meta = (name) => document.querySelector(\`meta[name="\${name}"]\`)?.getAttribute('content') ?? '';
const screenFromHash = () => decodeURIComponent(location.hash.replace(/^#/, '')) || undefined;
const shell = createLocalWebShell({
  root: document.getElementById('brainbase-local-web'),
  token: meta('brainbase-web-token'),
  initialScreen: screenFromHash()
});
addEventListener('hashchange', () => shell.show(screenFromHash()));
`;

/** Local single-owner host. The caller owns `listen()` and must bind to a loopback address. */
export function createLocalWebHost(options: LocalWebHostOptions = {}): LocalWebHost {
  const token = options.token ?? randomBytes(24).toString('base64url');
  if (token.length < 16) throw new TypeError('token must be at least 16 characters');
  const dataDir = resolveDataDir(options.dataDir);
  const journalRoot = options.journalRoot ?? defaultJudgmentJournalRoot(dataDir);
  const uiDir = options.uiDir ?? fileURLToPath(new URL('../ui/', import.meta.url));
  const context: LocalWebModuleContext = { dataDir, journalRoot, token, now: options.now ?? (() => new Date()) };
  const modules = defaultLocalWebModules(context);
  const uiFiles = new Map<string, string>();
  for (const file of [...BASE_UI_FILES, ...modules.flatMap((module) => module.uiFiles)]) {
    const extension = file.slice(file.lastIndexOf('.'));
    const type = CONTENT_TYPES[extension];
    if (!type || file.includes('/')) throw new TypeError(`Unsupported UI file ${file}`);
    uiFiles.set(`/ui/${file}`, type);
  }
  const stylesheets = [...uiFiles.keys()].filter((path) => path.endsWith('.css')).map((path) => path.slice('/ui/'.length));

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!isLoopbackHost(request)) {
      writeJson(response, 403, { error: { code: 'host_rejected', message: 'Host must be a loopback address for this server' } });
      return;
    }
    if (request.method !== 'GET') {
      const rejected = rejectUntrustedWrite(request, token);
      if (rejected) {
        writeHttpError(response, rejected);
        return;
      }
    }
    for (const module of modules) {
      if (await module.handle(request, response)) return;
    }
    const path = requestUrl(request).pathname;
    if (request.method !== 'GET') {
      writeJson(response, 405, { error: { code: 'method_not_allowed', message: 'Use GET' } });
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (path === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('Content-Security-Policy', LOCAL_WEB_CONTENT_SECURITY_POLICY);
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.end(shellHtml(token, stylesheets));
      return;
    }
    if (path === '/app.js') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end(BOOTSTRAP_JS);
      return;
    }
    const type = uiFiles.get(path);
    if (!type) {
      writeJson(response, 404, { error: { code: 'not_found', message: 'Not found' } });
      return;
    }
    response.setHeader('Content-Type', type);
    response.end(await readFile(join(uiDir, path.slice('/ui/'.length))));
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (error instanceof LocalWebHttpError) writeHttpError(response, error);
      else writeJson(response, 500, { error: { code: 'internal_error', message: 'Unexpected error' } });
    });
  });
  return { server, token, dataDir, journalRoot };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
