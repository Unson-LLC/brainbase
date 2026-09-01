// @ts-check

import { Router } from 'express';

import { asyncHandler } from '../lib/async-handler.js';
import { RunReceiptContractError } from '../services/run-receipt/contract.js';

function normalizeProjectCode(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isServerToServerAuth(req) {
    const authSource = String(req.authSource || '');
    if (['internal', 'service-token'].includes(authSource)) return true;
    return authSource === 'insecure-header' && process.env.NODE_ENV !== 'production';
}

function canAccessProject(req, projectId) {
    if (!projectId) return true;
    if (req.authSource === 'internal' || req.auth?.sub === 'internal_api' || req.access?.personId === 'internal_api') {
        return true;
    }
    if (['admin', 'ceo'].includes(String(req.access?.role || req.auth?.role || '').toLowerCase())) return true;
    const requested = normalizeProjectCode(projectId);
    const projectCodes = Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : [];
    return projectCodes.some((code) => normalizeProjectCode(code) === requested);
}

function actorFromRequest(req) {
    return {
        ...(req.auth || {}),
        person_id: req.access?.personId || req.auth?.person_id || req.auth?.sub || null,
        projectCodes: Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : [],
        role: req.access?.role || req.auth?.role || null,
        authSource: req.authSource || null,
        organizationId: req.access?.organizationId || req.access?.tenantId || null
    };
}

export function createRunReceiptRouter({ ingestService, queryService, routineLivenessService = null }) {
    const router = Router();

    router.post('/ingest', asyncHandler(async (req, res) => {
        if (!isServerToServerAuth(req)) {
            res.status(403).json({
                error: 'server_to_server_auth_required',
                message: 'run receipt ingest requires service token or internal API authentication'
            });
            return;
        }
        const projectId = req.body?.run?.project_id;
        if (!canAccessProject(req, projectId)) {
            res.status(403).json({
                error: 'project_not_accessible',
                message: `project '${projectId}' is not accessible`
            });
            return;
        }
        try {
            const result = await ingestService.ingest(req.body);
            res.status(result.status === 'duplicate' ? 200 : 201).json(result);
        } catch (error) {
            if (error instanceof RunReceiptContractError) {
                const retryable = error.code === 'run_receipt_lock_timeout';
                if (retryable) res.set('Retry-After', '1');
                res.status(retryable ? 503 : 400).json({
                    error: error.message,
                    code: error.code,
                    details: error.details,
                    retryable
                });
                return;
            }
            throw error;
        }
    }));

    router.get('/inbox', asyncHandler(async (req, res) => {
        res.json(await queryService.listInbox({
            projectId: req.query.project_id || req.query.projectId || null,
            sourceType: req.query.source_type || req.query.sourceType || null,
            runStatus: req.query.run_status || req.query.runStatus || null,
            evidenceState: req.query.evidence_state || req.query.evidenceState || null,
            limit: req.query.limit
        }, actorFromRequest(req)));
    }));

    router.get('/history', asyncHandler(async (req, res) => {
        res.json(await queryService.listHistory({
            projectId: req.query.project_id || req.query.projectId,
            sourceType: req.query.source_type || req.query.sourceType,
            sourceIdentity: req.query.source_identity || req.query.sourceIdentity,
            limit: req.query.limit
        }, actorFromRequest(req)));
    }));

    router.get('/routine-exceptions', asyncHandler(async (req, res) => {
        if (!canAccessProject(req, 'brainbase')) {
            res.status(403).json({
                error: 'project_not_accessible',
                message: "project 'brainbase' is not accessible"
            });
            return;
        }
        if (!routineLivenessService) {
            res.status(503).json({
                error: 'routine_liveness_unavailable',
                message: 'routine liveness service is not configured'
            });
            return;
        }
        const items = await routineLivenessService.listExceptions({ limit: 3 });
        res.json({ count: items.length, items });
    }));

    router.get('/:runId/diagnosis', asyncHandler(async (req, res) => {
        res.json(await queryService.diagnose({
            projectId: req.query.project_id || req.query.projectId,
            runId: req.params.runId
        }, actorFromRequest(req)));
    }));

    return router;
}
