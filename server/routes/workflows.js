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
        authSource: req.authSource || null,
        organizationId: req.access?.organizationId || req.access?.tenantId || null
    };
}

export function createWorkflowRouter({
    agentControlCatalogService,
    loopIntentService,
    meetingAutomationService = null
} = {}) {
    const router = express.Router();

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
        res.json(await agentControlCatalogService.listRoleAgentInstances(roleAgentQuery(req), actorFromRequest(req)));
    }));

    router.post('/control/role-agents', asyncHandler(async (req, res) => {
        res.status(201).json(await agentControlCatalogService.createRoleAgentInstance(req.body || {}, actorFromRequest(req)));
    }));

    router.get('/control/templates', asyncHandler(async (req, res) => {
        res.json(await agentControlCatalogService.listWorkflowTemplates(templateQuery(req), actorFromRequest(req)));
    }));

    router.post('/control/templates', asyncHandler(async (req, res) => {
        res.status(201).json(await agentControlCatalogService.createWorkflowTemplate(req.body || {}, actorFromRequest(req)));
    }));

    router.get('/control/bindings', asyncHandler(async (req, res) => {
        res.json(await agentControlCatalogService.listWorkflowBindings(bindingQuery(req), actorFromRequest(req)));
    }));

    router.post('/control/bindings', asyncHandler(async (req, res) => {
        res.status(201).json(await agentControlCatalogService.createWorkflowBinding(req.body || {}, actorFromRequest(req)));
    }));

    router.get('/control/triggers', asyncHandler(async (req, res) => {
        res.json(await agentControlCatalogService.listWorkflowTriggers(triggerQuery(req), actorFromRequest(req)));
    }));

    router.post('/control/triggers', asyncHandler(async (req, res) => {
        res.status(201).json(await agentControlCatalogService.createWorkflowTrigger(req.body || {}, actorFromRequest(req)));
    }));

    router.get('/control/loop-intents', asyncHandler(async (req, res) => {
        res.json(await loopIntentService.list(loopIntentQuery(req), actorFromRequest(req)));
    }));

    router.post('/control/loop-intents', asyncHandler(async (req, res) => {
        res.status(201).json(await loopIntentService.create(req.body || {}, actorFromRequest(req)));
    }));

    router.post('/control/meeting-pack/bootstrap', asyncHandler(async (req, res) => {
        res.status(201).json(await meetingAutomationService.bootstrapPack(req.body || {}, actorFromRequest(req)));
    }));

    router.post('/control/meeting-pack/design-review', asyncHandler(async (req, res) => {
        res.json(await meetingAutomationService.reviewPackDesign(req.body || {}, actorFromRequest(req)));
    }));

    router.post('/control/meeting-pack/calendar-inputs', asyncHandler(async (req, res) => {
        try {
            res.status(201).json(await meetingAutomationService.createCalendarLoopIntents(req.body || {}, actorFromRequest(req)));
        } catch (error) {
            if (error?.statusCode === 400 && Array.isArray(error?.details?.skipped_events)) {
                res.status(400).json({
                    error: error.message,
                    skipped_events: error.details.skipped_events,
                    ...(Array.isArray(error.details.state_transitions)
                        ? { state_transitions: error.details.state_transitions }
                        : {})
                });
                return;
            }
            throw error;
        }
    }));

    router.post('/control/meeting-pack/review-ingest', asyncHandler(async (req, res) => {
        try {
            res.status(201).json(await meetingAutomationService.ingestReviewPackage(req.body || {}, actorFromRequest(req)));
        } catch (error) {
            if (error?.statusCode === 400 && error?.details?.state_transition) {
                res.status(400).json({
                    error: error.message,
                    state_transition: error.details.state_transition,
                    details: error.details
                });
                return;
            }
            throw error;
        }
    }));

    router.post('/control/meeting-pack/note-generation', asyncHandler(async (req, res) => {
        try {
            res.status(201).json(await meetingAutomationService.recordNoteGeneration(req.body || {}, actorFromRequest(req)));
        } catch (error) {
            if (error?.statusCode === 400 && error?.details?.state_transition) {
                res.status(400).json({
                    error: error.message,
                    state_transition: error.details.state_transition,
                    details: error.details
                });
                return;
            }
            throw error;
        }
    }));

    router.post('/control/meeting-pack/candidates', asyncHandler(async (req, res) => {
        res.status(201).json(await meetingAutomationService.recordCandidates(req.body || {}, actorFromRequest(req)));
    }));

    router.get('/role-agents', asyncHandler(async (req, res) => {
        res.json(await agentControlCatalogService.listRoleAgentInstances(roleAgentQuery(req), actorFromRequest(req)));
    }));

    router.get('/templates', asyncHandler(async (req, res) => {
        res.json(await agentControlCatalogService.listWorkflowTemplates(templateQuery(req), actorFromRequest(req)));
    }));

    router.get('/bindings', asyncHandler(async (req, res) => {
        res.json(await agentControlCatalogService.listWorkflowBindings(bindingQuery(req), actorFromRequest(req)));
    }));

    router.get('/triggers', asyncHandler(async (req, res) => {
        res.json(await agentControlCatalogService.listWorkflowTriggers(triggerQuery(req), actorFromRequest(req)));
    }));

    router.get('/loop-intents', asyncHandler(async (req, res) => {
        res.json(await loopIntentService.list(loopIntentQuery(req), actorFromRequest(req)));
    }));

    return router;
}

export function createWorkflowRunRouter(automationRunService) {
    const router = express.Router();

    router.get('/:runId', asyncHandler(async (req, res) => {
        res.json(await automationRunService.getRun(req.params.runId, actorFromRequest(req)));
    }));

    router.post('/:runId/rerun', asyncHandler(async (req, res) => {
        const body = req.body || {};
        res.status(201).json(await automationRunService.rerun(req.params.runId, {
            actorId: actorFromRequest(req).person_id || actorFromRequest(req).sub || 'system',
            dryRun: Boolean(body.dry_run || body.dryRun)
        }, actorFromRequest(req)));
    }));

    router.post('/:runId/human-steps/:stepId/resolve', asyncHandler(async (req, res) => {
        res.json(await automationRunService.resolveHumanStep(req.params.stepId, {
            ...(req.body || {}),
            run_id: req.params.runId
        }, actorFromRequest(req)));
    }));

    return router;
}

export function createWorkflowHumanStepRouter(automationRunService) {
    const router = express.Router();

    router.post('/:stepId/resolve', asyncHandler(async (req, res) => {
        res.json(await automationRunService.resolveHumanStep(req.params.stepId, req.body || {}, actorFromRequest(req)));
    }));

    return router;
}
