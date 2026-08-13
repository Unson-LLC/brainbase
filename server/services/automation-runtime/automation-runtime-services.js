// @ts-check

import { AppError } from '../../lib/errors.js';
import { AutomationRunService } from '../automation-run/automation-run-service.js';
import { CompanionApprovalInboxService } from '../companion/approval-inbox-service.js';
import { MeetingAutomationService } from '../meeting-automation/meeting-automation-service.js';
import { MeetingTaskOwnerResolver } from '../meeting-automation/meeting-task-owner-resolver.js';
import { ProjectAccessPolicy } from '../project-access/project-access-policy.js';
import { RunReceiptQueryService } from '../run-receipt/query-service.js';
import { AutomationControlRuntime } from './automation-control-runtime.js';
import { AgentControlCatalogService } from './agent-control-catalog-service.js';
import {
    AutomationRuntimeDefaultsService,
    createBrainbaseAliveWorkflow
} from './automation-runtime-defaults-service.js';
import { LoopIntentService } from './loop-intent-service.js';

function assertActorCanResolveHumanStep(step, actor = {}) {
    const actorId = actor.person_id || actor.sub || null;
    if (actor.authSource === 'internal' || actorId === 'internal_api') return;
    if (['admin', 'ceo'].includes(String(actor.role || '').toLowerCase())) return;
    if (!actorId || actorId !== step.requested_to) {
        throw AppError.forbidden(`human step '${step.id}' is not assigned to this actor`);
    }
}

export function createAutomationRuntimeServices({
    repository,
    runner,
    configParser = null,
    googleCalendarService = null,
    infoSSOTService = null,
    canonicalTaskService = null,
    meetingKnowledgeEventBridge = null,
    meetingTaskOwnerResolver = null,
    projectAccessPolicy = null
}) {
    const accessPolicy = projectAccessPolicy || new ProjectAccessPolicy({ configParser });
    const controlRuntime = new AutomationControlRuntime({
        repository,
        projectAccessPolicy: accessPolicy
    });
    const agentControlCatalogService = new AgentControlCatalogService({ runtime: controlRuntime });
    const loopIntentService = new LoopIntentService({ runtime: controlRuntime });
    const ownerResolver = meetingTaskOwnerResolver || new MeetingTaskOwnerResolver({ infoSSOTService });
    const runReceiptQueryService = new RunReceiptQueryService({
        repository,
        prepareProjectAccess: () => accessPolicy.prepare(),
        assertProjectAccess: (projectId, actor) => accessPolicy.assertProjectAccess(projectId, actor),
        canAccessProject: (projectId, actor) => accessPolicy.canAccessProject(projectId, actor)
    });
    const meetingAutomationService = new MeetingAutomationService({
        repository,
        googleCalendarService,
        infoSSOTService,
        projectAccessPolicy: accessPolicy,
        createLoopIntent: (input, actor) => loopIntentService.create(input, actor),
        meetingKnowledgeEventBridge,
        meetingTaskOwnerResolver: ownerResolver
    });
    const automationRuntimeDefaultsService = new AutomationRuntimeDefaultsService({
        repository,
        createDefaultWorkflow: createBrainbaseAliveWorkflow
    });
    const automationRunService = new AutomationRunService({
        repository,
        runner,
        ensureDefaultWorkflows: () => automationRuntimeDefaultsService.ensure(),
        prepareProjectAccess: () => accessPolicy.prepare(),
        assertProjectSelectable: (projectId) => accessPolicy.assertProjectSelectable(projectId),
        assertProjectAccess: (projectId, actor) => accessPolicy.assertProjectAccess(projectId, actor),
        assertHumanStepAccess: assertActorCanResolveHumanStep,
        canonicalTaskService
    });
    const companionApprovalInboxService = new CompanionApprovalInboxService({
        repository,
        projectAccessPolicy: accessPolicy
    });

    return {
        agentControlCatalogService,
        loopIntentService,
        meetingAutomationService,
        automationRunService,
        runReceiptQueryService,
        companionApprovalInboxService,
        automationRuntimeDefaultsService,
        projectAccessPolicy: accessPolicy,
        meetingTaskOwnerResolver: ownerResolver
    };
}
