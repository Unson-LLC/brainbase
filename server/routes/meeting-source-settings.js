import express from 'express';
import { asyncHandler } from '../lib/async-handler.js';
import { requireConfigWriteRole } from './config.js';
import { createMeetingSourceIntegrationCatalogService } from '../services/meeting-source/meeting-source-integration-catalog.js';

function actorFromRequest(req) {
    const actor = req.actor || req.user || req.auth || {};
    const access = req.access || {};
    return {
        ...access,
        ...actor,
        projectCodes: actor.projectCodes || access.projectCodes || [],
        personId: actor.personId || access.personId || actor.sub || access.sub || null
    };
}

function normalizeProjectCode(value) {
    if (typeof value !== 'string') return null;
    return value.trim().toLowerCase().replace(/_/g, '-') || null;
}

export function createMeetingSourceSettingsRouter(meetingSourceMcpSyncService, options = {}) {
    if (!meetingSourceMcpSyncService) {
        throw new Error('meetingSourceMcpSyncService is required');
    }

    const router = express.Router();
    const writeGuard = options.writeGuard || requireConfigWriteRole;
    const integrationCatalogService = options.integrationCatalogService
        || meetingSourceMcpSyncService.integrationCatalogService
        || createMeetingSourceIntegrationCatalogService();

    router.get('/mcp-providers', asyncHandler(async (_req, res) => {
        res.json(await meetingSourceMcpSyncService.listProviderStatuses());
    }));

    router.get('/diagnosis', asyncHandler(async (req, res) => {
        const projectId = normalizeProjectCode(req.query.project_id);
        if (!projectId) {
            return res.status(400).json({ error: 'project_id is required' });
        }
        const actor = actorFromRequest(req);
        const projectCodes = new Set((actor.projectCodes || []).map(normalizeProjectCode).filter(Boolean));
        if (!projectCodes.has(projectId)) {
            return res.status(403).json({ error: `project '${projectId}' is not accessible` });
        }
        return res.json(await meetingSourceMcpSyncService.diagnose({ project_id: projectId }));
    }));

    router.get('/integration-catalog', asyncHandler(async (_req, res) => {
        res.json(await integrationCatalogService.listCatalog());
    }));

    router.get('/integration-catalog/:provider', asyncHandler(async (req, res) => {
        res.json(await integrationCatalogService.getCatalogEntry(req.params.provider));
    }));

    router.post('/integration-catalog/:provider/refresh', writeGuard, asyncHandler(async (req, res) => {
        res.json(await integrationCatalogService.refreshProvider(req.params.provider));
    }));

    router.post('/mcp-providers/:provider/connect', writeGuard, asyncHandler(async (req, res) => {
        res.json(await meetingSourceMcpSyncService.connectProvider(req.params.provider, req.body || {}));
    }));

    router.post('/mcp-providers/:provider/test', writeGuard, asyncHandler(async (req, res) => {
        res.json(await meetingSourceMcpSyncService.testProvider(req.params.provider));
    }));

    router.post('/mcp-providers/:provider/disconnect', writeGuard, asyncHandler(async (req, res) => {
        res.json(await meetingSourceMcpSyncService.disconnectProvider(req.params.provider));
    }));

    router.post('/resync-preview', writeGuard, asyncHandler(async (req, res) => {
        res.json(await meetingSourceMcpSyncService.previewResync({
            ...(req.body || {}),
            dry_run: true
        }));
    }));

    router.post('/resync-confirm', writeGuard, asyncHandler(async (req, res) => {
        res.json(await meetingSourceMcpSyncService.confirmResync({
            ...(req.body || {}),
            submit: req.body?.submit !== false,
            actor: actorFromRequest(req)
        }));
    }));

    router.use((error, _req, res, next) => {
        if (!error?.statusCode) return next(error);
        res.status(error.statusCode).json({ error: error.message });
    });

    return router;
}
