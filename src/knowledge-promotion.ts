/**
 * Common knowledge promotion (brainbase-project ADR-006 D4・D12).
 *
 * Two approval kinds pass through the same service and reach the organization
 * Graph only after an organization approval:
 *
 * - `personal_share`: a Personal Knowledge v1 event → owner consent →
 *   organization review → Graph.
 * - `organization_candidate`: an organization candidate (meeting observation,
 *   task candidate, ...) → organization approval → Graph. It never takes the
 *   shape of an owner consent.
 *
 * When the owner retracts the source memory, `withdrawPersonalShares` cancels
 * the shares still waiting for a decision and withdraws an already promoted
 * Graph fact from future retrieval, keeping the approval lineage and audit.
 *
 * This module owns normalization, receipts, evidence, lineage, the Graph
 * mutation, and the state machine. Storage, the source readers, the knowledge
 * event kernel, the Graph writer, and the organization review policy (roles,
 * decision authority) are injected. A missing port stops the operation.
 */
import { createHash } from 'node:crypto';

export const KNOWLEDGE_PROMOTION_CONTRACT_VERSION = 'knowledge_promotion.v1' as const;
/** Kept byte-compatible with brainbase-unson so stored hashes and receipts still verify. */
export const NORMALIZED_PROMOTION_SCHEMA_VERSION = 'personal_knowledge_normalized.v1' as const;

export type PromotionApprovalKind = 'personal_share' | 'organization_candidate';
export type PromotionSourceKind = 'personal_knowledge_v1' | 'organization_candidate';
export type PromotionStatus =
  | 'pending_owner_approval'
  | 'pending_org_review'
  | 'owner_rejected'
  | 'org_rejected'
  | 'org_accepted'
  | 'source_stale'
  | 'source_withdrawn';
export type PromotionDecision = 'approve' | 'reject';
export type PromotionReviewAction = 'request' | 'owner_consent' | 'organization_review';

export class KnowledgePromotionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, status = 400, details?: Record<string, unknown>) {
    super(code);
    this.name = 'KnowledgePromotionError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Normalization (same rules as brainbase-unson personal-knowledge-normalization.js)
// ---------------------------------------------------------------------------

const ALLOWED_KINDS = new Set(['decision', 'entity', 'relation']);
const ALLOWED_ROLES = new Set(['member', 'gm', 'ceo']);
const ALLOWED_SENSITIVITIES = new Set(['internal', 'restricted', 'finance', 'hr', 'contract']);
const SAFE_IDENTIFIER = /^[a-z][a-z0-9_.:-]{0,199}$/i;
const SECRET_OR_PRIVATE = /(secret\s*=|password\s*=|api[_-]?key\s*=|bearer\s+[a-z0-9._-]+|\/Users\/|\/home\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;
const FORBIDDEN_KEY = /(^|_)(body|raw|transcript|conversation|message|prompt|private|personal|excerpt|preview|content|note)(_|$)/i;
const SERVER_CONTROLLED_KEY = /(^|_)(source_pointer|source_evidence|owner_consent|organization_review|promotion_evidence|receipt)(_|$)/i;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 80;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface NormalizedPromotionEntity {
  id: string;
  type: string;
  payload: Record<string, JsonValue>;
}

export interface NormalizedPromotionEdge {
  from_id: string;
  to_id: string;
  relation: string;
  payload: Record<string, JsonValue>;
}

export interface NormalizedPromotionPayload {
  schema_version: typeof NORMALIZED_PROMOTION_SCHEMA_VERSION;
  kind: 'decision' | 'entity' | 'relation';
  entity: NormalizedPromotionEntity;
  edges: NormalizedPromotionEdge[];
  context_entities: Array<{ id: string; type: string }>;
  decision_domain?: string;
  sensitivity: string;
  role_min: string;
}

export interface NormalizedPromotionResult {
  normalized: NormalizedPromotionPayload;
  normalized_payload_hash: string;
  summary: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function promotionSha256(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

function requirePlainObject(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new KnowledgePromotionError(code);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new KnowledgePromotionError(code);
  return value as Record<string, unknown>;
}

function safeIdentifier(value: unknown, code: string): string {
  const result = String(value ?? '').trim();
  if (!SAFE_IDENTIFIER.test(result) || SECRET_OR_PRIVATE.test(result)) throw new KnowledgePromotionError(code);
  return result;
}

function safeText(value: unknown, code: string, maxLength = 1000): string {
  const result = String(value ?? '').trim();
  if (!result || result.length > maxLength || SECRET_OR_PRIVATE.test(result)) throw new KnowledgePromotionError(code);
  return result;
}

function sanitizeStructuredValue(value: unknown, depth = 0): JsonValue {
  if (depth > MAX_DEPTH) throw new KnowledgePromotionError('personal_knowledge_normalized_payload_too_deep');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new KnowledgePromotionError('personal_knowledge_normalized_payload_invalid_number');
    return value;
  }
  if (typeof value === 'string') return safeText(value, 'personal_knowledge_normalized_payload_contains_private_content');
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) throw new KnowledgePromotionError('personal_knowledge_normalized_payload_too_large');
    return value.map((item) => sanitizeStructuredValue(item, depth + 1));
  }
  const object = requirePlainObject(value, 'personal_knowledge_normalized_payload_invalid');
  const keys = Object.keys(object);
  if (keys.length > MAX_OBJECT_KEYS) throw new KnowledgePromotionError('personal_knowledge_normalized_payload_too_large');
  const result: Record<string, JsonValue> = {};
  for (const key of keys) {
    if (!/^[a-z][a-z0-9_]{0,79}$/i.test(key)
      || FORBIDDEN_KEY.test(key)
      || SERVER_CONTROLLED_KEY.test(key)
      || ['__proto__', 'prototype', 'constructor'].includes(key)) {
      throw new KnowledgePromotionError('personal_knowledge_normalized_payload_forbidden_field');
    }
    result[key] = sanitizeStructuredValue(object[key], depth + 1);
  }
  return result;
}

function normalizeEntity(value: unknown): NormalizedPromotionEntity {
  const entity = requirePlainObject(value, 'personal_knowledge_normalized_entity_required');
  if (Object.keys(entity).some((key) => !['id', 'type', 'payload'].includes(key))) {
    throw new KnowledgePromotionError('personal_knowledge_normalized_entity_forbidden_field');
  }
  const payload = sanitizeStructuredValue(
    requirePlainObject(entity.payload, 'personal_knowledge_normalized_entity_payload_required'),
  ) as Record<string, JsonValue>;
  return {
    id: safeIdentifier(entity.id, 'personal_knowledge_normalized_entity_id_invalid'),
    type: safeIdentifier(entity.type, 'personal_knowledge_normalized_entity_type_invalid'),
    payload,
  };
}

function normalizeContextEntities(value: unknown = []): Array<{ id: string; type: string }> {
  if (!Array.isArray(value) || value.length > 40) {
    throw new KnowledgePromotionError('personal_knowledge_normalized_context_entities_invalid');
  }
  return value.map((item) => {
    const context = requirePlainObject(item, 'personal_knowledge_normalized_context_entity_invalid');
    if (Object.keys(context).some((key) => !['id', 'type'].includes(key))) {
      throw new KnowledgePromotionError('personal_knowledge_normalized_context_entity_forbidden_field');
    }
    return {
      id: safeIdentifier(context.id, 'personal_knowledge_normalized_context_entity_id_invalid'),
      type: safeIdentifier(context.type, 'personal_knowledge_normalized_context_entity_type_invalid'),
    };
  });
}

function normalizeEdges(value: unknown, entityId: string, contextEntities: Array<{ id: string }>): NormalizedPromotionEdge[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new KnowledgePromotionError('personal_knowledge_normalized_edges_invalid');
  }
  const endpointIds = new Set([entityId, ...contextEntities.map((item) => item.id)]);
  return value.map((item) => {
    const edge = requirePlainObject(item, 'personal_knowledge_normalized_edge_invalid');
    if (Object.keys(edge).some((key) => !['from_id', 'to_id', 'relation', 'payload'].includes(key))) {
      throw new KnowledgePromotionError('personal_knowledge_normalized_edge_forbidden_field');
    }
    const normalized: NormalizedPromotionEdge = {
      from_id: safeIdentifier(edge.from_id, 'personal_knowledge_normalized_edge_endpoint_invalid'),
      to_id: safeIdentifier(edge.to_id, 'personal_knowledge_normalized_edge_endpoint_invalid'),
      relation: safeIdentifier(edge.relation, 'personal_knowledge_normalized_edge_relation_invalid'),
      payload: edge.payload === undefined
        ? {}
        : sanitizeStructuredValue(requirePlainObject(edge.payload, 'personal_knowledge_normalized_edge_payload_invalid')) as Record<string, JsonValue>,
    };
    if (!endpointIds.has(normalized.from_id) || !endpointIds.has(normalized.to_id)) {
      throw new KnowledgePromotionError('personal_knowledge_normalized_edge_context_missing');
    }
    if (normalized.from_id !== entityId && normalized.to_id !== entityId) {
      throw new KnowledgePromotionError('personal_knowledge_normalized_edge_must_include_primary_entity');
    }
    return normalized;
  });
}

