import { createHash } from 'node:crypto';

export const NORMALIZED_PROMOTION_SCHEMA_VERSION = 'personal_knowledge_normalized.v1';

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

function promotionError(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function sha256(value) {
    return createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

function requirePlainObject(value, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw promotionError(code);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw promotionError(code);
    return value;
}

function safeIdentifier(value, code) {
    const result = String(value || '').trim();
    if (!SAFE_IDENTIFIER.test(result) || SECRET_OR_PRIVATE.test(result)) throw promotionError(code);
    return result;
}

function safeText(value, code, maxLength = 1000) {
    const result = String(value || '').trim();
    if (!result || result.length > maxLength || SECRET_OR_PRIVATE.test(result)) throw promotionError(code);
    return result;
}

function sanitizeStructuredValue(value, path = 'payload', depth = 0) {
    if (depth > MAX_DEPTH) throw promotionError('personal_knowledge_normalized_payload_too_deep');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw promotionError('personal_knowledge_normalized_payload_invalid_number');
        return value;
    }
    if (typeof value === 'string') return safeText(value, 'personal_knowledge_normalized_payload_contains_private_content');
    if (Array.isArray(value)) {
        if (value.length > MAX_ARRAY_ITEMS) throw promotionError('personal_knowledge_normalized_payload_too_large');
        return value.map((item, index) => sanitizeStructuredValue(item, `${path}[${index}]`, depth + 1));
    }
    const object = requirePlainObject(value, 'personal_knowledge_normalized_payload_invalid');
    const keys = Object.keys(object);
    if (keys.length > MAX_OBJECT_KEYS) throw promotionError('personal_knowledge_normalized_payload_too_large');
    const result = {};
    for (const key of keys) {
        if (!/^[a-z][a-z0-9_]{0,79}$/i.test(key)
            || FORBIDDEN_KEY.test(key)
            || SERVER_CONTROLLED_KEY.test(key)
            || ['__proto__', 'prototype', 'constructor'].includes(key)) {
            throw promotionError('personal_knowledge_normalized_payload_forbidden_field');
        }
        result[key] = sanitizeStructuredValue(object[key], `${path}.${key}`, depth + 1);
    }
    return result;
}

function normalizeEntity(value) {
    const entity = requirePlainObject(value, 'personal_knowledge_normalized_entity_required');
    const keys = Object.keys(entity);
    if (keys.some((key) => !['id', 'type', 'payload'].includes(key))) {
        throw promotionError('personal_knowledge_normalized_entity_forbidden_field');
    }
    const payload = sanitizeStructuredValue(
        requirePlainObject(entity.payload, 'personal_knowledge_normalized_entity_payload_required'),
        'entity.payload'
    );
    return {
        id: safeIdentifier(entity.id, 'personal_knowledge_normalized_entity_id_invalid'),
        type: safeIdentifier(entity.type, 'personal_knowledge_normalized_entity_type_invalid'),
        payload
    };
}

function normalizeContextEntities(value = []) {
    if (!Array.isArray(value) || value.length > 40) {
        throw promotionError('personal_knowledge_normalized_context_entities_invalid');
    }
    return value.map((item) => {
        const context = requirePlainObject(item, 'personal_knowledge_normalized_context_entity_invalid');
        if (Object.keys(context).some((key) => !['id', 'type'].includes(key))) {
            throw promotionError('personal_knowledge_normalized_context_entity_forbidden_field');
        }
        return {
            id: safeIdentifier(context.id, 'personal_knowledge_normalized_context_entity_id_invalid'),
            type: safeIdentifier(context.type, 'personal_knowledge_normalized_context_entity_type_invalid')
        };
    });
}

function normalizeEdges(value = [], entityId, contextEntities) {
    if (!Array.isArray(value) || value.length > 20) {
        throw promotionError('personal_knowledge_normalized_edges_invalid');
    }
    const endpointIds = new Set([entityId, ...contextEntities.map((item) => item.id)]);
    return value.map((item) => {
        const edge = requirePlainObject(item, 'personal_knowledge_normalized_edge_invalid');
        if (Object.keys(edge).some((key) => !['from_id', 'to_id', 'relation', 'payload'].includes(key))) {
            throw promotionError('personal_knowledge_normalized_edge_forbidden_field');
        }
        const normalized = {
            from_id: safeIdentifier(edge.from_id, 'personal_knowledge_normalized_edge_endpoint_invalid'),
            to_id: safeIdentifier(edge.to_id, 'personal_knowledge_normalized_edge_endpoint_invalid'),
            relation: safeIdentifier(edge.relation, 'personal_knowledge_normalized_edge_relation_invalid'),
            payload: edge.payload === undefined
                ? {}
                : sanitizeStructuredValue(
                    requirePlainObject(edge.payload, 'personal_knowledge_normalized_edge_payload_invalid'),
                    'edge.payload'
                )
        };
        if (!endpointIds.has(normalized.from_id) || !endpointIds.has(normalized.to_id)) {
            throw promotionError('personal_knowledge_normalized_edge_context_missing');
        }
        if (normalized.from_id !== entityId && normalized.to_id !== entityId) {
            throw promotionError('personal_knowledge_normalized_edge_must_include_primary_entity');
        }
        return normalized;
    });
}

function normalizedSummary(normalized) {
    const payload = normalized.entity.payload || {};
    const candidate = payload.statement || payload.label || payload.name || payload.title || normalized.entity.id;
    return safeText(candidate, 'personal_knowledge_normalized_summary_required', 1000);
}

export function normalizePromotionPayload(input) {
    const value = requirePlainObject(input, 'personal_knowledge_normalized_payload_required');
    const allowed = new Set([
        'schema_version', 'kind', 'entity', 'edges', 'context_entities',
        'decision_domain', 'sensitivity', 'role_min'
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
        throw promotionError('personal_knowledge_normalized_payload_forbidden_field');
    }
    if (value.schema_version !== NORMALIZED_PROMOTION_SCHEMA_VERSION) {
        throw promotionError('personal_knowledge_normalized_payload_schema_invalid');
    }
    const kind = String(value.kind || '').trim();
    if (!ALLOWED_KINDS.has(kind)) throw promotionError('personal_knowledge_normalized_payload_kind_invalid');
    const entity = normalizeEntity(value.entity);
    const contextEntities = normalizeContextEntities(value.context_entities || []);
    const edges = normalizeEdges(value.edges || [], entity.id, contextEntities);
    if (kind === 'decision' && entity.type !== 'decision') {
        throw promotionError('personal_knowledge_normalized_decision_type_required');
    }
    if (kind !== 'decision' && entity.type === 'decision') {
        throw promotionError('personal_knowledge_normalized_kind_mismatch');
    }
    if (kind === 'relation' && edges.length === 0) {
        throw promotionError('personal_knowledge_normalized_relation_edge_required');
    }
    const decisionDomain = kind === 'decision'
        ? safeIdentifier(value.decision_domain, 'personal_knowledge_normalized_decision_domain_required')
        : null;
    if (kind === 'decision') {
        safeText(entity.payload.statement, 'personal_knowledge_normalized_decision_statement_required', 1000);
    } else if (value.decision_domain !== undefined) {
        throw promotionError('personal_knowledge_normalized_decision_domain_not_allowed');
    }
    const sensitivity = String(value.sensitivity || 'internal').toLowerCase();
    if (!ALLOWED_SENSITIVITIES.has(sensitivity)) {
        throw promotionError('personal_knowledge_normalized_sensitivity_invalid');
    }
    const roleMin = String(value.role_min || 'member').toLowerCase();
    if (!ALLOWED_ROLES.has(roleMin)) throw promotionError('personal_knowledge_normalized_role_invalid');
    const normalized = {
        schema_version: NORMALIZED_PROMOTION_SCHEMA_VERSION,
        kind,
        entity,
        edges,
        context_entities: contextEntities,
        ...(decisionDomain ? { decision_domain: decisionDomain } : {}),
        sensitivity,
        role_min: roleMin
    };
    if (Buffer.byteLength(canonicalJson(normalized), 'utf8') > MAX_PAYLOAD_BYTES) {
        throw promotionError('personal_knowledge_normalized_payload_too_large');
    }
    return {
        normalized,
        normalized_payload_hash: `sha256:${sha256(normalized)}`,
        summary: normalizedSummary(normalized)
    };
}

export function ownerConsentReceipt(request) {
    if (!request?.owner_decided_by
        || !request?.owner_decided_at
        || !request?.normalized_payload_hash
        || request.status !== 'pending_org_review') {
        throw promotionError('personal_knowledge_owner_consent_receipt_unavailable', 409);
    }
    const ownerDecidedAt = request.owner_decided_at instanceof Date
        ? request.owner_decided_at.toISOString()
        : request.owner_decided_at;
    return `pkoc_${sha256({
        request_id: request.request_id,
        owner_person_id: request.owner_person_id,
        owner_decided_by: request.owner_decided_by,
        owner_decided_at: ownerDecidedAt,
        normalized_payload_hash: request.normalized_payload_hash
    }).slice(0, 24)}`;
}

export function organizationReviewReceipt(request, normalizedPayloadHash, reviewerPersonId, reviewedAt) {
    return `pkor_${sha256({
        request_id: request.request_id,
        normalized_payload_hash: normalizedPayloadHash,
        reviewer_person_id: reviewerPersonId,
        reviewed_at: reviewedAt
    }).slice(0, 24)}`;
}

export function buildPromotionEvidence(request, reviewerPersonId, reviewedAt) {
    const normalizedPayload = normalizePromotionPayload(request.normalized_payload);
    if (normalizedPayload.normalized_payload_hash !== request.normalized_payload_hash) {
        throw promotionError('personal_knowledge_normalized_payload_hash_mismatch', 409);
    }
    const expectedOwnerReceipt = ownerConsentReceipt(request);
    if (request.owner_consent_receipt_id !== expectedOwnerReceipt) {
        throw promotionError('personal_knowledge_owner_consent_receipt_mismatch', 409);
    }
    const ownerReceipt = expectedOwnerReceipt;
    const organizationReceipt = organizationReviewReceipt(
        request,
        request.normalized_payload_hash,
        reviewerPersonId,
        reviewedAt
    );
    return {
        normalized: normalizedPayload.normalized,
        summary: normalizedPayload.summary,
        evidence: {
            contract_version: NORMALIZED_PROMOTION_SCHEMA_VERSION,
            promotion_request_id: request.request_id,
            source_evidence_hash: request.body_hash,
            normalized_payload_hash: request.normalized_payload_hash,
            owner_consent_receipt_id: ownerReceipt,
            organization_review_receipt_id: organizationReceipt,
            source_pointer: {
                uri: `brainbase://knowledge-promotion-receipts/${request.request_id}`,
                digest: request.normalized_payload_hash
            }
        }
    };
}

export function buildOrganizationKnowledgeEvent(request, normalized, summary, evidence, access, occurredAt) {
    const eventId = `kev_prom_${sha256(`${request.request_id}:${evidence.normalized_payload_hash}`).slice(0, 24)}`;
    const reviewerPersonId = access.actorPersonId || access.personId;
    const isDecision = normalized.kind === 'decision';
    return {
        schema_version: 'knowledge_event.v1',
        event_id: eventId,
        occurred_at: occurredAt,
        captured_at: occurredAt,
        source: {
            type: 'personal_knowledge_promotion',
            venue: 'organization_review',
            contract_version: NORMALIZED_PROMOTION_SCHEMA_VERSION
        },
        subject: { type: normalized.entity.type, id: normalized.entity.id },
        ...(isDecision ? { decision: { statement: normalized.entity.payload.statement } } : {}),
        decision_authority: isDecision
            ? {
                authorized: true,
                decider_id: request.owner_person_id,
                domain: normalized.decision_domain
            }
            : {
                authorized: true,
                decider_id: reviewerPersonId,
                domain: 'organization_knowledge_review'
            },
        applicability_scope: {
            scope: 'organization',
            organization_id: request.organization_id,
            project_code: request.project_code
        },
        permission_snapshot: {
            visibility: 'organization',
            contains_pii: false,
            sensitivity: normalized.sensitivity,
            role_min: normalized.role_min,
            owner_consented: true,
            owner_consent_receipt_id: evidence.owner_consent_receipt_id,
            organization_reviewed: true,
            organization_review_receipt_id: evidence.organization_review_receipt_id
        },
        source_pointer: evidence.source_pointer,
        body_hash: evidence.normalized_payload_hash,
        parent_episode_id: `episode_personal_promotion_${sha256(request.request_id).slice(0, 24)}`,
        payload: {
            summary,
            normalized_kind: normalized.kind,
            promotion_evidence: evidence
        },
        promotion_evidence: evidence,
        organization_id: request.organization_id,
        project_code: request.project_code,
        sensitivity: normalized.sensitivity,
        role_min: normalized.role_min,
        venue: 'personal_knowledge_promotion'
    };
}

export function buildNormalizedGraphMutation(normalized, evidence, knowledgeEventResult, organizationEvent) {
    const derived = {
        ...evidence,
        organization_event_id: knowledgeEventResult.event_id,
        candidate_id: knowledgeEventResult.candidate_id || null
    };
    return {
        project_code: null,
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
                    source_pointer: organizationEvent.source_pointer
                } : {
                    applicability_scope: organizationEvent.applicability_scope,
                    source_pointer: organizationEvent.source_pointer
                }),
                derived_from_event_id: knowledgeEventResult.event_id,
                derived_from_candidate_id: knowledgeEventResult.candidate_id || null,
                semantic_state: 'active',
                searchable: true,
                promotion_evidence: derived
            }
        },
        edges: normalized.edges.map((edge) => ({
            ...edge,
            payload: {
                ...(edge.payload || {}),
                promotion_evidence: {
                    organization_event_id: knowledgeEventResult.event_id,
                    normalized_payload_hash: evidence.normalized_payload_hash,
                    owner_consent_receipt_id: evidence.owner_consent_receipt_id,
                    organization_review_receipt_id: evidence.organization_review_receipt_id
                }
            }
        })),
        context_entities: normalized.context_entities,
        role_min: normalized.role_min,
        sensitivity: normalized.sensitivity,
        evidence: derived
    };
}
