import { Router } from 'express';
import crypto from 'crypto';

import { asyncHandler } from '../lib/async-handler.js';
import { resolveCanonicalTenantIdentity } from '../lib/canonical-tenant-identity.js';
import { OutcomeCaseError } from '../services/outcome-case/outcome-case-service.js';

function normalizeProjectCode(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function canAccessProject(req, projectCode) {
    const requested = normalizeProjectCode(projectCode);
    return (Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : [])
        .some((code) => normalizeProjectCode(code) === requested);
}

function organizationIdentity(req) {
    return resolveCanonicalTenantIdentity(req.access);
}

async function recordDeniedAccess(auditSink, { action, reason, req }) {
    const auditId = `oca_${crypto.randomUUID()}`;
    const entry = {
        audit_id: auditId,
        event: 'outcome_case_access_denied',
        action,
        reason,
        auth_source: req.authSource || null
    };
    try {
        if (typeof auditSink?.writeAuditLog === 'function') await auditSink.writeAuditLog(entry);
        else if (typeof auditSink === 'function') await auditSink(entry);
    } catch {
        // A denial must remain non-disclosing even when diagnostics are down.
    }
    return auditId;
}

async function denyOrganization(res, req, auditSink, identity) {
    const reason = identity.state === 'ambiguous'
        ? 'outcome_case_ambiguous_tenant_denied'
        : 'outcome_case_unknown_tenant_denied';
    const auditId = await recordDeniedAccess(auditSink, { action: req.outcomeCaseAction, reason, req });
    res.status(403).json({
        error: 'outcome_case_organization_access_denied',
        message: 'authenticated organization is required',
        details: { audit_event: reason, audit_id: auditId }
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
        organizationId: req.access?.organizationId || null,
        tenantId: req.access?.tenantId || null
    };
}

async function sendError(res, error, { auditSink, req, action }) {
    if (error instanceof OutcomeCaseError
        || error?.code === 'outcome_case_revision_conflict'
        || error?.code === 'outcome_case_store_unavailable'
        || error?.code === 'outcome_case_tenant_access_denied') {
        const mustAudit = error.status === 404
            || error?.code === 'outcome_case_tenant_access_denied'
            || error?.code === 'outcome_case_organization_access_denied';
        const auditId = mustAudit
            ? await recordDeniedAccess(auditSink, { action, reason: error.code, req })
            : null;
        const details = auditId ? { ...(error.details || {}), audit_id: auditId } : (error.details || null);
        res.status(error.status || 422).json({ error: error.code, message: error.message, details });
        return true;
    }
    return false;
}

export function createOutcomeCaseRouter({ service, auditSink = null } = {}) {
    const router = Router();
    router.use((req, res, next) => {
        if (service) return next();
        res.status(503).json({ error: 'outcome_case_unavailable', message: 'OutcomeCase PostgreSQL store is not configured' });
    });

    router.post('/', asyncHandler(async (req, res) => {
        req.outcomeCaseAction = 'create';
        const identity = organizationIdentity(req);
        if (identity.state !== 'confirmed') {
            await denyOrganization(res, req, auditSink, identity);
            return;
        }
        if (!canAccessProject(req, req.body?.project_code)) {
            res.status(403).json({ error: 'project_not_accessible', message: 'project is not accessible' });
            return;
        }
        try {
            res.status(201).json(await service.create(req.body, actorFromRequest(req)));
        } catch (error) {
            if (!await sendError(res, error, { auditSink, req, action: 'create' })) throw error;
        }
    }));

    router.get('/:caseId', asyncHandler(async (req, res) => {
        req.outcomeCaseAction = 'read';
        const identity = organizationIdentity(req);
        if (identity.state !== 'confirmed') {
            await denyOrganization(res, req, auditSink, identity);
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
            if (!await sendError(res, error, { auditSink, req, action: 'read' })) throw error;
        }
    }));

    router.post('/:caseId/evaluations', asyncHandler(async (req, res) => {
        req.outcomeCaseAction = 'evaluate';
        const identity = organizationIdentity(req);
        if (identity.state !== 'confirmed') {
            await denyOrganization(res, req, auditSink, identity);
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
            if (!await sendError(res, error, { auditSink, req, action: 'evaluate' })) throw error;
        }
    }));

    return router;
}
