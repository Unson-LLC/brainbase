import { describe, expect, it, vi } from 'vitest';

import { AutomationRunService } from '../../../server/services/automation-run/automation-run-service.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../../../server/services/workflow/workflow-runner.js';

const workflow = {
    id: 'company-authority-resume',
    workspace_id: 'default',
    project_id: 'project-company-authority',
    name: 'Company Authority resume',
    enabled: true,
    implementation_key: 'company-authority-resume',
    context_sources: [],
    hitl_policy: 'none'
};

function seedWaitingRun(repository, { marker = undefined } = {}) {
    repository.createRun({
        id: 'run-company-authority',
        workspace_id: workflow.workspace_id,
        project_id: workflow.project_id,
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        status: 'waiting_human',
        closure_state: 'open',
        human_waiting: true,
        action_required: 'approve',
        started_by: 'requester'
    });
    return repository.createHumanStep({
        id: 'human-company-authority',
        workspace_id: workflow.workspace_id,
        project_id: workflow.project_id,
        workflow_run_id: 'run-company-authority',
        workflow_id: workflow.id,
        requested_by: 'requester',
        requested_to: 'approver',
        ...(marker === undefined ? {} : {
            metadata: { company_authority_human_approval: marker }
        })
    });
}

function makeService({ companyAuthorityHumanApprovalService = null, events = [] } = {}) {
    const repository = new InMemoryWorkflowRepository({ seedWorkflows: [workflow] });
    const runner = new WorkflowRunner({
        repository,
        handlers: {
            [workflow.implementation_key]: vi.fn(async (context) => {
                events.push({ type: 'handler', actorId: context.actorId });
                return { status: 'success', closureState: 'closed', message: 'resumed' };
            })
        }
    });
    const service = new AutomationRunService({
        repository,
        runner,
        ensureDefaultWorkflows: async () => {},
        prepareProjectAccess: async () => {},
        assertProjectSelectable: async () => {},
        assertProjectAccess: () => {},
        assertHumanStepAccess: () => {},
        companyAuthorityHumanApprovalService
    });
    return { repository, runner, service };
}

describe('AutomationRunService Company Authority human approval wiring', () => {
    it('marker付きstepだけapproval receiptを検証してから、approver実行・original requester保持でresumeする', async () => {
        const events = [];
        const approval = {
            isBound: vi.fn((step) => Boolean(step.metadata?.company_authority_human_approval)),
            resolve: vi.fn(async ({ step, actor }) => {
                events.push({ type: 'approval', stepId: step.id, actorId: actor.person_id });
                return {
                    receipt: { receipt_id: 'cahapr_integration' },
                    consumed_at: '2026-09-05T00:00:00.000Z',
                    consumed_by: actor.person_id,
                    fresh_context: { tenant_context: { tenant: { tenant_id: 'tenant-a' } } }
                };
            })
        };
        const { repository, runner, service } = makeService({
            companyAuthorityHumanApprovalService: approval,
            events
        });
        seedWaitingRun(repository, { marker: { schema_version: '1.0', binding_digest: 'digest' } });

        const result = await service.resolveHumanStep(
            'human-company-authority',
            { resolution: 'approved' },
            { person_id: 'approver' }
        );

        expect(approval.resolve).toHaveBeenCalledWith(expect.objectContaining({
            step: expect.objectContaining({ requested_by: 'requester', requested_to: 'approver' }),
            actor: expect.objectContaining({ person_id: 'approver' })
        }));
        expect(events.map((event) => event.type)).toEqual(['approval', 'handler']);
        expect(events[1]).toMatchObject({ actorId: 'approver' });
        expect(result).toMatchObject({
            human_step: { id: 'human-company-authority', status: 'approved', resolved_by: 'approver' },
            resumed_run: {
                status: 'success',
                started_by: 'requester',
                parent_run_id: 'run-company-authority'
            },
            company_authority_approval: {
                receipt: { receipt_id: 'cahapr_integration' },
                consumed_by: 'approver'
            }
        });
        expect(result.resumed_run.started_by).not.toBe(result.human_step.resolved_by);
        expect(result.resumed_run).toMatchObject({
            status: 'success',
            closure_state: 'closed'
        });
        expect(runner.handlers[workflow.implementation_key]).toHaveBeenCalledWith(
            expect.objectContaining({ actorId: 'approver' }),
            expect.objectContaining({ id: workflow.id })
        );
    });

    it('通常のhuman stepはCompany Authority serviceを通らず従来どおりresumeする', async () => {
        const approval = {
            isBound: vi.fn(() => false),
            resolve: vi.fn()
        };
        const { repository, service } = makeService({ companyAuthorityHumanApprovalService: approval });
        seedWaitingRun(repository);

        const result = await service.resolveHumanStep(
            'human-company-authority',
            { resolution: 'approved' },
            { person_id: 'approver' }
        );

        expect(approval.resolve).not.toHaveBeenCalled();
        expect(result.company_authority_approval).toBeUndefined();
        expect(result.resumed_run).toMatchObject({ status: 'success', started_by: 'requester' });
    });

    it('Company Authority markerがあるのにserviceが未注入ならfail-closedでpendingを維持する', async () => {
        const { repository, runner, service } = makeService();
        seedWaitingRun(repository, { marker: { schema_version: '1.0' } });

        await expect(service.resolveHumanStep(
            'human-company-authority',
            { resolution: 'approved' },
            { person_id: 'approver' }
        )).rejects.toMatchObject({
            code: 'company_authority_human_approval_unavailable',
            statusCode: 503
        });

        expect(repository.getHumanStep('human-company-authority')).toMatchObject({ status: 'pending' });
        expect(runner.handlers[workflow.implementation_key]).not.toHaveBeenCalled();
    });

    it('Company Authority serviceが未消費receiptを返した場合もfail-closedでresumeしない', async () => {
        const approval = {
            isBound: vi.fn(() => true),
            resolve: vi.fn(async () => null)
        };
        const { repository, runner, service } = makeService({ companyAuthorityHumanApprovalService: approval });
        seedWaitingRun(repository, { marker: { schema_version: '1.0' } });

        await expect(service.resolveHumanStep(
            'human-company-authority',
            { resolution: 'approved' },
            { person_id: 'approver' }
        )).rejects.toMatchObject({
            code: 'company_authority_human_approval_invalid',
            statusCode: 503
        });

        expect(repository.getHumanStep('human-company-authority')).toMatchObject({ status: 'pending' });
        expect(runner.handlers[workflow.implementation_key]).not.toHaveBeenCalled();
    });
});
