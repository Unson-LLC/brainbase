import {
  FOUNDATION_HTTP_CONTRACT_VERSION,
  createFoundationHttpRouter,
  createObjectiveFoundationRoute,
  type FoundationHttpCsrfVerifier,
  type FoundationHttpRoute,
  type FoundationHttpRouter,
  type ObjectiveDefinitionBuilder
} from './foundation-http.js';
import { checkObjectiveReadiness } from './company-os-objectives.js';
import { createFoundationPublicProvider, createFoundationPublicRoute } from './foundation-public-provider.js';
import { createGraphFoundationReaders, type GraphFoundationHistoryRow, type GraphFoundationReaders } from './graph-foundation-reader.js';
import { FoundationStoreError, type FoundationStoreContext } from './foundation-store.js';
import { digestFoundationDefinition, nextFoundationRevision, type FoundationRef } from './foundation-catalog.js';
import { validateFoundationGraphWrite } from './foundation-graph-write.js';
import type { ObjectiveDefinition } from './ontology-foundation.js';

/**
 * Readiness probe for the Graph history contract used by the public adapter.
 *
 * The query is deliberately kept in the reusable adapter.  Hosts provide the
 * transaction-bound query port, while the migration remains the authority for
 * RLS and immutable-history trigger state.
 */
export const FOUNDATION_GRAPH_READY_SQL = `SELECT
    EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.graph_foundation_revisions') AND relrowsecurity)
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.graph_entities')
        AND tgname = 'graph_entities_foundation_history_capture' AND tgenabled = 'O' AND tgtype = 21
        AND tgfoid = to_regprocedure('public.capture_graph_foundation_revision()'))
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.graph_foundation_revisions')
        AND tgname = 'graph_foundation_revisions_guard' AND tgenabled = 'O' AND tgtype = 31
        AND tgfoid = to_regprocedure('public.guard_graph_foundation_revision_mutation()'))
    AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.graph_foundation_revisions')
        AND tgname = 'graph_foundation_revisions_truncate_guard' AND tgenabled = 'O' AND tgtype = 34
        AND tgfoid = to_regprocedure('public.guard_graph_foundation_revision_mutation()')) AS ready`;

export const FOUNDATION_GRAPH_CONTRACT_VERSION = 'foundation-graph-http.v1' as const;
export const FOUNDATION_OVERVIEW_CONTRACT_VERSION = 'foundation-overview.v1' as const;
const FOUNDATION_CATALOG_PATH = '/api/foundation/catalog' as const;

type MaybePromise<T> = T | Promise<T>;

export interface FoundationGraphTrustedIdentity {
  /** Canonical principal supplied by the host authentication boundary. */
  readonly principal: string;
  /** Canonical organization scope supplied by the host authentication boundary. */
  readonly organizationId: string;
  /** Project scopes the authenticated principal may select. `*` is supported by hosts. */
  readonly projectScopeIds: readonly string[];
}

export interface FoundationGraphQueryResult {
  readonly rows: readonly Record<string, unknown>[];
}

export interface FoundationGraphQueryClient {
  query(text: string, values?: readonly unknown[]):
    | FoundationGraphQueryResult
    | Promise<FoundationGraphQueryResult>;
}

export interface FoundationGraphHttpOptions {
  /** Resolve only trusted identity; request body and query values are never used for identity. */
  readonly resolveTrustedIdentity: (
    request: Request
  ) => MaybePromise<FoundationGraphTrustedIdentity | null>;
  /** Run the shared provider inside the host's authenticated transaction/context. */
  readonly withAccessContext: <T>(
    identity: FoundationGraphTrustedIdentity,
    callback: (client: FoundationGraphQueryClient) => Promise<T>
  ) => Promise<T>;
  /** Host-owned CSRF verification port for mutation requests. */
  readonly csrf?: FoundationHttpCsrfVerifier;
  /** Canonical host writer, using this request's authenticated transaction.
   * Must enforce current ACL, tenant/project access and expectedRevision CAS;
   * null means create-only. Never connect a low-level or maintenance writer.
   */
  readonly writeObjectiveDraft?: (input: FoundationGraphObjectiveWriteInput) => Promise<void>;
  readonly bodyLimitBytes?: number;
}

