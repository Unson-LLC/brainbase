import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * A purpose based, bounded Graph lookup.
 *
 * This module deliberately has no knowledge of tenants, authentication
 * tokens, internal endpoints, or a particular Graph transport.  Hosts inject
 * those concerns through `KnowledgeLookupDependencies`; the lookup contract
 * only decides which single bounded action to execute and how to report its
 * evidence.
 */

export type KnowledgeLookupOutcome =
  | 'retrieved'
  | 'empty'
  | 'incomplete'
  | 'transport_error'
  | 'forbidden'
  | 'ambiguous'
  | 'unsupported';

export type KnowledgeLookupActionKind = 'search' | 'read' | 'follow_relation' | 'finish';

export interface KnowledgeLookupScope {
  readonly project_codes: string[];
}

export interface KnowledgeLookupError {
  readonly code: string;
  readonly message: string;
  readonly http_status?: number;
  readonly details?: unknown;
}

export type KnowledgeLookupDependencyStatus = 'ok' | 'error' | 'unavailable';

/** The result shape expected from one host-owned Graph operation. */
export interface KnowledgeLookupDependencyResult {
  readonly status: KnowledgeLookupDependencyStatus;
  readonly scope: KnowledgeLookupScope;
  readonly data?: unknown;
  readonly error?: KnowledgeLookupError;
}

export interface KnowledgeLookupSearchRequest {
  readonly query: string;
  readonly entity_types: string[];
  readonly required_fields: string[];
  readonly seed_ids?: string[];
}

export interface KnowledgeLookupReadRequest {
  readonly entity_id: string;
  readonly entity_type: string;
  readonly required_fields: string[];
}

export interface KnowledgeLookupRelationRequest {
  readonly query: string;
  readonly entity_types: string[];
  readonly required_fields: string[];
  readonly seed_ids: string[];
  readonly relation: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly target_types?: string[];
}

/**
 * A host may return any transport-specific candidate shape as long as it
 * exposes these fields.  Unknown candidate fields are treated as data and
 * never used to change authorization scope.
 */
export interface KnowledgeLookupSearchData {
  readonly candidates?: readonly unknown[];
  readonly coverage?: 'complete' | 'partial' | 'unknown';
}

export interface KnowledgeLookupReadData {
  readonly entity?: unknown | null;
  readonly coverage?: 'complete' | 'partial' | 'unknown';
}

export interface KnowledgeLookupProjection {
  readonly body: Record<string, unknown>;
  readonly entity_type?: string;
}

export type KnowledgeLookupProjectEntity =
  (entity: Record<string, unknown>) => KnowledgeLookupProjection;

/**
 * The only host boundary needed by the purpose-based lookup.  Implementations
 * should authenticate and enforce their own source scope before returning a
 * result.  They must not derive scope from `target_hint` or `context_hints`.
 */
export interface KnowledgeLookupDependencies {
  search(input: KnowledgeLookupSearchRequest): Promise<KnowledgeLookupDependencyResult>;
  read(input: KnowledgeLookupReadRequest): Promise<KnowledgeLookupDependencyResult>;
  followRelation(input: KnowledgeLookupRelationRequest): Promise<KnowledgeLookupDependencyResult>;
  readonly projectEntity: KnowledgeLookupProjectEntity;
}

export interface KnowledgeLookupReference {
  readonly id: string;
  readonly entity_type: string;
  readonly evidence_fields: string[];
}

export interface KnowledgeLookupCandidateSummary {
  readonly id: string;
  readonly entity_type: string;
  readonly name?: string;
  readonly title?: string;
  readonly display_name?: string;
  readonly excerpt?: string;
  readonly evidence?: Record<string, unknown>;
}

export interface KnowledgeLookupAction {
  readonly kind: KnowledgeLookupActionKind;
  readonly required_fields: string[];
  readonly why_different?: string;
  readonly query?: string;
  readonly entity_types?: string[];
  readonly seed_ids?: string[];
  readonly entity_id?: string;
  readonly entity_type?: string;
  readonly relation?: string;
  readonly direction?: 'incoming' | 'outgoing';
  readonly target_types?: string[];
}

export interface KnowledgeLookupFinishProposal {
  readonly assessment: 'sufficient' | 'insufficient';
  readonly status: 'satisfied' | 'unresolved' | 'needs_user_input';
  readonly reference_ids: string[];
  readonly field_evidence: Array<{ field: string; reference_id: string; attempt_id: string }>;
  readonly unresolved_items: string[];
  readonly termination_reason: string;
}

export type KnowledgeLookupFinishValidation =
  | { readonly valid: true; readonly finish: KnowledgeLookupFinishProposal }
  | { readonly valid: false; readonly code: string; readonly message: string };

