import { Router } from 'express';

function actor(req) {
    return {
        personId: req.access?.personId || req.auth?.sub || null,
        role: req.access?.role || req.auth?.role,
        projectCodes: req.access?.projectCodes || [],
        clearance: req.access?.clearance || [],
        organizationId: req.access?.organizationId || req.access?.tenantId || null,
        tenantId: req.access?.tenantId || null,
        authSource: req.authSource || null
    };
}

function sendError(res, error) {
    const status = Number(error?.statusCode || error?.status) || 500;
    return res.status(status).json({
        error: {
            code: error?.code || 'PROJECT_PROVISIONING_INTERNAL_ERROR',
            message: status >= 500 ? 'Project Provisioning failed' : error?.message,
            details: error?.details
        }
    });
}

function route(handler) {
    return async (req, res) => {
        try { await handler(req, res); } catch (error) { sendError(res, error); }
    };
}

export function createProjectProvisioningRouter({ service }) {
    const router = Router();
    if (!service) {
        router.use((_req, res) => res.status(503).json({
            error: { code: 'PROJECT_PROVISIONING_UNAVAILABLE', message: 'Project Provisioning is unavailable' }
        }));
        return router;
    }
    router.post('/check', route(async (req, res) => res.json(await service.check(actor(req), req.body))));
    router.post('/plan', route(async (req, res) => res.status(201).json(await service.plan(actor(req), req.body, {
        idempotencyKey: req.get('Idempotency-Key')
    }))));
    router.get('/runs/:runId', route(async (req, res) => res.json(await service.status(actor(req), req.params.runId))));
    router.post('/runs/:runId/approve', route(async (req, res) => res.json(await service.approve(actor(req), req.params.runId, {
        approvedGates: req.body?.approved_gates || [],
        reviewRef: req.body?.review_ref || null
    }))));
    router.post('/runs/:runId/apply', route(async (req, res) => res.json(await service.apply(actor(req), req.params.runId))));
    router.post('/runs/:runId/verify', route(async (req, res) => res.json(await service.verify(actor(req), req.params.runId))));
    router.post('/runs/:runId/resume', route(async (req, res) => res.json(await service.resume(actor(req), req.params.runId))));
    return router;
}
