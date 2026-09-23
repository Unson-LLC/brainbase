import {
  assertFoundationCatalog,
  cloneFoundationCatalog,
  cloneFoundationDefinition,
  digestFoundationDefinition,
  findFoundationRecord,
  findLatestFoundationRecord,
  foundationCatalogOrEmpty,
  foundationKey,
  foundationRef,
  nextFoundationRevision
} from './foundation-catalog.js';
import type {
  FoundationDefinition,
  FoundationAcl,
  FoundationRelationEndpoint,
  FoundationRelationReference,
  FoundationRevision,
  FoundationScope,
  FoundationType
} from './ontology-foundation.js';
import { validateFoundationDefinition, validateFoundationRelation } from './ontology-foundation.js';
import { loadPersonalOs, mutatePersonalOs } from './ssot.js';
import type { FoundationCatalog, FoundationCatalogRecord, PersonalOs } from './types.js';
import type { FoundationRef } from './foundation-catalog.js';

export interface FoundationStoreContext {
  /** Identity resolved by the caller's trusted auth boundary. */
  principal: string;
  /**
   * Optional trusted subject scope.  The request body never supplies this
   * value; organization adapters may inject it for the default policy.
   */
  scope?: FoundationScope;
}

export type FoundationStoreAction = 'create' | 'read' | 'update' | 'list' | 'link';

/**
 * Metadata returned for a non-foundation relation endpoint (for example a
 * Story).  It deliberately contains no Story body or private projection.
 * `acl` and `scope` are the current values used for authorization even when
 * `revision` points at an older immutable revision.
 */
export interface FoundationEndpointResource {
  id: string;
  type: FoundationRelationEndpoint;
  revision: string;
  currentRevision: string;
  acl: FoundationAcl;
  scope: FoundationScope;
}

export type FoundationAuthorizationResource = FoundationDefinition | FoundationEndpointResource;

export interface FoundationEndpointResolverRequest {
  endpoint: { id: string; type: FoundationRelationEndpoint; revision?: string };
  context: FoundationStoreContext;
  /** The current aggregate loaded while the canonical SSOT lock is held. */
  current: PersonalOs;
}

/**
 * Trusted adapter for endpoint types that are not stored by this foundation
 * catalog.  A resolver is called only inside the canonical mutation lock and
 * must return authorization metadata, never a private endpoint document.
 */
export interface FoundationEndpointResolver {
  resolve(
    request: FoundationEndpointResolverRequest
  ): FoundationEndpointResource | null | Promise<FoundationEndpointResource | null>;
}

/**
 * Minimal metadata record used by the OSS standalone Story resolver.  This is
 * an adapter input, not a second Story store: Story content and lifecycle stay
 * owned by the consuming Story provider.
 */
export interface LocalStoryRevision {
  id: string;
  revision: string;
  acl: FoundationAcl;
  scope: FoundationScope;
}

export interface FoundationAuthorizationRequest {
  action: FoundationStoreAction;
  context: FoundationStoreContext;
  reference?: FoundationRevision;
  current?: FoundationDefinition;
  next?: FoundationDefinition;
  /**
   * Foundation records resolved from relation endpoints while the canonical
   * SSOT lock is held.  A link must never be authorized from an ID alone.
   */
  resources?: readonly FoundationAuthorizationResource[];
  relation?: FoundationRelationReference;
}

export interface FoundationStorePolicy {
  authorize(request: FoundationAuthorizationRequest): void | boolean | Promise<void | boolean>;
}

export interface FoundationUpdateInput {
  reference: FoundationRevision;
  next: FoundationDefinition;
  /** Optional duplicate check for callers that carry an explicit CAS field. */
  expectedRevision?: string;
}

