import { createHash } from 'node:crypto';
import type {
  FoundationDefinition,
  FoundationRelationReference,
  FoundationRevision,
  FoundationType
} from './ontology-foundation.js';
import { validateFoundationDefinition, validateFoundationRelation } from './ontology-foundation.js';
import type { FoundationCatalog, FoundationCatalogRecord } from './types.js';

const revisionPattern = /^[1-9]\d*$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;

/**
 * The key is an encoded tuple rather than `${type}:${id}` so IDs containing a
 * colon cannot alias another logical resource.
 */
export function foundationKey(reference: Pick<FoundationRevision, 'type' | 'id'>): string {
  return JSON.stringify([reference.type, reference.id]);
}

export function createEmptyFoundationCatalog(): FoundationCatalog {
  return {
    version: 1,
    records: [],
    latest: {},
    relations: []
  };
}

export function cloneFoundationCatalog(catalog: FoundationCatalog): FoundationCatalog {
  return JSON.parse(JSON.stringify(catalog)) as FoundationCatalog;
}

export function cloneFoundationDefinition<T extends FoundationDefinition>(definition: T): T {
  return JSON.parse(JSON.stringify(definition)) as T;
}

export interface FoundationRef extends FoundationRevision {
  digest: string;
}

export function foundationRef(record: FoundationCatalogRecord): FoundationRef {
  return {
    id: record.definition.id,
    type: record.definition.type,
    revision: record.definition.revision,
    digest: record.digest
  };
}

/**
 * Hashes the complete definition, with object keys sorted recursively. Array
 * order remains significant because criteria, provenance, and authorized uses
 * are ordered contracts in the shared ontology.
 */
export function digestFoundationDefinition(definition: FoundationDefinition): string {
  const canonical = canonicalJson(definition);
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

export function nextFoundationRevision(revision: string): string {
  assertRevision(revision, 'revision');
  return (BigInt(revision) + 1n).toString();
}

export function assertFoundationRevision(value: unknown, label = 'revision'): asserts value is FoundationRevision {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || value.id.length === 0
    || !isFoundationType(value.type)
    || typeof value.revision !== 'string') {
    throw new Error(`FOUNDATION-INVALID-REFERENCE: ${label} must contain id, type, and revision`);
  }
  assertRevision(value.revision, `${label}.revision`);
}

export function assertFoundationCatalog(value: unknown): asserts value is FoundationCatalog | undefined {
  if (value === undefined) return;
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.records) || !Array.isArray(value.relations) || !isRecord(value.latest)) {
    throw new Error('FOUNDATION-CATALOG-CORRUPT: version, records, latest, and relations are required');
  }

  const recordsByRevision = new Map<string, FoundationCatalogRecord>();
  const latestByLogical = new Map<string, FoundationCatalogRecord>();
  for (const [index, item] of value.records.entries()) {
    if (!isRecord(item) || !isRecord(item.definition) || typeof item.digest !== 'string') {
      throw new Error(`FOUNDATION-CATALOG-CORRUPT: records[${index}] must contain a definition and digest`);
    }
    const definition = item.definition as FoundationDefinition;
    assertDefinitionShape(definition, `records[${index}].definition`);
    const revisionKey = `${foundationKey(definition)}@${definition.revision}`;
    if (recordsByRevision.has(revisionKey)) {
      throw new Error(`FOUNDATION-CATALOG-CORRUPT: duplicate revision ${revisionKey}`);
    }
    if (!digestPattern.test(item.digest) || item.digest !== digestFoundationDefinition(definition)) {
      throw new Error(`FOUNDATION-CATALOG-CORRUPT: digest mismatch for ${revisionKey}`);
    }
    const record = item as FoundationCatalogRecord;
    recordsByRevision.set(revisionKey, record);
    const logicalKey = foundationKey(definition);
    const previous = latestByLogical.get(logicalKey);
    if (!previous || compareRevisions(definition.revision, previous.definition.revision) > 0) {
      latestByLogical.set(logicalKey, record);
    }
  }

  const latest = value.latest as Record<string, FoundationRevision>;
  const latestKeys = Object.keys(latest);
  if (latestKeys.length !== latestByLogical.size) {
    throw new Error('FOUNDATION-CATALOG-CORRUPT: latest pointers do not match records');
  }
  for (const [logicalKey, record] of latestByLogical) {
    const pointer = latest[logicalKey];
    assertFoundationRevision(pointer, `latest[${logicalKey}]`);
    if (foundationKey(pointer) !== logicalKey || pointer.revision !== record.definition.revision) {
      throw new Error(`FOUNDATION-CATALOG-CORRUPT: latest pointer mismatch for ${logicalKey}`);
    }
    if (!recordsByRevision.has(`${logicalKey}@${pointer.revision}`)) {
      throw new Error(`FOUNDATION-CATALOG-CORRUPT: latest pointer has no record for ${logicalKey}@${pointer.revision}`);
    }
  }

  for (const [index, relation] of value.relations.entries()) {
    if (!isRecord(relation)) throw new Error(`FOUNDATION-CATALOG-CORRUPT: relations[${index}] is not an object`);
    const result = safeValidateRelation(relation as FoundationRelationReference);
    if (!result.valid) {
      throw new Error(`FOUNDATION-CATALOG-CORRUPT: relations[${index}] ${result.issues.map((issue) => issue.message).join('; ')}`);
    }
    for (const endpoint of [relation.source, relation.target]) {
      if (!isRecord(endpoint) || typeof endpoint.id !== 'string' || !isFoundationType(endpoint.type) || typeof endpoint.revision !== 'string') continue;
      assertRevision(endpoint.revision, `relations[${index}] endpoint.revision`);
      const endpointKey = `${foundationKey({ id: endpoint.id, type: endpoint.type })}@${endpoint.revision}`;
      if (!recordsByRevision.has(endpointKey)) {
        throw new Error(`FOUNDATION-CATALOG-CORRUPT: relation endpoint ${endpointKey} has no record`);
      }
    }
  }
}

