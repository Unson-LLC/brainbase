import { Router } from 'express';

const ERROR_STATUS = new Map([
    ['knowledge_event_invalid', 400],
    ['knowledge_feedback_invalid', 400],
    ['knowledge_event_conflict', 409],
    ['knowledge_event_not_found', 404],
    ['knowledge_cycle_not_found', 404],
    ['knowledge_project_code_required', 400],
    ['knowledge_project_access_denied', 403]
]);

function projectCodeFor(req) {
    return req.body?.applicability_scope?.project_code
        || req.body?.correction_event?.applicability_scope?.project_code
        || req.body?.project_code
        || req.query?.project_code
        || null;
}

function requireProjectAccess(req, res) {
    const projectCode = projectCodeFor(req);
    const allowed = Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : [];
    if (projectCode && !allowed.includes(projectCode)) {
        res.status(403).json({ error: 'knowledge_project_access_denied' });
        return false;
    }
    return true;
}

function route(handler) {
    return async (req, res) => {
        try {
            await handler(req, res);
        } catch (error) {
            const code = error?.code || 'knowledge_event_failed';
            res.status(ERROR_STATUS.get(code) || 500).json({
                error: code,
                message: error instanceof Error ? error.message : String(error)
            });
        }
    };
}

export function createKnowledgeEventRouter({ eventService, feedbackService, cycleQueryService }) {
    const router = Router();
    router.post('/events', route(async (req, res) => {
        if (!requireProjectAccess(req, res)) return;
        const result = await eventService.ingest(req.body, { access: req.access, auth: req.auth });
        res.status(202).json(result);
    }));
    router.post('/feedback', route(async (req, res) => {
        if (!requireProjectAccess(req, res)) return;
        const result = await feedbackService.recordFeedback(req.body, { access: req.access, auth: req.auth });
        res.json(result);
    }));
    router.get('/cycles/:eventId', route(async (req, res) => {
        if (!req.query.project_code) {
            res.status(400).json({ error: 'knowledge_project_code_required' });
            return;
        }
        if (!requireProjectAccess(req, res)) return;
        const result = await cycleQueryService.getCycle(req.params.eventId, {
            access: req.access,
            auth: req.auth,
            projectCode: req.query.project_code
        });
        res.json(result);
    }));
    return router;
}