export interface FoundationRevisionStore {
  create(definition: FoundationDefinition, context: FoundationStoreContext): Promise<FoundationRef>;
  read(reference: FoundationRevision, context: FoundationStoreContext): Promise<FoundationCatalogRecord | null>;
  readLatest(type: FoundationType, id: string, context: FoundationStoreContext): Promise<FoundationCatalogRecord | null>;
  update(input: FoundationUpdateInput, context: FoundationStoreContext): Promise<FoundationRef>;
  list(type: FoundationType | undefined, context: FoundationStoreContext): Promise<FoundationCatalogRecord[]>;
  addRelation(relation: FoundationRelationReference, context: FoundationStoreContext): Promise<void>;
}

export type FoundationStoreErrorCode =
  | 'invalid_input'
  | 'not_found'
  | 'revision_conflict'
  | 'authorization_denied'
  | 'scope_violation'
  | 'unsupported_graph'
  | 'corrupt_catalog'
  | 'readback_mismatch';

export class FoundationStoreError extends Error {
  readonly code: FoundationStoreErrorCode;
  readonly currentRevision?: string;

  constructor(code: FoundationStoreErrorCode, message: string, options: { currentRevision?: string } = {}) {
    super(message);
    this.name = 'FoundationStoreError';
    this.code = code;
    this.currentRevision = options.currentRevision;
  }
}

export interface FoundationRevisionStoreOptions {
  dataDir: string;
  policy?: FoundationStorePolicy;
  /** Trusted resolver for Story and other external relation endpoints. */
  endpointResolver?: FoundationEndpointResolver;
}

/**
 * Canonical foundation persistence over the existing Graph SSOT aggregate.
 * There is intentionally no separate objectives/world-model file or writer.
 */
export class GraphFoundationRevisionStore implements FoundationRevisionStore {
  private readonly dataDir: string;
  private readonly policy?: FoundationStorePolicy;
  private readonly endpointResolver?: FoundationEndpointResolver;

  constructor(options: FoundationRevisionStoreOptions) {
    if (!options.dataDir) throw new FoundationStoreError('invalid_input', 'dataDir is required');
    this.dataDir = options.dataDir;
    this.policy = options.policy;
    this.endpointResolver = options.endpointResolver;
  }

  async create(definition: FoundationDefinition, context: FoundationStoreContext): Promise<FoundationRef> {
    const candidate = prepareDefinition(definition, 'create');
    if (candidate.revision !== '1') {
      throw new FoundationStoreError('invalid_input', 'A new foundation definition must start at revision 1');
    }
    validateForDraft(candidate);
    assertContext(context);
    await this.authorize({ action: 'create', context, next: candidate });

    const ref = await mutatePersonalOs(this.dataDir, async (current) => {
      const catalog = readCatalog(current);
      if (catalog.records.some((record) => (
        record.definition.id === candidate.id && record.definition.type === candidate.type
      ))) {
        throw new FoundationStoreError('revision_conflict', `Foundation resource ${candidate.type}/${candidate.id} already exists`);
      }
      const record = makeRecord(candidate);
      await this.authorize({
        action: 'read',
        context,
        reference: foundationRef(record),
        current: candidate
      });
      const nextCatalog = appendRecord(catalog, record);
      return withFoundationCatalog(current, nextCatalog);
    }).then(() => foundationRef(makeRecord(candidate)));

    return this.readback(ref, context);
  }

  async read(reference: FoundationRevision, context: FoundationStoreContext): Promise<FoundationCatalogRecord | null> {
    assertReferenceInput(reference);
    assertContext(context);
    const os = await this.load();
    const catalog = readCatalog(os);
    const record = findFoundationRecord(catalog, reference);
    if (!record) return null;
    const latest = findLatestFoundationRecord(catalog, reference.type, reference.id);
    if (!latest) {
      throw new FoundationStoreError('corrupt_catalog', `Latest pointer is missing for ${reference.type}/${reference.id}`);
    }
    // Historical content is immutable, but access is evaluated against the
    // current revision.  A principal removed from the current ACL must not
    // regain access merely by requesting an older revision.
    await this.authorize({ action: 'read', context, reference, current: latest.definition });
    return cloneRecord(record);
  }

