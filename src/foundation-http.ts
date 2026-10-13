import type { CompanyOsObjectives, ObjectiveReadiness } from './company-os-objectives.js';
import { FoundationStoreError, type FoundationRevisionStore, type FoundationStoreContext } from './foundation-store.js';
import type { FoundationRef } from './foundation-catalog.js';
import type {
  FoundationDefinition,
  FoundationRevision,
  ObjectiveDefinition,
} from './ontology-foundation.js';
import type {
  FoundationCatalogRecord,
  ObjectiveReadback,
  ObjectiveReadbackReason,
  ObjectiveReadbackSource,
  ObjectiveReadbackStatus,
} from './types.js';

/**
 * HTTP boundary shared by the OSS Objective UI and organization adapters.
 *
 * This module intentionally exposes a Fetch-style route handler instead of
 * opening a listener.  A local host can mount it beside Reservation,
 * Decision, or another Company OS route on one server.  Authentication,
 * tenant scope, and CSRF are supplied by that host; none of them are read
 * from a JSON request body.
 */
export const FOUNDATION_HTTP_CONTRACT_VERSION = 'brainbase.foundation-http.v1' as const;
export const FOUNDATION_HTTP_PREFIX = '/api/foundation' as const;
export const FOUNDATION_OBJECTIVE_ROUTE_PREFIX = `${FOUNDATION_HTTP_PREFIX}/objectives` as const;
export const FOUNDATION_OBJECTIVE_READBACK_CONTRACT_VERSION = 'brainbase.objective-readback.v1' as const;
export const FOUNDATION_OBJECTIVE_ROUTES = Object.freeze([
  'GET /api/foundation/objectives',
  'GET /api/foundation/objectives/:id',
  'GET /api/foundation/objectives/:id/readiness',
  'GET /api/foundation/objectives/:id/constraints',
  'PUT /api/foundation/objectives/:id/constraints',
  'POST /api/foundation/objectives',
  'PUT /api/foundation/objectives/:id',
  'GET /api/foundation/stories/:id/objectives',
]);

type MaybePromise<T> = T | Promise<T>;

export interface FoundationHttpRouteContext {
  /** Resolved by the host's trusted auth/tenant boundary. */
  readonly context: FoundationStoreContext;
  readonly request: Request;
}

/**
 * A route is deliberately a small composable unit.  `null` means that the
 * route does not own this request, allowing a reservation/decision route to
 * be mounted beside it without a second server or a route-specific BFF.
 */
export interface FoundationHttpRoute {
  readonly name: string;
  readonly methods: readonly string[];
  readonly paths: readonly string[];
  matches(request: Request): boolean;
  handle(request: Request, input: FoundationHttpRouteContext): Promise<Response>;
}

export interface FoundationHttpCsrfVerifier {
  verify(request: Request, context: FoundationStoreContext): MaybePromise<void | boolean>;
}

export interface FoundationHttpRouterOptions {
  /** Return null to fail closed before any route handler is called. */
  resolveContext(request: Request): MaybePromise<FoundationStoreContext | null>;
  /** Mutation routes return 501 when no verifier is configured. */
  csrf?: FoundationHttpCsrfVerifier;
  routes: readonly FoundationHttpRoute[];
  bodyLimitBytes?: number;
}

export interface FoundationHttpRouter {
  readonly contractVersion: typeof FOUNDATION_HTTP_CONTRACT_VERSION;
  readonly routes: readonly FoundationHttpRoute[];
  handle(request: Request): Promise<Response>;
}

export interface ObjectiveDefinitionBuilderInput {
  operation: 'create' | 'update';
  /** Sanitized domain fields. Authorization fields have already been rejected. */
  body: Readonly<Record<string, unknown>>;
  context: FoundationStoreContext;
  current?: ObjectiveDefinition;
  expectedRevision?: string;
}

/**
 * Hosts must construct ACL/scope/provenance/storage from trusted context.  A
 * request body is only a proposal for domain fields and cannot authorize a
 * tenant, principal, visibility, or permitted use.
 */
export type ObjectiveDefinitionBuilder = (
  input: ObjectiveDefinitionBuilderInput
) => MaybePromise<ObjectiveDefinition>;

