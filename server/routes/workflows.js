// @ts-check
import express from 'express';
import { asyncHandler } from '../lib/async-handler.js';

function actorFromRequest(req) {
    return {
        ...(req.auth || {}),
        ...(req.actor || req.user || {}),
        person_id: req.access?.personId || req.actor?.person_id || req.user?.person_id || req.auth?.person_id || req.auth?.sub || null,
        projectCodes: Array.isArray(req.access?.projectCodes) ? req.access.projectCodes : [],
        role: req.access?.role || req.auth?.role || null,
        authSource: req.authSource || null
    };
}

export function createWorkflowRouter(workflowService) {
    const router = express.Router();

    router.get('/', asyncHandler(async (req, res) => {
        const projectId = req.query.project_id || req.query.projectId || null;
        res.json(await workflowService.listWorkflows({ projectId }, actorFromRequest(req)));
    }));

    router.post('/', asyncHandler(async (req, res) => {
        const result = await workflowService.createWorkflow(req.body || {}, actorFromRequest(req));
        res.status(201).json(result);
    }));

    router.get('/:workflowId', asyncHandler(async (req, res) => {
        res.json(await workflowService.getWorkflow(req.params.workflowId, actorFromRequest(req)));
    }));

    router.patch('/:workflowId', asyncHandler(async (req, res) => {
        res.json(await workflowService.updateWorkflow(req.params.workflowId, req.body || {}, actorFromRequest(req)));
    }));

    router.post('/:workflowId/run', asyncHandler(async (req, res) => {
        const body = req.body || {};
        const actor = actorFromRequest(req);
        res.status(201).json(await workflowService.runWorkflow(req.params.workflowId, {
            triggerType: body.trigger_type || body.triggerType || 'manual',
            env: body.env || 'local',
            dryRun: Boolean(body.dry_run || body.dryRun),
            actorId: actor.person_id || actor.sub || 'system',
            projectCodes: actor.projectCodes || [],
            role: actor.role,
            authSource: actor.authSource
        }));
    }));

    return router;
}

export function createWorkflowRunRouter(workflowService) {
    const router = express.Router();

    router.get('/:runId', asyncHandler(async (req, res) => {
        res.json(await workflowService.getRun(req.params.runId, actorFromRequest(req)));
    }));

    router.post('/:runId/rerun', asyncHandler(async (req, res) => {
        const body = req.body || {};
        res.status(201).json(await workflowService.rerun(req.params.runId, {
            actorId: actorFromRequest(req).person_id || actorFromRequest(req).sub || 'system',
            dryRun: Boolean(body.dry_run || body.dryRun)
        }, actorFromRequest(req)));
    }));

    router.post('/:runId/human-steps/:stepId/resolve', asyncHandler(async (req, res) => {
        res.json(await workflowService.resolveHumanStep(req.params.stepId, {
            ...(req.body || {}),
            run_id: req.params.runId
        }, actorFromRequest(req)));
    }));

    return router;
}

export function createWorkflowHumanStepRouter(workflowService) {
    const router = express.Router();

    router.post('/:stepId/resolve', asyncHandler(async (req, res) => {
        res.json(await workflowService.resolveHumanStep(req.params.stepId, req.body || {}, actorFromRequest(req)));
    }));

    return router;
}
