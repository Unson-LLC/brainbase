import { createHash } from 'node:crypto';

import {
    buildNormalizedGraphMutation,
    buildOrganizationKnowledgeEvent,
    buildPromotionEvidence,
    NORMALIZED_PROMOTION_SCHEMA_VERSION,
    normalizePromotionPayload,
    ownerConsentReceipt,
    sha256
} from './personal-knowledge-normalization.js';
import {
    decideOwnerPromotionRequest,
    listOrganizationPromotionReviews,
    reviewOrganizationPromotionRequest,
    saveNormalizedPromotionPayload
} from './two-stage-promotion-repository.js';

const SECRET_OR_PRIVATE = /(secret\s*=|password\s*=|api[_-]?key\s*=|\/Users\/|\/home\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;
const OWNER_DECISIONS = new Set(['approve', 'reject']);
const ORGANIZATION_DECISIONS = new Set(['approve', 'reject']);

function hash(value) {
    return createHash('sha256').update(String(value)).digest('hex');
}

function sanitize(value) {
    const text = String(value || '').trim().slice(0, 2000);
    if (!text || SECRET_OR_PRIVATE.test(text)) throw promotionError('personal_knowledge_promotion_requires_safe_preview');
    return text;
}

function sanitizeReason(value) {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value).trim().slice(0, 500);
    if (!text || SECRET_OR_PRIVATE.test(text)) throw promotionError('personal_knowledge_promotion_requires_safe_reason');
    return text;
}

function sanitizeSubject(value, fallbackId) {
    const subject = value && typeof value === 'object' ? value : { type: 'note', id: fallbackId };
    const type = String(subject.type || '').trim();
    const id = String(subject.id || '').trim();
    if (!/^[a-z][a-z0-9_-]{0,79}$/i.test(type)
        || !id
        || id.length > 200
        || SECRET_OR_PRIVATE.test(id)) {
        throw promotionError('personal_knowledge_promotion_requires_safe_subject');
    }
    return { type, id };
}

function promotionError(message, status = 400, details = undefined) {
    const error = new Error(message);
    error.status = status;
    if (details !== undefined) error.details = details;
    return error;
}

function requireAccess(access) {
    if (!access?.personId || !access?.organizationId) {
        throw promotionError('personal_knowledge_identity_required', 403);
    }
}

function roleRank(role) {
    return { member: 1, gm: 2, ceo: 3 }[String(role || '').toLowerCase()] || 0;
}

function requireProject(access, projectCode) {
    const projectCodes = Array.isArray(access?.projectCodes) ? access.projectCodes : [];
    if (!projectCode || !projectCodes.includes(projectCode)) {
        throw promotionError('personal_knowledge_project_access_denied', 403);
    }
}

function requireOwner(request, access) {
    if (!request
        || request.owner_person_id !== access?.personId
        || request.organization_id !== access?.organizationId) {
        throw promotionError('personal_knowledge_promotion_not_found', 404);
    }
}

function requireOrganizationReviewer(request, access) {
    if (!request || request.organization_id !== access?.organizationId) {
        throw promotionError('personal_knowledge_promotion_not_found', 404);
    }
    requireProject(access, request.project_code);
    if (roleRank(access.role) < roleRank('gm')) {
        throw promotionError('personal_knowledge_organization_reviewer_required', 403);
    }
    if (request.owner_person_id === access.personId) {
        throw promotionError('personal_knowledge_distinct_organization_reviewer_required', 403);
    }
}

async function ingestWithinTransaction(service, event, { client, access }) {
    if (!service) throw promotionError('personal_knowledge_knowledge_event_service_unavailable', 503);
    if (typeof service.ingestInTransaction === 'function') {
        return service.ingestInTransaction(event, { client, access });
    }
    // KnowledgeEventService already exposes its repository and transaction-aware _ingest
    // primitive. Keep the whole promotion in one database transaction until the public
    // ingestInTransaction API is promoted to the base service.
    if (client && service.eventRepository && typeof service._ingest === 'function') {
        await service.eventRepository.ensureSchema?.();
        return service._ingest(event, {
            eventRepository: service.eventRepository,
            client,
            access
        });
    }
    return service.ingest(event, { access, client });
}

export class PersonalKnowledgePromotionService {
    constructor({
        repository,
        knowledgeEventService = null,
        knowledgeGraphRepository = knowledgeEventService?.graphRepository || null,
        now = () => new Date()
    }) {
        this.repository = repository;
        this.knowledgeEventService = knowledgeEventService;
        this.knowledgeGraphRepository = knowledgeGraphRepository;
        this.now = now;
    }