export interface ObjectiveFoundationHttpRouteOptions {
  objectives: Pick<
    CompanyOsObjectives,
    'createObjective' | 'readObjective' | 'updateObjective' | 'checkObjectiveReadiness'
  > & { list?(type: 'objective', context: FoundationStoreContext): Promise<FoundationCatalogRecord[]> };
  /** Required for writes; the host supplies trusted ACL/scope fields. */
  buildDefinition?: ObjectiveDefinitionBuilder;
  /** Typed relation reads remain owned by the Story provider. */
  listStoryObjectiveLinks?: (
    storyId: string,
    context: FoundationStoreContext
  ) => MaybePromise<unknown>;
  /** Constraint relation reads/writes remain owned by the canonical adapter. */
  listObjectiveConstraintRefs?: (
    reference: FoundationRevision,
    context: FoundationStoreContext
  ) => MaybePromise<unknown>;
  replaceObjectiveConstraintRefs?: (
    reference: FoundationRef,
    refs: readonly FoundationRevision[],
    context: FoundationStoreContext
  ) => MaybePromise<unknown>;
  /** Injectable clock for deterministic readback evidence; production uses the real clock. */
  clock?: () => Date;
  bodyLimitBytes?: number;
}

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const OBJECTIVE_READBACK_STATUSES: readonly ObjectiveReadbackStatus[] = ['ready', 'error', 'unknown'];
const FOUNDATION_PROVENANCE_KINDS = new Set(['candidate', 'document', 'observation', 'decision', 'import']);
const AUTHORITY_FIELDS = new Set([
  'acl',
  'scope',
  'storage',
  'provenance',
  'authorizedUses',
  'authorized_uses',
  'ownerId',
  'owner_id',
  'userId',
  'user_id',
  'memberId',
  'member_id',
  'readerIds',
  'reader_ids',
  'writerIds',
  'writer_ids',
  'tenant',
  'subjectIds',
  'subject_ids',
  'tenantId',
  'tenant_id',
  'organization',
  'organization_id',
  'organizationId',
  'org',
  'orgId',
  'org_id',
  'workspace',
  'workspaceId',
  'workspace_id',
  'principal',
  'actor',
  'actorId',
  'actor_id',
  'role',
  'roles',
  'raci',
  'authorization',
  'permission',
  'permissions',
]);

/** Typed, explicitly sanitized error for trusted host adapters. */
export class FoundationHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly currentRevision?: string;

  constructor(status: number, code: string, message: string, options: { currentRevision?: string } = {}) {
    super(message);
    this.name = 'FoundationHttpError';
    this.status = status;
    this.code = code;
    this.currentRevision = options.currentRevision;
  }
}

/**
 * Runtime guard for the Objective detail contract.  It is exported so a BFF
 * can fail closed when a canonical host returns an old or malformed payload.
 * The guard only accepts source metadata that agrees with the returned
 * FoundationCatalogRecord; it never creates a source from request data.
 */
export function isObjectiveReadbackPayload(value: unknown): value is ObjectiveReadback {
  const object = asRecord(value);
  if (!object
    || object.contract_version !== FOUNDATION_OBJECTIVE_READBACK_CONTRACT_VERSION
    || !OBJECTIVE_READBACK_STATUSES.includes(object.status)
    || !isCanonicalIsoTimestamp(object.checked_at)) {
    return false;
  }

  if (object.status === 'ready') {
    if (object.reason !== null) return false;
    const record = objectiveReadbackRecord(object.record);
    const objective = objectiveReadbackRecord(object.objective);
    const source = objectiveReadbackSourceValue(object.source);
    if (!record || !objective || !source) return false;
    return sameObjectiveIdentity(record, objective)
      && source.source_id === record.definition.id
      && source.source_version === record.definition.revision
      && source.digest === record.digest
      && JSON.stringify(source.provenance) === JSON.stringify(record.definition.provenance);
  }

  return object.source === null
    && object.record === null
    && object.objective === null
    && objectiveReadbackReason(object.reason) !== null;
}