export interface KnowledgeLookupResultData {
  readonly lookup_id: string | null;
  readonly revision: number | null;
  readonly attempt_id: string | null;
  readonly outcome: KnowledgeLookupOutcome;
  readonly searched_scope: KnowledgeLookupScope;
  readonly references: KnowledgeLookupReference[];
  readonly available_fields: string[];
  readonly missing_fields: string[];
  readonly coverage: 'complete' | 'partial' | 'unknown';
  readonly absence_confirmed: false;
  readonly body: Record<string, unknown> | null;
  readonly action: KnowledgeLookupAction;
  readonly error_kind?: string;
  readonly proposed_finish?: KnowledgeLookupFinishProposal;
  readonly model_metadata?: {
    readonly assessment?: 'sufficient' | 'insufficient';
    readonly missing_information: string[];
    readonly why_different?: string;
    readonly based_on_attempt_ids: string[];
  };
}

export interface KnowledgeLookupToolResult {
  readonly status: KnowledgeLookupDependencyStatus;
  readonly scope: KnowledgeLookupScope;
  readonly data?: KnowledgeLookupResultData;
  readonly error?: KnowledgeLookupError;
}

const MAX_TEXT_LENGTH = 6_000;
const MAX_FIELD_LENGTH = 200;
const MAX_FIELDS = 40;
const MAX_CONTEXT_HINTS = 20;
const MAX_HINT_LENGTH = 1_000;
const MAX_IDS = 10;
const MAX_RELATION_LENGTH = 200;

/** Public roots accepted in a projection. Unknown payload roots are dropped. */
export const KNOWLEDGE_LOOKUP_ALLOWED_FIELD_ROOTS = new Set([
  'id',
  'graph_entity_id',
  'type',
  'project_code',
  'organization_id',
  'tenant_id',
  'updated',
  'updated_at',
  'version',
  'name',
  'title',
  'status',
  'description',
  'content',
  'body',
  'summary',
  'statement',
  'rationale',
  'decision',
  'markdown',
  'body_summary',
  'notes',
  'app_id',
  'display_name',
  'excerpt',
  'project',
  'orgs',
  'org',
  'org_tags',
  'aliases',
  'projects',
  'repository',
  'parent_project',
  'parent_project_entity_id',
  'environments',
  'environment',
  'record_class',
  'service_profile_eligible',
  'operational_profile_coverage',
  'source',
  'source_path',
  'legacy_source_path',
  'lifecycle_status',
  'lifecycle_state',
  'semantic_state',
  'related_orgs',
  'related_apps',
  'owner_entity_id',
  'tags',
  'path',
  'role',
  'orgType',
  'canonical',
  'term',
  'decided_at',
  'decider',
  'project_id',
  'meeting_id',
  'salesOrg',
  'implOrg',
  'contractType',
  'upfront',
  'customer_id',
  'partner',
]);