function normalizedSummary(normalized: NormalizedPromotionPayload): string {
  const payload = normalized.entity.payload || {};
  const candidate = payload.statement || payload.label || payload.name || payload.title || normalized.entity.id;
  return safeText(candidate, 'personal_knowledge_normalized_summary_required', 1000);
}

/** Validate and canonicalize the structured content a person approves for the organization. */
export function normalizePromotionPayload(input: unknown): NormalizedPromotionResult {
  const value = requirePlainObject(input, 'personal_knowledge_normalized_payload_required');
  const allowed = new Set([
    'schema_version', 'kind', 'entity', 'edges', 'context_entities',
    'decision_domain', 'sensitivity', 'role_min',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new KnowledgePromotionError('personal_knowledge_normalized_payload_forbidden_field');
  }
  if (value.schema_version !== NORMALIZED_PROMOTION_SCHEMA_VERSION) {
    throw new KnowledgePromotionError('personal_knowledge_normalized_payload_schema_invalid');
  }
  const kind = String(value.kind ?? '').trim();
  if (!ALLOWED_KINDS.has(kind)) throw new KnowledgePromotionError('personal_knowledge_normalized_payload_kind_invalid');
  const entity = normalizeEntity(value.entity);
  const contextEntities = normalizeContextEntities(value.context_entities ?? []);
  const edges = normalizeEdges(value.edges ?? [], entity.id, contextEntities);
  if (kind === 'decision' && entity.type !== 'decision') {
    throw new KnowledgePromotionError('personal_knowledge_normalized_decision_type_required');
  }
  if (kind !== 'decision' && entity.type === 'decision') {
    throw new KnowledgePromotionError('personal_knowledge_normalized_kind_mismatch');
  }
  if (kind === 'relation' && edges.length === 0) {
    throw new KnowledgePromotionError('personal_knowledge_normalized_relation_edge_required');
  }
  const decisionDomain = kind === 'decision'
    ? safeIdentifier(value.decision_domain, 'personal_knowledge_normalized_decision_domain_required')
    : null;
  if (kind === 'decision') {
    safeText(entity.payload.statement, 'personal_knowledge_normalized_decision_statement_required', 1000);
  } else if (value.decision_domain !== undefined) {
    throw new KnowledgePromotionError('personal_knowledge_normalized_decision_domain_not_allowed');
  }
  const sensitivity = String(value.sensitivity ?? 'internal').toLowerCase();
  if (!ALLOWED_SENSITIVITIES.has(sensitivity)) {
    throw new KnowledgePromotionError('personal_knowledge_normalized_sensitivity_invalid');
  }
  const roleMin = String(value.role_min ?? 'member').toLowerCase();
  if (!ALLOWED_ROLES.has(roleMin)) throw new KnowledgePromotionError('personal_knowledge_normalized_role_invalid');
  const normalized: NormalizedPromotionPayload = {
    schema_version: NORMALIZED_PROMOTION_SCHEMA_VERSION,
    kind: kind as NormalizedPromotionPayload['kind'],
    entity,
    edges,
    context_entities: contextEntities,
    ...(decisionDomain ? { decision_domain: decisionDomain } : {}),
    sensitivity,
    role_min: roleMin,
  };
  if (Buffer.byteLength(canonicalJson(normalized), 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new KnowledgePromotionError('personal_knowledge_normalized_payload_too_large');
  }
  return {
    normalized,
    normalized_payload_hash: `sha256:${promotionSha256(normalized)}`,
    summary: normalizedSummary(normalized),
  };
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

function isoTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Owner consent receipt, identical to brainbase-unson's `pkoc_` receipt. */
export function ownerConsentReceipt(request: {
  request_id: string;
  owner_person_id: string | null;
  owner_decided_by: string | null;
  owner_decided_at: string | Date | null;
  normalized_payload_hash: string;
}): string {
  if (!request.owner_decided_by || !request.owner_decided_at || !request.normalized_payload_hash) {
    throw new KnowledgePromotionError('knowledge_promotion_owner_consent_receipt_unavailable', 409);
  }
  return `pkoc_${promotionSha256({
    request_id: request.request_id,
    owner_person_id: request.owner_person_id,
    owner_decided_by: request.owner_decided_by,
    owner_decided_at: isoTimestamp(request.owner_decided_at),
    normalized_payload_hash: request.normalized_payload_hash,
  }).slice(0, 24)}`;
}

/** Organization review receipt of a personal share, identical to brainbase-unson's `pkor_` receipt. */
export function organizationReviewReceipt(
  request: { request_id: string },
  normalizedPayloadHash: string,
  reviewerPersonId: string,
  reviewedAt: string,
): string {
  return `pkor_${promotionSha256({
    request_id: request.request_id,
    normalized_payload_hash: normalizedPayloadHash,
    reviewer_person_id: reviewerPersonId,
    reviewed_at: reviewedAt,
  }).slice(0, 24)}`;
}

/** Organization approval receipt of an organization candidate. */
export function candidateApprovalReceipt(
  request: { request_id: string; source: PromotionSourceRef; normalized_payload_hash: string },
  reviewerPersonId: string,
  reviewedAt: string,
): string {
  return `pkca_${promotionSha256({
    approval_kind: 'organization_candidate',
    request_id: request.request_id,
    source_kind: request.source.kind,
    source_id: request.source.id,
    source_version: request.source.version,
    normalized_payload_hash: request.normalized_payload_hash,
    reviewer_person_id: reviewerPersonId,
    reviewed_at: reviewedAt,
  }).slice(0, 24)}`;
}

// ---------------------------------------------------------------------------
// Request, ports, and the service
// ---------------------------------------------------------------------------

export interface PromotionSourceRef {
  kind: PromotionSourceKind;
  id: string;
  version: string;
  evidence_hash: string;
}

export interface PromotionDecisionRecord {
  action: 'owner_consent' | 'organization_review' | 'source_withdrawal';
  decision: PromotionDecision | 'withdraw';
  actor_person_id: string;
  decided_at: string;
  receipt_id: string | null;
  reason: string | null;
}

export interface KnowledgePromotionRequest {
  request_id: string;
  contract_version: typeof KNOWLEDGE_PROMOTION_CONTRACT_VERSION;
  approval_kind: PromotionApprovalKind;
  source: PromotionSourceRef;
  source_event_ids: string[];
  organization_id: string;
  project_code: string;
  owner_person_id: string | null;
  requested_by_person_id: string;
  status: PromotionStatus;
  revision: number;
  subject: { type: string; id: string };
  sanitized_preview: string | null;
  preview_hash: string | null;
  normalized_payload: NormalizedPromotionPayload;
  normalized_payload_hash: string;
  normalization_contract_version: typeof NORMALIZED_PROMOTION_SCHEMA_VERSION;
  owner_decided_by: string | null;
  owner_decided_at: string | null;
  owner_consent_receipt_id: string | null;
  organization_review_receipt_id: string | null;
  organization_event_id: string | null;
  graph_entity_id: string | null;
  decisions: PromotionDecisionRecord[];
  created_at: string;
  updated_at: string;
}

export interface KnowledgePromotionPrincipal {
  personId: string;
  /** The person who acts, when a service acts for `personId`. Defaults to `personId`. */
  actorPersonId?: string;
  organizationId: string;
  projectCodes: string[];
  role?: string;
  principalType: 'person' | 'service';
}

/** Opaque signed authority. When present, the store records its single use. */
export interface KnowledgePromotionAuthority {
  operationId: string;
  idempotencyKey: string;
  [key: string]: unknown;
}

export interface PromotionContext {
  tx: unknown;
  principal: KnowledgePromotionPrincipal;
}

export interface PersonalKnowledgeSourceRecord {
  event_id: string;
  owner_person_id: string;
  organization_id: string;
  body_hash: string;
  version: string;
  active: boolean;
}

export interface OrganizationCandidateSourceRecord {
  candidate_id: string;
  organization_id: string;
  project_code: string;
  version: string;
  active: boolean;
  evidence_hash: string;
  source_event_ids?: string[];
}

export interface OrganizationCandidateOutcome {
  candidate_id: string;
  outcome: 'promoted' | 'rejected';
  request_id: string;
  actor_person_id: string;
  receipt_id: string;
  graph_entity_id: string | null;
  organization_event_id: string | null;
  decided_at: string;
}

export interface KnowledgePromotionLineage {
  lineage_id: string;
  contract_version: typeof KNOWLEDGE_PROMOTION_CONTRACT_VERSION;
  approval_kind: PromotionApprovalKind;
  promotion_request_id: string;
  source: PromotionSourceRef;
  source_event_ids: string[];
  owner_person_id: string | null;
  organization_id: string;
  project_code: string;
  organization_event_id: string;
  graph_entity_id: string;
  normalized_payload_hash: string;
  receipts: { owner_consent_receipt_id: string | null; organization_review_receipt_id: string };
  approved_by_person_id: string;
  sanitization: { raw_copied: false; personal_body_copied: false; sanitized_preview_copied: false };
  created_at: string;
}

/** Append-only record of a share cancelled because the owner retracted the source memory. */
export interface KnowledgePromotionWithdrawal {
  withdrawal_id: string;
  contract_version: typeof KNOWLEDGE_PROMOTION_CONTRACT_VERSION;
  approval_kind: PromotionApprovalKind;
  promotion_request_id: string;
  source: PromotionSourceRef;
  owner_person_id: string | null;
  organization_id: string;
  project_code: string;
  previous_status: PromotionStatus;
  organization_event_id: string | null;
  graph_entity_id: string | null;
  graph_withdrawn: boolean;
  graph_outcome: 'not_promoted' | 'retracted' | 'projection_replaced';
  withdrawn_by_person_id: string;
  reason: string | null;
  created_at: string;
}

export interface PromotedEntityWithdrawalInput {
  request_id: string;
  graph_entity_id: string;
  organization_event_id: string | null;
  organization_id: string;
  project_code: string;
  normalized_payload_hash: string;
  withdrawal_id: string;
  withdrawn_at: string;
  reason: string | null;
}

export interface KnowledgePromotionStore {
  transaction<T>(work: (tx: unknown) => Promise<T>, options?: { principal: KnowledgePromotionPrincipal }): Promise<T>;
  /** Insert, or return the existing request with the same `request_id`. */
  createRequest(request: KnowledgePromotionRequest, ctx: PromotionContext): Promise<KnowledgePromotionRequest>;
  findRequest(requestId: string, ctx: PromotionContext): Promise<KnowledgePromotionRequest | null>;
  /** Apply `patch` and increment `revision` only when the stored revision equals `expectedRevision`; otherwise `null`. */
  updateRequest(
    requestId: string,
    patch: Partial<KnowledgePromotionRequest>,
    options: { expectedRevision: number },
    ctx: PromotionContext,
  ): Promise<KnowledgePromotionRequest | null>;
  createLineage(lineage: KnowledgePromotionLineage, ctx: PromotionContext): Promise<void>;
  claimAuthorityUse?(use: {
    operation_id: string;
    idempotency_key: string;
    request_id: string;
    action: PromotionReviewAction;
    actor_person_id: string;
    organization_id: string;
    project_code: string;
  }, ctx: PromotionContext): Promise<void>;
  /** Requests of one source visible to the caller, locked so a concurrent decision is ordered with the withdrawal. */
  listRequestsBySource?(sourceKind: PromotionSourceKind, sourceId: string, ctx: PromotionContext): Promise<KnowledgePromotionRequest[]>;
  recordWithdrawal?(withdrawal: KnowledgePromotionWithdrawal, ctx: PromotionContext): Promise<void>;
}

export interface KnowledgePromotionSources {
  readPersonalKnowledgeEvent?(eventId: string, ctx: PromotionContext): Promise<PersonalKnowledgeSourceRecord | null>;
  readOrganizationCandidate?(candidateId: string, ctx: PromotionContext): Promise<OrganizationCandidateSourceRecord | null>;
  recordOrganizationCandidateOutcome?(outcome: OrganizationCandidateOutcome, ctx: PromotionContext): Promise<void>;
}

export type PromotionReviewDecisionResult =
  | { allowed: true; decider_person_id?: string }
  | { allowed: false; code: string; status?: number; details?: Record<string, unknown> };

export interface PromotionReviewInput {
  action: PromotionReviewAction;
  approvalKind: PromotionApprovalKind;
  request: KnowledgePromotionRequest;
  normalized: NormalizedPromotionPayload;
  principal: KnowledgePromotionPrincipal;
  authority: KnowledgePromotionAuthority | null;
}

/** Organization-owned review rules (brainbase-organization). */
export interface PromotionReviewPolicy {
  authorize(input: PromotionReviewInput, ctx: PromotionContext): Promise<PromotionReviewDecisionResult>;
}

export interface KnowledgeEventRecordResult {
  event_id: string;
  candidate_id?: string | null;
  semantic_state?: string;
  quarantine_reason?: string | null;
}

export interface KnowledgePromotionEventSink {
  recordOrganizationEvent(event: OrganizationKnowledgeEvent, ctx: PromotionContext): Promise<KnowledgeEventRecordResult>;
  reconcileGraphProjection?(input: {
    candidate_id: string;
    graph_entity_id: string;
    event_id: string;
    actor_person_id: string;
    decision_owner_person_id: string;
  }, ctx: PromotionContext): Promise<void>;
}

export interface KnowledgePromotionGraphWriter {
  commitNormalizedPromotion(mutation: NormalizedGraphMutation, ctx: PromotionContext): Promise<{ id: string } | null>;
  /**
   * Mark the fact promoted by the request as retracted and out of retrieval. `projection_replaced` means
   * another write has replaced the fact since, so it was left as it is.
   */
  withdrawPromotedEntity?(
    input: PromotedEntityWithdrawalInput,
    ctx: PromotionContext,
  ): Promise<{ id: string; outcome: 'retracted' | 'projection_replaced' } | null>;
}

export interface KnowledgePromotionPorts {
  store: KnowledgePromotionStore;
  sources: KnowledgePromotionSources;
  reviewPolicy: PromotionReviewPolicy | null;
  knowledgeEvents: KnowledgePromotionEventSink;
  graph: KnowledgePromotionGraphWriter;
  now?: () => Date;
}

export interface PromotionEvidence {
  contract_version: typeof NORMALIZED_PROMOTION_SCHEMA_VERSION;
  approval_kind: PromotionApprovalKind;
  promotion_request_id: string;
  source_kind: PromotionSourceKind;
  source_version: string;
  source_evidence_hash: string;
  normalized_payload_hash: string;
  owner_consent_receipt_id: string | null;
  organization_review_receipt_id: string;
  source_pointer: { uri: string; digest: string };
}

export interface OrganizationKnowledgeEvent {
  schema_version: 'knowledge_event.v1';
  event_id: string;
  occurred_at: string;
  captured_at: string;
  source: { type: string; venue: string; contract_version: string };
  subject: { type: string; id: string };
  decision?: { statement: JsonValue };
  decision_authority: { authorized: true; decider_id: string; domain: string };
  applicability_scope: { scope: 'organization'; organization_id: string; project_code: string };
  permission_snapshot: Record<string, unknown>;
  source_pointer: { uri: string; digest: string };
  body_hash: string;
  parent_episode_id: string;
  payload: { summary: string; normalized_kind: string; promotion_evidence: PromotionEvidence };
  promotion_evidence: PromotionEvidence;
  organization_id: string;
  project_code: string;
  sensitivity: string;
  role_min: string;
  venue: string;
}

export interface NormalizedGraphMutation {
  project_code: string;
  entity: { id: string; type: string; payload: Record<string, unknown> };
  edges: Array<NormalizedPromotionEdge & { payload: Record<string, unknown> }>;
  context_entities: Array<{ id: string; type: string }>;
  role_min: string;
  sensitivity: string;
  evidence: PromotionEvidence & { organization_event_id: string; candidate_id: string | null };
}

const DECISIONS = new Set<PromotionDecision>(['approve', 'reject']);
const TERMINAL: ReadonlySet<PromotionStatus> = new Set(['owner_rejected', 'org_rejected', 'org_accepted', 'source_stale', 'source_withdrawn']);
const WITHDRAWABLE: ReadonlySet<PromotionStatus> = new Set(['pending_owner_approval', 'pending_org_review', 'org_accepted']);

function sanitizePreview(value: unknown): string {
  const text = String(value ?? '').trim().slice(0, 2000);
  if (!text || SECRET_OR_PRIVATE.test(text)) throw new KnowledgePromotionError('knowledge_promotion_requires_safe_preview');
  return text;
}

function sanitizeReason(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim().slice(0, 500);
  if (!text || SECRET_OR_PRIVATE.test(text)) throw new KnowledgePromotionError('knowledge_promotion_requires_safe_reason');
  return text;
}

function sanitizeSubject(value: unknown, fallback: { type: string; id: string }): { type: string; id: string } {
  const subject = value && typeof value === 'object' ? value as Record<string, unknown> : fallback;
  const type = String(subject.type ?? '').trim();
  const id = String(subject.id ?? '').trim();
  if (!/^[a-z][a-z0-9_-]{0,79}$/i.test(type) || !id || id.length > 200 || SECRET_OR_PRIVATE.test(id)) {
    throw new KnowledgePromotionError('knowledge_promotion_requires_safe_subject');
  }
  return { type, id };
}

function requireText(value: unknown, code: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 240) throw new KnowledgePromotionError(code);
  return value;
}

function requireHuman(principal: KnowledgePromotionPrincipal | undefined): KnowledgePromotionPrincipal {
  if (!principal?.personId || !principal.organizationId) {
    throw new KnowledgePromotionError('knowledge_promotion_identity_required', 403);
  }
  // Scheduled routines and service principals never request or approve.
  if (principal.principalType !== 'person') {
    throw new KnowledgePromotionError('knowledge_promotion_human_principal_required', 403);
  }
  return principal;
}

function actorOf(principal: KnowledgePromotionPrincipal): string {
  return principal.actorPersonId || principal.personId;
}

function rejectWithdrawn(request: KnowledgePromotionRequest): void {
  if (request.status === 'source_withdrawn') {
    throw new KnowledgePromotionError('knowledge_promotion_source_withdrawn', 409, { request_id: request.request_id });
  }
}

function requireProjectAccess(principal: KnowledgePromotionPrincipal, projectCode: string): void {
  if (!Array.isArray(principal.projectCodes) || !principal.projectCodes.includes(projectCode)) {
    throw new KnowledgePromotionError('knowledge_promotion_project_access_denied', 403);
  }
}

function requireExpectedRevision(value: unknown, request: KnowledgePromotionRequest): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new KnowledgePromotionError('knowledge_promotion_expected_revision_required', 400);
  }
  if (value !== request.revision) {
    throw new KnowledgePromotionError('knowledge_promotion_stale_revision', 409, {
      expected_revision: value as number,
      current_revision: request.revision,
    });
  }
  return value as number;
}

