import { createHash } from 'node:crypto';

/** Stable common boundary for host-provided knowledge-event adapters. */
export const KNOWLEDGE_EVENT_CONTRACT_VERSION = 'knowledge_event.v1' as const;

export const KNOWLEDGE_EVENT_REQUIRED_FIELDS = [
  'schema_version',
  'event_id',
  'occurred_at',
  'captured_at',
  'source',
  'subject',
  'decision_authority',
  'applicability_scope',
  'permission_snapshot',
  'source_pointer',
  'body_hash',
  'parent_episode_id'
] as const;

export type KnowledgeEventRequiredField = typeof KNOWLEDGE_EVENT_REQUIRED_FIELDS[number];
export type KnowledgeEventRecord = Record<string, unknown>;

export class KnowledgeEventContractError extends Error {
  readonly code = 'knowledge_event_invalid';

  constructor(readonly field: string, message = `knowledge_event.v1 field is required: ${field}`) {
    super(message);
    this.name = 'KnowledgeEventContractError';
  }
}

function isRecord(value: unknown): value is KnowledgeEventRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clone);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
  }
  return value;
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/**
 * Canonical JSON used for idempotency and conflict checks. Host repositories
 * may store additional fields, but the common identity never depends on
 * property insertion order.
 */
export function canonicalKnowledgeEventJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalKnowledgeEventJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalKnowledgeEventJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function knowledgeEventSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Validate only the portable event envelope. Subject semantics, decision
 * authority, tenant identity, and persistence remain host responsibilities.
 */
export function normalizeKnowledgeEvent(value: unknown): KnowledgeEventRecord {
  if (!isRecord(value)) throw new KnowledgeEventContractError('event', 'knowledge event must be an object');

  for (const field of KNOWLEDGE_EVENT_REQUIRED_FIELDS) {
    if (!hasValue(value[field])) throw new KnowledgeEventContractError(field);
  }
  if (value.schema_version !== KNOWLEDGE_EVENT_CONTRACT_VERSION) {
    throw new KnowledgeEventContractError(
      'schema_version',
      `schema_version must be ${KNOWLEDGE_EVENT_CONTRACT_VERSION}`
    );
  }
  if (typeof value.event_id !== 'string' || !value.event_id.trim()) {
    throw new KnowledgeEventContractError('event_id', 'event_id must be a non-empty string');
  }
  for (const field of ['occurred_at', 'captured_at'] as const) {
    if (typeof value[field] !== 'string' || !Number.isFinite(Date.parse(value[field]))) {
      throw new KnowledgeEventContractError(field, `${field} must be an ISO timestamp`);
    }
  }
  if (typeof value.body_hash !== 'string' || !/^(?:sha256:)?[a-f0-9]{64}$/u.test(value.body_hash)) {
    throw new KnowledgeEventContractError('body_hash', 'body_hash must be a SHA-256 digest');
  }

  return clone(value) as KnowledgeEventRecord;
}

const IDENTITY_FIELDS = [
  'body_hash',
  'source_pointer',
  'subject',
  'decision_authority',
  'applicability_scope',
  'permission_snapshot',
  'parent_episode_id',
  'organization_id',
  'sensitivity',
  'role_min',
  'venue'
] as const;

export type KnowledgeEventIdentity = Pick<KnowledgeEventRecord, typeof IDENTITY_FIELDS[number]>;

export function knowledgeEventIdentity(value: unknown): KnowledgeEventIdentity {
  const event = normalizeKnowledgeEvent(value);
  return Object.fromEntries(
    IDENTITY_FIELDS
      .filter((field) => event[field] !== undefined)
      .map((field) => [field, event[field]])
  ) as KnowledgeEventIdentity;
}

export function knowledgeEventFingerprint(value: unknown): string {
  return knowledgeEventSha256(canonicalKnowledgeEventJson(knowledgeEventIdentity(value)));
}

export function sameKnowledgeEventIdentity(left: unknown, right: unknown): boolean {
  try {
    return canonicalKnowledgeEventJson(knowledgeEventIdentity(left))
      === canonicalKnowledgeEventJson(knowledgeEventIdentity(right));
  } catch {
    return false;
  }
}