const FORBIDDEN_FIELD_ROOTS = new Set(['payload', 'filePath', 'retrieval_evidence', '__proto__', 'constructor', 'prototype']);
const DEFAULT_ENTITY_TYPES = ['decision', 'project', 'org', 'app', 'philosophy', 'glossary_term', 'document', 'person', 'brand'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const nonEmptyString = (value: unknown, max = MAX_TEXT_LENGTH): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;

function normalizeStringList(
  value: unknown,
  label: string,
  options: { maxItems: number; maxLength: number },
): string[] {
  if (!Array.isArray(value) || value.length > options.maxItems
    || !value.every((item) => nonEmptyString(item, options.maxLength))) {
    throw new LookupInputError('brainbase_knowledge_lookup_input_invalid', `${label} must be a bounded list of non-empty strings`);
  }
  const values = value.map((item) => (item as string).trim());
  if (new Set(values).size !== values.length) {
    throw new LookupInputError('brainbase_knowledge_lookup_input_invalid', `${label} must not contain duplicates`);
  }
  return values;
}

function normalizeFields(value: unknown, label = 'required_fields'): string[] {
  const fields = normalizeStringList(value, label, { maxItems: MAX_FIELDS, maxLength: MAX_FIELD_LENGTH });
  for (const field of fields) {
    const root = field.split('.')[0];
    if (FORBIDDEN_FIELD_ROOTS.has(root) || !KNOWLEDGE_LOOKUP_ALLOWED_FIELD_ROOTS.has(root)
      || field.includes('..') || field.includes('[') || field.includes(']')) {
      throw new LookupInputError('brainbase_knowledge_lookup_field_invalid', `Unsupported field path: ${field}`);
    }
  }
  return fields;
}

/**
 * Validate field paths at a host boundary without exposing the lookup
 * implementation's input-error class.  The continuation host uses this
 * result before it freezes required_fields, so both boundaries enforce the
 * same public and forbidden roots.
 */
export type KnowledgeLookupFieldValidation =
  | { readonly valid: true; readonly fields: string[] }
  | { readonly valid: false; readonly code: string; readonly message: string };

export function validateKnowledgeLookupFields(
  value: unknown,
  label = 'required_fields',
): KnowledgeLookupFieldValidation {
  try {
    return { valid: true, fields: normalizeFields(value, label) };
  } catch (error) {
    if (error instanceof LookupInputError) {
      return { valid: false, code: error.code, message: error.message };
    }
    throw error;
  }
}

function normalizeIds(value: unknown, label: string): string[] {
  const ids = normalizeStringList(value, label, { maxItems: MAX_IDS, maxLength: 1_000 });
  if (ids.some((id) => id.includes(','))) {
    throw new LookupInputError('brainbase_knowledge_lookup_input_invalid', `${label} must contain single Graph ids`);
  }
  return ids;
}

class LookupInputError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/**
 * Validate and normalize the public finish proposal shape.  The continuation
 * host calls this before its evidence checks so the API and host enforce the
 * same bounds, identifier rules, and public field paths.
 */
export function validateKnowledgeLookupFinish(value: unknown): KnowledgeLookupFinishValidation {
  try {
    if (!isRecord(value)) {
      throw new LookupInputError('brainbase_knowledge_lookup_finish_invalid', 'finish action must be an object');
    }
    if (value.assessment !== 'sufficient' && value.assessment !== 'insufficient') {
      throw new LookupInputError('brainbase_knowledge_lookup_finish_invalid', 'finish assessment must be sufficient or insufficient');
    }
    if (value.status !== 'satisfied' && value.status !== 'unresolved' && value.status !== 'needs_user_input') {
      throw new LookupInputError('brainbase_knowledge_lookup_finish_invalid', 'finish status is invalid');
    }
    const referenceIds = normalizeIds(value.reference_ids, 'reference_ids');
    const unresolvedItems = normalizeStringList(value.unresolved_items, 'unresolved_items', {
      maxItems: MAX_FIELDS,
      maxLength: MAX_HINT_LENGTH,
    });
    if (!nonEmptyString(value.termination_reason, MAX_HINT_LENGTH)) {
      throw new LookupInputError('brainbase_knowledge_lookup_finish_invalid', 'termination_reason must be non-empty');
    }
    if (!Array.isArray(value.field_evidence) || value.field_evidence.length > MAX_FIELDS) {
      throw new LookupInputError('brainbase_knowledge_lookup_finish_invalid', 'field_evidence must be a bounded list');
    }
    const fieldEvidence = value.field_evidence.map((item, index) => {
      if (!isRecord(item) || !nonEmptyString(item.field, MAX_FIELD_LENGTH)
        || !nonEmptyString(item.reference_id, 1_000) || !nonEmptyString(item.attempt_id, 300)) {
        throw new LookupInputError('brainbase_knowledge_lookup_finish_invalid', `field_evidence[${index}] is invalid`);
      }
      normalizeFields([item.field], `field_evidence[${index}].field`);
      return {
        field: item.field.trim(),
        reference_id: item.reference_id.trim(),
        attempt_id: item.attempt_id.trim(),
      };
    });
    return {
      valid: true,
      finish: {
        assessment: value.assessment,
        status: value.status,
        reference_ids: referenceIds,
        field_evidence: fieldEvidence,
        unresolved_items: unresolvedItems,
        termination_reason: value.termination_reason.trim(),
      },
    };
  } catch (error) {
    if (error instanceof LookupInputError) {
      return { valid: false, code: error.code, message: error.message };
    }
    throw error;
  }
}

function metadata(args: Record<string, unknown>): Pick<KnowledgeLookupResultData, 'lookup_id' | 'revision' | 'attempt_id'> {
  const lookupId = args.lookup_id;
  const revision = args.revision;
  const attemptId = args.attempt_id;
  if (lookupId !== undefined && !nonEmptyString(lookupId, 200)) {
    throw new LookupInputError('brainbase_knowledge_lookup_input_invalid', 'lookup_id must be a non-empty string');
  }
  if (revision !== undefined && (!Number.isInteger(revision) || Number(revision) < 0)) {
    throw new LookupInputError('brainbase_knowledge_lookup_input_invalid', 'revision must be a non-negative integer');
  }
  if (attemptId !== undefined && !nonEmptyString(attemptId, 300)) {
    throw new LookupInputError('brainbase_knowledge_lookup_input_invalid', 'attempt_id must be a non-empty string');
  }
  return {
    lookup_id: typeof lookupId === 'string' ? lookupId : null,
    revision: typeof revision === 'number' ? revision : null,
    attempt_id: typeof attemptId === 'string' ? attemptId : null,
  };
}

type CommonInput = {
  question: string;
  targetHint: string;
  requiredFields: string[];
  knownEntityId?: string;
  contextHints: string[];
  metadata: Pick<KnowledgeLookupResultData, 'lookup_id' | 'revision' | 'attempt_id'>;
  modelMetadata: NonNullable<KnowledgeLookupResultData['model_metadata']>;
};

function commonInput(args: Record<string, unknown>): CommonInput {
  if (!nonEmptyString(args.question)) {
    throw new LookupInputError('brainbase_knowledge_lookup_input_invalid', 'question must be a non-empty string');
  }
  if (!nonEmptyString(args.target_hint, MAX_HINT_LENGTH)) {
    throw new LookupInputError('brainbase_knowledge_lookup_input_invalid', 'target_hint must be a non-empty string');
  }
  const requiredFields = normalizeFields(args.required_fields);
  if (requiredFields.length === 0) {
    throw new LookupInputError('brainbase_knowledge_lookup_input_invalid', 'required_fields must contain at least one field');
  }
  const knownEntityId = args.known_entity_id === undefined
    ? undefined
    : nonEmptyString(args.known_entity_id, 1_000) && !args.known_entity_id.includes(',')
      ? args.known_entity_id.trim()
      : (() => {
        throw new LookupInputError('brainbase_knowledge_lookup_input_invalid', 'known_entity_id must be a single Graph id');
      })();
  const contextHints = args.context_hints === undefined
    ? []
    : normalizeStringList(args.context_hints, 'context_hints', { maxItems: MAX_CONTEXT_HINTS, maxLength: MAX_HINT_LENGTH });
  const assessment = args.assessment === undefined
    ? undefined
    : args.assessment === 'sufficient' || args.assessment === 'insufficient'
      ? args.assessment
      : (() => {
        throw new LookupInputError('brainbase_knowledge_lookup_input_invalid', 'assessment must be sufficient or insufficient');
      })();
  const missingInformation = args.missing_information === undefined
    ? []
    : normalizeStringList(args.missing_information, 'missing_information', { maxItems: MAX_FIELDS, maxLength: MAX_HINT_LENGTH });
  const whyDifferent = args.why_different === undefined
    ? undefined
    : nonEmptyString(args.why_different, MAX_HINT_LENGTH)
      ? args.why_different.trim()
      : (() => {
        throw new LookupInputError('brainbase_knowledge_lookup_input_invalid', 'why_different must be a non-empty string');
      })();
  const basedOnAttemptIds = args.based_on_attempt_ids === undefined
    ? []
    : normalizeStringList(args.based_on_attempt_ids, 'based_on_attempt_ids', { maxItems: MAX_IDS, maxLength: 300 });
  return {
    question: args.question.trim(),
    targetHint: args.target_hint.trim(),
    requiredFields,
    ...(knownEntityId ? { knownEntityId } : {}),
    contextHints,
    metadata: metadata(args),
    modelMetadata: {
      ...(assessment ? { assessment } : {}),
      missing_information: missingInformation,
      ...(whyDifferent ? { why_different: whyDifferent } : {}),
      based_on_attempt_ids: basedOnAttemptIds,
    },
  };
}

function queryForInput(input: CommonInput, actionQuery?: string): string {
  const values = [
    actionQuery,
    input.question,
    input.targetHint,
    ...(input.knownEntityId ? [`known_entity_id: ${input.knownEntityId}`] : []),
    ...input.contextHints,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const query = values.join('\n').trim();
  if (!query || query.length > MAX_TEXT_LENGTH) {
    throw new LookupInputError('brainbase_knowledge_lookup_input_invalid', 'lookup query is empty or too long');
  }
  return query;
}

function validateEntityTypes(value: unknown): string[] {
  if (value === undefined) return [...DEFAULT_ENTITY_TYPES];
  return normalizeStringList(value, 'entity_types', { maxItems: 10, maxLength: 100 });
}

function normalizeAction(raw: unknown, input: CommonInput): KnowledgeLookupAction | (KnowledgeLookupAction & { finish: KnowledgeLookupFinishProposal }) {
  if (raw === undefined) return { kind: 'search', required_fields: input.requiredFields };
  if (!isRecord(raw) || !nonEmptyString(raw.kind, 40)) {
    throw new LookupInputError('brainbase_knowledge_lookup_action_invalid', 'next_action.kind is required');
  }
  const kind = raw.kind as KnowledgeLookupActionKind;
  if (!['search', 'read', 'follow_relation', 'finish'].includes(kind)) {
    throw new LookupInputError('brainbase_knowledge_lookup_action_unsupported', `Unsupported next action: ${String(raw.kind)}`);
  }
  const actionFields = raw.required_fields === undefined
    ? input.requiredFields
    : normalizeFields(raw.required_fields, 'next_action.required_fields');
  const omittedRequiredFields = input.requiredFields.filter((field) => !actionFields.includes(field));
  if (omittedRequiredFields.length > 0) {
    throw new LookupInputError(
      'brainbase_knowledge_lookup_action_invalid',
      `next_action.required_fields cannot omit top-level required_fields: ${omittedRequiredFields.join(', ')}`,
    );
  }
  const whyDifferent = raw.why_different === undefined
    ? undefined
    : nonEmptyString(raw.why_different, MAX_HINT_LENGTH)
      ? raw.why_different.trim()
      : (() => {
        throw new LookupInputError('brainbase_knowledge_lookup_action_invalid', 'why_different must be a non-empty string');
      })();
  if (kind === 'search') {
    const query = raw.query === undefined
      ? queryForInput(input)
      : nonEmptyString(raw.query) ? raw.query.trim() : (() => {
        throw new LookupInputError('brainbase_knowledge_lookup_action_invalid', 'search query must be non-empty');
      })();
    return {
      kind,
      required_fields: actionFields,
      ...(whyDifferent ? { why_different: whyDifferent } : {}),
      query,
      entity_types: validateEntityTypes(raw.entity_types),
      ...(raw.seed_ids === undefined ? {} : { seed_ids: normalizeIds(raw.seed_ids, 'next_action.seed_ids') }),
    };
  }
  if (kind === 'read') {
    if (!nonEmptyString(raw.entity_id, 1_000) || raw.entity_id.includes(',')) {
      throw new LookupInputError('brainbase_knowledge_lookup_action_invalid', 'read entity_id must be a single Graph id');
    }
    if (!nonEmptyString(raw.entity_type, 100) || raw.entity_type.includes(',')) {
      throw new LookupInputError('brainbase_knowledge_lookup_action_invalid', 'read entity_type must be a single type');
    }
    return {
      kind,
      required_fields: actionFields,
      ...(whyDifferent ? { why_different: whyDifferent } : {}),
      entity_id: raw.entity_id.trim(),
      entity_type: raw.entity_type.trim(),
    };
  }
  if (kind === 'follow_relation') {
    const seedIds = normalizeIds(raw.seed_ids, 'next_action.seed_ids');
    if (!nonEmptyString(raw.relation, MAX_RELATION_LENGTH)) {
      throw new LookupInputError('brainbase_knowledge_lookup_action_invalid', 'relation must be a non-empty string');
    }
    if (raw.direction !== 'incoming' && raw.direction !== 'outgoing') {
      throw new LookupInputError('brainbase_knowledge_lookup_action_invalid', 'direction must be incoming or outgoing');
    }
    const targetTypes = raw.target_types === undefined
      ? undefined
      : normalizeStringList(raw.target_types, 'target_types', { maxItems: 10, maxLength: 100 });
    return {
      kind,
      required_fields: actionFields,
      ...(whyDifferent ? { why_different: whyDifferent } : {}),
      seed_ids: seedIds,
      relation: raw.relation.trim(),
      direction: raw.direction,
      ...(targetTypes ? { target_types: targetTypes } : {}),
    };
  }
  return normalizeFinish(raw, actionFields, whyDifferent);
}

function normalizeFinish(
  raw: Record<string, unknown>,
  requiredFields: string[],
  whyDifferent?: string,
): KnowledgeLookupAction & { finish: KnowledgeLookupFinishProposal } {
  const validation = validateKnowledgeLookupFinish(raw);
  if (!validation.valid) throw new LookupInputError(validation.code, validation.message);
  return {
    kind: 'finish',
    required_fields: requiredFields,
    ...(whyDifferent ? { why_different: whyDifferent } : {}),
    finish: validation.finish,
  };
}

function flattenFields(value: unknown, prefix: string, output: Set<string>): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'object') {
    if (String(value).trim()) output.add(prefix);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 0) output.add(prefix);
    value.forEach((item, index) => flattenFields(item, `${prefix}.${index}`, output));
    return;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length === 0) return;
  output.add(prefix);
  for (const [key, child] of Object.entries(record)) flattenFields(child, `${prefix}.${key}`, output);
}