function sourcePointer(requestId: string, normalizedPayloadHash: string) {
  return { uri: `brainbase://knowledge-promotion-receipts/${requestId}`, digest: normalizedPayloadHash };
}

export function buildPromotionEvidence(
  request: KnowledgePromotionRequest,
  organizationReviewReceiptId: string,
): PromotionEvidence {
  return {
    contract_version: NORMALIZED_PROMOTION_SCHEMA_VERSION,
    approval_kind: request.approval_kind,
    promotion_request_id: request.request_id,
    source_kind: request.source.kind,
    source_version: request.source.version,
    source_evidence_hash: request.source.evidence_hash,
    normalized_payload_hash: request.normalized_payload_hash,
    owner_consent_receipt_id: request.owner_consent_receipt_id,
    organization_review_receipt_id: organizationReviewReceiptId,
    source_pointer: sourcePointer(request.request_id, request.normalized_payload_hash),
  };
}

/** The organization knowledge event that records the approval. The approval kind is never disguised. */
export function buildOrganizationKnowledgeEvent(
  request: KnowledgePromotionRequest,
  normalized: NormalizedPromotionPayload,
  summary: string,
  evidence: PromotionEvidence,
  approverPersonId: string,
  occurredAt: string,
): OrganizationKnowledgeEvent {
  const isDecision = normalized.kind === 'decision';
  const personal = request.approval_kind === 'personal_share';
  const decisionAuthority = isDecision
    // A personal decision is the owner's; a candidate decision is owned by the approver
    // whose decision authority the organization policy verified.
    ? { authorized: true as const, decider_id: personal ? request.owner_person_id as string : approverPersonId, domain: normalized.decision_domain as string }
    : { authorized: true as const, decider_id: approverPersonId, domain: 'organization_knowledge_review' };
  return {
    schema_version: 'knowledge_event.v1',
    event_id: `kev_prom_${promotionSha256(`${request.request_id}:${evidence.normalized_payload_hash}`).slice(0, 24)}`,
    occurred_at: occurredAt,
    captured_at: occurredAt,
    source: {
      type: personal ? 'personal_knowledge_promotion' : 'organization_candidate_promotion',
      venue: personal ? 'organization_review' : 'organization_candidate_approval',
      contract_version: NORMALIZED_PROMOTION_SCHEMA_VERSION,
    },
    subject: { type: normalized.entity.type, id: normalized.entity.id },
    ...(isDecision ? { decision: { statement: normalized.entity.payload.statement } } : {}),
    decision_authority: decisionAuthority,
    applicability_scope: { scope: 'organization', organization_id: request.organization_id, project_code: request.project_code },
    permission_snapshot: {
      visibility: 'org',
      contains_pii: false,
      sensitivity: normalized.sensitivity,
      role_min: normalized.role_min,
      approval_kind: request.approval_kind,
      ...(personal ? { owner_consented: true, owner_consent_receipt_id: evidence.owner_consent_receipt_id } : {}),
      organization_reviewed: true,
      organization_review_receipt_id: evidence.organization_review_receipt_id,
    },
    source_pointer: evidence.source_pointer,
    body_hash: evidence.normalized_payload_hash,
    parent_episode_id: `episode_${personal ? 'personal' : 'candidate'}_promotion_${promotionSha256(request.request_id).slice(0, 24)}`,
    payload: { summary, normalized_kind: normalized.kind, promotion_evidence: evidence },
    promotion_evidence: evidence,
    organization_id: request.organization_id,
    project_code: request.project_code,
    sensitivity: normalized.sensitivity,
    role_min: normalized.role_min,
    venue: personal ? 'personal_knowledge_promotion' : 'organization_candidate_promotion',
  };
}