    async requestPromotion(personalEventId, input, { access } = {}) {
        requireAccess(access);
        const run = async ({ client } = {}) => {
            const options = { access, client };
            const event = await this.repository.findById(personalEventId, options);
            if (!event || event.owner_person_id !== access.personId || event.organization_id !== access.organizationId) {
                throw promotionError('personal_knowledge_event_not_found', 404);
            }
            requireProject(access, input.project_code);
            const preview = sanitize(input.summary);
            const request = {
                request_id: `kpr_${hash(`${personalEventId}:${input.project_code}:${preview}`).slice(0, 24)}`,
                personal_event_id: personalEventId,
                owner_person_id: access.personId,
                organization_id: access.organizationId,
                project_code: input.project_code,
                status: 'pending_owner_approval',
                sanitized_preview: preview,
                subject: sanitizeSubject(input.subject, personalEventId),
                body_hash: `sha256:${hash(preview)}`,
                created_at: this.now().toISOString()
            };
            return this.repository.createPromotionRequest(request, options);
        };
        return this.repository.transaction ? this.repository.transaction(run, { access }) : run();
    }

    async decideOwnerPromotion(requestId, input, { access } = {}) {
        requireAccess(access);
        if (!OWNER_DECISIONS.has(input?.decision)) {
            throw promotionError('personal_knowledge_promotion_decision_invalid');
        }
        const run = async ({ client } = {}) => {
            const options = { access, client };
            const request = await this.repository.findPromotionRequest(requestId, options);
            requireOwner(request, access);

            if (request.status === 'pending_org_review' && input.decision === 'approve') return request;
            if (request.status === 'owner_rejected' && input.decision === 'reject') return request;
            if (request.status !== 'pending_owner_approval') {
                throw promotionError('personal_knowledge_promotion_already_decided', 409);
            }

            const decidedAt = this.now().toISOString();
            const status = input.decision === 'approve' ? 'pending_org_review' : 'owner_rejected';
            const updated = await decideOwnerPromotionRequest(this.repository, requestId, {
                status,
                decided_at: decidedAt
            }, options);
            if (!updated) throw promotionError('personal_knowledge_promotion_state_conflict', 409);
            return updated;
        };
        return this.repository.transaction ? this.repository.transaction(run, { access }) : run();
    }

    // Backward-compatible route name. Semantics are now owner consent only.
    async decidePromotion(requestId, input, context = {}) {
        return this.decideOwnerPromotion(requestId, input, context);
    }

    async listOrganizationReviews(input = {}, { access } = {}) {
        requireAccess(access);
        if (roleRank(access.role) < roleRank('gm')) {
            throw promotionError('personal_knowledge_organization_reviewer_required', 403);
        }
        if (!Array.isArray(access.projectCodes) || access.projectCodes.length === 0) {
            throw promotionError('personal_knowledge_project_access_denied', 403);
        }
        const run = async ({ client } = {}) => listOrganizationPromotionReviews(
            this.repository,
            { limit: input.limit },
            { access, client }
        );
        return this.repository.transaction ? this.repository.transaction(run, { access }) : run();
    }

    async saveNormalizedPromotion(requestId, input, { access } = {}) {
        requireAccess(access);
        const run = async ({ client } = {}) => {
            const options = { access, client };
            const request = await this.repository.findPromotionRequest(requestId, options);
            requireOrganizationReviewer(request, access);
            if (request.status !== 'pending_org_review') {
                throw promotionError('personal_knowledge_promotion_already_decided', 409);
            }
            const normalizedResult = normalizePromotionPayload(input?.normalized_payload || input);
            const consentReceiptId = request.owner_consent_receipt_id || ownerConsentReceipt(request);
            if (request.normalized_payload_hash === normalizedResult.normalized_payload_hash
                && request.owner_consent_receipt_id === consentReceiptId) {
                return { ...request, idempotent: true };
            }
            const updated = await saveNormalizedPromotionPayload(this.repository, requestId, {
                normalized_payload: normalizedResult.normalized,
                normalized_payload_hash: normalizedResult.normalized_payload_hash,
                normalized_at: this.now().toISOString(),
                owner_consent_receipt_id: consentReceiptId,
                contract_version: NORMALIZED_PROMOTION_SCHEMA_VERSION
            }, options);
            if (!updated) throw promotionError('personal_knowledge_promotion_state_conflict', 409);
            return updated;
        };
        return this.repository.transaction ? this.repository.transaction(run, { access }) : run();
    }

