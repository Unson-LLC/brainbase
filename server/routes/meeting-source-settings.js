import express from 'express';
import { asyncHandler } from '../lib/async-handler.js';
import { requireConfigWriteRole } from './config.js';

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

export function createMeetingSourceSettingsRouter(meetingSourceMcpSyncService, options = {}) {
    if (!meetingSourceMcpSyncService) {
        throw new Error('meetingSourceMcpSyncService is required');
    }

    const router = express.Router();
    const writeGuard = options.writeGuard || requireConfigWriteRole;

    router.get('/mcp-providers', asyncHandler(async (_req, res) => {
        res.json(await meetingSourceMcpSyncService.listProviderStatuses());
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
