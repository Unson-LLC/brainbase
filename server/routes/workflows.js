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

function workflowControlRequested(req) {
    const prefer = String(req.get('prefer') || req.get('x-brainbase-api-mode') || '').toLowerCase();
    return req.query.control === '1'
        || req.query.mode === 'control'
        || prefer.includes('workflow-control-v0')
        || prefer.includes('workflow-control');
}

async function respondWorkflowOrControl({ req, res, workflowService, workflowId, controlResponse }) {
    const actor = actorFromRequest(req);
    if (!workflowControlRequested(req)) {
        try {
            res.json(await workflowService.getWorkflow(workflowId, actor));
            return;
        } catch (error) {
            if (error?.statusCode !== 404) throw error;
        }
    }
    res.json(await controlResponse(actor));
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

    router.post('/draft', asyncHandler(async (req, res) => {
        res.status(201).json(await workflowService.generateDraft(req.body || {}, actorFromRequest(req)));
    }));

    router.post('/draft/test', asyncHandler(async (req, res) => {
        res.json(await workflowService.testDraft(req.body || {}, actorFromRequest(req)));
    }));

    function roleAgentQuery(req) {
        return {
            orgId: req.query.org_id || req.query.orgId || null,
            projectId: req.query.project_id || req.query.projectId || null,
            roleArchetypeId: req.query.role_archetype_id || req.query.roleArchetypeId || null
        };
    }
    function templateQuery(req) {
        return {
            orgId: req.query.org_id || req.query.orgId || null,
            projectId: req.query.project_id || req.query.projectId || null,
            workflowKind: req.query.workflow_kind || req.query.workflowKind || null
        };
    }
    function bindingQuery(req) {
        return {
            orgId: req.query.org_id || req.query.orgId || null,
            projectId: req.query.project_id || req.query.projectId || null,
            roleAgentInstanceId: req.query.role_agent_instance_id || req.query.roleAgentInstanceId || null
        };
    }
    function triggerQuery(req) {
        return {
            orgId: req.query.org_id || req.query.orgId || null,
            projectId: req.query.project_id || req.query.projectId || null,
            workflowBindingId: req.query.workflow_binding_id || req.query.workflowBindingId || null,
            triggerType: req.query.trigger_type || req.query.triggerType || null
        };
    }
    function loopIntentQuery(req) {
        return {
            orgId: req.query.org_id || req.query.orgId || null,
            projectId: req.query.project_id || req.query.projectId || null,
            workflowBindingId: req.query.workflow_binding_id || req.query.workflowBindingId || null,
            triggerId: req.query.trigger_id || req.query.triggerId || null
        };
    }

    router.get('/control/role-agents', asyncHandler(async (req, res) => {
        res.json(await workflowService.listRoleAgentInstances(roleAgentQuery(req), actorFromRequest(req)));
    }));

    router.post('/control/role-agents', asyncHandler(async (req, res) => {
        res.status(201).json(await workflowService.createRoleAgentInstance(req.body || {}, actorFromRequest(req)));
    }));

    router.get('/control/templates', asyncHandler(async (req, res) => {
        res.json(await workflowService.listWorkflowTemplates(templateQuery(req), actorFromRequest(req)));
    }));

    router.post('/control/templates', asyncHandler(async (req, res) => {
        res.status(201).json(await workflowService.createWorkflowTemplate(req.body || {}, actorFromRequest(req)));
    }));

    router.get('/control/bindings', asyncHandler(async (req, res) => {
        res.json(await workflowService.listWorkflowBindings(bindingQuery(req), actorFromRequest(req)));
    }));

    router.post('/control/bindings', asyncHandler(async (req, res) => {
        res.status(201).json(await workflowService.createWorkflowBinding(req.body || {}, actorFromRequest(req)));
    }));

    router.get('/control/triggers', asyncHandler(async (req, res) => {
        res.json(await workflowService.listWorkflowTriggers(triggerQuery(req), actorFromRequest(req)));
    }));

    router.post('/control/triggers', asyncHandler(async (req, res) => {
        res.status(201).json(await workflowService.createWorkflowTrigger(req.body || {}, actorFromRequest(req)));
    }));

    router.get('/control/loop-intents', asyncHandler(async (req, res) => {
        res.json(await workflowService.listLoopIntents(loopIntentQuery(req), actorFromRequest(req)));
    }));

    router.post('/control/loop-intents', asyncHandler(async (req, res) => {
        res.status(201).json(await workflowService.createLoopIntent(req.body || {}, actorFromRequest(req)));
    }));

    router.get('/role-agents', asyncHandler(async (req, res) => {
        await respondWorkflowOrControl({
            req,
            res,
            workflowService,
            workflowId: 'role-agents',
            controlResponse: (actor) => workflowService.listRoleAgentInstances(roleAgentQuery(req), actor)
        });
    }));

    router.get('/templates', asyncHandler(async (req, res) => {
        await respondWorkflowOrControl({
            req,
            res,
            workflowService,
            workflowId: 'templates',
            controlResponse: (actor) => workflowService.listWorkflowTemplates(templateQuery(req), actor)
        });
    }));

    router.get('/bindings', asyncHandler(async (req, res) => {
        await respondWorkflowOrControl({
            req,
            res,
            workflowService,
            workflowId: 'bindings',
            controlResponse: (actor) => workflowService.listWorkflowBindings(bindingQuery(req), actor)
        });
    }));

    router.get('/triggers', asyncHandler(async (req, res) => {
        await respondWorkflowOrControl({
            req,
            res,
            workflowService,
            workflowId: 'triggers',
            controlResponse: (actor) => workflowService.listWorkflowTriggers(triggerQuery(req), actor)
        });
    }));

    router.get('/loop-intents', asyncHandler(async (req, res) => {
        await respondWorkflowOrControl({
            req,
            res,
            workflowService,
            workflowId: 'loop-intents',
            controlResponse: (actor) => workflowService.listLoopIntents(loopIntentQuery(req), actor)
        });
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