/** Graph mutation carrying only normalized content and provenance pointers. */
export function buildNormalizedGraphMutation(
  request: KnowledgePromotionRequest,
  normalized: NormalizedPromotionPayload,
  evidence: PromotionEvidence,
  eventResult: KnowledgeEventRecordResult,
  organizationEvent: OrganizationKnowledgeEvent,
): NormalizedGraphMutation {
  const derived = { ...evidence, organization_event_id: eventResult.event_id, candidate_id: eventResult.candidate_id ?? null };
  return {
    project_code: request.project_code,
    entity: {
      id: normalized.entity.id,
      type: normalized.entity.type,
      payload: {
        ...normalized.entity.payload,
        ...(normalized.kind === 'decision' ? {
          statement: normalized.entity.payload.statement,
          applicability_scope: organizationEvent.applicability_scope,
          decision_authority: organizationEvent.decision_authority,
          occurred_at: organizationEvent.occurred_at,
          source_pointer: organizationEvent.source_pointer,
        } : {
          applicability_scope: organizationEvent.applicability_scope,
          source_pointer: organizationEvent.source_pointer,
        }),
        derived_from_event_id: eventResult.event_id,
        derived_from_candidate_id: eventResult.candidate_id ?? null,
        semantic_state: 'active',
        searchable: true,
        promotion_evidence: derived,
      },
    },
    edges: normalized.edges.map((edge) => ({
      ...edge,
      payload: {
        ...(edge.payload || {}),
        promotion_evidence: {
          approval_kind: request.approval_kind,
          organization_event_id: eventResult.event_id,
          normalized_payload_hash: evidence.normalized_payload_hash,
          owner_consent_receipt_id: evidence.owner_consent_receipt_id,
          organization_review_receipt_id: evidence.organization_review_receipt_id,
        },
      },
    })),
    context_entities: normalized.context_entities,
    role_min: normalized.role_min,
    sensitivity: normalized.sensitivity,
    evidence: derived,
  };
}

