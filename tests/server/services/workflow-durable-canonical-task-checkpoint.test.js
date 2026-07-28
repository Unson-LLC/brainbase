import { describe, expect, it, vi } from 'vitest';

import {
    InMemoryWorkflowCheckpointRepository,
    PostgresWorkflowCheckpointRepository
} from '../../../server/services/workflow/workflow-checkpoint-repository.js';
import { AutomationRunService } from '../../../server/services/automation-run/automation-run-service.js';
import { createDefaultWorkflowHandlers } from '../../../server/services/automation-runtime/automation-runtime-defaults-service.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';

const ACTOR = {
    person_id: 'keigo',
    sub: 'keigo',
    role: 'admin',
    projectCodes: ['brainbase']
};

function seedWorkflow(repository) {
    repository.upsertWorkflow({
        id: 'wf-task-review',
        workspace_id: 'default',
        project_id: 'brainbase',
        name: 'Meeting Review Package Ingest',
        owner_id: 'keigo',
        implementation_key: 'meeting-review-package-ingest'
    });
    repository.createRun({
        id: 'run-task-review',
        workspace_id: 'default',
        project_id: 'brainbase',
        workflow_id: 'wf-task-review',
        status: 'waiting_human',
        closure_state: 'open',
        human_waiting: true,
        action_required: 'approve'
    });
    repository.createOutput({
        id: 'out-task-review',
        workspace_id: 'default',
        project_id: 'brainbase',
        workflow_id: 'wf-task-review',
        workflow_run_id: 'run-task-review',
        type: 'task_candidates',
        metadata: { write_back_target: 'task_store' },
        payload: [{ id: 'candidate-1', title: '正本Taskを作る', selected_owner_id: 'keigo' }]
    });
    repository.createHumanStep({
        id: 'human-task-review',
        workspace_id: 'default',
        project_id: 'brainbase',
        workflow_id: 'wf-task-review',
        workflow_run_id: 'run-task-review',
        requested_by: 'system',
        requested_to: 'keigo',
        status: 'pending',
        metadata: {
            write_back_target: 'task_store',
            output_id: 'out-task-review'
        }
    });
}

function makeIdempotentCanonicalTaskService() {
    const tasks = new Map();
    let createCount = 0;
    const materializeWorkflowApproval = vi.fn(async () => {
        const replayed = tasks.has('candidate-1');
        if (!replayed) {
            createCount += 1;
            tasks.set('candidate-1', 'ct1.task-1');
        }
        return {
            status: 'completed',
            task_ids: [tasks.get('candidate-1')],
            excluded_candidates: [],
            warnings: [],
            replayed
        };
    });
    return {
        materializeWorkflowApproval,
        get createCount() {
            return createCount;
        }
    };
}

function makeService({ repository, checkpointRepository, canonicalTaskService }) {
    return new AutomationRunService({
        repository,
        runner: new WorkflowRunner({ repository, handlers: createDefaultWorkflowHandlers() }),
        canonicalTaskService,
        checkpointRepository
    });
}

describe('Workflow durable Canonical Task checkpoint recovery', () => {
    it('recovers after Task creation without creating the Task again', async () => {
        const repository = new InMemoryWorkflowRepository();
        const checkpointRepository = new InMemoryWorkflowCheckpointRepository();
        const canonicalTaskService = makeIdempotentCanonicalTaskService();
        seedWorkflow(repository);

        const firstService = makeService({ repository, checkpointRepository, canonicalTaskService });
        const saveMaterialization = checkpointRepository.saveMaterialization.bind(checkpointRepository);
        vi.spyOn(checkpointRepository, 'saveMaterialization')
            .mockRejectedValueOnce(Object.assign(new Error('forced stop after Task creation'), { code: 'forced_stop' }))
            .mockImplementation(saveMaterialization);

        await expect(firstService.resolveHumanStep('human-task-review', {
            run_id: 'run-task-review',
            resolution: 'approved',
            response_ref: { source: 'mac_companion', decision_mode: 'approve' }
        }, ACTOR)).rejects.toMatchObject({ code: 'forced_stop' });

        expect(canonicalTaskService.createCount).toBe(1);
        expect(repository.getHumanStep('human-task-review').status).toBe('pending');

        const restartedService = makeService({ repository, checkpointRepository, canonicalTaskService });
        const [recovered] = await Promise.all([
            restartedService.getRun('run-task-review', ACTOR),
            restartedService.getRun('run-task-review', ACTOR)
        ]);

        expect(canonicalTaskService.createCount).toBe(1);
        expect(canonicalTaskService.materializeWorkflowApproval).toHaveBeenCalledTimes(2);
        expect(recovered.human_steps[0]).toMatchObject({
            status: 'approved',
            canonical_task_materialization: { task_ids: ['ct1.task-1'] }
        });
        expect(recovered.run).toMatchObject({
            status: 'success',
            closure_state: 'closed',
            human_waiting: false,
            action_required: 'none'
        });
    });

    it('reprojects a saved Task result during startup without invoking the provider', async () => {
        const repository = new InMemoryWorkflowRepository();
        const checkpointRepository = new InMemoryWorkflowCheckpointRepository();
        const canonicalTaskService = makeIdempotentCanonicalTaskService();
        seedWorkflow(repository);

        const firstService = makeService({ repository, checkpointRepository, canonicalTaskService });
        const updateHumanStep = repository.updateHumanStep.bind(repository);
        vi.spyOn(repository, 'updateHumanStep')
            .mockImplementationOnce(() => {
                throw Object.assign(new Error('forced stop before Workflow JSON projection'), { code: 'forced_stop' });
            })
            .mockImplementation(updateHumanStep);

        await expect(firstService.resolveHumanStep('human-task-review', {
            run_id: 'run-task-review',
            resolution: 'approved'
        }, ACTOR)).rejects.toMatchObject({ code: 'forced_stop' });

        expect(canonicalTaskService.createCount).toBe(1);
        expect(repository.getHumanStep('human-task-review').status).toBe('pending');

        const restartedService = makeService({ repository, checkpointRepository, canonicalTaskService });
        await restartedService.waitForCanonicalTaskCheckpointReconciliation();

        expect(canonicalTaskService.materializeWorkflowApproval).toHaveBeenCalledTimes(1);
        expect(repository.getHumanStep('human-task-review')).toMatchObject({
            status: 'approved',
            canonical_task_materialization: { task_ids: ['ct1.task-1'] }
        });
        expect(repository.getRun('run-task-review').status).toBe('success');

        await restartedService.getRun('run-task-review', ACTOR);
        const materializationAudits = repository.listAuditLogs({ targetId: 'run-task-review', limit: 100 })
            .filter((entry) => entry.action === 'workflow.canonical_tasks.materialized');
        expect(materializationAudits).toHaveLength(1);
        expect(materializationAudits[0].id).toBe('canonical-task:1:tasks_materialized');
    });
});