function objectiveReadbackSourceFromRecord(record: FoundationCatalogRecord): ObjectiveReadbackSource | null {
  const normalized = objectiveReadbackRecord(record);
  if (!normalized) return null;
  return {
    source_type: 'foundation_revision_store',
    source_id: normalized.definition.id,
    source_version: normalized.definition.revision,
    digest: normalized.digest,
    // Keep the exact canonical provenance array.  Do not derive it from the
    // request, a UI label, or a BFF projection.
    provenance: normalized.definition.provenance,
  };
}

function objectiveReadbackPayload(
  status: ObjectiveReadbackStatus,
  checkedAt: string,
  record: FoundationCatalogRecord | null,
  reason: ObjectiveReadbackReason | null,
): ObjectiveReadback {
  const source = status === 'ready' && record ? objectiveReadbackSourceFromRecord(record) : null;
  if (status === 'ready' && (!source || !record)) {
    throw new Error('objective_readback_source_unavailable');
  }
  return {
    contract_version: FOUNDATION_OBJECTIVE_READBACK_CONTRACT_VERSION,
    status,
    source,
    checked_at: checkedAt,
    record: status === 'ready' ? record : null,
    objective: status === 'ready' ? record : null,
    reason: status === 'ready' ? null : reason,
  };
}

function objectiveReadbackReason(value: unknown): ObjectiveReadbackReason | null {
  const object = asRecord(value);
  if (!object || typeof object.code !== 'string' || !object.code.trim()
    || typeof object.message !== 'string' || !object.message.trim()) return null;
  return { code: object.code, message: object.message };
}

function objectiveReadbackRecord(value: unknown): FoundationCatalogRecord | null {
  const object = asRecord(value);
  const definition = asRecord(object?.definition);
  if (!object || !definition || definition.type !== 'objective'
    || typeof definition.id !== 'string' || !definition.id.trim()
    || typeof definition.revision !== 'string' || !definition.revision.trim()
    || typeof object.digest !== 'string' || !object.digest.trim()
    || !Array.isArray(definition.provenance)
    || !definition.provenance.every(isFoundationProvenance)) return null;
  return object as FoundationCatalogRecord;
}

function objectiveReadbackMatchesRequest(
  record: FoundationCatalogRecord,
  requestedId: string,
  requestedRevision?: string,
): boolean {
  return record.definition.id === requestedId
    && (!requestedRevision || record.definition.revision === requestedRevision);
}

function objectiveReadbackSourceValue(value: unknown): ObjectiveReadbackSource | null {
  const object = asRecord(value);
  if (!object || object.source_type !== 'foundation_revision_store'
    || typeof object.source_id !== 'string' || !object.source_id.trim()
    || typeof object.source_version !== 'string' || !object.source_version.trim()
    || typeof object.digest !== 'string' || !object.digest.trim()
    || !Array.isArray(object.provenance)
    || !object.provenance.every(isFoundationProvenance)) return null;
  return object as ObjectiveReadbackSource;
}

function isFoundationProvenance(value: unknown): boolean {
  const object = asRecord(value);
  if (!object) return false;
  return typeof object.sourceId === 'string'
    && object.sourceId.trim().length > 0
    && typeof object.sourceKind === 'string'
    && FOUNDATION_PROVENANCE_KINDS.has(object.sourceKind)
    && Array.isArray(object.evidenceIds)
    && object.evidenceIds.every((id: unknown) => typeof id === 'string');
}

