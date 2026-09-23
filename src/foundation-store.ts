import {
  assertFoundationCatalog,
  cloneFoundationCatalog,
  cloneFoundationDefinition,
  createEmptyFoundationCatalog,
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
  FoundationRelationReference,
  FoundationRevision,
  FoundationType
} from './ontology-foundation.js';
import { validateFoundationDefinition, validateFoundationRelation } from './ontology-foundation.js';
import { loadPersonalOs, mutatePersonalOs } from './ssot.js';
import type { FoundationCatalog, FoundationCatalogRecord, PersonalOs } from './types.js';
import type { FoundationRef } from './foundation-catalog.js';

export interface FoundationStoreContext {
  /** Identity resolved by the caller's trusted auth boundary. */
  principal: string;
}

export type FoundationStoreAction = 'create' | 'read' | 'update' | 'list' | 'link';

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
  resources?: readonly FoundationDefinition[];
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
}

/**
 * Canonical foundation persistence over the existing Graph SSOT aggregate.
 * There is intentionally no separate objectives/world-model file or writer.
 */
export class GraphFoundationRevisionStore implements FoundationRevisionStore {
  private readonly dataDir: string;
  private readonly policy?: FoundationStorePolicy;

  constructor(options: FoundationRevisionStoreOptions) {
    if (!options.dataDir) throw new FoundationStoreError('invalid_input', 'dataDir is required');
    this.dataDir = options.dataDir;
    this.policy = options.policy;
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
      const resources = resolveFoundationRelationResources(catalog, relation);
      await this.authorize({ action: 'link', context, relation, resources });
      const serialized = JSON.stringify(relation);
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
          ...(request.resources ? { resources: request.resources.map((resource) => cloneFoundationDefinition(resource)) } : {})
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
      assertAclWrite(request.next, request.context.principal);
      return;
    }
    if (request.current) {
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

function resolveFoundationRelationResources(
  catalog: FoundationCatalog,
  relation: FoundationRelationReference
): FoundationDefinition[] {
  const resources: FoundationDefinition[] = [];
  const seen = new Set<string>();
  for (const endpoint of [relation.source, relation.target]) {
    if (!isFoundationType(endpoint.type)) continue;
    if (!endpoint.revision) {
      throw new FoundationStoreError('invalid_input', `Foundation relation endpoint ${endpoint.type}/${endpoint.id} requires a revision`);
    }
    const requested = findFoundationRecord(catalog, {
      id: endpoint.id,
      type: endpoint.type,
      revision: endpoint.revision
    });
    if (!requested) {
      throw new FoundationStoreError('not_found', `Foundation relation endpoint ${endpoint.type}/${endpoint.id}@${endpoint.revision} was not found`);
    }
    const latest = findLatestFoundationRecord(catalog, endpoint.type, endpoint.id);
    if (!latest) {
      throw new FoundationStoreError('corrupt_catalog', `Latest pointer is missing for ${endpoint.type}/${endpoint.id}`);
    }
    const key = foundationKey(latest.definition);
    if (!seen.has(key)) {
      seen.add(key);
      resources.push(cloneFoundationDefinition(latest.definition));
    }
  }
  if (resources.length === 0) {
    throw new FoundationStoreError('authorization_denied', 'A foundation relation requires at least one local foundation endpoint');
  }
  return resources;
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
}

function assertAclRead(definition: FoundationDefinition, principal: string): void {
  const acl = definition.acl;
  if (acl.visibility === 'public' || acl.ownerId === principal || acl.readerIds.includes(principal) || acl.writerIds.includes(principal)) return;
  throw new FoundationStoreError('authorization_denied', `Principal ${principal} cannot read ${definition.type}/${definition.id}`);
}

function assertAclWrite(definition: FoundationDefinition, principal: string): void {
  const acl = definition.acl;
  if (acl.ownerId === principal || acl.writerIds.includes(principal)) return;
  throw new FoundationStoreError('authorization_denied', `Principal ${principal} cannot write ${definition.type}/${definition.id}`);
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
