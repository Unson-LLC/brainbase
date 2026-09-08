import { Router } from 'express';

import { asyncHandler } from '../lib/async-handler.js';
import { OutcomeCaseError } from '../services/outcome-case/outcome-case-service.js';

function actorFromRequest(req) {
    return {
        ...(req.auth || {}),
        personId: req.access?.personId || null,
        projectCodes: Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : [],
        clearance: Array.isArray(req.access?.clearance) ? req.access.clearance : [],
        role: req.access?.role || req.auth?.role || null,
        organizationId: req.access?.organizationId || null,
        tenantId: req.access?.tenantId || null
    };
}

function hasBearerHeader(req) {
    return /^Bearer \S+$/u.test(req.get('authorization') || '');
}

function isAllowedAuthSource(req) {
    return hasBearerHeader(req) && ['bearer', 'service-token'].includes(req.authSource);
}

function sendError(res, error) {
    if (error instanceof OutcomeCaseError) {
        res.status(error.status || 422).json({ error: error.code, message: error.message });
        return;
    }
    res.status(503).json({ error: 'vibepro_handoff_unavailable', message: 'VibePro handoff service is unavailable' });
}

/**
 * A Bearer header is required even when requireAuth classifies its verified
 * token as service-token. Cookie, insecure-header, and internal API contexts
 * cannot adopt or issue a personal judgment handoff.
 */
export function createVibeproHandoffRouter({ runtime } = {}) {
    const router = Router();
    router.use((req, res, next) => {
        if (!isAllowedAuthSource(req)) {
            res.status(403).json({ error: 'vibepro_handoff_bearer_required', message: 'Bearer authentication is required' });
            return;
        }
        if (!runtime || typeof runtime.adopt !== 'function' || typeof runtime.issue !== 'function') {
            res.status(503).json({ error: 'vibepro_handoff_unavailable', message: 'VibePro handoff service is unavailable' });
            return;
        }
        next();
    });
    router.post('/adoptions', asyncHandler(async (req, res) => {
        try {
            res.status(201).json(await runtime.adopt(req.body, actorFromRequest(req)));
        } catch (error) {
            sendError(res, error);
        }
    }));
    router.post('/issue', asyncHandler(async (req, res) => {
        try {
            res.status(200).json(await runtime.issue(req.body, actorFromRequest(req)));
        } catch (error) {
            sendError(res, error);
        }
    }));
    return router;
}
