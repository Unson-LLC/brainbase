// @ts-check

/** Public boundary for agent, template, binding, and trigger catalog operations. */
export class AgentControlCatalogService {
    constructor({ runtime }) {
        this.runtime = runtime;
    }

    listRoleAgentInstances(...args) { return this.runtime.listRoleAgentInstances(...args); }
    createRoleAgentInstance(...args) { return this.runtime.createRoleAgentInstance(...args); }
    listWorkflowTemplates(...args) { return this.runtime.listWorkflowTemplates(...args); }
    createWorkflowTemplate(...args) { return this.runtime.createWorkflowTemplate(...args); }
    listWorkflowBindings(...args) { return this.runtime.listWorkflowBindings(...args); }
    createWorkflowBinding(...args) { return this.runtime.createWorkflowBinding(...args); }
    listWorkflowTriggers(...args) { return this.runtime.listWorkflowTriggers(...args); }
    createWorkflowTrigger(...args) { return this.runtime.createWorkflowTrigger(...args); }
}
