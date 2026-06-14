// @ts-check
import express from 'express';

import { asyncHandler } from '../lib/async-handler.js';

function accessFromRequest(req) {
    return req.access || { role: 'member', projectCodes: [], clearance: ['internal'], personId: null };
}

export function createAdminVisualizationRouter(adminVisualizationService) {
    const router = express.Router();
    router.get('/overview', asyncHandler(async (req, res) => res.json(await adminVisualizationService.getOverview(accessFromRequest(req)))));
    router.get('/graph/entities', asyncHandler(async (req, res) => res.json(await adminVisualizationService.listGraphEntities(accessFromRequest(req), { project: req.query.project || null, type: req.query.type || null, id: req.query.id || null, q: req.query.q || null, limit: req.query.limit || null }))));
    router.get('/candidates', asyncHandler(async (req, res) => res.json(await adminVisualizationService.listCandidates(accessFromRequest(req), { project: req.query.project || null, status: req.query.status || null, type: req.query.type || null, id: req.query.id || null, redaction: req.query.redaction || null, limit: req.query.limit || null }))));
    router.post('/context-preview', asyncHandler(async (req, res) => res.json(await adminVisualizationService.previewContext(accessFromRequest(req), req.body || {}))));
    router.get('/data-flow', asyncHandler(async (req, res) => res.json(await adminVisualizationService.getDataFlow(accessFromRequest(req), { project: req.query.project || null, entity: req.query.entity || null, candidate: req.query.candidate || null }))));
    router.get('/health', asyncHandler(async (req, res) => res.json(await adminVisualizationService.getHealth(accessFromRequest(req)))));
    return router;
}
