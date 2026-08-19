import express from 'express';

function context(req) {
    const access = req.personalKnowledgeAccess || req.access;
    return { access, personalAccess: access };
}
function sendError(res, error) {
    return res.status(error.status || 400).json({ error: error.message || 'personal_knowledge_request_failed' });
}

export function createPersonalKnowledgeRouter({ personalKnowledgeService, promotionService }) {
    const router = express.Router();
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
    router.post('/events/:eventId/promotion-requests', async (req, res) => {
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
    router.post('/promotions/:requestId/decision', ownerDecision);
    router.post('/promotions/:requestId/owner-decision', ownerDecision);

    router.get('/organization-reviews', async (req, res) => {
        try {
            res.json({ reviews: await promotionService.listOrganizationReviews({ limit: req.query.limit }, context(req)) });
        } catch (error) { sendError(res, error); }
    });
    router.post('/promotions/:requestId/organization-decision', async (req, res) => {
        try {
            res.json(await promotionService.reviewOrganizationPromotion(req.params.requestId, req.body || {}, context(req)));
        } catch (error) { sendError(res, error); }
    });
    return router;
}