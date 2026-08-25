import express from 'express';

function context(req) {
    const access = req.personalKnowledgeAccess || req.access;
    return {
        access,
        personalAccess: access,
        promotionAuthority: req.personalKnowledgePromotionAuthority || null
    };
}
function sendError(res, error) {
    return res.status(error.status || 400).json({
        error: error.message || 'personal_knowledge_request_failed',
        ...(error.details ? { details: error.details } : {})
    });
}

function projectOrganizationReview(value = {}) {
    const normalizedEntity = value.normalized_payload?.entity;
    return {
        request_id: value.request_id,
        organization_id: value.organization_id,
        project_code: value.project_code,
        status: value.status,
        subject: normalizedEntity ? { type: normalizedEntity.type, id: normalizedEntity.id } : undefined,
        normalized_payload: value.normalized_payload,
        normalized_payload_hash: value.normalized_payload_hash,
        normalization_contract_version: value.normalization_contract_version,
        owner_consent_receipt_id: value.owner_consent_receipt_id,
        owner_decided_at: value.owner_decided_at,
        created_at: value.created_at
    };
}

function projectOrganizationDecisionReceipt(value = {}) {
    return {
        request_id: value.request_id,
        status: value.status,
        organization_event_id: value.organization_event_id,
        graph_entity_id: value.graph_entity_id,
        owner_consent_receipt_id: value.owner_consent_receipt_id,
        organization_review_receipt_id: value.organization_review_receipt_id,
        normalized_payload_hash: value.normalized_payload_hash,
        organization_reviewed_at: value.organization_reviewed_at,
        organization_review_reason: value.organization_review_reason
    };
}

const unavailablePromotionAuthority = (_req, res) => res.status(503).json({
    error: 'personal_knowledge_promotion_authority_unavailable'
});

export function createPersonalKnowledgeRouter({
    personalKnowledgeService,
    promotionService,
    promotionAuthorityGuards = {}
}) {
    const router = express.Router();
    const requestAuthority = promotionAuthorityGuards.request || unavailablePromotionAuthority;
    const ownerAuthority = promotionAuthorityGuards.owner || unavailablePromotionAuthority;
    const organizationAuthority = promotionAuthorityGuards.organization || unavailablePromotionAuthority;
    router.post('/events', async (req, res) => {
        try { res.status(201).json(await personalKnowledgeService.ingest(req.body || {}, context(req))); } catch (error) { sendError(res, error); }
    });
    router.get('/search', async (req, res) => {
        try { res.json(await personalKnowledgeService.search({ query: req.query.q || req.query.query, limit: req.query.limit }, context(req))); } catch (error) { sendError(res, error); }
    });
    router.get('/cycles/:eventId', async (req, res) => {
        try {
            const value = await personalKnowledgeService.getCycle(req.params.eventId, context(req));
            return value ? res.json(value) : res.status(404).json({ error: 'personal_knowledge_event_not_found' });
        } catch (error) { return sendError(res, error); }
    });
    router.post('/events/:eventId/promotion-requests', requestAuthority, async (req, res) => {
        try {
            res.status(202).json(await promotionService.requestPromotion(req.params.eventId, req.body || {}, context(req)));
        } catch (error) { sendError(res, error); }
    });

    const ownerDecision = async (req, res) => {
        try {
            res.json(await promotionService.decideOwnerPromotion(req.params.requestId, req.body || {}, context(req)));
        } catch (error) { sendError(res, error); }
    };
    // Compatibility path: this is owner consent only and never publishes to Graph.
    router.post('/promotions/:requestId/decision', ownerAuthority, ownerDecision);
    router.post('/promotions/:requestId/owner-decision', ownerAuthority, ownerDecision);

    router.get('/organization-reviews', async (req, res) => {
        try {
            const reviews = await promotionService.listOrganizationReviews({ limit: req.query.limit }, context(req));
            res.json({ reviews: reviews.map(projectOrganizationReview) });
        } catch (error) { sendError(res, error); }
    });
    router.put('/promotions/:requestId/normalized-payload', ownerAuthority, async (req, res) => {
        try {
            res.json(await promotionService.saveNormalizedPromotion(req.params.requestId, req.body || {}, context(req)));
        } catch (error) { sendError(res, error); }
    });
    router.post('/promotions/:requestId/organization-decision', organizationAuthority, async (req, res) => {
        try {
            const receipt = await promotionService.reviewOrganizationPromotion(req.params.requestId, req.body || {}, context(req));
            res.json(projectOrganizationDecisionReceipt(receipt));
        } catch (error) { sendError(res, error); }
    });
    return router;
}