export interface FoundationGraphObjectiveWriteInput {
  readonly definition: ObjectiveDefinition;
  readonly expectedRevision: string | null;
  readonly projectCode: string;
  readonly identity: FoundationGraphTrustedIdentity;
  readonly client: FoundationGraphQueryClient;
}

class FoundationGraphResponseError extends Error {
  constructor(readonly response: Response) {
    super('Foundation mutation was rejected');
  }
}

/** Domain proposals can never supply the host's authority or provenance. */
function graphObjectiveBuilder(projectCode: string): ObjectiveDefinitionBuilder {
  return ({ operation, body, context, current, expectedRevision }) => {
    if (body.adoptionState !== undefined && body.adoptionState !== 'draft') {
      throw new FoundationStoreError('invalid_input', 'Objective writes accept draft definitions only');
    }
    const domain: Record<string, unknown> = {};
    for (const key of ['meaning', 'desiredState', 'beneficiaryIds', 'criteria', 'evaluationPeriod', 'accountableId', 'epistemicState']) {
      if (body[key] !== undefined) domain[key] = body[key];
    }
    const blank = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && !value.trim());
    if (isRecord(domain.evaluationPeriod)
      && blank(domain.evaluationPeriod.from) && blank(domain.evaluationPeriod.until)) delete domain.evaluationPeriod;
    if (blank(domain.accountableId)) delete domain.accountableId;
    if (operation === 'update') {
      if (!current) throw new FoundationStoreError('not_found', 'The current Objective is required');
      if (current.revision !== expectedRevision) {
        throw new FoundationStoreError('revision_conflict', 'Objective changed; reload before saving', { currentRevision: current.revision });
      }
      return {
        ...domain, id: current.id, type: 'objective', revision: nextFoundationRevision(current.revision),
        adoptionState: 'draft', acl: current.acl, scope: current.scope, storage: current.storage,
        provenance: current.provenance, authorizedUses: current.authorizedUses
      } as unknown as ObjectiveDefinition;
    }
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) throw new FoundationStoreError('invalid_input', 'id is required');
    return {
      ...domain, id, type: 'objective', revision: '1', adoptionState: 'draft',
      acl: { ownerId: context.principal, visibility: 'private', readerIds: [], writerIds: [] },
      scope: { subjectIds: [projectCode], validFrom: new Date().toISOString() },
      storage: 'candidate', authorizedUses: ['draft'],
      provenance: [{ sourceId: 'foundation-objective-editor', sourceKind: 'candidate', evidenceIds: [] }]
    } as unknown as ObjectiveDefinition;
  };
}

