import { Router } from 'express';

import { asyncHandler } from '../lib/async-handler.js';
import { OutcomeCaseError } from '../services/outcome-case/outcome-case-service.js';

function normalizeProjectCode(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function canAccessProject(req, projectCode) {
    const requested = normalizeProjectCode(projectCode);
    return (Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : [])
        .some((code) => normalizeProjectCode(code) === requested);
}

function hasOrganizationContext(req) {
    return Boolean(String(req.access?.organizationId || req.access?.tenantId || '').trim());
}

function denyMissingOrganization(res) {
    res.status(403).json({
        error: 'outcome_case_organization_access_denied',
        message: 'authenticated organization is required',
        details: { audit_event: 'outcome_case_unknown_tenant_denied' }
    });
}

function actorFromRequest(req) {
    return {
        ...(req.auth || {}),
        person_id: req.access?.personId || req.auth?.person_id || req.auth?.sub || null,
        projectCodes: Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : [],
        clearance: Array.isArray(req.access?.clearance) ? req.access.clearance : [],
        role: req.access?.role || req.auth?.role || null,
        authSource: req.authSource || null,
        organizationId: req.access?.organizationId || req.access?.tenantId || null,
        tenantId: req.access?.tenantId || null
    };
}

function sendError(res, error) {
    if (error instanceof OutcomeCaseError
        || error?.code === 'outcome_case_revision_conflict'
        || error?.code === 'outcome_case_store_unavailable') {
        res.status(error.status || 422).json({ error: error.code, message: error.message, details: error.details || null });
        return true;
    }
    return false;
}

export function createOutcomeCaseRouter({ service } = {}) {
    const router = Router();
    router.use((req, res, next) => {
        if (service) return next();
        res.status(503).json({ error: 'outcome_case_unavailable', message: 'OutcomeCase PostgreSQL store is not configured' });
    });

    router.post('/', asyncHandler(async (req, res) => {
        if (!hasOrganizationContext(req)) {
            denyMissingOrganization(res);
            return;
        }
        if (!canAccessProject(req, req.body?.project_code)) {
            res.status(403).json({ error: 'project_not_accessible', message: 'project is not accessible' });
            return;
        }
        try {
            res.status(201).json(await service.create(req.body, actorFromRequest(req)));
        } catch (error) {
            if (!sendError(res, error)) throw error;
        }
    }));

    router.get('/:caseId', asyncHandler(async (req, res) => {
        if (!hasOrganizationContext(req)) {
            denyMissingOrganization(res);
            return;
        }
        try {
            const outcomeCase = await service.read(req.params.caseId, actorFromRequest(req));
            if (!canAccessProject(req, outcomeCase.project_code)) {
                res.status(403).json({ error: 'project_not_accessible', message: 'project is not accessible' });
                return;
            }
            res.json(outcomeCase);
        } catch (error) {
            if (!sendError(res, error)) throw error;
        }
    }));

    router.post('/:caseId/evaluations', asyncHandler(async (req, res) => {
        if (!hasOrganizationContext(req)) {
            denyMissingOrganization(res);
            return;
        }
        try {
            const current = await service.read(req.params.caseId, actorFromRequest(req));
            if (!canAccessProject(req, current.project_code)) {
                res.status(403).json({ error: 'project_not_accessible', message: 'project is not accessible' });
                return;
            }
            res.json(await service.evaluate(req.params.caseId, req.body, actorFromRequest(req)));
        } catch (error) {
            if (!sendError(res, error)) throw error;
        }
    }));

    return router;
}
