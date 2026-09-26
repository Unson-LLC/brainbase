import {
  FOUNDATION_HTTP_CONTRACT_VERSION,
  createFoundationHttpRouter,
  type FoundationHttpCsrfVerifier,
  type FoundationHttpRouter
} from './foundation-http.js';
import { createFoundationPublicProvider, createFoundationPublicRoute } from './foundation-public-provider.js';
import { createGraphFoundationReaders, type GraphFoundationHistoryRow } from './graph-foundation-reader.js';
import type { FoundationStoreContext } from './foundation-store.js';

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
  readonly bodyLimitBytes?: number;
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
            query: async (text, values) => ({
              rows: (await client.query(text, values ?? [])).rows as readonly GraphFoundationHistoryRow[]
            })
          });
          const provider = createFoundationPublicProvider(readers);
          const route = createFoundationPublicRoute(provider);
          const handler = createFoundationHttpRouter({
            resolveContext: () => context,
            csrf: options.csrf,
            routes: [route],
            bodyLimitBytes
          });
          return handler.handle(request);
        });
        return response instanceof Response
          ? response
          : jsonResponse(503, { error: { code: 'foundation_provider_unavailable' } });
      } catch {
        return jsonResponse(503, { error: { code: 'foundation_provider_unavailable' } });
      }
    }
  };
}
