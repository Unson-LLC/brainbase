import { createAutomationRuntimeServices } from '../../server/services/automation-runtime/automation-runtime-services.js';

export {
    createBrainbaseAliveWorkflow,
    createDefaultWorkflowHandlers
} from '../../server/services/automation-runtime/automation-runtime-defaults-service.js';

const CATALOG_METHODS = new Set([
    'listRoleAgentInstances', 'createRoleAgentInstance',
    'listWorkflowTemplates', 'createWorkflowTemplate',
    'listWorkflowBindings', 'createWorkflowBinding',
    'listWorkflowTriggers', 'createWorkflowTrigger'
]);

export class TestAutomationRuntime {
    constructor(options) {
        const runtime = createAutomationRuntimeServices(options);
        return new Proxy(runtime, {
            get(target, property, receiver) {
                if (property === 'listCompanionApprovalInbox') {
                    return target.companionApprovalInboxService.list.bind(target.companionApprovalInboxService);
                }
                if (property === 'ensureDefaultWorkflows') {
                    return target.automationRuntimeDefaultsService.ensure.bind(target.automationRuntimeDefaultsService);
                }
                if (Reflect.has(target, property)) return Reflect.get(target, property, receiver);
                if (CATALOG_METHODS.has(property)) {
                    return target.agentControlCatalogService[property].bind(target.agentControlCatalogService);
                }
                if (property === 'listLoopIntents') return target.loopIntentService.list.bind(target.loopIntentService);
                if (property === 'createLoopIntent') return target.loopIntentService.create.bind(target.loopIntentService);
                if (property === 'dispatchLoopIntentToEve') return target.eveSessionDispatchService.dispatch.bind(target.eveSessionDispatchService);
                return undefined;
            }
        });
    }
}