export function promotionRequestId(input: {
  approval_kind: PromotionApprovalKind;
  source: PromotionSourceRef;
  project_code: string;
  normalized_payload_hash: string;
}): string {
  return `kpr_${promotionSha256(canonicalJson({
    approval_kind: input.approval_kind,
    source_kind: input.source.kind,
    source_id: input.source.id,
    source_version: input.source.version,
    project_code: input.project_code,
    normalized_payload_hash: input.normalized_payload_hash,
  })).slice(0, 24)}`;
}

export class KnowledgePromotionService {
  readonly ports: KnowledgePromotionPorts;
  private readonly now: () => Date;

  constructor(ports: KnowledgePromotionPorts) {
    if (!ports?.store || !ports.sources || !ports.knowledgeEvents || !ports.graph) {
      throw new Error('KnowledgePromotionService requires store, sources, knowledgeEvents, and graph ports');
    }
    this.ports = ports;
    this.now = ports.now ?? (() => new Date());
  }

  /** D4: request sharing a Personal Knowledge v1 event owned by the authenticated person. */
  async requestPersonalShare(input: {
    personal_event_id: string;
    project_code: string;
    summary: string;
    subject?: { type: string; id: string };
    normalized_payload: unknown;
  }, context: { principal: KnowledgePromotionPrincipal; authority?: KnowledgePromotionAuthority | null }): Promise<KnowledgePromotionRequest> {
    const principal = requireHuman(context.principal);
    const policy = this.requirePolicy();
    const read = this.ports.sources.readPersonalKnowledgeEvent;
    if (typeof read !== 'function') throw new KnowledgePromotionError('knowledge_promotion_personal_source_unavailable', 503);
    const eventId = requireText(input?.personal_event_id, 'knowledge_promotion_source_id_required');
    const projectCode = requireText(input?.project_code, 'knowledge_promotion_project_required');
    return this.ports.store.transaction(async (tx) => {
      const ctx = { tx, principal };
      const event = await read.call(this.ports.sources, eventId, ctx);
      if (!event || event.owner_person_id !== principal.personId || event.organization_id !== principal.organizationId) {
        throw new KnowledgePromotionError('knowledge_promotion_source_not_found', 404);
      }
      requireProjectAccess(principal, projectCode);
      if (!event.active) throw new KnowledgePromotionError('knowledge_promotion_source_not_promotable', 409);
      const preview = sanitizePreview(input.summary);
      const normalizedResult = normalizePromotionPayload(input.normalized_payload);
      const source: PromotionSourceRef = {
        kind: 'personal_knowledge_v1',
        id: event.event_id,
        version: requireText(event.version, 'knowledge_promotion_source_version_required'),
        evidence_hash: requireText(event.body_hash, 'knowledge_promotion_source_evidence_required'),
      };
      const draft = this.draftRequest({
        approval_kind: 'personal_share',
        source,
        source_event_ids: [event.event_id],
        principal,
        projectCode,
        ownerPersonId: principal.personId,
        status: 'pending_owner_approval',
        subject: sanitizeSubject(input.subject, { type: normalizedResult.normalized.entity.type, id: normalizedResult.normalized.entity.id }),
        preview,
        normalizedResult,
      });
      await this.authorize(policy, 'request', draft, normalizedResult.normalized, principal, context.authority ?? null, ctx);
      await this.claimAuthority(context.authority ?? null, draft, 'request', ctx);
      return this.ports.store.createRequest(draft, ctx);
    }, { principal });
  }