export function foundationCatalogOrEmpty(value: FoundationCatalog | undefined): FoundationCatalog {
  if (value === undefined) return createEmptyFoundationCatalog();
  assertFoundationCatalog(value);
  return cloneFoundationCatalog(value);
}

export function findFoundationRecord(
  catalog: FoundationCatalog,
  reference: FoundationRevision
): FoundationCatalogRecord | undefined {
  assertFoundationRevision(reference);
  return catalog.records.find((record) => (
    record.definition.id === reference.id
    && record.definition.type === reference.type
    && record.definition.revision === reference.revision
  ));
}

export function findLatestFoundationRecord(
  catalog: FoundationCatalog,
  type: FoundationType,
  id: string
): FoundationCatalogRecord | undefined {
  const pointer = catalog.latest[foundationKey({ type, id })];
  return pointer ? findFoundationRecord(catalog, pointer) : undefined;
}

function assertDefinitionShape(definition: FoundationDefinition, label: string): void {
  if (!isRecord(definition)
    || typeof definition.id !== 'string'
    || definition.id.length === 0
    || !isFoundationType(definition.type)
    || typeof definition.revision !== 'string') {
    throw new Error(`FOUNDATION-CATALOG-CORRUPT: ${label} has an invalid identity`);
  }
  assertRevision(definition.revision, `${label}.revision`);
  if (!isRecord(definition.acl)
    || typeof definition.acl.ownerId !== 'string'
    || definition.acl.ownerId.length === 0
    || !Array.isArray(definition.acl.readerIds)
    || !Array.isArray(definition.acl.writerIds)
    || !['private', 'project', 'organization', 'public'].includes(definition.acl.visibility)) {
    throw new Error(`FOUNDATION-CATALOG-CORRUPT: ${label}.acl is invalid`);
  }
  const result = safeValidateDefinition(definition);
  if (!result.valid) {
    throw new Error(`FOUNDATION-CATALOG-CORRUPT: ${label} ${result.issues.map((issue) => issue.message).join('; ')}`);
  }
}

function safeValidateDefinition(definition: FoundationDefinition) {
  try {
    return validateFoundationDefinition(definition, { use: 'draft' });
  } catch (error) {
    throw new Error(`invalid definition: ${formatError(error)}`);
  }
}

function safeValidateRelation(relation: FoundationRelationReference) {
  try {
    return validateFoundationRelation(relation);
  } catch (error) {
    throw new Error(`invalid relation: ${formatError(error)}`);
  }
}

function assertRevision(value: string, label: string): void {
  if (!revisionPattern.test(value)) {
    throw new Error(`FOUNDATION-INVALID-REVISION: ${label} must be a positive canonical decimal`);
  }
}

function compareRevisions(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function isFoundationType(value: unknown): value is FoundationType {
  return value === 'objective' || value === 'variable' || value === 'model' || value === 'constraint';
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  const canonical = canonicalize(value);
  const serialized = JSON.stringify(canonical);
  if (serialized === undefined) throw new Error('FOUNDATION-DIGEST-INVALID: definition is not JSON serializable');
  return serialized;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().flatMap((key) => (
      value[key] === undefined ? [] : [[key, canonicalize(value[key])]]
    )));
  }
  return value;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
