import { createHash } from 'node:crypto';

import {
    decideOwnerPromotionRequest,
    listOrganizationPromotionReviews,
    reviewOrganizationPromotionRequest
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

function promotionError(message, status = 400) {
    const error = new Error(message);
    error.status = status;
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

export class PersonalKnowledgePromotionService {
    constructor({ repository, knowledgeEventService = null, now = () => new Date() }) {
        this.repository = repository;
        this.knowledgeEventService = knowledgeEventService;
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

            // M1-B deliberately cannot publish. M1-C adds the normalized Graph payload and
            // is the only path that may turn an organization approval into org_accepted.
            if (input.decision === 'approve') {
                throw promotionError('personal_knowledge_normalized_payload_required', 409);
            }

            const updated = await reviewOrganizationPromotionRequest(this.repository, requestId, {
                status: 'org_rejected',
                reason: sanitizeReason(input.reason),
                reviewed_at: this.now().toISOString()
            }, options);
            if (!updated) throw promotionError('personal_knowledge_promotion_state_conflict', 409);
            return updated;
        };
        return this.repository.transaction ? this.repository.transaction(run, { access }) : run();
    }
}