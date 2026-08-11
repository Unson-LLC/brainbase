import { Router } from 'express';

function actorFromRequest(req) {
    return {
        ...(req.auth || {}),
        personId: req.access?.personId || req.auth?.sub,
        role: req.access?.role || req.auth?.role,
        projectCodes: Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : [],
        authSource: req.authSource || null,
        access: req.access
    };
}

function sendError(res, error) {
    const status = Number(error?.statusCode) || 500;
    return res.status(status).json({
        error: {
            code: error?.code || 'onboarding_internal_error',
            message: status >= 500 ? 'Onboarding runtime failed' : error?.message
        }
    });
}

function route(handler) {
    return async (req, res) => {
        try {
            await handler(req, res);
        } catch (error) {
            sendError(res, error);
        }
    };
}

export function createOnboardingRouter({ service }) {
    const router = Router();
    if (!service) {
        router.use((_req, res) => res.status(503).json({ error: { code: 'onboarding_runtime_unavailable', message: 'Onboarding runtime is unavailable' } }));
        return router;
    }
    router.post('/runs', route(async (req, res) => res.status(201).json(await service.startRun(actorFromRequest(req), req.body))));
    router.get('/runs/:runId', route(async (req, res) => res.json(await service.getRun(actorFromRequest(req), req.params.runId))));
    router.post('/runs/:runId/sources', route(async (req, res) => res.status(201).json(await service.ingestSource(actorFromRequest(req), req.params.runId, req.body))));
    router.post('/runs/:runId/candidates/:candidateId/review', route(async (req, res) => res.json(await service.reviewCandidate(actorFromRequest(req), req.params.runId, req.params.candidateId, req.body))));
    router.post('/runs/:runId/first-value', route(async (req, res) => res.json(await service.recordFirstValue(actorFromRequest(req), req.params.runId, req.body))));
    router.post('/runs/:runId/first-value/review', route(async (req, res) => res.json(await service.reviewFirstValue(actorFromRequest(req), req.params.runId, req.body))));
    return router;
}
