import { describe, expect, it, vi } from 'vitest';

import { ExternalRunnerContractError } from '../../../server/services/external-runner/contract-schema.js';
import { ExternalRunnerIngestService } from '../../../server/services/external-runner/ingest-service.js';
import { InMemoryWorkflowRepository } from '../../../server/services/workflow/workflow-repository.js';

function observedRequest() {
    return {
        provider_identity: {
            provider: 'slack',
            authenticated_subject_id: 'person-requester',
            workspace_id: 'workspace-a',
            app_id: 'app-a'
        },
        requested_action: {
            capability_id: 'task.write',
            resource_ref: 'project:brainbase',
            project_hint: 'brainbase',
            desired_effect: 'write'
        },
        delivery: {
            event_id: 'event-human-approval-1',
            channel_id: 'channel-brainbase'
        },
        correlation_id: 'correlation-human-approval-1'
    };
}

function companyAuthorityHandoff(overrides = {}) {
    return {
        observed_request: observedRequest(),
        authority_response: {
            schema_version: '1.0',
            contract_id: 'mana-brainbase-company-authority/v1',
            correlation_id: 'correlation-human-approval-1',
            context: { signed: true },
            error: null
        },
        handoff_idempotency_key: 'handoff-human-approval-1',
        target_approver_id: 'person-approver',
        ...overrides
    };
}

function makePayload(overrides = {}) {
    return {
        contract_version: 'external_runner.v0',
        runner: {
            type: 'agent_report',
            external_run_id: 'human-approval-run-1',
            agent_id: 'agent-reporter'
        },
        run: {
            org_id: 'brainbase',
            project_id: 'brainbase',
            role_agent_id: 'reviewer',
            workflow_id: 'workflow-human-approval-1',
            status: 'waiting_human'
        },
        loop_control: {
            owner_id: 'agent-owner',
            cost_owner_id: 'agent-owner',
            approval_owner_id: 'person-approver',
            stop_conditions: ['human_approval_required']
        },
        context_sources: [{
            source_type: 'agent_report',
            source_ref: 'agent-report://human-approval-run-1'
        }],
        rounds: [{
            round_id: 'round-1',
            status: 'completed',
            evidence_refs: ['agent-report://human-approval-run-1/round-1']
        }],
        human_steps: [{
            id: 'human-step-company-authority-1',
            step_type: 'approval',
            prompt: 'Company Authorityで承認する',
            required_by: 'person-approver',
            requested_to: 'person-approver',
            company_authority_handoff: companyAuthorityHandoff()
        }],
        ...overrides
    };
}