  async readLatest(type: FoundationType, id: string, context: FoundationStoreContext): Promise<FoundationCatalogRecord | null> {
    if (!isFoundationType(type) || !id) {
      throw new FoundationStoreError('invalid_input', 'type and id are required');
    }
    assertContext(context);
    const os = await this.load();
    const catalog = readCatalog(os);
    const record = findLatestFoundationRecord(catalog, type, id);
    if (!record) return null;
    await this.authorize({ action: 'read', context, reference: foundationRef(record), current: record.definition });
    return cloneRecord(record);
  }

  async update(input: FoundationUpdateInput, context: FoundationStoreContext): Promise<FoundationRef> {
    assertContext(context);
    assertReferenceInput(input.reference);
    if (input.expectedRevision !== undefined && input.expectedRevision !== input.reference.revision) {
      throw new FoundationStoreError('revision_conflict', 'expectedRevision must match reference.revision', {
        currentRevision: input.reference.revision
      });
    }
    const reference = { ...input.reference };
    const nextInput = cloneFoundationDefinition(input.next);
    if (nextInput.id !== reference.id || nextInput.type !== reference.type) {
      throw new FoundationStoreError('invalid_input', 'An update cannot change the logical id or type');
    }
    const candidate = {
      ...nextInput,
      revision: nextFoundationRevision(reference.revision)
    } as FoundationDefinition;
    validateForDraft(candidate);

    let savedRef: FoundationRef | undefined;
    await mutatePersonalOs(this.dataDir, async (current) => {
      const catalog = readCatalog(current);
      const latest = findLatestFoundationRecord(catalog, reference.type, reference.id);
      if (!latest) throw new FoundationStoreError('not_found', `Foundation resource ${reference.type}/${reference.id} was not found`);
      if (latest.definition.revision !== reference.revision) {
        throw new FoundationStoreError('revision_conflict', `Expected ${reference.type}/${reference.id}@${reference.revision}, current is @${latest.definition.revision}`, {
          currentRevision: latest.definition.revision
        });
      }
      await this.authorize({ action: 'update', context, reference, current: latest.definition, next: candidate });
      const record = makeRecord(candidate);
      await this.authorize({
        action: 'read',
        context,
        reference: foundationRef(record),
        current: candidate
      });
      const nextCatalog = appendRecord(catalog, record);
      savedRef = foundationRef(record);
      return withFoundationCatalog(current, nextCatalog);
    });
    if (!savedRef) throw new FoundationStoreError('readback_mismatch', 'Foundation update did not produce a revision reference');
    return this.readback(savedRef, context);
  }

  async list(type: FoundationType | undefined, context: FoundationStoreContext): Promise<FoundationCatalogRecord[]> {
    assertContext(context);
    if (type !== undefined && !isFoundationType(type)) {
      throw new FoundationStoreError('invalid_input', `Unknown foundation type ${String(type)}`);
    }
    const os = await this.load();
    const catalog = readCatalog(os);
    const records = catalog.records.filter((record) => record.definition.revision === catalog.latest[foundationKey(record.definition)]?.revision)
      .filter((record) => type === undefined || record.definition.type === type);
    const visible: FoundationCatalogRecord[] = [];
    for (const record of records) {
      await this.authorize({ action: 'list', context, reference: foundationRef(record), current: record.definition });
      visible.push(cloneRecord(record));
    }
    return visible;
  }

