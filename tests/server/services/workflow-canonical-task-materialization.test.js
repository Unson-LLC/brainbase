import { describe, expect, it, vi } from 'vitest';

import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';
import {
    WorkflowService,
    createDefaultWorkflowHandlers
} from '../../../server/services/workflow/workflow-service.js';

function makeHarness(materializeWorkflowApproval) {
    const repository = new InMemoryWorkflowRepository();
    const service = new WorkflowService({
        repository,
        runner: new WorkflowRunner({ repository, handlers: createDefaultWorkflowHandlers() }),
        configParser: {
            async getProjects() {
                return { root: '/workspace', projects: [{ id: 'brainbase', session_select: true }] };
            }
        },
        canonicalTaskService: { materializeWorkflowApproval }
    });
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
    return {
        repository,
        service,
        actor: { person_id: 'keigo', sub: 'keigo', role: 'admin', projectCodes: ['brainbase'] }
    };
}

describe('WorkflowService Canonical Task materialization', () => {
    it('keeps the human step pending when Canonical Task materialization fails', async () => {
        const materializeWorkflowApproval = vi.fn().mockRejectedValue(Object.assign(
            new Error('Task store unavailable'),
            { code: 'task_store_unavailable', status: 503 }
        ));
        const { repository, service, actor } = makeHarness(materializeWorkflowApproval);

        await expect(service.resolveHumanStep('human-task-review', {
            run_id: 'run-task-review',
            resolution: 'approved'
        }, actor)).rejects.toMatchObject({ code: 'task_store_unavailable' });

        expect(repository.getHumanStep('human-task-review').status).toBe('pending');
        expect(repository.getRun('run-task-review').status).toBe('waiting_human');
    });

    it('returns materialized Task IDs and only then approves the human step', async () => {
        const materializeWorkflowApproval = vi.fn().mockResolvedValue({
            status: 'completed',
            task_ids: ['ct1.task-1'],
            excluded_candidates: [],
            warnings: [],
            replayed: false
        });
        const { repository, service, actor } = makeHarness(materializeWorkflowApproval);

        const result = await service.resolveHumanStep('human-task-review', {
            run_id: 'run-task-review',
            resolution: 'approved',
            response_ref: {
                source: 'mac_companion',
                decision_mode: 'approve',
                review_items: [{ candidate_id: 'candidate-1', resolution: 'approved', edited_fields: [] }]
            }
        }, actor);

        expect(materializeWorkflowApproval).toHaveBeenCalledWith(expect.objectContaining({
            step: expect.objectContaining({ id: 'human-task-review' }),
            output: expect.objectContaining({ id: 'out-task-review' }),
            responseRef: expect.objectContaining({ source: 'mac_companion' }),
            actor
        }));
        expect(result).toMatchObject({
            human_step: { status: 'approved' },
            materialized_task_ids: ['ct1.task-1'],
            materialization: { status: 'completed', replayed: false }
        });
        expect(repository.getHumanStep('human-task-review').status).toBe('approved');
    });

    it('replays the materialization result after an approved response was lost', async () => {
        const materializeWorkflowApproval = vi.fn().mockResolvedValue({
            status: 'completed',
            task_ids: ['ct1.task-1'],
            excluded_candidates: [],
            warnings: [],
            replayed: true
        });
        const { repository, service, actor } = makeHarness(materializeWorkflowApproval);
        repository.updateHumanStep('human-task-review', { status: 'approved' });

        const result = await service.resolveHumanStep('human-task-review', {
            run_id: 'run-task-review',
            resolution: 'approved'
        }, actor);

        expect(result.materialized_task_ids).toEqual(['ct1.task-1']);
        expect(result.materialization.replayed).toBe(true);
        expect(materializeWorkflowApproval).toHaveBeenCalledTimes(1);
    });

    it('surface.workflow.get-run-reconcile persists materialization on the human step', async () => {
        const materializeWorkflowApproval = vi.fn().mockResolvedValue({
            status: 'completed',
            task_ids: ['ct1.task-1'],
            excluded_candidates: [],
            warnings: [],
            replayed: false
        });
        const { service, actor } = makeHarness(materializeWorkflowApproval);

        await service.resolveHumanStep('human-task-review', {
            run_id: 'run-task-review',
            resolution: 'approved'
        }, actor);
        const run = await service.getRun('run-task-review', actor);

        expect(run.human_steps[0]).toMatchObject({
            id: 'human-task-review',
            status: 'approved',
            canonical_task_materialization: {
                status: 'completed',
                task_ids: ['ct1.task-1']
            }
        });
        expect(run.audit_logs).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'audit_canonical_task_materialization_human-task-review',
                action: 'workflow.canonical_tasks.materialized'
            })
        ]));
    });

    it('surface.workflow.retry-reconcile returns the persisted phase without another write', async () => {
        const materializeWorkflowApproval = vi.fn().mockResolvedValue({
            status: 'completed',
            task_ids: ['ct1.task-1'],
            excluded_candidates: [],
            warnings: [],
            replayed: false
        });
        const { service, actor } = makeHarness(materializeWorkflowApproval);

        await service.resolveHumanStep('human-task-review', {
            run_id: 'run-task-review',
            resolution: 'approved'
        }, actor);
        const replay = await service.resolveHumanStep('human-task-review', {
            run_id: 'run-task-review',
            resolution: 'approved'
        }, actor);

        expect(replay.materialized_task_ids).toEqual(['ct1.task-1']);
        expect(replay.materialization).toMatchObject({ status: 'completed' });
        expect(materializeWorkflowApproval).toHaveBeenCalledTimes(1);
    });

    it('surface.workflow.audit-idempotency records one materialization audit across retries', async () => {
        const materializeWorkflowApproval = vi.fn().mockResolvedValue({
            status: 'completed',
            task_ids: ['ct1.task-1'],
            excluded_candidates: [],
            warnings: [],
            replayed: false
        });
        const { repository, service, actor } = makeHarness(materializeWorkflowApproval);

        await service.resolveHumanStep('human-task-review', {
            run_id: 'run-task-review',
            resolution: 'approved'
        }, actor);
        await service.resolveHumanStep('human-task-review', {
            run_id: 'run-task-review',
            resolution: 'approved'
        }, actor);

        const audits = repository.listAuditLogs({ targetId: 'run-task-review', limit: 100 })
            .filter((entry) => entry.action === 'workflow.canonical_tasks.materialized');
        expect(audits).toHaveLength(1);
        expect(audits[0].after).toMatchObject({
            human_step_id: 'human-task-review',
            task_ids: ['ct1.task-1']
        });
    });
});
