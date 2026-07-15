import { describe, expect, it, vi } from 'vitest';

import { CanonicalTaskService } from '../../../server/services/companion/canonical-task-service.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';
import {
    WorkflowService,
    createDefaultWorkflowHandlers
} from '../../../server/services/workflow/workflow-service.js';

function makeHarness(materializeWorkflowApproval, { payload } = {}) {
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
        payload: payload || [{ id: 'candidate-1', title: '正本Taskを作る', selected_owner_id: 'keigo' }]
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

    it('AC-20 fails closed when top-level decision_mode and resolution disagree', async () => {
        const materializeWorkflowApproval = vi.fn();
        const { repository, service, actor } = makeHarness(materializeWorkflowApproval);

        await expect(service.resolveHumanStep('human-task-review', {
            run_id: 'run-task-review',
            resolution: 'approved',
            response_ref: {
                decision_mode: 'requestChanges',
                resolution: 'needs_changes',
                review_items: [{
                    candidate_id: 'candidate-1',
                    decision_mode: 'requestChanges',
                    resolution: 'needs_changes',
                    edited_fields: []
                }]
            }
        }, actor)).rejects.toMatchObject({ code: 'inconsistent_approval_decision', statusCode: 422 });

        expect(materializeWorkflowApproval).not.toHaveBeenCalled();
        expect(repository.getHumanStep('human-task-review').status).toBe('pending');
    });

    it('AC-20 fails closed when a candidate decision pair disagrees', async () => {
        const materializeWorkflowApproval = vi.fn();
        const { repository, service, actor } = makeHarness(materializeWorkflowApproval);

        await expect(service.resolveHumanStep('human-task-review', {
            run_id: 'run-task-review',
            resolution: 'approved',
            response_ref: {
                decision_mode: 'approve',
                resolution: 'approved',
                review_items: [{
                    candidate_id: 'candidate-1',
                    decision_mode: 'reject',
                    resolution: 'approved',
                    edited_fields: []
                }]
            }
        }, actor)).rejects.toMatchObject({ code: 'inconsistent_approval_decision', statusCode: 422 });

        expect(materializeWorkflowApproval).not.toHaveBeenCalled();
        expect(repository.getHumanStep('human-task-review').status).toBe('pending');
    });

    it.each([
        ['unknown', [
            { candidate_id: 'candidate-1', resolution: 'approved' },
            { candidate_id: 'candidate-unknown', resolution: 'approved' }
        ]],
        ['duplicate', [
            { candidate_id: 'candidate-1', resolution: 'approved' },
            { candidate_id: 'candidate-1', resolution: 'approved' }
        ]],
        ['missing', [
            { candidate_id: 'candidate-1', resolution: 'approved' }
        ]]
    ])('AC-20 fails closed for %s candidate mapping', async (_case, reviewItems) => {
        const materializeWorkflowApproval = vi.fn();
        const { repository, service, actor } = makeHarness(materializeWorkflowApproval, {
            payload: [
                { id: 'candidate-1', title: 'Task 1', selected_owner_id: 'keigo' },
                { id: 'candidate-2', title: 'Task 2', selected_owner_id: 'keigo' }
            ]
        });

        await expect(service.resolveHumanStep('human-task-review', {
            run_id: 'run-task-review',
            response_ref: {
                decision_mode: 'approve',
                resolution: 'approved',
                review_items: reviewItems
            }
        }, actor)).rejects.toMatchObject({ code: 'inconsistent_approval_decision', statusCode: 422 });

        expect(materializeWorkflowApproval).not.toHaveBeenCalled();
        expect(repository.getHumanStep('human-task-review').status).toBe('pending');
    });

    it('AC-20 keeps the step pending with 409 when top-level authority requests changes', async () => {
        const materializeWorkflowApproval = vi.fn();
        const { repository, service, actor } = makeHarness(materializeWorkflowApproval);

        await expect(service.resolveHumanStep('human-task-review', {
            run_id: 'run-task-review',
            response_ref: {
                decision_mode: 'requestChanges',
                review_items: [{
                    candidate_id: 'candidate-1',
                    decision_mode: 'requestChanges',
                    resolution: 'needs_changes',
                    edited_fields: []
                }]
            }
        }, actor)).rejects.toMatchObject({ code: 'CONFLICT', statusCode: 409 });

        expect(materializeWorkflowApproval).not.toHaveBeenCalled();
        expect(repository.getHumanStep('human-task-review').status).toBe('pending');
    });

    it('AC-25 keeps generated candidate IDs and downstream operation keys stable across reorder', async () => {
        const tasksByKey = new Map();
        const repository = {
            findByIdempotencyKey: vi.fn(async (key) => tasksByKey.get(key) || null),
            create: vi.fn(async (input) => {
                const task = {
                    ...input,
                    id: `task-${tasksByKey.size + 1}`,
                    completed_at: null,
                    web_url: null
                };
                tasksByKey.set(input.idempotency_key, task);
                return task;
            })
        };
        const canonicalTaskService = new CanonicalTaskService({
            repository,
            readiness: { assertMutationReady: vi.fn() },
            operationRepository: { execute: vi.fn(async ({ run }) => run()) },
            auditRepository: { upsertAuditLog: vi.fn(async entry => entry) },
            infoSSOTService: {
                listGraphEntities: vi.fn(async (_access, { id }) => [{
                    entity_id: id,
                    entity_type: 'person',
                    payload: { person_id: id, display_name: id }
                }])
            },
            ownerPersonId: 'keigo'
        });
        const materializeWorkflowApproval = vi.fn(
            canonicalTaskService.materializeWorkflowApproval.bind(canonicalTaskService)
        );
        const duplicate = {
            title: '  同じTask  ',
            description: ' 同じ説明 ',
            selected_owner_id: 'keigo',
            evidence_refs: [{ type: 'meeting', id: 'm2' }, { id: 'm1', type: 'meeting' }]
        };
        const another = { title: '別Task', selected_owner_id: 'keigo', priority: 'high' };
        const firstHarness = makeHarness(materializeWorkflowApproval, {
            payload: [duplicate, another, { ...duplicate }]
        });
        const secondHarness = makeHarness(materializeWorkflowApproval, {
            payload: [{ ...duplicate }, { ...duplicate }, another]
        });

        const first = await firstHarness.service.resolveHumanStep('human-task-review', {
            run_id: 'run-task-review',
            resolution: 'approved'
        }, firstHarness.actor);
        const firstCandidates = materializeWorkflowApproval.mock.calls[0][0].output.payload;
        const firstKeys = [...tasksByKey.keys()].sort();
        const second = await secondHarness.service.resolveHumanStep('human-task-review', {
            run_id: 'run-task-review',
            resolution: 'approved'
        }, secondHarness.actor);
        const secondCandidates = materializeWorkflowApproval.mock.calls[1][0].output.payload;

        expect(firstCandidates.map((candidate) => candidate.candidate_id)).toEqual(
            secondCandidates.map((candidate) => candidate.candidate_id)
        );
        expect(firstCandidates.map((candidate) => candidate.candidate_id)).toEqual(expect.arrayContaining([
            expect.stringMatching(/^workflow-output:out-task-review:candidate:[a-f0-9]{64}:1$/),
            expect.stringMatching(/^workflow-output:out-task-review:candidate:[a-f0-9]{64}:2$/)
        ]));
        expect([...tasksByKey.keys()].sort()).toEqual(firstKeys);
        expect(repository.create).toHaveBeenCalledTimes(3);
        expect(second.materialized_task_ids).toEqual(first.materialized_task_ids);
        expect(second.materialization.replayed).toBe(true);
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