  async addRelation(relation: FoundationRelationReference, context: FoundationStoreContext): Promise<void> {
    assertContext(context);
    validateRelationInput(relation);
    await mutatePersonalOs(this.dataDir, async (current) => {
      const catalog = readCatalog(current);
      const resolved = await resolveFoundationRelationResources({
        catalog,
        relation,
        context,
        current,
        endpointResolver: this.endpointResolver
      });
      // A trusted context scope is a store-level boundary.  The injected
      // policy may add organization-specific role checks, but it cannot turn
      // a resolved cross-scope endpoint into an in-scope one.
      for (const resource of resolved.resources) assertScopeAccess(resource, context);
      await this.authorize({ action: 'link', context, relation: resolved.relation, resources: resolved.resources });
      const serialized = JSON.stringify(resolved.relation);
      if (catalog.relations.some((existing) => JSON.stringify(existing) === serialized)) return current;
      return withFoundationCatalog(current, {
        ...cloneFoundationCatalog(catalog),
        relations: [...catalog.relations, JSON.parse(serialized) as FoundationRelationReference]
      });
    });
  }

  private async load(): Promise<PersonalOs> {
    try {
      return await loadPersonalOs(this.dataDir);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  private async authorize(request: FoundationAuthorizationRequest): Promise<void> {
    if (this.policy) {
      try {
        const allowed = await this.policy.authorize({
          ...request,
          ...(request.current ? { current: cloneFoundationDefinition(request.current) } : {}),
          ...(request.next ? { next: cloneFoundationDefinition(request.next) } : {}),
          ...(request.resources ? { resources: request.resources.map(cloneAuthorizationResource) } : {})
        });
        if (allowed === false) throw new FoundationStoreError('authorization_denied', 'Foundation policy denied the operation');
      } catch (error) {
        if (error instanceof FoundationStoreError) throw error;
        throw new FoundationStoreError('authorization_denied', formatError(error));
      }
      return;
    }
    if (request.action === 'create') {
      if (!request.next) throw new FoundationStoreError('invalid_input', 'Create authorization requires a definition');
      assertScopeAccess(request.next, request.context);
      assertAclWrite(request.next, request.context.principal);
      return;
    }
    if (request.current) {
      assertScopeAccess(request.current, request.context);
      if (request.action === 'read' || request.action === 'list') {
        assertAclRead(request.current, request.context.principal);
      } else {
        assertAclWrite(request.current, request.context.principal);
      }
      return;
    }
    if (request.action === 'link') {
      if (!request.resources || request.resources.length === 0) {
        throw new FoundationStoreError('authorization_denied', 'A foundation relation requires resolved endpoint resources');
      }
      // The relation itself is stored in the shared catalog.  Without an
      // injected tenant policy, require write access to every local foundation
      // endpoint so a caller cannot link an object it cannot modify.
      for (const resource of request.resources) {
        assertScopeAccess(resource, request.context);
        assertAclWrite(resource, request.context.principal);
      }
    }
  }

  private async readback(reference: FoundationRef, context: FoundationStoreContext): Promise<FoundationRef> {
    const saved = await this.read(reference, context);
    if (!saved || saved.digest !== reference.digest || saved.definition.revision !== reference.revision) {
      throw new FoundationStoreError('readback_mismatch', `Foundation readback failed for ${reference.type}/${reference.id}@${reference.revision}`);
    }
    return foundationRef(saved);
  }
}

export function createFoundationRevisionStore(options: FoundationRevisionStoreOptions): FoundationRevisionStore {
  return new GraphFoundationRevisionStore(options);
}

export const createFoundationStore = createFoundationRevisionStore;

/**
 * Creates a concrete, in-memory Story endpoint adapter for OSS consumers.
 * Only immutable revision/security metadata is supplied; no Story body is
 * duplicated into the foundation catalog.  Current ACL and scope are taken
 * from the greatest registered revision while the requested revision is only
 * checked for existence and retained in the relation.
 */
export function createLocalStoryResolver(records: readonly LocalStoryRevision[]): FoundationEndpointResolver {
  const grouped = new Map<string, LocalStoryRevision[]>();
  for (const record of records) {
    validateLocalStoryRevision(record);
    const revisions = grouped.get(record.id) ?? [];
    if (revisions.some((candidate) => candidate.revision === record.revision)) {
      throw new TypeError(`Duplicate Story revision ${record.id}@${record.revision}`);
    }
    revisions.push(cloneLocalStoryRevision(record));
    grouped.set(record.id, revisions);
  }
  for (const revisions of grouped.values()) {
    revisions.sort((left, right) => compareRevisions(left.revision, right.revision));
  }

  return {
    resolve({ endpoint }) {
      if (endpoint.type !== 'story') return null;
      const revisions = grouped.get(endpoint.id);
      if (!revisions) return null;
      const current = revisions[revisions.length - 1];
      const requested = endpoint.revision === undefined
        ? current
        : revisions.find((candidate) => candidate.revision === endpoint.revision);
      if (!requested) return null;
      return {
        id: endpoint.id,
        type: 'story',
        revision: requested.revision,
        currentRevision: current.revision,
        acl: cloneAcl(current.acl),
        scope: cloneScope(current.scope)
      };
    }
  };
}

/** Descriptive alias for consumers that use the generic endpoint terminology. */
export const createStoryEndpointResolver = createLocalStoryResolver;

function prepareDefinition(definition: FoundationDefinition, operation: 'create' | 'update'): FoundationDefinition {
  if (!definition || typeof definition !== 'object') {
    throw new FoundationStoreError('invalid_input', `${operation} requires a foundation definition`);
  }
  const clone = cloneFoundationDefinition(definition);
  if (!clone.id || !isFoundationType(clone.type) || !clone.revision) {
    throw new FoundationStoreError('invalid_input', `${operation} requires id, type, and revision`);
  }
  return clone;
}

function validateForDraft(definition: FoundationDefinition): void {
  try {
    const result = validateFoundationDefinition(definition, { use: 'draft' });
    if (!result.valid) {
      throw new FoundationStoreError('invalid_input', result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    }
  } catch (error) {
    if (error instanceof FoundationStoreError) throw error;
    throw new FoundationStoreError('invalid_input', formatError(error));
  }
}

function validateRelationInput(relation: FoundationRelationReference): void {
  try {
    const result = validateFoundationRelation(relation);
    if (!result.valid) throw new FoundationStoreError('invalid_input', result.issues.map((issue) => issue.message).join('; '));
  } catch (error) {
    if (error instanceof FoundationStoreError) throw error;
    throw new FoundationStoreError('invalid_input', formatError(error));
  }
}

function makeRecord(definition: FoundationDefinition): FoundationCatalogRecord {
  return { definition: cloneFoundationDefinition(definition), digest: digestFoundationDefinition(definition) };
}

function cloneRecord(record: FoundationCatalogRecord): FoundationCatalogRecord {
  return { definition: cloneFoundationDefinition(record.definition), digest: record.digest };
}

function appendRecord(catalog: FoundationCatalog, record: FoundationCatalogRecord): FoundationCatalog {
  const next = cloneFoundationCatalog(catalog);
  next.records.push(cloneRecord(record));
  next.latest[foundationKey(record.definition)] = {
    id: record.definition.id,
    type: record.definition.type,
    revision: record.definition.revision
  };
  return next;
}

function readCatalog(os: PersonalOs): FoundationCatalog {
  if (os.graph.version !== 2) {
    throw new FoundationStoreError('unsupported_graph', 'Foundation catalog writes require canonical Graph v2');
  }
  try {
    assertFoundationCatalog(os.graph.foundation);
    return foundationCatalogOrEmpty(os.graph.foundation);
  } catch (error) {
    throw new FoundationStoreError('corrupt_catalog', formatError(error));
  }
}

interface ResolvedRelationResources {
  relation: FoundationRelationReference;
  resources: FoundationAuthorizationResource[];
}

async function resolveFoundationRelationResources(input: {
  catalog: FoundationCatalog;
  relation: FoundationRelationReference;
  context: FoundationStoreContext;
  current: PersonalOs;
  endpointResolver?: FoundationEndpointResolver;
}): Promise<ResolvedRelationResources> {
  const resources: FoundationAuthorizationResource[] = [];
  const seen = new Set<string>();
  const endpoints: Array<'source' | 'target'> = ['source', 'target'];
  const resolvedEndpoints: Partial<Record<'source' | 'target', FoundationRelationReference['source']>> = {};

  for (const position of endpoints) {
    const endpoint = input.relation[position];
    if (isFoundationType(endpoint.type)) {
      if (!endpoint.revision) {
        throw new FoundationStoreError('invalid_input', `Foundation relation endpoint ${endpoint.type}/${endpoint.id} requires a revision`);
      }
      const requested = findFoundationRecord(input.catalog, {
        id: endpoint.id,
        type: endpoint.type,
        revision: endpoint.revision
      });
      if (!requested) {
        throw new FoundationStoreError('not_found', `Foundation relation endpoint ${endpoint.type}/${endpoint.id}@${endpoint.revision} was not found`);
      }
      const latest = findLatestFoundationRecord(input.catalog, endpoint.type, endpoint.id);
      if (!latest) {
        throw new FoundationStoreError('corrupt_catalog', `Latest pointer is missing for ${endpoint.type}/${endpoint.id}`);
      }
      const key = foundationKey(latest.definition);
      if (!seen.has(key)) {
        seen.add(key);
        resources.push(cloneFoundationDefinition(latest.definition));
      }
      resolvedEndpoints[position] = { ...endpoint };
      continue;
    }

    if (!input.endpointResolver) {
      // Do not authorize an external endpoint from an ID alone.  Returning a
      // generic denial also avoids turning an absent resolver into a lookup
      // oracle for private Story/project identifiers.
      throw new FoundationStoreError(
        'authorization_denied',
        `No trusted endpoint resolver is configured for ${endpoint.type}/${endpoint.id}`
      );
    }

    let resource: FoundationEndpointResource | null;
    try {
      resource = await input.endpointResolver.resolve({
        endpoint: {
          id: endpoint.id,
          type: endpoint.type,
          ...(endpoint.revision === undefined ? {} : { revision: endpoint.revision })
        },
        context: input.context,
        // This callback executes within mutatePersonalOs's canonical lock.
        current: input.current
      });
    } catch (error) {
      if (error instanceof FoundationStoreError) throw error;
      throw new FoundationStoreError('authorization_denied', 'The trusted endpoint resolver failed closed');
    }
    if (!resource) {
      throw new FoundationStoreError('not_found', `Relation endpoint ${endpoint.type}/${endpoint.id} was not found`);
    }
    validateEndpointResource(resource, endpoint);
    const key = endpointResourceKey(resource);
    if (!seen.has(key)) {
      seen.add(key);
      resources.push(cloneEndpointResource(resource));
    }
    // Persist a concrete revision even when the caller referred to the
    // current Story by ID only.  This makes the link historically reproducible.
    resolvedEndpoints[position] = {
      id: resource.id,
      type: resource.type,
      revision: resource.revision
    };
  }

  if (resources.length === 0) {
    throw new FoundationStoreError('authorization_denied', 'A foundation relation requires resolved endpoint resources');
  }
  return {
    relation: {
      ...input.relation,
      source: resolvedEndpoints.source ?? input.relation.source,
      target: resolvedEndpoints.target ?? input.relation.target
    },
    resources
  };
}

function withFoundationCatalog(os: PersonalOs, foundation: FoundationCatalog): PersonalOs {
  if (os.graph.version !== 2) {
    throw new FoundationStoreError('unsupported_graph', 'Foundation catalog writes require canonical Graph v2');
  }
  return {
    ...os,
    graph: {
      ...os.graph,
      foundation
    }
  };
}

function assertReferenceInput(reference: FoundationRevision): void {
  if (!reference || typeof reference !== 'object' || !reference.id || !isFoundationType(reference.type) || !/^[1-9]\d*$/.test(reference.revision)) {
    throw new FoundationStoreError('invalid_input', 'A revision reference requires id, type, and a positive revision');
  }
}

function assertContext(context: FoundationStoreContext): void {
  if (!context || typeof context.principal !== 'string' || context.principal.length === 0) {
    throw new FoundationStoreError('authorization_denied', 'A trusted principal is required');
  }
  if (context.scope !== undefined && !isValidScope(context.scope)) {
    throw new FoundationStoreError('authorization_denied', 'A trusted context scope is invalid');
  }
}

function assertAclRead(definition: FoundationDefinition, principal: string): void {
  const acl = definition.acl;
  if (acl.visibility === 'public' || acl.ownerId === principal || acl.readerIds.includes(principal) || acl.writerIds.includes(principal)) return;
  throw new FoundationStoreError('authorization_denied', `Principal ${principal} cannot read ${definition.type}/${definition.id}`);
}

function assertAclWrite(resource: FoundationAuthorizationResource, principal: string): void {
  const acl = resource.acl;
  if (acl.ownerId === principal || acl.writerIds.includes(principal)) return;
  throw new FoundationStoreError('authorization_denied', `Principal ${principal} cannot write ${resource.type}/${resource.id}`);
}

function assertScopeAccess(resource: FoundationAuthorizationResource, context: FoundationStoreContext): void {
  if (!context.scope) return;
  const allowed = new Set(context.scope.subjectIds);
  if (resource.scope.subjectIds.some((subjectId) => allowed.has(subjectId))) return;
  throw new FoundationStoreError('scope_violation', `Principal ${context.principal} cannot access ${resource.type}/${resource.id} outside the trusted scope`);
}

function cloneAuthorizationResource(resource: FoundationAuthorizationResource): FoundationAuthorizationResource {
  return isFoundationDefinitionResource(resource)
    ? cloneFoundationDefinition(resource)
    : cloneEndpointResource(resource);
}

function isFoundationDefinitionResource(resource: FoundationAuthorizationResource): resource is FoundationDefinition {
  return isFoundationType(resource.type) && 'adoptionState' in resource;
}

function cloneEndpointResource(resource: FoundationEndpointResource): FoundationEndpointResource {
  return {
    id: resource.id,
    type: resource.type,
    revision: resource.revision,
    currentRevision: resource.currentRevision,
    acl: cloneAcl(resource.acl),
    scope: cloneScope(resource.scope)
  };
}

function endpointResourceKey(resource: FoundationEndpointResource): string {
  return JSON.stringify([resource.type, resource.id]);
}

function validateEndpointResource(
  resource: FoundationEndpointResource,
  endpoint: { id: string; type: FoundationRelationEndpoint; revision?: string }
): void {
  if (resource.id !== endpoint.id || resource.type !== endpoint.type) {
    throw new FoundationStoreError('authorization_denied', 'The endpoint resolver returned a mismatched resource');
  }
  if (isFoundationType(resource.type)) {
    throw new FoundationStoreError('authorization_denied', 'Foundation endpoints must be resolved by the canonical catalog');
  }
  if (!isPositiveRevision(resource.revision) || !isPositiveRevision(resource.currentRevision)) {
    throw new FoundationStoreError('authorization_denied', 'The endpoint resolver returned an invalid revision');
  }
  if (endpoint.revision !== undefined && endpoint.revision !== resource.revision) {
    throw new FoundationStoreError('authorization_denied', 'The endpoint resolver did not resolve the requested revision');
  }
  if (compareRevisions(resource.currentRevision, resource.revision) < 0) {
    throw new FoundationStoreError('authorization_denied', 'The endpoint resolver returned a revision newer than current');
  }
  if (!isValidAcl(resource.acl) || !isValidScope(resource.scope)) {
    throw new FoundationStoreError('authorization_denied', 'The endpoint resolver returned invalid authorization metadata');
  }
}

function validateLocalStoryRevision(record: LocalStoryRevision): void {
  if (!record || typeof record !== 'object' || !record.id || !isPositiveRevision(record.revision)) {
    throw new TypeError('A local Story revision requires a non-empty id and positive revision');
  }
  if (!isValidAcl(record.acl) || !isValidScope(record.scope)) {
    throw new TypeError(`Local Story ${record.id}@${record.revision} has invalid ACL or scope metadata`);
  }
}

function cloneLocalStoryRevision(record: LocalStoryRevision): LocalStoryRevision {
  return {
    id: record.id,
    revision: record.revision,
    acl: cloneAcl(record.acl),
    scope: cloneScope(record.scope)
  };
}

function cloneAcl(acl: FoundationAcl): FoundationAcl {
  return {
    ownerId: acl.ownerId,
    visibility: acl.visibility,
    readerIds: [...acl.readerIds],
    writerIds: [...acl.writerIds]
  };
}

function cloneScope(scope: FoundationScope): FoundationScope {
  return {
    subjectIds: [...scope.subjectIds],
    validFrom: scope.validFrom,
    ...(scope.validUntil === undefined ? {} : { validUntil: scope.validUntil })
  };
}

function isValidAcl(value: unknown): value is FoundationAcl {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<FoundationAcl>;
  return typeof candidate.ownerId === 'string'
    && candidate.ownerId.length > 0
    && (candidate.visibility === 'private'
      || candidate.visibility === 'project'
      || candidate.visibility === 'organization'
      || candidate.visibility === 'public')
    && Array.isArray(candidate.readerIds)
    && candidate.readerIds.every((id) => typeof id === 'string' && id.length > 0)
    && Array.isArray(candidate.writerIds)
    && candidate.writerIds.every((id) => typeof id === 'string' && id.length > 0);
}

function isValidScope(value: unknown): value is FoundationScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<FoundationScope>;
  if (!Array.isArray(candidate.subjectIds)) return false;
  if (candidate.subjectIds.length === 0 || !candidate.subjectIds.every((id) => typeof id === 'string' && id.length > 0)) {
    return false;
  }
  if (typeof candidate.validFrom !== 'string' || parseStrictRfc3339(candidate.validFrom) === undefined) {
    return false;
  }
  if (candidate.validUntil === undefined) return true;
  if (typeof candidate.validUntil !== 'string') return false;
  const from = parseStrictRfc3339(candidate.validFrom);
  const until = parseStrictRfc3339(candidate.validUntil);
  return from !== undefined && until !== undefined && until > from;
}

/**
 * Keep resolver metadata validation aligned with the foundation ontology.
 * Date.parse accepts malformed calendar values by normalizing them (for
 * example, February 30), so endpoint authorization must use strict RFC3339
 * parsing before comparing scope boundaries.
 */
function parseStrictRfc3339(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? '';
  const zone = match[8];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;

  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return undefined;
    offsetMinutes = sign * (offsetHour * 60 + offsetMinute);
  }

  const milliseconds = Number((fraction + '000').slice(0, 3));
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds)
    - offsetMinutes * 60_000;
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isPositiveRevision(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

function compareRevisions(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function isFoundationType(value: unknown): value is FoundationType {
  return value === 'objective' || value === 'variable' || value === 'model' || value === 'constraint';
}

function normalizeStorageError(error: unknown): FoundationStoreError {
  if (error instanceof FoundationStoreError) return error;
  const message = formatError(error);
  if (message.includes('FOUNDATION-CATALOG-CORRUPT')) return new FoundationStoreError('corrupt_catalog', message);
  return new FoundationStoreError('corrupt_catalog', message);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