function publicProjection(raw: Record<string, unknown>, projection: KnowledgeLookupProjection): {
  body: Record<string, unknown>;
  entityType: string;
  fields: string[];
} {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(projection.body)) {
    if (value === undefined || !KNOWLEDGE_LOOKUP_ALLOWED_FIELD_ROOTS.has(key)
      || key === 'filePath' || key === 'retrieval_evidence') continue;
    body[key] = value;
  }
  const graphId = raw.id ?? raw.entity_id;
  if (typeof graphId === 'string' && graphId.trim()) {
    body.id = graphId;
    body.graph_entity_id = graphId;
  }
  const rawType = raw.entity_type ?? raw.type;
  const entityType = typeof projection.entity_type === 'string' && projection.entity_type.trim()
    ? projection.entity_type
    : typeof body.type === 'string' && body.type.trim()
      ? body.type
      : typeof rawType === 'string' && rawType.trim() ? rawType : 'unknown';
  if (!body.type && entityType !== 'unknown') body.type = entityType;
  const fields = new Set<string>();
  for (const [key, value] of Object.entries(body)) flattenFields(value, key, fields);
  return { body, entityType, fields: [...fields].sort() };
}

function requiredMissing(requiredFields: string[], availableFields: string[]): string[] {
  const available = new Set(availableFields);
  return requiredFields.filter((field) => !available.has(field));
}

