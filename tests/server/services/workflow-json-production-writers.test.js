import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EveMeetingNoteReconciler } from '../../../server/services/external-runner/eve-meeting-note-reconciler.js';
import {
    JsonFileWorkflowRepository
} from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';
import {
    WorkflowService,
    createDefaultWorkflowHandlers
} from '../../../server/services/workflow/workflow-service.js';

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
                projects: [{ id: 'salestailor', session_select: true }]
            };
        }
    };
    const service = new WorkflowService({ repository, runner, configParser });
    const actor = {
        sub: 'keigo',
        person_id: 'keigo',
        role: 'admin',
        projectCodes: ['salestailor']
    };
    return { service, actor };
}

describe('production workflow shared-ledger writers', () => {
    it('persists WorkflowService CRUD groups atomically through the JSON repository', async () => {
        const { filePath, repository } = makeRepository();
        const { service, actor } = makeService(repository);

        await service.ensureDefaultWorkflows();
        await service.createWorkflow({
            id: 'wf-production-writer',
            project_id: 'salestailor',
            name: 'Production writer smoke test',
            implementation_key: 'brainbase_alive'
        }, actor);
        await service.updateWorkflow('wf-production-writer', { description: 'updated' }, actor);
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
        expect(reloaded.getWorkflow('wf-production-writer')).toMatchObject({ description: 'updated' });
        expect(reloaded.getRoleAgentInstance('rai-production-writer')).toBeTruthy();
        expect(reloaded.getWorkflowTemplate('wft-production-writer')).toBeTruthy();
        expect(reloaded.getWorkflowBinding('wfb-production-writer')).toBeTruthy();
        expect(reloaded.getWorkflowTrigger('wftg-production-writer')).toBeTruthy();
        expect(reloaded.getLoopIntent('loop-production-writer')).toBeTruthy();
        expect(reloaded.listAuditLogs({ limit: 100 }).map((entry) => entry.action)).toEqual(expect.arrayContaining([
            'workflow.created',
            'workflow.updated',
            'workflow.role_agent_instance.upserted',
            'workflow.template.upserted',
            'workflow.binding.upserted',
            'workflow.trigger.upserted',
            'workflow.loop_intent.created'
        ]));
    });

    it('persists Eve reconciler run and audit changes in one JSON transaction', async () => {
        const { filePath, repository } = makeRepository();
        await repository.transaction(() => {
            repository.createRun({
                id: 'run-eve-reconcile-json',
                workspace_id: 'brainbase',
                org_id: 'salestailor',
                project_id: 'salestailor',
                workflow_id: 'wf-eve-dispatch',
                workflow_name: 'Eve dispatch',
                status: 'running',
                env: 'eve',
                metadata: {
                    meeting_note_generation: { run_id: 'run-ingest', source_text_hash: 'hash-1' },
                    runner: { session_id: 'eve-session-1' }
                }
            });
        });
        const reconciler = new EveMeetingNoteReconciler({
            repository,
            workflowService: { repository },
            eveSessionClient: {
                isConfigured: () => true,
                readSessionStream: async () => [{ type: 'session.completed' }]
            },
            clock: () => '2026-07-15T00:00:00.000Z'
        });

        const result = await reconciler.runOnce();

        expect(result.blocked).toBe(1);
        const reloaded = new JsonFileWorkflowRepository({ filePath });
        expect(reloaded.getRun('run-eve-reconcile-json')).toMatchObject({
            status: 'blocked',
            action_required: 'operator_review_eve_session'
        });
        expect(reloaded.listAuditLogs({ limit: 100 })).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: 'workflow.meeting_pack.note_generation.reconcile_blocked',
                target_id: 'run-eve-reconcile-json'
            })
        ]));
    });
});