describe('PostgresWorkflowCheckpointRepository', () => {
    it('persists the claim, projection targets, audit checkpoint, and completed phase', async () => {
        const preparedCheckpoint = {
            phase: 'human_step_claimed',
            workflow_run_id: 'run-task-review',
            human_step_id: 'human-task-review',
            human_step_claim: { response_ref: { source: 'mac_companion' } },
            post_processing_phase: 'not_started'
        };
        const projectedCheckpoint = {
            ...preparedCheckpoint,
            phase: 'tasks_materialized',
            human_step_target: { status: 'approved' },
            run_target: { status: 'success' },
            audit_checkpoint: { ids: ['canonical-task:41:tasks_materialized'] },
            post_processing_phase: 'pending'
        };
        const completedCheckpoint = {
            ...projectedCheckpoint,
            phase: 'completed',
            post_processing_phase: 'completed'
        };
        const row = (state, resultJson, recoveryCheckpoint) => ({
            id: 41,
            scope: 'workflow-task-materialization',
            operation_key: 'workflow:human-task-review',
            fingerprint: 'fingerprint-1',
            state,
            result_json: resultJson,
            authorization_snapshot: { person_id: 'keigo' },
            recovery_checkpoint: recoveryCheckpoint
        });
        const checkpointQuery = vi.fn()
            .mockResolvedValueOnce({ rowCount: 1, rows: [row('prepared', null, preparedCheckpoint)] })
            .mockResolvedValueOnce({
                    rowCount: 1,
                    rows: [row('prepared', { task_ids: ['ct1.task-1'] }, projectedCheckpoint)]
            })
            .mockResolvedValueOnce({
                    rowCount: 1,
                    rows: [row('completed', { task_ids: ['ct1.task-1'] }, completedCheckpoint)]
            });
        const client = {
            query: vi.fn(async (sql, values) => {
                if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0, rows: [] };
                return checkpointQuery(sql, values);
            }),
            release: vi.fn()
        };
        const pool = {
            connect: vi.fn().mockResolvedValue(client)
        };
        const operationRepository = {
            pool,
            writerToken: 'writer-1',
            assertWriter: vi.fn().mockResolvedValue(undefined)
        };
        const repository = new PostgresWorkflowCheckpointRepository({ operationRepository });

        const prepared = await repository.prepare({
            operationKey: 'workflow:human-task-review',
            fingerprint: 'fingerprint-1',
            authorizationSnapshot: { person_id: 'keigo' },
            recoveryCheckpoint: preparedCheckpoint
        });
        const materialized = await repository.saveMaterialization({
            operationKey: 'workflow:human-task-review',
            fingerprint: 'fingerprint-1',
            materialization: { task_ids: ['ct1.task-1'] },
            recoveryCheckpoint: projectedCheckpoint
        });
        const completed = await repository.markCompleted({
            operationKey: 'workflow:human-task-review',
            fingerprint: 'fingerprint-1',
            recoveryCheckpoint: completedCheckpoint
        });

        expect(operationRepository.assertWriter).toHaveBeenCalledTimes(3);
        expect(prepared.recovery_checkpoint.human_step_claim).toBeTruthy();
        expect(materialized).toMatchObject({
            result_json: { task_ids: ['ct1.task-1'] },
            recovery_checkpoint: {
                human_step_target: { status: 'approved' },
                run_target: { status: 'success' },
                audit_checkpoint: { ids: ['canonical-task:41:tasks_materialized'] },
                post_processing_phase: 'pending'
            }
        });
        expect(completed).toMatchObject({
            state: 'completed',
            recovery_checkpoint: { phase: 'completed', post_processing_phase: 'completed' }
        });
        expect(operationRepository.assertWriter).toHaveBeenNthCalledWith(1, client);
        expect(JSON.parse(checkpointQuery.mock.calls[0][1][5])).toEqual(preparedCheckpoint);
        expect(JSON.parse(checkpointQuery.mock.calls[1][1][4])).toEqual({ task_ids: ['ct1.task-1'] });
        expect(JSON.parse(checkpointQuery.mock.calls[1][1][5])).toEqual(projectedCheckpoint);
        expect(JSON.parse(checkpointQuery.mock.calls[2][1][4])).toEqual(completedCheckpoint);
        expect(client.release).toHaveBeenCalledTimes(3);
    });
});