  /** D12: request promoting an organization candidate waiting for the Graph promotion review. */
  async requestOrganizationCandidate(input: {
    candidate_id: string;
    project_code: string;
    normalized_payload: unknown;
  }, context: { principal: KnowledgePromotionPrincipal; authority?: KnowledgePromotionAuthority | null }): Promise<KnowledgePromotionRequest> {
    const principal = requireHuman(context.principal);
    const policy = this.requirePolicy();
    const read = this.ports.sources.readOrganizationCandidate;
    if (typeof read !== 'function') throw new KnowledgePromotionError('knowledge_promotion_candidate_source_unavailable', 503);
    if (typeof this.ports.sources.recordOrganizationCandidateOutcome !== 'function') {
      throw new KnowledgePromotionError('knowledge_promotion_candidate_outcome_unavailable', 503);
    }
    const candidateId = requireText(input?.candidate_id, 'knowledge_promotion_source_id_required');
    const projectCode = requireText(input?.project_code, 'knowledge_promotion_project_required');
    return this.ports.store.transaction(async (tx) => {
      const ctx = { tx, principal };
      const candidate = await read.call(this.ports.sources, candidateId, ctx);
      if (!candidate || candidate.organization_id !== principal.organizationId) {
        throw new KnowledgePromotionError('knowledge_promotion_source_not_found', 404);
      }
      if (candidate.project_code !== projectCode) {
        throw new KnowledgePromotionError('knowledge_promotion_source_scope_mismatch', 403);
      }
      requireProjectAccess(principal, projectCode);
      if (!candidate.active) throw new KnowledgePromotionError('knowledge_promotion_source_not_promotable', 409);
      const normalizedResult = normalizePromotionPayload(input.normalized_payload);
      const source: PromotionSourceRef = {
        kind: 'organization_candidate',
        id: candidate.candidate_id,
        version: requireText(candidate.version, 'knowledge_promotion_source_version_required'),
        evidence_hash: requireText(candidate.evidence_hash, 'knowledge_promotion_source_evidence_required'),
      };
      const draft = this.draftRequest({
        approval_kind: 'organization_candidate',
        source,
        source_event_ids: [...(candidate.source_event_ids ?? [])],
        principal,
        projectCode,
        ownerPersonId: null,
        status: 'pending_org_review',
        subject: { type: normalizedResult.normalized.entity.type, id: normalizedResult.normalized.entity.id },
        preview: null,
        normalizedResult,
      });
      await this.authorize(policy, 'request', draft, normalizedResult.normalized, principal, context.authority ?? null, ctx);
      await this.claimAuthority(context.authority ?? null, draft, 'request', ctx);
      return this.ports.store.createRequest(draft, ctx);
    }, { principal });
  }

  /** D4: the owner approves or rejects sharing the exact normalized content. */
  async decideOwnerConsent(requestId: string, input: {
    decision: PromotionDecision;
    normalized_payload_hash?: string;
    expected_revision: number;
  }, context: { principal: KnowledgePromotionPrincipal; authority?: KnowledgePromotionAuthority | null }): Promise<KnowledgePromotionRequest> {
    const principal = requireHuman(context.principal);
    const policy = this.requirePolicy();
    if (!DECISIONS.has(input?.decision)) throw new KnowledgePromotionError('knowledge_promotion_decision_invalid');
    return this.ports.store.transaction(async (tx) => {
      const ctx = { tx, principal };
      const request = await this.ports.store.findRequest(requestId, ctx);
      if (!request || request.organization_id !== principal.organizationId) {
        throw new KnowledgePromotionError('knowledge_promotion_request_not_found', 404);
      }
      if (request.approval_kind !== 'personal_share') {
        throw new KnowledgePromotionError('knowledge_promotion_owner_consent_not_applicable', 409);
      }
      if (request.owner_person_id !== principal.personId) {
        throw new KnowledgePromotionError('knowledge_promotion_request_not_found', 404);
      }
      requireProjectAccess(principal, request.project_code);
      rejectWithdrawn(request);
      const normalized = normalizePromotionPayload(request.normalized_payload).normalized;
      await this.authorize(policy, 'owner_consent', request, normalized, principal, context.authority ?? null, ctx);
      await this.claimAuthority(context.authority ?? null, request, 'owner_consent', ctx);

      if (request.status === 'pending_org_review' && input.decision === 'approve') return request;
      if (request.status === 'owner_rejected' && input.decision === 'reject') return request;
      if (request.status !== 'pending_owner_approval') {
        throw new KnowledgePromotionError('knowledge_promotion_already_decided', 409);
      }
      const expectedRevision = requireExpectedRevision(input.expected_revision, request);
      const decidedAt = this.now().toISOString();
      const actor = actorOf(principal);
      let receiptId: string | null = null;
      if (input.decision === 'approve') {
        if (input.normalized_payload_hash !== request.normalized_payload_hash) {
          throw new KnowledgePromotionError('knowledge_promotion_normalized_payload_hash_mismatch', 409);
        }
        receiptId = ownerConsentReceipt({ ...request, owner_decided_by: actor, owner_decided_at: decidedAt });
      }
      const updated = await this.ports.store.updateRequest(request.request_id, {
        status: input.decision === 'approve' ? 'pending_org_review' : 'owner_rejected',
        owner_decided_by: actor,
        owner_decided_at: decidedAt,
        owner_consent_receipt_id: receiptId,
        decisions: [...request.decisions, {
          action: 'owner_consent', decision: input.decision, actor_person_id: actor, decided_at: decidedAt, receipt_id: receiptId, reason: null,
        }],
        updated_at: decidedAt,
      }, { expectedRevision }, ctx);
      if (!updated) throw new KnowledgePromotionError('knowledge_promotion_state_conflict', 409);
      return updated;
    }, { principal });
  }

