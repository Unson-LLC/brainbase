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
    reviewOrganizationPromotionRequest
} from './two-stage-promotion-repository.js';
import {
    actionForRuntimeCapability,
    resourceRefForPersonalEvent,
    resourceRefForPromotionRequest
} from './promotion-authority-contract.js';

const SECRET_OR_PRIVATE = /(secret\s*=|password\s*=|api[_-]?key\s*=|\/Users\/|\/home\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i;
const OWNER_DECISIONS = new Set(['approve', 'reject']);
const ORGANIZATION_DECISIONS = new Set(['approve', 'reject']);
const DECISION_REVISION_PATTERN = /^(0|[1-9]\d*)$/;

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

function requireExpectedDecisionRevision(input, request, {
    inputField,
    requestField,
    action
}) {
    const rawExpected = input?.[inputField];
    if (rawExpected === undefined || rawExpected === null || rawExpected === '') {
        throw promotionError('personal_knowledge_promotion_expected_revision_required', 400, {
            action,
            field: inputField
        });
    }
    const expected = String(rawExpected);
    if (!DECISION_REVISION_PATTERN.test(expected)) {
        throw promotionError('personal_knowledge_promotion_expected_revision_invalid', 400, {
            action,
            field: inputField,
            expected_revision: expected
        });
    }
    const current = String(request?.[requestField]);
    if (expected !== current) {
        throw promotionError('personal_knowledge_promotion_stale_revision', 409, {
            action,
            field: inputField,
            expected_revision: expected,
            current_revision: current
        });
    }
    return expected;
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

function requirePromotionAuthority(authority, access, projectCode, capabilityId) {
    if (!authority) {
        throw promotionError('personal_knowledge_promotion_authority_required', 403);
    }
    if (authority.capabilityId !== capabilityId
        || authority.actorPersonId !== (access.actorPersonId || access.personId)
        || authority.organizationIds?.length !== 1
        || authority.organizationIds[0] !== access.organizationId
        || authority.projectIds?.length !== 1
        || authority.projectIds[0] !== projectCode
        || !authority.operationId
        || !authority.idempotencyKey) {
        throw promotionError('personal_knowledge_promotion_authority_scope_mismatch', 403);
    }
}

function authorityField(authority, camel, wire) {
    return authority?.[camel] ?? authority?.[wire];
}

function requirePromotionAuthorityTarget(authority, {
    capabilityId,
    personalEventId = null,
    requestId = null,
    normalizedPayloadHash = null,
    inputNormalizedPayloadHash = undefined
} = {}) {
    const mapping = actionForRuntimeCapability(capabilityId);
    const action = authorityField(authority, 'action', 'action');
    const resourceRef = authorityField(authority, 'resourceRef', 'resource_ref');
    const authorityRequestId = authorityField(authority, 'requestId', 'request_id');
    const authorityHash = authorityField(authority, 'normalizedPayloadHash', 'normalized_payload_hash');
    if (!mapping || action !== mapping.action) {
        throw promotionError('personal_knowledge_promotion_authority_scope_mismatch', 403);
    }
    const expectedResourceRef = action === 'request'
        ? resourceRefForPersonalEvent(personalEventId)
        : resourceRefForPromotionRequest(requestId);
    if (resourceRef !== expectedResourceRef) {
        throw promotionError('personal_knowledge_promotion_authority_scope_mismatch', 403);
    }
    if (action === 'request') {
        if (authorityRequestId !== null || authorityHash !== null) {
            throw promotionError('personal_knowledge_promotion_authority_scope_mismatch', 403);
        }
        return;
    }
    if (authorityRequestId !== requestId
        || (normalizedPayloadHash && authorityHash !== normalizedPayloadHash)
        || (inputNormalizedPayloadHash !== undefined && inputNormalizedPayloadHash !== authorityHash)) {
        throw promotionError('personal_knowledge_promotion_authority_scope_mismatch', 403);
    }
}

async function claimPromotionAuthorityUse(repository, authority, requestId, action, options) {
    if (!authority) {
        throw promotionError('personal_knowledge_promotion_authority_required', 403);
    }
    if (typeof repository.claimPromotionAuthorityUse === 'function') {
        await repository.claimPromotionAuthorityUse({
            operation_id: authority.operationId,
            idempotency_key: authority.idempotencyKey,
            request_id: requestId,
            action,
            actor_person_id: authority.actorPersonId,
            organization_id: options.access.organizationId,
            project_code: authority.projectIds[0]
        }, options);
        return;
    }
    const client = options.client;
    if (!client?.query) throw promotionError('personal_knowledge_transaction_required', 500);
    try {
        await client.query(
            `INSERT INTO knowledge_promotion_authority_uses
             (operation_id, idempotency_key, request_id, action, actor_person_id,
              organization_id, project_code)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [authority.operationId, authority.idempotencyKey, requestId, action,
                authority.actorPersonId, options.access.organizationId, authority.projectIds[0]]
        );
    } catch (error) {
        if (error?.code === '23505') {
            throw promotionError('personal_knowledge_promotion_authority_replayed', 409);
        }
        throw error;
    }
}

async function ingestWithinTransaction(service, event, { client, access }) {
    if (!service) throw promotionError('personal_knowledge_knowledge_event_service_unavailable', 503);
    if (typeof service.ingestInTransaction === 'function') {
        return service.ingestInTransaction(event, {
            client,
            access,
            // The organization event is the audit/provenance record. The
            // normalized Graph mutation below is the sole Graph projection.
            skipGraphProjection: true
        });
    }
    // Keep compatibility with transaction-aware service doubles while refusing
    // an unconstrained ingest fallback that could project Graph a second time.
    if (client && service.eventRepository && typeof service._ingest === 'function') {
        await service.eventRepository.ensureSchema?.();
        return service._ingest(event, {
            eventRepository: service.eventRepository,
            client,
            access,
            skipGraphProjection: true
        });
    }
    throw promotionError('personal_knowledge_transaction_required', 500);
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

    async requestPromotion(personalEventId, input, { access, promotionAuthority } = {}) {
        requireAccess(access);
        const run = async ({ client } = {}) => {
            const options = { access, client };
            const event = await this.repository.findById(personalEventId, options);
            if (!event || event.owner_person_id !== access.personId || event.organization_id !== access.organizationId) {
                throw promotionError('personal_knowledge_event_not_found', 404);
            }
            requireProject(access, input.project_code);
            requirePromotionAuthority(
                promotionAuthority,
                access,
                input.project_code,
                'personal_knowledge_promotion:request'
            );
            requirePromotionAuthorityTarget(promotionAuthority, {
                capabilityId: 'personal_knowledge_promotion:request',
                personalEventId
            });
            const preview = sanitize(input.summary);
            const normalizedResult = normalizePromotionPayload(input.normalized_payload);
            const createdAt = this.now().toISOString();
            const request = {
                request_id: `kpr_${hash(`${personalEventId}:${input.project_code}:${normalizedResult.normalized_payload_hash}`).slice(0, 24)}`,
                personal_event_id: personalEventId,
                owner_person_id: access.personId,
                organization_id: access.organizationId,
                project_code: input.project_code,
                status: 'pending_owner_approval',
                sanitized_preview: preview,
                subject: sanitizeSubject(input.subject, personalEventId),
                body_hash: `sha256:${hash(preview)}`,
                normalized_payload: normalizedResult.normalized,
                normalized_payload_hash: normalizedResult.normalized_payload_hash,
                normalized_by_person_id: access.actorPersonId || access.personId,
                normalized_at: createdAt,
                owner_consent_receipt_id: null,
                normalization_contract_version: NORMALIZED_PROMOTION_SCHEMA_VERSION,
                created_at: createdAt
            };
            const created = await this.repository.createPromotionRequest(request, options);
            await claimPromotionAuthorityUse(
                this.repository,
                promotionAuthority,
                request.request_id,
                'request',
                options
            );
            return created;
        };
        return this.repository.transaction ? this.repository.transaction(run, { access }) : run();
    }

    async decideOwnerPromotion(requestId, input, { access, promotionAuthority } = {}) {
        requireAccess(access);
        if (!OWNER_DECISIONS.has(input?.decision)) {
            throw promotionError('personal_knowledge_promotion_decision_invalid');
        }
        const run = async ({ client } = {}) => {
            const options = { access, client };
            const request = await this.repository.findPromotionRequest(requestId, options);
            requireOwner(request, access);
            requirePromotionAuthority(
                promotionAuthority,
                access,
                request.project_code,
                'personal_knowledge_promotion:owner_consent'
            );
            requirePromotionAuthorityTarget(promotionAuthority, {
                capabilityId: 'personal_knowledge_promotion:owner_consent',
                requestId,
                normalizedPayloadHash: request.normalized_payload_hash
            });

            requirePromotionAuthorityTarget(promotionAuthority, {
                capabilityId: 'personal_knowledge_promotion:owner_consent',
                requestId,
                normalizedPayloadHash: request.normalized_payload_hash,
                inputNormalizedPayloadHash: input.normalized_payload_hash
            });
            const expectedOwnerDecisionRevision = requireExpectedDecisionRevision(input, request, {
                inputField: 'expected_owner_decision_revision',
                requestField: 'owner_decision_revision',
                action: 'owner_consent'
            });
            await claimPromotionAuthorityUse(
                this.repository,
                promotionAuthority,
                requestId,
                'owner_consent',
                options
            );

            // Claim the exact signed authority before returning an idempotent state.
            // A replay of the same operation must fail closed with no second effect.
            if (request.status === 'pending_org_review' && input.decision === 'approve') return request;
            if (request.status === 'owner_rejected' && input.decision === 'reject') return request;
            if (request.status !== 'pending_owner_approval') {
                throw promotionError('personal_knowledge_promotion_already_decided', 409);
            }

            const decidedAt = this.now().toISOString();
            const status = input.decision === 'approve' ? 'pending_org_review' : 'owner_rejected';
            let consentReceiptId = null;
            if (input.decision === 'approve') {
                if (!request.normalized_payload || !request.normalized_payload_hash) {
                    throw promotionError('personal_knowledge_normalized_payload_required', 409);
                }
                if (input.normalized_payload_hash !== request.normalized_payload_hash) {
                    throw promotionError('personal_knowledge_normalized_payload_hash_mismatch', 409);
                }
                consentReceiptId = ownerConsentReceipt({
                    ...request,
                    status,
                    owner_decided_by: access.actorPersonId || access.personId,
                    owner_decided_at: decidedAt
                });
            }
            const updated = await decideOwnerPromotionRequest(this.repository, requestId, {
                status,
                decided_at: decidedAt,
                owner_consent_receipt_id: consentReceiptId,
                expected_owner_decision_revision: expectedOwnerDecisionRevision
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

    async saveNormalizedPromotion(requestId, input, { access, promotionAuthority } = {}) {
        requireAccess(access);
        const run = async ({ client } = {}) => {
            const options = { access, client };
            const request = await this.repository.findPromotionRequest(requestId, options);
            requireOwner(request, access);
            requirePromotionAuthority(
                promotionAuthority,
                access,
                request?.project_code,
                'personal_knowledge_promotion:owner_consent'
            );
            const normalizedResult = normalizePromotionPayload(input?.normalized_payload || input);
            requirePromotionAuthorityTarget(promotionAuthority, {
                capabilityId: 'personal_knowledge_promotion:owner_consent',
                requestId,
                normalizedPayloadHash: request.normalized_payload_hash
            });
            if (request.status !== 'pending_owner_approval') {
                throw promotionError('personal_knowledge_promotion_already_decided', 409);
            }
            requirePromotionAuthorityTarget(promotionAuthority, {
                capabilityId: 'personal_knowledge_promotion:owner_consent',
                requestId,
                normalizedPayloadHash: request.normalized_payload_hash,
                inputNormalizedPayloadHash: normalizedResult.normalized_payload_hash
            });
            await claimPromotionAuthorityUse(
                this.repository,
                promotionAuthority,
                requestId,
                'owner_consent',
                options
            );
            if (request.normalized_payload_hash === normalizedResult.normalized_payload_hash) {
                return { ...request, idempotent: true };
            }
            throw promotionError('personal_knowledge_normalized_payload_immutable', 409);
        };
        return this.repository.transaction ? this.repository.transaction(run, { access }) : run();
    }

    async reviewOrganizationPromotion(requestId, input, { access, promotionAuthority } = {}) {
        requireAccess(access);
        if (!ORGANIZATION_DECISIONS.has(input?.decision)) {
            throw promotionError('personal_knowledge_organization_decision_invalid');
        }
        const run = async ({ client } = {}) => {
            const options = { access, client };
            const request = await this.repository.findPromotionRequest(requestId, options);
            requireOrganizationReviewer(request, access);
            requirePromotionAuthority(
                promotionAuthority,
                access,
                request.project_code,
                'personal_knowledge_promotion:organization_review'
            );
            requirePromotionAuthorityTarget(promotionAuthority, {
                capabilityId: 'personal_knowledge_promotion:organization_review',
                requestId,
                normalizedPayloadHash: request.normalized_payload_hash
            });
            const expectedOrganizationReviewRevision = requireExpectedDecisionRevision(input, request, {
                inputField: 'expected_organization_review_revision',
                requestField: 'organization_review_revision',
                action: 'organization_review'
            });
            await claimPromotionAuthorityUse(
                this.repository,
                promotionAuthority,
                requestId,
                'organization_review',
                options
            );

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
                    reviewed_at: reviewedAt,
                    expected_organization_review_revision: expectedOrganizationReviewRevision
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
            if (!eventResult?.candidate_id) {
                throw promotionError('personal_knowledge_candidate_readback_failed', 409);
            }
            if (typeof this.knowledgeEventService?.reconcileGraphProjection !== 'function') {
                throw promotionError('personal_knowledge_candidate_reconciliation_unavailable', 503);
            }
            await this.knowledgeEventService.reconcileGraphProjection(
                eventResult.candidate_id,
                graphResult.id,
                {
                    client,
                    eventId: organizationEvent.event_id,
                    actorPersonId: reviewerPersonId,
                    decisionOwnerPersonId: organizationEvent.decision_authority.decider_id,
                    access
                }
            );

            const accepted = await reviewOrganizationPromotionRequest(this.repository, requestId, {
                status: 'org_accepted',
                reason: sanitizeReason(input.reason),
                reviewed_at: reviewedAt,
                organization_event_id: organizationEvent.event_id,
                graph_entity_id: graphResult.id,
                organization_review_receipt_id: evidence.organization_review_receipt_id,
                expected_organization_review_revision: expectedOrganizationReviewRevision
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
