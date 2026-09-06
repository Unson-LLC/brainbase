import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { AutomationRunService } from '../../../server/services/automation-run/automation-run-service.js';
import { CompanyAuthorityHumanApprovalService } from '../../../server/services/multitenant/company-authority-human-approval-service.js';
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

function seedWaitingRun(repository, { marker = undefined, authorityRequired = false } = {}) {
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
        ...((marker === undefined && !authorityRequired) ? {} : {
            metadata: {
                ...(authorityRequired ? { company_authority_required: true } : {}),
                ...(marker === undefined ? {} : { company_authority_human_approval: marker })
            }
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
                return {
                    status: 'success',
                    closureState: 'closed',
                    message: 'resumed',
                    outputCount: 1,
                    data: { effect: 'completed' }
                };
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
        expect(repository.listOutputs(result.resumed_run.id)).toEqual([
            expect.objectContaining({
                metadata: {
                    output_count: 1,
                    company_authority_approval_receipt_id: 'cahapr_integration',
                    source_human_step_id: 'human-company-authority'
                }
            })
        ]);

        await expect(service.resolveHumanStep(
            'human-company-authority',
            { resolution: 'approved' },
            { person_id: 'approver' }
        )).rejects.toMatchObject({ statusCode: 409 });
        expect(approval.resolve).toHaveBeenCalledTimes(1);
        expect(runner.handlers[workflow.implementation_key]).toHaveBeenCalledTimes(1);
        expect(repository.listOutputs(result.resumed_run.id)).toHaveLength(1);
    });

    it('必須stepのmarkerが欠落してもCompany Authorityを迂回しない', async () => {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const producer = {
            resolve: vi.fn(),
            signingKey: {
                key_id: 'company-authority-missing-marker-test-key',
                private_key: privateKey,
                public_key: publicKey
            }
        };
        const repository = new InMemoryWorkflowRepository({ seedWorkflows: [workflow] });
        const approval = new CompanyAuthorityHumanApprovalService({
            repository,
            companyAuthorityContextProducer: producer
        });
        const runner = new WorkflowRunner({
            repository,
            handlers: {
                [workflow.implementation_key]: vi.fn(async () => ({ status: 'success' }))
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
            companyAuthorityHumanApprovalService: approval
        });
        seedWaitingRun(repository, { authorityRequired: true });

        await expect(service.resolveHumanStep(
            'human-company-authority',
            { resolution: 'approved' },
            { person_id: 'approver' }
        )).rejects.toMatchObject({
            code: 'company_authority_human_approval_unavailable',
            statusCode: 503
        });

        expect(producer.resolve).not.toHaveBeenCalled();
        expect(repository.getHumanStep('human-company-authority')).toMatchObject({ status: 'pending' });
        expect(runner.handlers[workflow.implementation_key]).not.toHaveBeenCalled();
        expect(repository.listOutputs()).toHaveLength(0);
        expect(repository.listCompanyAuthorityApprovalReceipts()).toHaveLength(0);
    });

    it('receipt消費とstep承認を同じtransactionでrollbackする', async () => {
        const approval = {
            isBound: vi.fn(() => true),
            resolve: vi.fn()
        };
        const { repository, runner, service } = makeService({ companyAuthorityHumanApprovalService: approval });
        approval.resolve.mockImplementation(async ({ step, actor }) => repository.transaction(() => {
            repository.createCompanyAuthorityApprovalReceipt({
                id: 'cahapr-atomic',
                human_step_id: step.id,
                tenant_id: 'tenant-a',
                binding_digest: 'digest',
                receipt: { receipt_id: 'cahapr-atomic' }
            });
            const consumed = repository.consumeCompanyAuthorityApprovalReceipt('cahapr-atomic', {
                consumed_at: '2026-09-05T00:00:00.000Z',
                consumed_by: actor.person_id
            });
            return {
                receipt: consumed.receipt,
                consumed_at: consumed.consumed_at,
                consumed_by: consumed.consumed_by,
                fresh_context: { tenant_context: { tenant: { tenant_id: 'tenant-a' } } }
            };
        }));
        seedWaitingRun(repository, { marker: { schema_version: '1.0' } });
        const originalUpdate = repository.updateHumanStep.bind(repository);
        vi.spyOn(repository, 'updateHumanStep').mockImplementation((stepId, patch) => {
            if (patch.status === 'approved') throw new Error('injected step persistence failure');
            return originalUpdate(stepId, patch);
        });

        await expect(service.resolveHumanStep(
            'human-company-authority',
            { resolution: 'approved' },
            { person_id: 'approver' }
        )).rejects.toThrow('injected step persistence failure');

        expect(repository.getHumanStep('human-company-authority')).toMatchObject({ status: 'pending' });
        expect(repository.listCompanyAuthorityApprovalReceipts()).toHaveLength(0);
        expect(runner.handlers[workflow.implementation_key]).not.toHaveBeenCalled();
    });

    it('権限承認に束縛された失敗runはreceipt帰属を保持し、汎用rerunを拒否する', async () => {
        const approval = {
            isBound: vi.fn(() => true),
            resolve: vi.fn(async ({ actor }) => ({
                receipt: { receipt_id: 'cahapr-failed-run' },
                consumed_at: '2026-09-05T00:00:00.000Z',
                consumed_by: actor.person_id,
                fresh_context: { tenant_context: { tenant: { tenant_id: 'tenant-a' } } }
            }))
        };
        const { repository, runner, service } = makeService({ companyAuthorityHumanApprovalService: approval });
        seedWaitingRun(repository, { marker: { schema_version: '1.0' } });
        runner.handlers[workflow.implementation_key] = vi.fn(async () => {
            throw new Error('external effect state is unknown');
        });

        const result = await service.resolveHumanStep(
            'human-company-authority',
            { resolution: 'approved' },
            { person_id: 'approver', projectCodes: [workflow.project_id] }
        );

        expect(result.resumed_run).toMatchObject({
            status: 'failed',
            company_authority_approval_receipt_id: 'cahapr-failed-run',
            source_human_step_id: 'human-company-authority'
        });
        await expect(service.rerun(result.resumed_run.id, {}, {
            person_id: 'approver',
            projectCodes: [workflow.project_id]
        })).rejects.toMatchObject({
            code: 'company_authority_approved_run_rerun_forbidden',
            statusCode: 409
        });
        expect(runner.handlers[workflow.implementation_key]).toHaveBeenCalledTimes(1);
        expect(repository.listOutputs(result.resumed_run.id)).toHaveLength(0);
    });

    it('権限承認後にworkflow lockが競合してもskipped runへreceipt帰属を保持し、汎用rerunを拒否する', async () => {
        const approval = {
            isBound: vi.fn(() => true),
            resolve: vi.fn(async ({ actor }) => ({
                receipt: { receipt_id: 'cahapr-skipped-run' },
                consumed_at: '2026-09-05T00:00:00.000Z',
                consumed_by: actor.person_id,
                fresh_context: { tenant_context: { tenant: { tenant_id: 'tenant-a' } } }
            }))
        };
        const { repository, runner, service } = makeService({ companyAuthorityHumanApprovalService: approval });
        seedWaitingRun(repository, { marker: { schema_version: '1.0' } });
        repository.acquireWorkflowLock({
            workspace_id: workflow.workspace_id,
            workflow_id: workflow.id,
            locked_by: 'run-already-running',
            ttl_ms: 300000
        });

        const result = await service.resolveHumanStep(
            'human-company-authority',
            { resolution: 'approved' },
            { person_id: 'approver', projectCodes: [workflow.project_id] }
        );

        expect(result.resumed_run).toMatchObject({
            status: 'skipped',
            company_authority_approval_receipt_id: 'cahapr-skipped-run',
            source_human_step_id: 'human-company-authority'
        });
        await expect(service.rerun(result.resumed_run.id, {}, {
            person_id: 'approver',
            projectCodes: [workflow.project_id]
        })).rejects.toMatchObject({
            code: 'company_authority_approved_run_rerun_forbidden',
            statusCode: 409
        });
        expect(runner.handlers[workflow.implementation_key]).not.toHaveBeenCalled();
        expect(repository.listOutputs(result.resumed_run.id)).toHaveLength(0);
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