  /**
   * D4: organization review of an owner-approved personal share.
   * D12: organization approval of an organization candidate.
   * Only an approval commits the event, the Graph mutation, the lineage, and the request in one transaction.
   */
  async reviewOrganization(requestId: string, input: {
    decision: PromotionDecision;
    reason?: string;
    expected_revision: number;
  }, context: { principal: KnowledgePromotionPrincipal; authority?: KnowledgePromotionAuthority | null }): Promise<KnowledgePromotionRequest> {
    const principal = requireHuman(context.principal);
    const policy = this.requirePolicy();
    if (!DECISIONS.has(input?.decision)) throw new KnowledgePromotionError('knowledge_promotion_decision_invalid');
    const staleness = { stale: false };
    const result = await this.ports.store.transaction(async (tx) => {
      const ctx = { tx, principal };
      const request = await this.ports.store.findRequest(requestId, ctx);
      if (!request || request.organization_id !== principal.organizationId) {
        throw new KnowledgePromotionError('knowledge_promotion_request_not_found', 404);
      }
      requireProjectAccess(principal, request.project_code);
      const actor = actorOf(principal);
      if (request.approval_kind === 'personal_share' && request.owner_person_id === actor) {
        throw new KnowledgePromotionError('knowledge_promotion_distinct_reviewer_required', 403);
      }
      // The owner retracted the source memory; neither an approval nor a retried decision may pass.
      rejectWithdrawn(request);
      if (request.status === 'pending_owner_approval' || request.status === 'owner_rejected') {
        throw new KnowledgePromotionError('knowledge_promotion_owner_consent_required', 409);
      }
      const normalizedResult = normalizePromotionPayload(request.normalized_payload);
      if (normalizedResult.normalized_payload_hash !== request.normalized_payload_hash) {
        throw new KnowledgePromotionError('knowledge_promotion_normalized_payload_hash_mismatch', 409);
      }
      if (request.approval_kind === 'personal_share'
        && request.owner_consent_receipt_id !== ownerConsentReceipt(request)) {
        throw new KnowledgePromotionError('knowledge_promotion_owner_consent_receipt_mismatch', 409);
      }
      const review = await this.authorize(policy, 'organization_review', request, normalizedResult.normalized, principal, context.authority ?? null, ctx);
      await this.claimAuthority(context.authority ?? null, request, 'organization_review', ctx);
      if (request.status === 'org_accepted' && input.decision === 'approve') return request;
      if (request.status === 'org_rejected' && input.decision === 'reject') return request;
      if (TERMINAL.has(request.status)) throw new KnowledgePromotionError('knowledge_promotion_already_decided', 409);
      const expectedRevision = requireExpectedRevision(input.expected_revision, request);

      const reviewedAt = this.now().toISOString();
      const approver = review.decider_person_id ?? actor;
      const receiptId = request.approval_kind === 'personal_share'
        ? organizationReviewReceipt(request, request.normalized_payload_hash, approver, reviewedAt)
        : candidateApprovalReceipt(request, approver, reviewedAt);
      const decisionRecord: PromotionDecisionRecord = {
        action: 'organization_review', decision: input.decision, actor_person_id: approver, decided_at: reviewedAt,
        receipt_id: receiptId, reason: sanitizeReason(input.reason),
      };

      if (input.decision === 'reject') {
        const rejected = await this.ports.store.updateRequest(request.request_id, {
          status: 'org_rejected',
          organization_review_receipt_id: receiptId,
          decisions: [...request.decisions, decisionRecord],
          updated_at: reviewedAt,
        }, { expectedRevision }, ctx);
        if (!rejected) throw new KnowledgePromotionError('knowledge_promotion_state_conflict', 409);
        await this.recordCandidateOutcome(request, 'rejected', approver, receiptId, null, null, reviewedAt, ctx);
        return rejected;
      }

      if (!(await this.sourceIsCurrent(request, ctx))) {
        const stale = await this.ports.store.updateRequest(request.request_id, {
          status: 'source_stale',
          updated_at: reviewedAt,
        }, { expectedRevision }, ctx);
        if (!stale) throw new KnowledgePromotionError('knowledge_promotion_state_conflict', 409);
        staleness.stale = true;
        return stale;
      }

      const evidence = buildPromotionEvidence(request, receiptId);
      const organizationEvent = buildOrganizationKnowledgeEvent(
        request, normalizedResult.normalized, normalizedResult.summary, evidence, approver, reviewedAt,
      );
      const eventResult = await this.ports.knowledgeEvents.recordOrganizationEvent(organizationEvent, ctx);
      if (eventResult?.semantic_state === 'quarantined') {
        throw new KnowledgePromotionError('knowledge_promotion_event_quarantined', 409, { reason: eventResult.quarantine_reason ?? null });
      }
      if (!eventResult?.event_id) throw new KnowledgePromotionError('knowledge_promotion_event_readback_failed', 409);
      const mutation = buildNormalizedGraphMutation(request, normalizedResult.normalized, evidence, eventResult, organizationEvent);
      const graphResult = await this.ports.graph.commitNormalizedPromotion(mutation, ctx);
      if (!graphResult?.id) throw new KnowledgePromotionError('knowledge_promotion_graph_readback_failed', 409);
      if (eventResult.candidate_id) {
        if (typeof this.ports.knowledgeEvents.reconcileGraphProjection === 'function') {
          await this.ports.knowledgeEvents.reconcileGraphProjection({
            candidate_id: eventResult.candidate_id,
            graph_entity_id: graphResult.id,
            event_id: eventResult.event_id,
            actor_person_id: approver,
            decision_owner_person_id: organizationEvent.decision_authority.decider_id,
          }, ctx);
        }
      }
      const accepted = await this.ports.store.updateRequest(request.request_id, {
        status: 'org_accepted',
        organization_review_receipt_id: receiptId,
        organization_event_id: eventResult.event_id,
        graph_entity_id: graphResult.id,
        decisions: [...request.decisions, decisionRecord],
        updated_at: reviewedAt,
      }, { expectedRevision }, ctx);
      if (!accepted) throw new KnowledgePromotionError('knowledge_promotion_state_conflict', 409);
      await this.ports.store.createLineage({
        lineage_id: `kpl_${promotionSha256(`${request.request_id}:${eventResult.event_id}`).slice(0, 24)}`,
        contract_version: KNOWLEDGE_PROMOTION_CONTRACT_VERSION,
        approval_kind: request.approval_kind,
        promotion_request_id: request.request_id,
        source: request.source,
        source_event_ids: request.source_event_ids,
        owner_person_id: request.owner_person_id,
        organization_id: request.organization_id,
        project_code: request.project_code,
        organization_event_id: eventResult.event_id,
        graph_entity_id: graphResult.id,
        normalized_payload_hash: request.normalized_payload_hash,
        receipts: { owner_consent_receipt_id: request.owner_consent_receipt_id, organization_review_receipt_id: receiptId },
        approved_by_person_id: approver,
        sanitization: { raw_copied: false, personal_body_copied: false, sanitized_preview_copied: false },
        created_at: reviewedAt,
      }, ctx);
      await this.recordCandidateOutcome(request, 'promoted', approver, receiptId, graphResult.id, eventResult.event_id, reviewedAt, ctx);
      return accepted;
    }, { principal });
    // The stale state is committed, then reported, so a retry cannot promote an old version.
    if (staleness.stale) throw new KnowledgePromotionError('knowledge_promotion_source_stale', 409, { request_id: requestId });
    return result;
  }

  /**
   * D4: the owner retracted a Personal Knowledge v1 memory. Cancel its shares that wait for a decision and
   * withdraw an already promoted Graph fact from future retrieval. The approval lineage, the organization
   * event, and the receipts stay. Retraction is the owner's right, so the organization review policy is
   * not consulted and lost project access does not block it. Pass `tx` to commit with the retraction itself.
   */
  async withdrawPersonalShares(input: {
    personal_event_id: string;
    reason?: string | null;
  }, context: { principal: KnowledgePromotionPrincipal; tx?: unknown }): Promise<{
    personal_event_id: string;
    withdrawals: KnowledgePromotionWithdrawal[];
  }> {
    const principal = requireHuman(context.principal);
    const read = this.ports.sources.readPersonalKnowledgeEvent;
    if (typeof read !== 'function') throw new KnowledgePromotionError('knowledge_promotion_personal_source_unavailable', 503);
    const { listRequestsBySource, recordWithdrawal } = this.ports.store;
    if (typeof listRequestsBySource !== 'function' || typeof recordWithdrawal !== 'function') {
      throw new KnowledgePromotionError('knowledge_promotion_withdrawal_unavailable', 503);
    }
    const eventId = requireText(input?.personal_event_id, 'knowledge_promotion_source_id_required');
    const reason = sanitizeReason(input?.reason);
    const work = async (tx: unknown) => {
      const ctx = { tx, principal };
      const event = await read.call(this.ports.sources, eventId, ctx);
      if (!event || event.owner_person_id !== principal.personId || event.organization_id !== principal.organizationId) {
        throw new KnowledgePromotionError('knowledge_promotion_source_not_found', 404);
      }
      if (event.active) throw new KnowledgePromotionError('knowledge_promotion_source_still_active', 409);
      const requests = (await listRequestsBySource.call(this.ports.store, 'personal_knowledge_v1', eventId, ctx))
        .filter((request) => request.approval_kind === 'personal_share'
          && request.owner_person_id === principal.personId
          && request.organization_id === principal.organizationId
          && WITHDRAWABLE.has(request.status))
        .sort((left, right) => left.request_id.localeCompare(right.request_id));
      const withdrawals: KnowledgePromotionWithdrawal[] = [];
      for (const request of requests) {
        withdrawals.push(await this.withdrawRequest(request, reason, ctx));
      }
      return { personal_event_id: eventId, withdrawals };
    };
    return context.tx === undefined
      ? this.ports.store.transaction(work, { principal })
      : work(context.tx);
  }