function boundedCandidateValue(value: unknown): unknown {
  if (typeof value === 'string') return value.length > 1_000 ? `${value.slice(0, 997)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  return undefined;
}

function candidateSummary(candidate: Record<string, unknown>, evidence: Record<string, unknown>): KnowledgeLookupCandidateSummary {
  const id = candidate.id ?? candidate.entity_id;
  const entityType = candidate.entity_type ?? candidate.type;
  const summary: Record<string, unknown> = {
    id: String(id),
    entity_type: String(entityType),
  };
  for (const field of ['name', 'title', 'display_name', 'excerpt'] as const) {
    const value = boundedCandidateValue(candidate[field]);
    if (typeof value === 'string' && value.trim()) summary[field] = value;
  }
  const publicEvidence: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(evidence)) {
    const bounded = boundedCandidateValue(value);
    if (bounded !== undefined) publicEvidence[field] = bounded;
  }
  if (Object.keys(publicEvidence).length > 0) summary.evidence = publicEvidence;
  return summary as unknown as KnowledgeLookupCandidateSummary;
}

function referencesFromCandidates(candidates: readonly unknown[]): {
  references: KnowledgeLookupReference[];
  availableFields: string[];
  summaries: KnowledgeLookupCandidateSummary[];
} {
  const references: KnowledgeLookupReference[] = [];
  const available = new Set<string>();
  const summaries: KnowledgeLookupCandidateSummary[] = [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const id = candidate.id ?? candidate.entity_id;
    const entityType = candidate.entity_type ?? candidate.type;
    if (!nonEmptyString(id, 1_000) || !nonEmptyString(entityType, 100)) continue;
    const evidence = isRecord(candidate.evidence) ? candidate.evidence : {};
    const fields = Object.keys(evidence).filter((field) => evidence[field] !== undefined && evidence[field] !== null);
    for (const field of fields) available.add(field);
    for (const field of ['name', 'title', 'display_name', 'excerpt'] as const) {
      if (typeof candidate[field] === 'string' && candidate[field].trim()) available.add(field);
    }
    references.push({ id: id.trim(), entity_type: entityType.trim(), evidence_fields: fields.sort() });
    summaries.push(candidateSummary(candidate, evidence));
  }
  return { references, availableFields: [...available].sort(), summaries };
}

function baseResult(
  input: CommonInput,
  action: KnowledgeLookupAction,
  scope: string[],
  data: Partial<KnowledgeLookupResultData> = {},
): KnowledgeLookupResultData {
  return {
    lookup_id: input.metadata.lookup_id,
    revision: input.metadata.revision,
    attempt_id: input.metadata.attempt_id,
    outcome: 'incomplete',
    searched_scope: { project_codes: [...scope] },
    references: [],
    available_fields: [],
    missing_fields: action.required_fields,
    coverage: 'unknown',
    absence_confirmed: false,
    body: null,
    action,
    ...data,
    model_metadata: input.modelMetadata,
  };
}

function dependencyFailure(
  input: CommonInput,
  action: KnowledgeLookupAction,
  retrieval: KnowledgeLookupDependencyResult,
): KnowledgeLookupToolResult {
  const error = retrieval.error;
  const httpStatus = error?.http_status;
  const code = error?.code || 'brainbase_knowledge_lookup_failed';
  const outcome: KnowledgeLookupOutcome = code === 'brainbase_project_not_accessible' || httpStatus === 401 || httpStatus === 403
    ? 'forbidden'
    : retrieval.status === 'unavailable' || (httpStatus !== undefined && httpStatus >= 500)
      ? 'transport_error'
      : 'unsupported';
  const data = baseResult(input, action, retrieval.scope.project_codes, {
    outcome,
    coverage: outcome === 'transport_error' ? 'unknown' : 'complete',
    error_kind: code,
  });
  return {
    status: retrieval.status,
    scope: retrieval.scope,
    data,
    ...(error ? { error } : {}),
  };
}

function success(
  input: CommonInput,
  action: KnowledgeLookupAction,
  scope: string[],
  data: Partial<KnowledgeLookupResultData>,
): KnowledgeLookupToolResult {
  return { status: 'ok', scope: { project_codes: scope }, data: baseResult(input, action, scope, data) };
}

function coverageOf(value: unknown): 'complete' | 'partial' | 'unknown' {
  return value === 'complete' || value === 'partial' ? value : 'unknown';
}

async function runSearch(input: CommonInput, action: KnowledgeLookupAction, deps: KnowledgeLookupDependencies): Promise<KnowledgeLookupToolResult> {
  const retrieval = await deps.search({
    query: queryForInput(input, action.query),
    entity_types: action.entity_types ?? [...DEFAULT_ENTITY_TYPES],
    required_fields: action.required_fields,
    ...(action.seed_ids ? { seed_ids: action.seed_ids } : {}),
  });
  if (retrieval.status !== 'ok') return dependencyFailure(input, action, retrieval);
  const data = isRecord(retrieval.data) ? retrieval.data as KnowledgeLookupSearchData : {};
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const { references, availableFields, summaries } = referencesFromCandidates(candidates);
  const coverage = coverageOf(data.coverage);
  // Empty is meaningful only when the host confirms complete coverage.  A
  // partial/unknown result remains incomplete so the host can re-plan.
  const outcome: KnowledgeLookupOutcome = references.length === 0 && coverage === 'complete' ? 'empty' : 'incomplete';
  return success(input, action, retrieval.scope.project_codes, {
    outcome,
    references,
    available_fields: availableFields,
    missing_fields: requiredMissing(action.required_fields, availableFields),
    coverage,
    body: summaries.length > 0 ? { candidates: summaries } : null,
  });
}

async function runRead(input: CommonInput, action: KnowledgeLookupAction, deps: KnowledgeLookupDependencies): Promise<KnowledgeLookupToolResult> {
  const retrieval = await deps.read({
    entity_id: action.entity_id!,
    entity_type: action.entity_type!,
    required_fields: action.required_fields,
  });
  if (retrieval.status !== 'ok') return dependencyFailure(input, action, retrieval);
  const data = isRecord(retrieval.data) ? retrieval.data as KnowledgeLookupReadData : {};
  const raw = isRecord(data.entity) ? data.entity : null;
  if (!raw) {
    const coverage = coverageOf(data.coverage);
    return success(input, action, retrieval.scope.project_codes, {
      outcome: coverage === 'complete' ? 'empty' : 'incomplete',
      coverage,
      missing_fields: action.required_fields,
    });
  }
  let projection: KnowledgeLookupProjection;
  try {
    projection = deps.projectEntity(raw);
    if (!isRecord(projection) || !isRecord(projection.body)) throw new Error('projectEntity must return a public body');
  } catch (error) {
    return {
      status: 'error',
      scope: retrieval.scope,
      data: baseResult(input, action, retrieval.scope.project_codes, {
        outcome: 'unsupported',
        coverage: 'unknown',
        error_kind: 'brainbase_knowledge_lookup_projection_invalid',
      }),
      error: {
        code: 'brainbase_knowledge_lookup_projection_invalid',
        message: error instanceof Error ? error.message : 'projectEntity returned an invalid public projection',
      },
    };
  }
  const projected = publicProjection(raw, projection);
  const reference: KnowledgeLookupReference = {
    id: String(raw.id ?? raw.entity_id),
    entity_type: projected.entityType,
    evidence_fields: projected.fields,
  };
  const missingFields = requiredMissing(action.required_fields, projected.fields);
  return success(input, action, retrieval.scope.project_codes, {
    outcome: missingFields.length > 0 ? 'incomplete' : 'retrieved',
    references: [reference],
    available_fields: projected.fields,
    missing_fields: missingFields,
    coverage: coverageOf(data.coverage) === 'unknown' ? 'complete' : coverageOf(data.coverage),
    body: projected.body,
  });
}

async function runRelation(input: CommonInput, action: KnowledgeLookupAction, deps: KnowledgeLookupDependencies): Promise<KnowledgeLookupToolResult> {
  const retrieval = await deps.followRelation({
    query: queryForInput(input),
    entity_types: action.target_types ?? [...DEFAULT_ENTITY_TYPES],
    required_fields: action.required_fields,
    seed_ids: action.seed_ids!,
    relation: action.relation!,
    direction: action.direction!,
    ...(action.target_types ? { target_types: action.target_types } : {}),
  });
  if (retrieval.status !== 'ok') return dependencyFailure(input, action, retrieval);
  const data = isRecord(retrieval.data) ? retrieval.data as KnowledgeLookupSearchData : {};
  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const { references, availableFields, summaries } = referencesFromCandidates(candidates);
  const coverage = coverageOf(data.coverage);
  return success(input, action, retrieval.scope.project_codes, {
    outcome: references.length === 0 && coverage === 'complete' ? 'empty' : 'incomplete',
    references,
    available_fields: availableFields,
    missing_fields: requiredMissing(action.required_fields, availableFields),
    coverage,
    body: summaries.length > 0 ? { candidates: summaries } : null,
  });
}

function runFinish(input: CommonInput, action: KnowledgeLookupAction & { finish: KnowledgeLookupFinishProposal }): KnowledgeLookupToolResult {
  // A finish proposal is advisory.  The host verifies cited fields against
  // actual read attempts before accepting it; this branch performs no I/O.
  return success(input, action, [], {
    outcome: 'incomplete',
    coverage: 'unknown',
    proposed_finish: action.finish,
  });
}

function isFinishAction(action: KnowledgeLookupAction | (KnowledgeLookupAction & { finish: KnowledgeLookupFinishProposal })): action is KnowledgeLookupAction & { finish: KnowledgeLookupFinishProposal } {
  return action.kind === 'finish' && 'finish' in action;
}

function unsupported(input: CommonInput | null, action: KnowledgeLookupAction | null, error: LookupInputError): KnowledgeLookupToolResult {
  const data = input && action
    ? baseResult(input, action, [], { outcome: 'unsupported', coverage: 'unknown', error_kind: error.code })
    : undefined;
  return {
    status: 'error',
    scope: { project_codes: [] },
    ...(data ? { data } : {}),
    error: { code: error.code, message: error.message },
  };
}

export const knowledgeLookupTools: Tool[] = [{
  name: 'brainbase_knowledge_lookup',
  description: 'Find and read authorized Graph knowledge by purpose. Each call performs one bounded search, read, relation follow, or finish proposal; project hints never change authorization scope.',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', minLength: 1, maxLength: MAX_TEXT_LENGTH },
      target_hint: { type: 'string', minLength: 1, maxLength: MAX_HINT_LENGTH },
      required_fields: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_FIELDS,
        description: 'Public field paths only; use roots such as content, body, statement, markdown, summary, name, or environments.production.endpoint.',
        items: { type: 'string', minLength: 1, maxLength: MAX_FIELD_LENGTH },
      },
      known_entity_id: { type: 'string', minLength: 1, maxLength: 1_000 },
      context_hints: { type: 'array', maxItems: MAX_CONTEXT_HINTS, items: { type: 'string', minLength: 1, maxLength: MAX_HINT_LENGTH } },
      lookup_id: { type: 'string', minLength: 1, maxLength: 200 },
      revision: { type: 'integer', minimum: 0 },
      attempt_id: { type: 'string', minLength: 1, maxLength: 300 },
      assessment: { type: 'string', enum: ['sufficient', 'insufficient'] },
      missing_information: { type: 'array', maxItems: MAX_FIELDS, items: { type: 'string', minLength: 1, maxLength: MAX_HINT_LENGTH } },
      based_on_attempt_ids: { type: 'array', maxItems: MAX_IDS, items: { type: 'string', minLength: 1, maxLength: 300 } },
      why_different: { type: 'string', minLength: 1, maxLength: MAX_HINT_LENGTH },
      next_action: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['search', 'read', 'follow_relation', 'finish'] },
          query: { type: 'string', minLength: 1, maxLength: MAX_TEXT_LENGTH },
          entity_types: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 100 } },
          seed_ids: { type: 'array', minItems: 1, maxItems: MAX_IDS, items: { type: 'string', minLength: 1, maxLength: 1_000 } },
          entity_id: { type: 'string', minLength: 1, maxLength: 1_000 },
          entity_type: { type: 'string', minLength: 1, maxLength: 100 },
          required_fields: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_FIELDS,
            description: 'Must contain the same public field paths as the top-level required_fields.',
            items: { type: 'string', minLength: 1, maxLength: MAX_FIELD_LENGTH },
          },
          relation: { type: 'string', minLength: 1, maxLength: MAX_RELATION_LENGTH },
          direction: { type: 'string', enum: ['incoming', 'outgoing'] },
          target_types: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 100 } },
          why_different: { type: 'string', minLength: 1, maxLength: MAX_HINT_LENGTH },
          assessment: { type: 'string', enum: ['sufficient', 'insufficient'] },
          status: { type: 'string', enum: ['satisfied', 'unresolved', 'needs_user_input'] },
          reference_ids: { type: 'array', maxItems: MAX_IDS, items: { type: 'string', minLength: 1, maxLength: 1_000 } },
          field_evidence: {
            type: 'array',
            maxItems: MAX_FIELDS,
            items: {
              type: 'object',
              properties: {
                field: { type: 'string', minLength: 1, maxLength: MAX_FIELD_LENGTH },
                reference_id: { type: 'string', minLength: 1, maxLength: 1_000 },
                attempt_id: { type: 'string', minLength: 1, maxLength: 300 },
              },
              required: ['field', 'reference_id', 'attempt_id'],
              additionalProperties: false,
            },
          },
          unresolved_items: { type: 'array', maxItems: MAX_FIELDS, items: { type: 'string', minLength: 1, maxLength: MAX_HINT_LENGTH } },
          termination_reason: { type: 'string', minLength: 1, maxLength: MAX_HINT_LENGTH },
        },
        oneOf: [
          { properties: { kind: { const: 'search' } }, required: ['kind'] },
          { properties: { kind: { const: 'read' } }, required: ['kind', 'entity_id', 'entity_type'] },
          { properties: { kind: { const: 'follow_relation' } }, required: ['kind', 'seed_ids', 'relation', 'direction'] },
          {
            properties: { kind: { const: 'finish' } },
            required: ['kind', 'assessment', 'status', 'reference_ids', 'field_evidence', 'unresolved_items', 'termination_reason'],
          },
        ],
        required: ['kind'],
        additionalProperties: false,
      },
    },
    required: ['question', 'target_hint', 'required_fields'],
    additionalProperties: false,
  },
}];

export async function handleKnowledgeLookupToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies: KnowledgeLookupDependencies,
): Promise<KnowledgeLookupToolResult | null> {
  if (name !== 'brainbase_knowledge_lookup') return null;
  let input: CommonInput | null = null;
  let action: KnowledgeLookupAction | null = null;
  try {
    // A project code is deliberately not part of this purpose-based contract.
    // Silently accepting it would make a model supplied hint look like an
    // authorization filter.
    if (Object.hasOwn(args, 'project_code')) {
      throw new LookupInputError(
        'brainbase_knowledge_lookup_input_invalid',
        'project_code is not accepted; put a project hint in target_hint or context_hints',
      );
    }
    input = commonInput(args);
    action = normalizeAction(args.next_action, input);
    if (isFinishAction(action)) return runFinish(input, action);
    if (action.kind === 'search') return await runSearch(input, action, dependencies);
    if (action.kind === 'read') return await runRead(input, action, dependencies);
    return await runRelation(input, action, dependencies);
  } catch (error) {
    if (error instanceof LookupInputError) return unsupported(input, action, error);
    return {
      status: 'unavailable',
      scope: { project_codes: [] },
      error: {
        code: 'brainbase_knowledge_lookup_unavailable',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
