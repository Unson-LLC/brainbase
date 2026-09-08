import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    JsonFileWorkflowRepository
} from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';
import {
    TestAutomationRuntime,
    createDefaultWorkflowHandlers
} from '../../helpers/test-automation-runtime.js';

const tempDirectories = [];

afterEach(() => {
    while (tempDirectories.length) {
        fs.rmSync(tempDirectories.pop(), { recursive: true, force: true });
    }
});

function makeRepository() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-workflow-writers-'));
    tempDirectories.push(directory);
    const filePath = path.join(directory, 'workflow-ledger.json');
    return {
        filePath,
        repository: new JsonFileWorkflowRepository({ filePath })
    };
}

function makeService(repository) {
    const runner = new WorkflowRunner({
        repository,
        handlers: createDefaultWorkflowHandlers()
    });
    const configParser = {
        async getProjects() {
            return {
                root: '/workspace',
                source: { status: 'loaded', mode: 'registry_scoped' },
                projects: [{ id: 'salestailor', session_select: true }]
            };
        }
    };
    const service = new TestAutomationRuntime({ repository, runner, configParser });
    const actor = {
        sub: 'keigo',
        person_id: 'keigo',
        role: 'admin',
        projectCodes: ['salestailor'],
        organizationId: 'salestailor'
    };
    return { service, actor };
}

describe('production workflow shared-ledger writers', () => {
    it('persists Workflow Control groups atomically through the JSON repository', async () => {
        const { filePath, repository } = makeRepository();
        const { service, actor } = makeService(repository);

        await service.ensureDefaultWorkflows();
        await service.createRoleAgentInstance({
            id: 'rai-production-writer',
            org_id: 'salestailor',
            project_id: 'salestailor',
            role_archetype_id: 'sales'
        }, actor);
        await service.createWorkflowTemplate({
            id: 'wft-production-writer',
            name: 'Production writer template'
        }, actor);
        await service.createWorkflowBinding({
            id: 'wfb-production-writer',
            org_id: 'salestailor',
            project_id: 'salestailor',
            role_agent_instance_id: 'rai-production-writer',
            workflow_template_id: 'wft-production-writer'
        }, actor);
        await service.createWorkflowTrigger({
            id: 'wftg-production-writer',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'wfb-production-writer'
        }, actor);
        await service.createLoopIntent({
            id: 'loop-production-writer',
            org_id: 'salestailor',
            project_id: 'salestailor',
            workflow_binding_id: 'wfb-production-writer',
            trigger_id: 'wftg-production-writer'
        }, actor);

        const reloaded = new JsonFileWorkflowRepository({ filePath });
        expect(reloaded.getWorkflow('brainbase-alive')).toBeTruthy();
        expect(reloaded.getRoleAgentInstance('rai-production-writer')).toBeTruthy();
        expect(reloaded.getWorkflowTemplate('wft-production-writer')).toBeTruthy();
        expect(reloaded.getWorkflowBinding('wfb-production-writer')).toBeTruthy();
        expect(reloaded.getWorkflowTrigger('wftg-production-writer')).toBeTruthy();
        expect(reloaded.getLoopIntent('loop-production-writer')).toBeTruthy();
        expect(reloaded.listAuditLogs({ limit: 100 }).map((entry) => entry.action)).toEqual(expect.arrayContaining([
            'workflow.role_agent_instance.upserted',
            'workflow.template.upserted',
            'workflow.binding.upserted',
            'workflow.trigger.upserted',
            'workflow.loop_intent.created'
        ]));
    });

});