const DEFAULT_BODY_LIMIT_BYTES = 65_536;
const DIRECT_FOUNDATION_REFERENCE_KINDS = new Set(['objective', 'variable', 'model', 'constraint', 'philosophy']);
const SNAPSHOT_REFERENCE_KINDS = new Set([
  'entity', 'edge', 'objective', 'criterion', 'variable', 'observation', 'model', 'constraint',
  'philosophy', 'authority', 'resource', 'deadline', 'dag', 'evidence'
]);
const FOUNDATION_SCOPE_TYPES = new Set(['personal', 'project', 'organization']);

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function methodNotAllowed(allow: readonly string[]): Response {
  return new Response(JSON.stringify({ error: { code: 'method_not_allowed' } }), {
    status: 405,
    headers: {
      'content-type': 'application/json',
      allow: allow.join(', ')
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Return true only for the canonical scope shape. Incomplete or extended
 * shapes stay on the shared validator path so it remains the source of
 * malformed-input errors.
 */
function isCanonicalFoundationScope(value: unknown): value is { type: string; id: string } {
  return isRecord(value)
    && Object.keys(value).length === 2
    && typeof value.type === 'string'
    && typeof value.id === 'string'
    && value.type.length > 0
    && value.id.length > 0
    && value.type === value.type.trim()
    && value.id === value.id.trim();
}

function isSelectedProjectScope(value: unknown, scopeId: string): boolean {
  return isCanonicalFoundationScope(value) && value.type === 'project' && value.id === scopeId;
}

function isAllowedFoundationReference(
  reference: unknown,
  scopeId: string,
  organizationId: string,
  knownKinds: ReadonlySet<string>
): boolean {
  if (!isRecord(reference) || !isCanonicalFoundationScope(reference.scope)) return true;
  // Let the common validator report a missing/non-string kind as malformed;
  // every present non-philosophy kind remains project-scoped.
  if (typeof reference.kind !== 'string' || reference.kind.length === 0 || reference.kind !== reference.kind.trim()) return true;
  // Unknown kinds and scope types remain the shared validator's responsibility.
  // This boundary only narrows otherwise valid references.
  if (!knownKinds.has(reference.kind) || !FOUNDATION_SCOPE_TYPES.has(reference.scope.type)) return true;
  return isSelectedProjectScope(reference.scope, scopeId)
    || (reference.kind === 'philosophy'
      && reference.scope.type === 'organization'
      && reference.scope.id === organizationId);
}

/**
 * Reject scope widening before the common provider sees a request. The
 * provider receives both the selected project and trusted organization so an
 * organization philosophy can resolve, but all other foundation references
 * remain project-scoped and measurements remain project-only.
 */
function hasFoundationScopeOverride(
  request: Request,
  body: unknown,
  scopeId: string,
  organizationId: string
): boolean {
  const method = (request.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(method) || !isRecord(body)) return false;
  const pathname = new URL(request.url).pathname;
  if (pathname.endsWith('/judgment-references/validate')) {
    return isRecord(body.reference)
      && !isAllowedFoundationReference(body.reference, scopeId, organizationId, DIRECT_FOUNDATION_REFERENCE_KINDS);
  }
  if (!pathname.endsWith('/judgment-problems/validate')) return false;

  const snapshot = body.snapshot;
  if (!isRecord(snapshot)) return false;
  if (Object.hasOwn(snapshot, 'owner_scope')
    && isCanonicalFoundationScope(snapshot.owner_scope)
    && FOUNDATION_SCOPE_TYPES.has(snapshot.owner_scope.type)
    && !isSelectedProjectScope(snapshot.owner_scope, scopeId)) {
    return true;
  }
  if (!Array.isArray(snapshot.references)) return false;
  return snapshot.references.some((reference) => {
    if (!isRecord(reference)) return false;
    if (Object.hasOwn(reference, 'scope')
      && !isAllowedFoundationReference(reference, scopeId, organizationId, SNAPSHOT_REFERENCE_KINDS)) {
      return true;
    }
    const measurement = reference.measurement;
    const measurementScope = isRecord(measurement) ? measurement.scope : undefined;
    const subjectIds = isRecord(measurementScope) ? measurementScope.subjectIds : undefined;
    // Incomplete subjectIds remain the shared validator's responsibility.
    return Array.isArray(subjectIds)
      && subjectIds.length > 0
      && subjectIds.every((subjectId) => typeof subjectId === 'string'
        && subjectId === subjectId.trim()
        && subjectId.length > 0)
      && subjectIds.some((subjectId) => subjectId !== scopeId);
  });
}

async function readJsonForScopeCheck(request: Request, bodyLimitBytes: number): Promise<unknown | null> {
  const method = (request.method || 'GET').toUpperCase();
  const pathname = new URL(request.url).pathname;
  if (!['POST', 'PUT', 'PATCH'].includes(method)
    || (!pathname.endsWith('/judgment-references/validate') && !pathname.endsWith('/judgment-problems/validate'))) {
    return null;
  }
  try {
    const body = await request.clone().text();
    if (new TextEncoder().encode(body).byteLength > bodyLimitBytes) return null;
    return JSON.parse(body);
  } catch {
    // The shared route owns malformed JSON errors. A failed preflight must not
    // turn malformed input into an authorization decision.
    return null;
  }
}

async function catalogRequestHasBody(request: Request, bodyLimitBytes: number): Promise<boolean> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 0) return true;
  if (Number.isFinite(contentLength) && contentLength > bodyLimitBytes) return true;
  if (!request.body) return false;
  try {
    return (await request.clone().text()).length > 0;
  } catch {
    return true;
  }
}

function catalogQueryIsStrict(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    if (key !== 'scope_id') return false;
  }
  return true;
}

function identityIsValid(identity: FoundationGraphTrustedIdentity | null): identity is FoundationGraphTrustedIdentity {
  if (!identity) return false;
  return typeof identity.principal === 'string'
    && identity.principal.trim().length > 0
    && typeof identity.organizationId === 'string'
    && identity.organizationId.trim().length > 0
    && Array.isArray(identity.projectScopeIds);
}

function selectedScopeIsAllowed(identity: FoundationGraphTrustedIdentity, scopeId: string): boolean {
  return identity.projectScopeIds.includes('*') || identity.projectScopeIds.includes(scopeId);
}

function readyResult(result: FoundationGraphQueryResult): boolean {
  return result.rows[0]?.ready === true;
}

function createFoundationCatalogRoute(
  readers: GraphFoundationReaders,
  scopeId: string,
  context: FoundationStoreContext
): FoundationHttpRoute {
  return {
    name: 'foundation-catalog',
    methods: ['GET'],
    paths: [`GET ${FOUNDATION_CATALOG_PATH}`],
    matches(request) {
      return new URL(request.url).pathname === FOUNDATION_CATALOG_PATH;
    },
    async handle(request) {
      if ((request.method || 'GET').toUpperCase() !== 'GET') return methodNotAllowed(['GET']);

      // Resolve all collections before constructing the response. A failed
      // history/ACL read must never be represented as an empty partial catalog.
      const objectives = await readers.store.list('objective', context);
      const variables = await readers.store.list('variable', context);
      const models = await readers.store.list('model', context);
      const philosophies = await readers.listPhilosophies(context);
      return jsonResponse(200, {
        contractVersion: FOUNDATION_OVERVIEW_CONTRACT_VERSION,
        scopeId,
        objectives,
        variables,
        models,
        philosophies
      });
    }
  };
}

/**
 * Create the reusable Graph-backed public Foundation handler.
 *
 * This is a native Fetch-style adapter. It has no Express, authentication, or
 * organization dependency: a host injects a trusted identity resolver, an
 * already-authenticated transaction port, and its CSRF verifier.
 */
export function createFoundationGraphHttpHandler(options: FoundationGraphHttpOptions): FoundationHttpRouter {
  if (!options || typeof options.resolveTrustedIdentity !== 'function') {
    throw new TypeError('resolveTrustedIdentity is required');
  }
  if (typeof options.withAccessContext !== 'function') {
    throw new TypeError('withAccessContext is required');
  }
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  if (!Number.isInteger(bodyLimitBytes) || bodyLimitBytes <= 0) {
    throw new TypeError('bodyLimitBytes must be a positive integer');
  }

  return {
    contractVersion: FOUNDATION_HTTP_CONTRACT_VERSION,
    routes: [],
    async handle(request: Request): Promise<Response> {
      let identity: FoundationGraphTrustedIdentity | null;
      try {
        identity = await options.resolveTrustedIdentity(request);
      } catch {
        identity = null;
      }
      if (!identityIsValid(identity)) {
        return jsonResponse(403, { error: { code: 'foundation_trusted_context_required' } });
      }

      const url = new URL(request.url);
      const scopeIds = url.searchParams.getAll('scope_id');
      if (scopeIds.length !== 1 || !scopeIds[0]?.trim() || scopeIds[0] !== scopeIds[0].trim()) {
        return jsonResponse(400, { error: { code: 'scope_id_required' } });
      }
      const scopeId = scopeIds[0];
      if (!selectedScopeIsAllowed(identity, scopeId)) {
        return jsonResponse(403, { error: { code: 'scope_not_allowed' } });
      }

      const isCatalog = url.pathname === FOUNDATION_CATALOG_PATH;
      if (isCatalog && (request.method || 'GET').toUpperCase() !== 'GET') {
        return methodNotAllowed(['GET']);
      }
      if (isCatalog && !catalogQueryIsStrict(url)) {
        return jsonResponse(400, { error: { code: 'unknown_query_parameter' } });
      }
      if (isCatalog && await catalogRequestHasBody(request, bodyLimitBytes)) {
        return jsonResponse(400, { error: { code: 'body_not_allowed' } });
      }

      const body = await readJsonForScopeCheck(request, bodyLimitBytes);
      if (hasFoundationScopeOverride(request, body, scopeId, identity.organizationId)) {
        return jsonResponse(403, { error: { code: 'scope_not_allowed' } });
      }

      const context: FoundationStoreContext = {
        principal: identity.principal,
        scope: {
          subjectIds: [scopeId, identity.organizationId],
          validFrom: '1970-01-01T00:00:00Z'
        }
      };

      try {
        const response = await options.withAccessContext(identity, async (client) => {
          let ready;
          try {
            ready = await client.query(FOUNDATION_GRAPH_READY_SQL);
          } catch {
            return jsonResponse(503, { error: { code: 'foundation_provider_unavailable' } });
          }
          if (!readyResult(ready)) {
            return jsonResponse(503, { error: { code: 'foundation_migration_required' } });
          }

          const readers = createGraphFoundationReaders({
            context,
            selectedProjectCode: scopeId,
            query: async (text, values) => ({
              rows: (await client.query(text, values ?? [])).rows as readonly GraphFoundationHistoryRow[]
            })
          });
          const provider = createFoundationPublicProvider(readers);
          const route = createFoundationPublicRoute(provider);
          const catalogRoute = createFoundationCatalogRoute(readers, scopeId, context);
          const writeObjective = async (definition: ObjectiveDefinition, expectedRevision: string | null): Promise<FoundationRef> => {
            if (!options.writeObjectiveDraft) {
              throw new FoundationStoreError('unsupported_graph', 'Objective writes are not configured');
            }
            const current = expectedRevision === null ? undefined
              : await readers.store.readLatest('objective', definition.id, context);
            if (expectedRevision !== null && !current) throw new FoundationStoreError('not_found', 'Objective was not found');
            if (current && current.definition.revision !== expectedRevision) {
              throw new FoundationStoreError('revision_conflict', 'Objective changed; reload before saving', { currentRevision: current.definition.revision });
            }
            const checked = validateFoundationGraphWrite({
              context: { principal: identity.principal, projectCode: scopeId },
              row: { id: definition.id, type: 'objective', projectCode: scopeId, revision: definition.revision, payload: { foundation: definition } },
              expectedNextRevision: expectedRevision === null ? '1' : nextFoundationRevision(expectedRevision),
              ...(current ? { currentDefinition: current.definition } : {})
            });
            if (!checked.valid || !checked.normalized) {
              const denied = checked.issues.some((issue) => ['WRITER_NOT_AUTHORIZED', 'OWNER_MISMATCH', 'ACL_CHANGE_FORBIDDEN', 'SCOPE_VIOLATION'].includes(issue.code));
              throw new FoundationStoreError(denied ? 'authorization_denied' : 'invalid_input', 'Objective draft validation failed');
            }
            const candidate = checked.normalized.definition as ObjectiveDefinition;
            await options.writeObjectiveDraft({ definition: candidate, expectedRevision, projectCode: scopeId, identity, client });
            const saved = await readers.store.read({ id: candidate.id, type: 'objective', revision: candidate.revision }, context);
            const digest = digestFoundationDefinition(candidate);
            if (!saved || saved.digest !== digest) {
              throw new FoundationStoreError('readback_mismatch', 'The saved Objective revision could not be verified');
            }
            return { id: candidate.id, type: 'objective', revision: candidate.revision, digest };
          };
          const objectiveRoute = createObjectiveFoundationRoute({
            ...(options.writeObjectiveDraft ? { buildDefinition: graphObjectiveBuilder(scopeId) } : {}),
            bodyLimitBytes,
            objectives: {
              createObjective: (definition) => writeObjective(definition, null),
              async readObjective(id, objectiveContext, revision) {
                return revision === undefined
                  ? readers.store.readLatest('objective', id, objectiveContext)
                  : readers.store.read({ id, type: 'objective', revision }, objectiveContext);
              },
              updateObjective: (_id, expectedRevision, definition) => writeObjective(definition, expectedRevision),
              async checkObjectiveReadiness(id, objectiveContext, revision) {
                return checkObjectiveReadiness(readers.store, id, objectiveContext, revision);
              },
              list: (type, objectiveContext) => readers.store.list(type, objectiveContext)
            }
          });
          const handler = createFoundationHttpRouter({
            resolveContext: () => context,
            csrf: options.csrf,
            routes: [catalogRoute, route, objectiveRoute],
            bodyLimitBytes
          });
          const result = await handler.handle(request);
          // The common HTTP router renders domain errors. Re-throw the response
          // until the host transaction rolls back, including failed readback.
          if (!['GET', 'HEAD'].includes(request.method.toUpperCase()) && result.status >= 400) {
            throw new FoundationGraphResponseError(result);
          }
          return result;
        });
        return response instanceof Response
          ? response
          : jsonResponse(503, { error: { code: 'foundation_provider_unavailable' } });
      } catch (error) {
        if (error instanceof FoundationGraphResponseError) return error.response;
        return jsonResponse(503, { error: { code: 'foundation_provider_unavailable' } });
      }
    }
  };
}