describe('external runner Company Authority handoff', () => {
    it('keeps the original requester and attaches the Company Authority marker at human-step creation', async () => {
        const repository = new InMemoryWorkflowRepository();
        const marker = {
            schema_version: '1.0',
            binding: {
                human_step_id: 'human-step-company-authority-1',
                requested_by: 'person-requester',
                target_approver_id: 'person-approver'
            },
            integrity: {
                method: 'jws_detached',
                key_id: 'test-key',
                value: 'signed-marker'
            }
        };
        const companyAuthorityHumanApprovalService = {
            createBinding: vi.fn(() => marker)
        };
        const service = new ExternalRunnerIngestService({
            workflowRepository: repository,
            companyAuthorityHumanApprovalService
        });

        const result = await service.ingest(makePayload());

        expect(companyAuthorityHumanApprovalService.createBinding).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'human-step-company-authority-1',
                requested_by: 'person-requester',
                requested_to: 'person-approver'
            }),
            expect.objectContaining({
                observedRequest: expect.objectContaining({
                    requested_action: expect.objectContaining({ capability_id: 'task.write' })
                }),
                authorityResponse: expect.objectContaining({ context: { signed: true } }),
                handoffIdempotencyKey: 'handoff-human-approval-1',
                targetApproverId: 'person-approver'
            })
        );
        expect(result.human_steps[0]).toMatchObject({
            requested_by: 'person-requester',
            requested_to: 'person-approver',
            metadata: { company_authority_human_approval: marker }
        });
    });

    it.each([
        ['observed request', (handoff) => ({
            ...handoff,
            observed_request: {
                ...handoff.observed_request,
                delivery: { ...handoff.observed_request.delivery, event_id: 'event-human-approval-replay' }
            }
        })],
        ['authority response', (handoff) => ({
            ...handoff,
            authority_response: {
                ...handoff.authority_response,
                correlation_id: 'correlation-human-approval-replay'
            }
        })],
        ['execution hash', (handoff) => ({ ...handoff, execution_hash: 'different-execution-hash' })],
        ['handoff idempotency key', (handoff) => ({
            ...handoff,
            handoff_idempotency_key: 'handoff-human-approval-replay'
        })],
        ['authority response approver', (handoff) => ({
            ...handoff,
            authority_response: {
                ...handoff.authority_response,
                context: { ...handoff.authority_response.context, approver_person_id: 'person-other' }
            }
        })]
    ])('rejects duplicate replay when the %s changes inside the Company Authority handoff', async (_label, mutate) => {
        const repository = new InMemoryWorkflowRepository();
        const marker = {
            schema_version: '1.0',
            binding: {
                human_step_id: 'human-step-company-authority-1',
                requested_by: 'person-requester',
                target_approver_id: 'person-approver'
            },
            integrity: {
                method: 'jws_detached',
                key_id: 'test-key',
                value: 'signed-marker'
            }
        };
        const companyAuthorityHumanApprovalService = {
            createBinding: vi.fn(() => marker)
        };
        const service = new ExternalRunnerIngestService({
            workflowRepository: repository,
            companyAuthorityHumanApprovalService
        });

        await service.ingest(makePayload());
        const replayStep = {
            ...makePayload().human_steps[0],
            company_authority_handoff: mutate(companyAuthorityHandoff())
        };
        await expect(service.ingest(makePayload({ human_steps: [replayStep] }))).rejects.toMatchObject({
            code: 'duplicate_payload_mismatch',
            details: { surface: 'human_steps' }
        });
    });

    it('fails closed before creating any workflow surface when the Company Authority binder is unavailable', async () => {
        const repository = new InMemoryWorkflowRepository();
        const service = new ExternalRunnerIngestService({ workflowRepository: repository });

        await expect(service.ingest(makePayload())).rejects.toMatchObject({
            code: 'company_authority_human_approval_unavailable'
        });
        expect(repository.listWorkflows()).toHaveLength(0);
        expect(repository.listRuns()).toHaveLength(0);
        expect(repository.listHumanSteps()).toHaveLength(0);
    });

    it('rejects an approver mismatch before the external-runner transaction', async () => {
        const repository = new InMemoryWorkflowRepository();
        const companyAuthorityHumanApprovalService = {
            createBinding: vi.fn()
        };
        const service = new ExternalRunnerIngestService({
            workflowRepository: repository,
            companyAuthorityHumanApprovalService
        });

        await expect(service.ingest(makePayload({
            human_steps: [{
                id: 'human-step-company-authority-1',
                prompt: 'Company Authorityで承認する',
                required_by: 'person-other',
                company_authority_handoff: companyAuthorityHandoff()
            }]
        }))).rejects.toMatchObject({
            code: 'company_authority_human_approval_approver_mismatch'
        });
        expect(companyAuthorityHumanApprovalService.createBinding).not.toHaveBeenCalled();
        expect(repository.listRuns()).toHaveLength(0);
    });

    it('rejects unknown handoff fields instead of accepting an unbound authority payload', async () => {
        const repository = new InMemoryWorkflowRepository();
        const service = new ExternalRunnerIngestService({
            workflowRepository: repository,
            companyAuthorityHumanApprovalService: { createBinding: vi.fn() }
        });

        await expect(service.ingest(makePayload({
            human_steps: [{
                id: 'human-step-company-authority-1',
                prompt: 'Company Authorityで承認する',
                company_authority_handoff: companyAuthorityHandoff({
                    approver_person_id: 'person-approver'
                })
            }]
        }))).rejects.toBeInstanceOf(ExternalRunnerContractError);
        expect(repository.listRuns()).toHaveLength(0);
    });

    it('rejects a Company Authority handoff on a non-waiting run', async () => {
        const repository = new InMemoryWorkflowRepository();
        const companyAuthorityHumanApprovalService = {
            createBinding: vi.fn()
        };
        const service = new ExternalRunnerIngestService({
            workflowRepository: repository,
            companyAuthorityHumanApprovalService
        });

        await expect(service.ingest(makePayload({
            run: {
                ...makePayload().run,
                status: 'completed'
            }
        }))).rejects.toMatchObject({
            code: 'company_authority_human_approval_requires_waiting_human'
        });
        expect(companyAuthorityHumanApprovalService.createBinding).not.toHaveBeenCalled();
        expect(repository.listRuns()).toHaveLength(0);
    });
});
