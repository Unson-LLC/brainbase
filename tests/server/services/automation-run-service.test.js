import { describe, expect, it, vi } from 'vitest';

import { AutomationRunService } from '../../../server/services/automation-run/automation-run-service.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';

function makeService() {
    const repository = new InMemoryWorkflowRepository();
    const runner = {
        runWorkflow: vi.fn(async (workflow, options) => ({ workflow, options, run: { id: 'retry-run', status: 'success' } }))
    };
    const service = new AutomationRunService({
        repository,
        runner,
        ensureDefaultWorkflows: async () => {},
        prepareProjectAccess: async () => {},
        assertProjectSelectable: async () => {},
        assertProjectAccess: () => {},
        assertHumanStepAccess: () => {}
    });
    return { repository, runner, service };
}

function seedWorkflow(repository, overrides = {}) {
    return repository.upsertWorkflow({
        id: 'workflow-1',
        workspace_id: 'default',
        project_id: 'brainbase',
        name: 'Automation Run',
        enabled: true,
        implementation_key: 'manual-placeholder',
        ...overrides
    });
}

function seedRun(repository, overrides = {}) {
    return repository.createRun({
        id: 'run-1',
        workspace_id: 'default',
        project_id: 'brainbase',
        workflow_id: 'workflow-1',
        workflow_name: 'Automation Run',
        status: 'waiting_human',
        closure_state: 'open',
        env: 'local',
        ...overrides
    });
}

describe('AutomationRunService', () => {
    it('getRun呼び出し時_runと実行証跡が一つの詳細として返される', async () => {
        const { repository, service } = makeService();
        seedWorkflow(repository);
        seedRun(repository);
        repository.createOutput({ id: 'output-1', workflow_run_id: 'run-1', type: 'summary' });

        const result = await service.getRun('run-1', { person_id: 'keigo' });

        expect(result.run).toMatchObject({ id: 'run-1' });
        expect(result.outputs).toEqual([expect.objectContaining({ id: 'output-1' })]);
    });

    it('rerun呼び出し時_元runをparentにしたretryとして実行される', async () => {
        const { repository, runner, service } = makeService();
        seedWorkflow(repository);
        seedRun(repository, { status: 'failed', closure_state: 'closed', env: 'runner' });

        await service.rerun('run-1', { input: { retry: true } }, {
            person_id: 'keigo',
            projectCodes: ['brainbase'],
            role: 'admin'
        });

        expect(runner.runWorkflow).toHaveBeenCalledWith(expect.objectContaining({ id: 'workflow-1' }), expect.objectContaining({
            parentRunId: 'run-1',
            triggerType: 'retry',
            env: 'runner',
            input: { retry: true }
        }));
    });

    it('resolveHumanStep呼び出し時_承認専用runを新規runなしで完了する', async () => {
        const { repository, runner, service } = makeService();
        seedWorkflow(repository, { implementation_key: 'meeting-review-package-ingest' });
        seedRun(repository);
        repository.createHumanStep({
            id: 'human-1',
            workflow_run_id: 'run-1',
            workflow_id: 'workflow-1',
            workspace_id: 'default',
            project_id: 'brainbase',
            status: 'pending',
            requested_to: 'keigo'
        });

        const result = await service.resolveHumanStep('human-1', { resolution: 'approved' }, { person_id: 'keigo' });

        expect(result.human_step).toMatchObject({ id: 'human-1', status: 'approved' });
        expect(result.resumed_run).toMatchObject({ id: 'run-1', status: 'success', closure_state: 'closed' });
        expect(runner.runWorkflow).not.toHaveBeenCalled();
    });
});
