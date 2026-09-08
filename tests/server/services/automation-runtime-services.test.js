import { describe, expect, it } from 'vitest';

import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';
import { createAutomationRuntimeServices } from '../../../server/services/automation-runtime/automation-runtime-services.js';

function makeRuntime(overrides = {}) {
    const repository = new InMemoryWorkflowRepository();
    const runner = new WorkflowRunner({ repository, handlers: new Map() });
    const projectAccessPolicy = {
        prepare: async () => {},
        assertProjectSelectable: async () => {},
        assertOrgReferenceAllowed: () => {},
        assertProjectAccess: () => {},
        canAccessProject: () => true
    };
    return createAutomationRuntimeServices({ repository, runner, projectAccessPolicy, ...overrides });
}

describe('createAutomationRuntimeServices', () => {
    it('生成時_CatalogとLoopIntentを別serviceとして返す', () => {
        const runtime = makeRuntime();

        expect(runtime.agentControlCatalogService).toBeDefined();
        expect(runtime.loopIntentService).toBeDefined();
        expect(runtime.eveSessionDispatchService).toBeUndefined();
        expect(runtime.meetingAutomationService).toBeDefined();
        expect(runtime.automationRunService).toBeDefined();
        expect(runtime.agentControlCatalogService).not.toBe(runtime.loopIntentService);
        expect(runtime.agentControlCatalogService).not.toBe(runtime.loopIntentService);
    });

    it('生成時_Companion承認Inboxを専用read serviceとして返す', () => {
        const runtime = makeRuntime();

        expect(runtime.companionApprovalInboxService).toBeDefined();
        expect(typeof runtime.companionApprovalInboxService.list).toBe('function');
        expect(runtime.agentControlCatalogService.listCompanionApprovalInbox).toBeUndefined();
    });

    it('生成時_Canonical Task serviceをAutomationRunへ同一instanceで注入する', () => {
        const canonicalTaskService = {
            materializeWorkflowApproval: async () => ({ status: 'completed' })
        };
        const runtime = makeRuntime({ canonicalTaskService });

        expect(runtime.automationRunService.canonicalTaskService).toBe(canonicalTaskService);
    });

    it('生成時_Company Authority human approval serviceをAutomationRunへ同一instanceで注入する', () => {
        const companyAuthorityHumanApprovalService = {
            isBound: () => false,
            resolve: async () => null
        };
        const runtime = makeRuntime({ companyAuthorityHumanApprovalService });

        expect(runtime.companyAuthorityHumanApprovalService).toBe(companyAuthorityHumanApprovalService);
        expect(runtime.automationRunService.companyAuthorityHumanApprovalService)
            .toBe(companyAuthorityHumanApprovalService);
    });

    it('生成時_RunReceipt queryをAgentLoopから分離して返す', () => {
        const runtime = makeRuntime();

        expect(runtime.runReceiptQueryService).toBeDefined();
        expect(runtime.loopIntentService.runReceiptQueryService).toBeUndefined();
    });

    it('生成時_旧WorkflowとAgentLoopのservice境界を返さない', () => {
        const runtime = makeRuntime();

        expect(runtime.workflowService).toBeUndefined();
        expect(runtime.agentLoopControlService).toBeUndefined();
        expect(runtime.automationRuntimeDefaultsService).toBeDefined();
    });
});
