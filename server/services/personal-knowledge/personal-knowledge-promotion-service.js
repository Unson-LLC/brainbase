import { createHash } from 'node:crypto';

const SECRET_OR_PRIVATE = /(secret\s*=|password\s*=|api[_-]?key\s*=|\/Users\/|\/home\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;

function hash(value) {
    return createHash('sha256').update(String(value)).digest('hex');
}

function sanitize(value) {
    const text = String(value || '').trim().slice(0, 2000);
    if (!text || SECRET_OR_PRIVATE.test(text)) throw new Error('personal_knowledge_promotion_requires_safe_preview');
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
        throw new Error('personal_knowledge_promotion_requires_safe_subject');
    }
    return { type, id };
}

export class PersonalKnowledgePromotionService {
    constructor({ repository, knowledgeEventService, now = () => new Date() }) {
        this.repository = repository;
        this.knowledgeEventService = knowledgeEventService;
        this.now = now;
    }

    async requestPromotion(personalEventId, input, { access } = {}) {
        const run = async ({ client } = {}) => {
            const options = { access, client };
            const event = await this.repository.findById(personalEventId, options);
            if (!event || event.owner_person_id !== access?.personId || event.organization_id !== access?.organizationId) {
                throw new Error('personal_knowledge_event_not_found');
            }
            if (!access.projectCodes?.includes(input.project_code)) throw new Error('personal_knowledge_project_access_denied');
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

    async decidePromotion(requestId, input, { access } = {}) {
        const run = async ({ client } = {}) => {
            const options = { access, client };
            const request = await this.repository.findPromotionRequest(requestId, options);
            if (!request || request.owner_person_id !== access?.personId || request.organization_id !== access?.organizationId) {
                throw new Error('personal_knowledge_promotion_not_found');
            }
            if (!['approve', 'reject'].includes(input.decision)) throw new Error('personal_knowledge_promotion_decision_invalid');
            const organizationEventId = `kev_prom_${hash(request.request_id).slice(0, 24)}`;
            if (request.status === 'approved') {
                if (input.decision !== 'approve') throw new Error('personal_knowledge_promotion_already_decided');
                return request;
            }
            if (request.status === 'rejected') {
                if (input.decision !== 'reject') throw new Error('personal_knowledge_promotion_already_decided');
                return request;
            }
            if (input.decision === 'reject') {
                return this.repository.decidePromotionRequest(requestId, { status: 'rejected', decided_at: this.now().toISOString() }, options);
            }
            const event = {
                schema_version: 'knowledge_event.v1',
                event_id: organizationEventId,
                occurred_at: this.now().toISOString(), captured_at: this.now().toISOString(),
                source: { type: 'personal_knowledge_promotion', request_id: requestId },
                subject: request.subject,
                decision_authority: input.decision_authority || { authorized: false, actor_person_id: access.personId },
                applicability_scope: { scope: 'organization', organization_id: access.organizationId, project_code: request.project_code },
                permission_snapshot: { owner_approved: true, approved_by: access.personId },
                source_pointer: { uri: `brainbase://personal-knowledge/promotions/${requestId}` },
                body_hash: request.body_hash,
                body: request.sanitized_preview,
                parent_episode_id: null,
                organization_id: access.organizationId,
                project_code: request.project_code,
                sensitivity: 'internal', role_min: 'member', venue: 'personal_promotion'
            };
            await this.knowledgeEventService.ingest(event, options);
            await this.repository.decidePromotionRequest(requestId, {
                status: 'approved', organization_event_id: organizationEventId, decided_at: this.now().toISOString()
            }, options);
            await this.repository.createLineage({
                lineage_id: `kpl_${hash(`${request.personal_event_id}:${organizationEventId}`).slice(0, 24)}`,
                personal_event_id: request.personal_event_id,
                organization_event_id: organizationEventId,
                promotion_request_id: requestId,
                owner_person_id: access.personId,
                organization_id: access.organizationId,
                sanitization: { raw_copied: false, body_hash: request.body_hash },
                created_at: this.now().toISOString()
            }, options);
            return { ...request, status: 'approved', organization_event_id: organizationEventId };
        };
        return this.repository.transaction ? this.repository.transaction(run, { access }) : run();
    }
}