  private async withdrawRequest(
    request: KnowledgePromotionRequest,
    reason: string | null,
    ctx: PromotionContext,
  ): Promise<KnowledgePromotionWithdrawal> {
    const withdrawnAt = this.now().toISOString();
    const actor = actorOf(ctx.principal);
    const withdrawalId = `kpw_${promotionSha256(`${request.request_id}:${request.source.version}:withdrawal`).slice(0, 24)}`;
    let graphOutcome: KnowledgePromotionWithdrawal['graph_outcome'] = 'not_promoted';
    if (request.status === 'org_accepted') {
      const withdraw = this.ports.graph.withdrawPromotedEntity;
      if (typeof withdraw !== 'function') throw new KnowledgePromotionError('knowledge_promotion_withdrawal_unavailable', 503);
      const result = await withdraw.call(this.ports.graph, {
        request_id: request.request_id,
        graph_entity_id: requireText(request.graph_entity_id, 'knowledge_promotion_graph_entity_required'),
        organization_event_id: request.organization_event_id,
        organization_id: request.organization_id,
        project_code: request.project_code,
        normalized_payload_hash: request.normalized_payload_hash,
        withdrawal_id: withdrawalId,
        withdrawn_at: withdrawnAt,
        reason,
      }, ctx);
      if (!result?.id || (result.outcome !== 'retracted' && result.outcome !== 'projection_replaced')) {
        throw new KnowledgePromotionError('knowledge_promotion_graph_withdrawal_failed', 409, { request_id: request.request_id });
      }
      graphOutcome = result.outcome;
    }
    const updated = await this.ports.store.updateRequest(request.request_id, {
      status: 'source_withdrawn',
      decisions: [...request.decisions, {
        action: 'source_withdrawal', decision: 'withdraw', actor_person_id: actor, decided_at: withdrawnAt,
        receipt_id: withdrawalId, reason,
      }],
      updated_at: withdrawnAt,
    }, { expectedRevision: request.revision }, ctx);
    if (!updated) throw new KnowledgePromotionError('knowledge_promotion_state_conflict', 409);
    const withdrawal: KnowledgePromotionWithdrawal = {
      withdrawal_id: withdrawalId,
      contract_version: KNOWLEDGE_PROMOTION_CONTRACT_VERSION,
      approval_kind: request.approval_kind,
      promotion_request_id: request.request_id,
      source: request.source,
      owner_person_id: request.owner_person_id,
      organization_id: request.organization_id,
      project_code: request.project_code,
      previous_status: request.status,
      organization_event_id: request.organization_event_id,
      graph_entity_id: request.graph_entity_id,
      graph_withdrawn: graphOutcome === 'retracted',
      graph_outcome: graphOutcome,
      withdrawn_by_person_id: actor,
      reason,
      created_at: withdrawnAt,
    };
    await (this.ports.store.recordWithdrawal as NonNullable<KnowledgePromotionStore['recordWithdrawal']>)
      .call(this.ports.store, withdrawal, ctx);
    return withdrawal;
  }

  private requirePolicy(): PromotionReviewPolicy {
    if (!this.ports.reviewPolicy || typeof this.ports.reviewPolicy.authorize !== 'function') {
      throw new KnowledgePromotionError('knowledge_promotion_review_policy_unavailable', 503);
    }
    return this.ports.reviewPolicy;
  }

  private draftRequest(input: {
    approval_kind: PromotionApprovalKind;
    source: PromotionSourceRef;
    source_event_ids: string[];
    principal: KnowledgePromotionPrincipal;
    projectCode: string;
    ownerPersonId: string | null;
    status: PromotionStatus;
    subject: { type: string; id: string };
    preview: string | null;
    normalizedResult: NormalizedPromotionResult;
  }): KnowledgePromotionRequest {
    const createdAt = this.now().toISOString();
    return {
      request_id: promotionRequestId({
        approval_kind: input.approval_kind,
        source: input.source,
        project_code: input.projectCode,
        normalized_payload_hash: input.normalizedResult.normalized_payload_hash,
      }),
      contract_version: KNOWLEDGE_PROMOTION_CONTRACT_VERSION,
      approval_kind: input.approval_kind,
      source: input.source,
      source_event_ids: input.source_event_ids,
      organization_id: input.principal.organizationId,
      project_code: input.projectCode,
      owner_person_id: input.ownerPersonId,
      requested_by_person_id: actorOf(input.principal),
      status: input.status,
      revision: 0,
      subject: input.subject,
      sanitized_preview: input.preview,
      preview_hash: input.preview === null ? null : `sha256:${promotionSha256(input.preview)}`,
      normalized_payload: input.normalizedResult.normalized,
      normalized_payload_hash: input.normalizedResult.normalized_payload_hash,
      normalization_contract_version: NORMALIZED_PROMOTION_SCHEMA_VERSION,
      owner_decided_by: null,
      owner_decided_at: null,
      owner_consent_receipt_id: null,
      organization_review_receipt_id: null,
      organization_event_id: null,
      graph_entity_id: null,
      decisions: [],
      created_at: createdAt,
      updated_at: createdAt,
    };
  }

  private async authorize(
    policy: PromotionReviewPolicy,
    action: PromotionReviewAction,
    request: KnowledgePromotionRequest,
    normalized: NormalizedPromotionPayload,
    principal: KnowledgePromotionPrincipal,
    authority: KnowledgePromotionAuthority | null,
    ctx: PromotionContext,
  ): Promise<{ decider_person_id?: string }> {
    const result = await policy.authorize({ action, approvalKind: request.approval_kind, request, normalized, principal, authority }, ctx);
    if (!result || result.allowed !== true) {
      const refusal = result as { code?: string; status?: number; details?: Record<string, unknown> } | null;
      throw new KnowledgePromotionError(refusal?.code || 'knowledge_promotion_review_denied', refusal?.status ?? 403, refusal?.details);
    }
    return result;
  }

  private async claimAuthority(
    authority: KnowledgePromotionAuthority | null,
    request: KnowledgePromotionRequest,
    action: PromotionReviewAction,
    ctx: PromotionContext,
  ): Promise<void> {
    if (!authority) return;
    if (typeof this.ports.store.claimAuthorityUse !== 'function') {
      throw new KnowledgePromotionError('knowledge_promotion_authority_ledger_unavailable', 503);
    }
    // Claim before any idempotent return: a replayed signed authority fails closed.
    await this.ports.store.claimAuthorityUse({
      operation_id: requireText(authority.operationId, 'knowledge_promotion_authority_invalid'),
      idempotency_key: requireText(authority.idempotencyKey, 'knowledge_promotion_authority_invalid'),
      request_id: request.request_id,
      action,
      actor_person_id: actorOf(ctx.principal),
      organization_id: ctx.principal.organizationId,
      project_code: request.project_code,
    }, ctx);
  }

  private async sourceIsCurrent(request: KnowledgePromotionRequest, ctx: PromotionContext): Promise<boolean> {
    if (request.source.kind === 'personal_knowledge_v1') {
      const read = this.ports.sources.readPersonalKnowledgeEvent;
      if (typeof read !== 'function') throw new KnowledgePromotionError('knowledge_promotion_personal_source_unavailable', 503);
      // The reviewer cannot read the owner's private event; the source adapter answers for the request's owner.
      const event = await read.call(this.ports.sources, request.source.id, ctx);
      return Boolean(event && event.active && event.version === request.source.version
        && event.owner_person_id === request.owner_person_id && event.organization_id === request.organization_id);
    }
    const read = this.ports.sources.readOrganizationCandidate;
    if (typeof read !== 'function') throw new KnowledgePromotionError('knowledge_promotion_candidate_source_unavailable', 503);
    const candidate = await read.call(this.ports.sources, request.source.id, ctx);
    return Boolean(candidate && candidate.active && candidate.version === request.source.version
      && candidate.organization_id === request.organization_id && candidate.project_code === request.project_code);
  }

  private async recordCandidateOutcome(
    request: KnowledgePromotionRequest,
    outcome: 'promoted' | 'rejected',
    actor: string,
    receiptId: string,
    graphEntityId: string | null,
    organizationEventId: string | null,
    decidedAt: string,
    ctx: PromotionContext,
  ): Promise<void> {
    if (request.approval_kind !== 'organization_candidate') return;
    const record = this.ports.sources.recordOrganizationCandidateOutcome;
    if (typeof record !== 'function') throw new KnowledgePromotionError('knowledge_promotion_candidate_outcome_unavailable', 503);
    await record.call(this.ports.sources, {
      candidate_id: request.source.id,
      outcome,
      request_id: request.request_id,
      actor_person_id: actor,
      receipt_id: receiptId,
      graph_entity_id: graphEntityId,
      organization_event_id: organizationEventId,
      decided_at: decidedAt,
    }, ctx);
  }
}