function sameObjectiveIdentity(left: FoundationCatalogRecord, right: FoundationCatalogRecord): boolean {
  return left.definition.id === right.definition.id
    && left.definition.revision === right.definition.revision
    && left.digest === right.digest;
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

/**
 * Compose OSS Company OS routes under one local server boundary.  The
 * resolver is called only for a matching route and the resulting trusted
 * context is passed to that route.  Unknown routes remain an ordinary 404 so
 * the host can mount this handler beside other app routes.
 */
export function createFoundationHttpRouter(options: FoundationHttpRouterOptions): FoundationHttpRouter {
  if (!options || typeof options.resolveContext !== 'function') {
    throw new TypeError('resolveContext is required');
  }
  if (!Array.isArray(options.routes) || options.routes.length === 0) {
    throw new TypeError('at least one Foundation HTTP route is required');
  }
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  if (!Number.isInteger(bodyLimitBytes) || bodyLimitBytes <= 0) {
    throw new TypeError('bodyLimitBytes must be a positive integer');
  }

  const routes = Object.freeze([...options.routes]);
  return {
    contractVersion: FOUNDATION_HTTP_CONTRACT_VERSION,
    routes,
    async handle(request: Request): Promise<Response> {
      const route = routes.find((candidate) => candidate.matches(request));
      if (!route) return jsonResponse(404, { error: { code: 'not_found', message: 'Route not found' } });

      let context: FoundationStoreContext | null;
      try {
        context = await options.resolveContext(request);
      } catch {
        context = null;
      }
      if (!context) return jsonResponse(401, { error: { code: 'authorization_required', message: 'A trusted context is required' } });

      if (MUTATING_METHODS.has((request.method || 'GET').toUpperCase())) {
        if (!options.csrf) {
          return jsonResponse(501, { error: { code: 'csrf_unconfigured', message: 'A CSRF verifier is required for mutations' } });
        }
        try {
          const verified = await options.csrf.verify(request, context);
          if (verified === false) {
            return jsonResponse(403, { error: { code: 'csrf_failed', message: 'CSRF verification failed' } });
          }
        } catch {
          return jsonResponse(403, { error: { code: 'csrf_failed', message: 'CSRF verification failed' } });
        }
      }

      try {
        return await route.handle(request, { context, request });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

/** Convenience constructor for a local/organization host with Objective routes only. */
export function createObjectiveFoundationHttpHandler(
  options: ObjectiveFoundationHttpRouteOptions & Omit<FoundationHttpRouterOptions, 'routes'>
): FoundationHttpRouter {
  return createFoundationHttpRouter({
    ...options,
    bodyLimitBytes: options.bodyLimitBytes,
    routes: [createObjectiveFoundationRoute(options)],
  });
}

export function createObjectiveFoundationRoute(options: ObjectiveFoundationHttpRouteOptions): FoundationHttpRoute {
  if (!options?.objectives) throw new TypeError('objectives service is required');
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  if (!Number.isInteger(bodyLimitBytes) || bodyLimitBytes <= 0) throw new TypeError('bodyLimitBytes must be a positive integer');

  const route: FoundationHttpRoute = {
    name: 'foundation-objectives',
    methods: FOUNDATION_OBJECTIVE_ROUTES.map((value) => value.split(' ', 1)[0]),
    paths: FOUNDATION_OBJECTIVE_ROUTES,
    matches(request) {
      const path = requestUrl(request).pathname;
      return path === FOUNDATION_OBJECTIVE_ROUTE_PREFIX
        || path.startsWith(`${FOUNDATION_OBJECTIVE_ROUTE_PREFIX}/`)
        || /^\/api\/foundation\/stories\/[^/]+\/objectives$/.test(path);
    },
    async handle(request, input) {
      const url = requestUrl(request);
      const path = url.pathname;
      const method = (request.method || 'GET').toUpperCase();

      if (path === FOUNDATION_OBJECTIVE_ROUTE_PREFIX) {
        if (method === 'GET') {
          const list = options.objectives.list;
          if (!list) throw new FoundationHttpError(501, 'api_unavailable', 'Objective list API is not configured');
          const records = await list.call(options.objectives, 'objective', input.context);
          return jsonResponse(200, { state: records.length ? 'ready' : 'empty', records, absence_confirmed: true });
        }
        if (method === 'POST') {
          const body = await readJsonBody(request, bodyLimitBytes);
          const definition = await buildObjectiveDefinition(options, body, {
            operation: 'create',
            context: input.context,
          });
          const reference = await options.objectives.createObjective(definition, input.context);
          return jsonResponse(201, { state: 'saved_unverified', reference, ref: reference });
        }
        return methodNotAllowed(['GET', 'POST']);
      }

      const storyMatch = path.match(/^\/api\/foundation\/stories\/([^/]+)\/objectives$/);
      if (storyMatch) {
        if (method !== 'GET') return methodNotAllowed(['GET']);
        if (!options.listStoryObjectiveLinks) throw new FoundationHttpError(501, 'api_unavailable', 'Story relation API is not configured');
        const storyId = decodePathPart(storyMatch[1]);
        const links = await options.listStoryObjectiveLinks(storyId, input.context);
        return jsonResponse(200, normalizeCollectionPayload(links, 'links'));
      }

      const objectiveMatch = path.match(/^\/api\/foundation\/objectives\/([^/]+)(?:\/(readiness|constraints))?$/);
      if (!objectiveMatch) throw new FoundationHttpError(404, 'not_found', 'Route not found');
      const id = decodePathPart(objectiveMatch[1]);
      const suffix = objectiveMatch[2] ?? null;
      const revision = positiveRevision(url.searchParams.get('revision') ?? undefined);

      if (suffix === 'readiness') {
        if (method !== 'GET') return methodNotAllowed(['GET']);
        const readiness = await options.objectives.checkObjectiveReadiness(id, input.context, revision);
        return jsonResponse(200, readinessPayload(readiness));
      }

      if (suffix === 'constraints') {
        const objectiveReference = await readObjectiveReference(options, id, revision, input.context);
        if (method === 'GET') {
          if (!options.listObjectiveConstraintRefs) throw new FoundationHttpError(501, 'api_unavailable', 'Constraint relation API is not configured');
          return jsonResponse(200, normalizeCollectionPayload(
            await options.listObjectiveConstraintRefs(objectiveReference, input.context),
            'refs'
          ));
        }
        if (method === 'PUT') {
          if (!options.replaceObjectiveConstraintRefs) throw new FoundationHttpError(501, 'api_unavailable', 'Constraint relation API is not configured');
          const body = await readJsonBody(request, bodyLimitBytes);
          // Validate the raw envelope before extracting `refs` so an
          // authority field cannot hide beside an otherwise valid collection.
          assertNoAuthorityFields(body);
          const refs = parseConstraintReferences(body);
          const result = await options.replaceObjectiveConstraintRefs(
            objectiveReference,
            refs,
            input.context
          );
          return jsonResponse(200, { state: 'saved_unverified', reference: objectiveReference, refs: result ?? refs });
        }
        return methodNotAllowed(['GET', 'PUT']);
      }

      if (method === 'GET') {
        try {
          const record = await options.objectives.readObjective(id, input.context, revision);
          const checkedAt = objectiveReadbackCheckedAt(options.clock);
          if (!record) {
            return jsonResponse(404, objectiveReadbackPayload(
              'unknown',
              checkedAt,
              null,
              { code: 'not_found', message: `Objective ${id} was not found` },
            ));
          }
          const canonicalRecord = objectiveReadbackRecord(record);
          if (!canonicalRecord) {
            return jsonResponse(502, objectiveReadbackPayload(
              'error',
              checkedAt,
              null,
              { code: 'invalid_canonical_record', message: 'The canonical Objective readback is incomplete' },
            ));
          }
          if (!objectiveReadbackMatchesRequest(canonicalRecord, id, revision)) {
            return jsonResponse(502, objectiveReadbackPayload(
              'error',
              checkedAt,
              null,
              { code: 'readback_identity_mismatch', message: 'The canonical Objective readback does not match the requested id or revision' },
            ));
          }
          // Keep the pre-readback `state` field for existing OSS consumers while
          // the canonical envelope is adopted by newer clients.
          return jsonResponse(200, {
            ...objectiveReadbackPayload('ready', checkedAt, canonicalRecord, null),
            state: 'ready',
          });
        } catch (error) {
          const normalized = normalizeHttpError(error);
          const checkedAt = objectiveReadbackCheckedAt(options.clock);
          const status: ObjectiveReadbackStatus = normalized.status === 404 || normalized.code === 'not_found'
            ? 'unknown'
            : 'error';
          return jsonResponse(normalized.status, objectiveReadbackPayload(
            status,
            checkedAt,
            null,
            { code: normalized.code, message: normalized.message },
          ));
        }
      }
      if (method === 'PUT') {
        const current = await options.objectives.readObjective(id, input.context, revision);
        if (!current || current.definition.type !== 'objective') throw new FoundationHttpError(404, 'not_found', `Objective ${id} was not found`);
        const body = await readJsonBody(request, bodyLimitBytes);
        const parsed = parseUpdateBody(body, request);
        const definition = await buildObjectiveDefinition(options, parsed.body, {
          operation: 'update',
          context: input.context,
          current: current.definition,
          expectedRevision: parsed.expectedRevision,
        });
        const reference = await options.objectives.updateObjective(id, parsed.expectedRevision, definition, input.context);
        return jsonResponse(200, { state: 'saved_unverified', reference, ref: reference });
      }
      return methodNotAllowed(['GET', 'PUT']);
    },
  };
  return route;
}

async function readObjectiveReference(
  options: ObjectiveFoundationHttpRouteOptions,
  id: string,
  revision: string | undefined,
  context: FoundationStoreContext
): Promise<FoundationRef> {
  const record = await options.objectives.readObjective(id, context, revision);
  if (!record || record.definition.type !== 'objective') throw new FoundationHttpError(404, 'not_found', `Objective ${id} was not found`);
  return {
    id: record.definition.id,
    type: 'objective',
    revision: record.definition.revision,
    digest: record.digest,
  };
}

async function buildObjectiveDefinition(
  options: ObjectiveFoundationHttpRouteOptions,
  payload: unknown,
  input: Omit<ObjectiveDefinitionBuilderInput, 'body'>
): Promise<ObjectiveDefinition> {
  if (!options.buildDefinition) throw new FoundationHttpError(501, 'api_unavailable', 'Objective definition builder is not configured');
  const body = sanitizeMutationBody(payload);
  const definition = await options.buildDefinition({ ...input, body });
  if (!definition || definition.type !== 'objective') {
    throw new FoundationHttpError(400, 'invalid_input', 'Objective builder returned a non-Objective definition');
  }
  if (!definition.id || !definition.revision) throw new FoundationHttpError(400, 'invalid_input', 'Objective definition identity is incomplete');
  if (input.operation === 'update') {
    if (!input.current || definition.id !== input.current.id || definition.type !== input.current.type) {
      throw new FoundationHttpError(400, 'invalid_input', 'An Objective update cannot change its logical identity');
    }
    if (JSON.stringify(definition.acl) !== JSON.stringify(input.current.acl)
      || JSON.stringify(definition.scope) !== JSON.stringify(input.current.scope)
      || JSON.stringify(definition.storage) !== JSON.stringify(input.current.storage)
      || JSON.stringify(definition.provenance) !== JSON.stringify(input.current.provenance)
      || JSON.stringify(definition.authorizedUses) !== JSON.stringify(input.current.authorizedUses)) {
      throw new FoundationHttpError(403, 'authority_field_change', 'Objective authority and provenance fields are host-controlled');
    }
  }
  return definition;
}

function parseUpdateBody(payload: unknown, request: Request): {
  body: unknown;
  expectedRevision: string;
} {
  // A PUT may carry a CAS envelope (`{ expectedRevision, definition }`).
  // Check the envelope itself before unwrapping it; otherwise an authority
  // field beside `definition` would be silently ignored by the builder.
  assertNoAuthorityFields(payload);
  const object = asRecord(payload);
  const expectedRevision = positiveRevision(
    firstString(object, 'expectedRevision', 'expected_revision')
      ?? request.headers.get('if-match')?.replace(/^W\//, '').replace(/^"|"$/g, '')
  );
  if (!expectedRevision) throw new FoundationHttpError(400, 'invalid_input', 'expectedRevision or If-Match is required for a CAS update');
  return { body: object?.definition ?? payload, expectedRevision };
}

function sanitizeMutationBody(payload: unknown): Readonly<Record<string, unknown>> {
  const object = asRecord(payload);
  if (!object) throw new FoundationHttpError(400, 'invalid_input', 'JSON object body is required');
  assertNoAuthorityFields(object);
  const definition = { ...object };
  delete definition.revision;
  delete definition.expectedRevision;
  delete definition.expected_revision;
  if (definition.type !== undefined && definition.type !== 'objective') {
    throw new FoundationHttpError(400, 'invalid_input', 'Objective definition type must be objective');
  }
  return Object.freeze(definition);
}

function assertNoAuthorityFields(payload: unknown): void {
  const object = asRecord(payload);
  if (!object) return;
  for (const key of Object.keys(object)) {
    if (AUTHORITY_FIELDS.has(key)) {
      throw new FoundationHttpError(400, 'authority_field_in_body', `Request body cannot set ${key}`);
    }
  }
}

function parseConstraintReferences(payload: unknown): FoundationRevision[] {
  const object = asRecord(payload);
  const values = Array.isArray(payload) ? payload : object?.refs ?? object?.references;
  if (!Array.isArray(values)) throw new FoundationHttpError(400, 'invalid_input', 'refs must be an array');
  return values.map((value, index) => {
    const ref = asRecord(value);
    if (!ref || ref.type !== 'constraint' || typeof ref.id !== 'string' || !positiveRevision(ref.revision)) {
      throw new FoundationHttpError(400, 'invalid_input', `refs[${index}] must be a Constraint revision reference`);
    }
    return { id: ref.id, type: 'constraint', revision: ref.revision };
  });
}

function readinessPayload(readiness: ObjectiveReadiness): ObjectiveReadiness & { state: string } {
  return { state: 'ready', ready: readiness.ready, issues: readiness.issues };
}

function objectiveReadbackCheckedAt(clock?: () => Date): string {
  return (clock?.() ?? new Date()).toISOString();
}

function normalizeCollectionPayload(value: unknown, key: 'links' | 'refs'): Record<string, unknown> {
  if (Array.isArray(value)) return { state: value.length ? 'ready' : 'empty', [key]: value, absence_confirmed: true };
  const object = asRecord(value);
  if (object && Object.prototype.hasOwnProperty.call(object, key) && Array.isArray(object[key])) {
    return {
      ...object,
      [key]: object[key],
      // A collection without an explicit absence claim is not a confirmed
      // empty result. Preserve false/unknown instead of inventing true.
      absence_confirmed: object.absence_confirmed === true,
    };
  }
  throw new FoundationHttpError(500, 'readback_mismatch', `The ${key} adapter returned an invalid collection`);
}

function methodNotAllowed(allow: readonly string[]): Response {
  return jsonResponse(405, { error: { code: 'method_not_allowed', message: 'Method not allowed' } }, { Allow: allow.join(', ') });
}

function errorResponse(error: unknown): Response {
  const normalized = normalizeHttpError(error);
  const body: Record<string, unknown> = {
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.currentRevision ? { currentRevision: normalized.currentRevision } : {}),
    },
  };
  return jsonResponse(normalized.status, body);
}

function normalizeHttpError(error: unknown): FoundationHttpError {
  if (error instanceof FoundationHttpError) return error;
  if (error instanceof FoundationStoreError) {
    const status = error.code === 'authorization_denied' || error.code === 'scope_violation' ? 403
      : error.code === 'not_found' ? 404
        : error.code === 'revision_conflict' ? 409
          : error.code === 'unsupported_graph' ? 503
            : error.code === 'readback_mismatch' ? 500
              : 400;
    return new FoundationHttpError(status, error.code, error.message, { currentRevision: error.currentRevision });
  }
  if (error instanceof Error && error.name === 'FoundationHttpError') {
    return new FoundationHttpError(500, 'internal_error', error.message);
  }
  return new FoundationHttpError(500, 'internal_error', 'Foundation request failed');
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

async function readJsonBody(request: Request, limitBytes: number): Promise<unknown> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    throw new FoundationHttpError(413, 'body_too_large', 'Request body exceeds the configured limit');
  }
  const text = await request.text();
  if (!text) throw new FoundationHttpError(400, 'invalid_json', 'A JSON body is required');
  if (new TextEncoder().encode(text).byteLength > limitBytes) {
    throw new FoundationHttpError(413, 'body_too_large', 'Request body exceeds the configured limit');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new FoundationHttpError(400, 'invalid_json', 'Request body is not valid JSON');
  }
}

function requestUrl(request: Request): URL {
  return new URL(request.url, 'http://localhost');
}

function decodePathPart(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded) throw new Error('empty');
    return decoded;
  } catch {
    throw new FoundationHttpError(400, 'invalid_input', 'Path identifier is not valid');
  }
}

function positiveRevision(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

function firstString(value: Record<string, any> | null, ...keys: string[]): string | undefined {
  if (!value) return undefined;
  for (const key of keys) if (typeof value[key] === 'string') return value[key];
  return undefined;
}
