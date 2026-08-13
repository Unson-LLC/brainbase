import express from 'express';

function context(req) { return { access: req.access, personalAccess: req.personalKnowledgeAccess }; }
function sendError(res, error) { return res.status(error.status || 400).json({ error: error.message || 'personal_knowledge_request_failed' }); }

export function createPersonalKnowledgeRouter({ personalKnowledgeService, promotionService }) {
    const router = express.Router();
    router.post('/events', async (req, res) => {
        try { res.status(201).json(await personalKnowledgeService.ingest(req.body || {}, context(req))); } catch (error) { sendError(res, error); }
    });
    router.get('/search', async (req, res) => {
        try { res.json(await personalKnowledgeService.search({ query: req.query.q || req.query.query, limit: req.query.limit }, context(req))); } catch (error) { sendError(res, error); }
    });
    router.get('/cycles/:eventId', async (req, res) => {
        try { const value = await personalKnowledgeService.getCycle(req.params.eventId, context(req)); return value ? res.json(value) : res.status(404).json({ error: 'personal_knowledge_event_not_found' }); } catch (error) { return sendError(res, error); }
    });
    router.post('/events/:eventId/promotion-requests', async (req, res) => {
        try { res.status(202).json(await promotionService.requestPromotion(req.params.eventId, req.body || {}, context(req))); } catch (error) { sendError(res, error); }
    });
    router.post('/promotions/:requestId/decision', async (req, res) => {
        try { res.json(await promotionService.decidePromotion(req.params.requestId, req.body || {}, context(req))); } catch (error) { sendError(res, error); }
    });
    return router;
}