    async reviewOrganizationPromotion(requestId, input, { access } = {}) {
        requireAccess(access);
        if (!ORGANIZATION_DECISIONS.has(input?.decision)) {
            throw promotionError('personal_knowledge_organization_decision_invalid');
        }
        const run = async ({ client } = {}) => {
            const options = { access, client };
            const request = await this.repository.findPromotionRequest(requestId, options);
            requireOrganizationReviewer(request, access);

            if (request.status === 'org_rejected' && input.decision === 'reject') return request;
            if (request.status === 'org_accepted' && input.decision === 'approve') return request;
            if (request.status !== 'pending_org_review') {
                throw promotionError('personal_knowledge_promotion_already_decided', 409);
            }

            const reviewedAt = this.now().toISOString();
            if (input.decision === 'reject') {
                const rejected = await reviewOrganizationPromotionRequest(this.repository, requestId, {
                    status: 'org_rejected',
                    reason: sanitizeReason(input.reason),
                    reviewed_at: reviewedAt
                }, options);
                if (!rejected) throw promotionError('personal_knowledge_promotion_state_conflict', 409);
                return rejected;
            }

            if (!request.normalized_payload
                || !request.normalized_payload_hash
                || !request.owner_consent_receipt_id) {
                throw promotionError('personal_knowledge_normalized_payload_required', 409);
            }
            if (!this.knowledgeGraphRepository?.commitNormalizedPromotion) {
                throw promotionError('personal_knowledge_graph_repository_unavailable', 503);
            }

            const reviewerPersonId = access.actorPersonId || access.personId;
            const { normalized, summary, evidence } = buildPromotionEvidence(
                request,
                reviewerPersonId,
                reviewedAt
            );
            const organizationEvent = buildOrganizationKnowledgeEvent(
                request,
                normalized,
                summary,
                evidence,
                access,
                reviewedAt
            );
            const eventResult = await ingestWithinTransaction(
                this.knowledgeEventService,
                organizationEvent,
                { client, access }
            );
            if (eventResult?.semantic_state === 'quarantined') {
                throw promotionError(
                    'personal_knowledge_graph_promotion_quarantined',
                    409,
                    { reason: eventResult.quarantine_reason }
                );
            }
            const mutation = buildNormalizedGraphMutation(
                normalized,
                evidence,
                eventResult,
                organizationEvent
            );
            mutation.project_code = request.project_code;
            const graphResult = await this.knowledgeGraphRepository.commitNormalizedPromotion(
                mutation,
                { client, access }
            );
            if (!graphResult?.id) {
                throw promotionError('personal_knowledge_graph_readback_failed', 409);
            }

            const accepted = await reviewOrganizationPromotionRequest(this.repository, requestId, {
                status: 'org_accepted',
                reason: sanitizeReason(input.reason),
                reviewed_at: reviewedAt,
                organization_event_id: organizationEvent.event_id,
                graph_entity_id: graphResult.id,
                organization_review_receipt_id: evidence.organization_review_receipt_id
            }, options);
            if (!accepted) throw promotionError('personal_knowledge_promotion_state_conflict', 409);

            const lineage = {
                lineage_id: `kpl_${sha256(`${request.request_id}:${organizationEvent.event_id}`).slice(0, 24)}`,
                personal_event_id: request.personal_event_id,
                organization_event_id: organizationEvent.event_id,
                promotion_request_id: request.request_id,
                owner_person_id: request.owner_person_id,
                organization_id: request.organization_id,
                sanitization: {
                    contract_version: NORMALIZED_PROMOTION_SCHEMA_VERSION,
                    raw_copied: false,
                    personal_body_copied: false,
                    sanitized_preview_copied: false,
                    source_evidence_hash: request.body_hash,
                    normalized_payload_hash: request.normalized_payload_hash,
                    owner_consent_receipt_id: evidence.owner_consent_receipt_id,
                    organization_review_receipt_id: evidence.organization_review_receipt_id,
                    graph_entity_id: graphResult.id
                },
                created_at: reviewedAt
            };
            await this.repository.createLineage(lineage, options);
            return {
                ...accepted,
                graph_entity_id: graphResult.id,
                organization_event_id: organizationEvent.event_id,
                owner_consent_receipt_id: evidence.owner_consent_receipt_id,
                organization_review_receipt_id: evidence.organization_review_receipt_id
            };
        };
        return this.repository.transaction ? this.repository.transaction(run, { access }) : run();
    }
}
