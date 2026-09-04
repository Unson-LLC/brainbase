import { createHash, generateKeyPairSync } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    acceptCompanyAuthorityResponse,
    canonicalJson,
    verifyDetachedJws
} from '../../../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';
import { InMemoryWorkflowRepository } from '../../../../server/services/workflow/workflow-repository.js';
import { CompanyAuthorityContextProducer } from '../../../../server/services/multitenant/company-authority-context-producer.js';
import { CompanyAuthorityHumanApprovalService } from '../../../../server/services/multitenant/company-authority-human-approval-service.js';
import { CompanyAuthorityResolver } from '../../../../server/services/multitenant/company-authority-resolver.js';
import { TenantContextProducer } from '../../../../server/services/multitenant/company-authority-tenant-context-producer.js';

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const connectionId = 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW';
const deploymentId = 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX';
const baseNow = new Date('2026-08-19T09:00:00Z');

function observed(overrides = {}) {
    return {
        provider_identity: {
            provider: 'slack',
            authenticated_subject_id: 'U-REQUESTER',
            workspace_id: 'workspace-a',
            app_id: 'app-a'
        },
        requested_action: {
            capability_id: 'task.read',
            resource_ref: 'project:unson-backoffice',
            project_hint: 'unson-backoffice',
            desired_effect: 'read'
        },
        delivery: {
            event_id: 'Ev-company-authority-human-approval-1',
            channel_id: 'C-backoffice',
            thread_ts: '1.0'
        },
        correlation_id: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAY',
        ...overrides
    };
}

function authorityDecision(input, overrides = {}) {
    return {
        binding_id: 'binding-task-read',
        binding_revision: '4',
        capability_id: input.capability_id,
        decision: 'auto',
        allowed_effects: [input.desired_effect],
        responsible_person_id: 'person-umeda',
        accountable_person_id: 'person-sato',
        approver_person_id: null,
        delegated_by_person_id: null,
        policy_revision: '8',
        raci_revision: '5',
        resource_revision: '12',
        stop_conditions: [],
        authority_resolution_receipt_id: 'authres-task-read',
        ...overrides
    };
}

function authorityRepository() {
    return {
        resolveCanonicalIdentity: vi.fn(async () => ({
            tenant_id: tenantId,
            canonical_person_id: 'person-umeda',
            principal_type: 'person',
            membership_id: 'membership-umeda-unson',
            membership_revision: '3',
            organization_id: 'organization-unson',
            project_id: 'project-unson-backoffice',
            project_code: 'unson-backoffice',
            placement_id: 'placement-backoffice-member',
            status: 'active',
            identity_resolution_receipt_id: 'idres-umeda'
        })),
        resolveCanonicalAuthority: vi.fn(async (input) => authorityDecision(input))
    };
}

function createHarness({ authorityRepo = authorityRepository() } = {}) {
    let currentNow = new Date(baseNow);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signingKey = {
        key_id: 'company-authority-human-approval-test-key',
        private_key: privateKey,
        public_key: publicKey
    };
    const routeRepository = {
        resolveObservedRoute: vi.fn(async () => ({
            tenant_id: tenantId,
            tenant_revision: '7',
            connection_id: connectionId,
            connection_revision: '11',
            workspace_id: 'workspace-a',
            app_id: 'app-a'
        }))
    };
    const tenantContextProducer = new TenantContextProducer({
        resolveCanonicalContext: async () => ({
            tenant: { tenant_id: tenantId, tenant_revision: '7', status: 'active' },
            workspace_connection: {
                connection_id: connectionId,
                connection_revision: '11',
                status: 'active',
                provider: 'slack',
                installation_id: 'installation-a',
                workspace_id: 'workspace-a',
                app_id: 'app-a',
                credential_ref: 'credential-ref-a',
                credential_mode: 'customer_oauth'
            },
            contract_revision: '13'
        }),
        companyAuthorityResolver: new CompanyAuthorityResolver({ repository: authorityRepo }),
        signingKey,
        audience: 'mana-runtime',
        deploymentId,
        deploymentProfile: 'shared_cloud',
        now: () => currentNow
    });
    const producer = new CompanyAuthorityContextProducer({
        routeRepository,
        tenantContextProducer,
        signingKey,
        audience: 'mana-runtime',
        deploymentId,
        now: () => currentNow
    });
    const repository = new InMemoryWorkflowRepository();
    const service = new CompanyAuthorityHumanApprovalService({
        repository,
        companyAuthorityContextProducer: producer,
        now: () => currentNow
    });
    return {
        authorityRepo,
        producer,
        publicJwk: publicKey.export({ format: 'jwk' }),
        repository,
        service,
        setNow(value) {
            currentNow = new Date(value);
        }
    };
}

async function createBoundStep(harness, input = observed(), overrides = {}) {
    const authorityResponse = await harness.producer.resolve(input);
    const step = harness.repository.createHumanStep({
        id: overrides.id || 'human-step-1',
        workspace_id: 'workspace-a',
        project_id: 'project-unson-backoffice',
        workflow_run_id: 'run-1',
        workflow_id: 'workflow-1',
        requested_by: overrides.requested_by || 'person-requester',
        requested_to: overrides.requested_to || 'person-approver',
        metadata: overrides.metadata || {}
    });
    await harness.service.attachBinding(step.id, {
        observedRequest: input,
        authorityResponse
    });
    return harness.repository.getHumanStep(step.id);
}

describe('CompanyAuthorityHumanApprovalService', () => {
    afterEach(() => vi.restoreAllMocks());

    it('issues a signed, request-bound receipt with separate requester and approver, then consumes it once', async () => {
        const harness = createHarness();
        const input = observed();
        const step = await createBoundStep(harness, input);
        const producerResolve = vi.spyOn(harness.producer, 'resolve');

        const resolved = await harness.service.resolve({
            step,
            input,
            actor: { person_id: 'person-approver' }
        });

        expect(resolved.receipt).toMatchObject({
            receipt_type: 'company_authority_human_approval',
            human_step_id: step.id,
            tenant_id: tenantId,
            project_id: 'project-unson-backoffice',
            resource_ref: 'project:unson-backoffice',
            requested_by: 'person-requester',
            resolved_by: 'person-approver',
            target_approver_id: 'person-approver',
            audience: 'mana-runtime',
            key_id: 'company-authority-human-approval-test-key'
        });
        expect(resolved.receipt.requested_by).not.toBe(resolved.receipt.resolved_by);
        expect(resolved.receipt.issued_at).toBeTruthy();
        expect(resolved.receipt.expires_at).toBeTruthy();
        expect(Date.parse(resolved.receipt.expires_at)).toBeGreaterThan(Date.parse(resolved.receipt.issued_at));
        expect(resolved.receipt.digest).toBe(createHash('sha256')
            .update(canonicalJson(Object.fromEntries(Object.entries(resolved.receipt)
                .filter(([key]) => !['digest', 'integrity'].includes(key)))))
            .digest('hex'));
        expect(() => verifyDetachedJws(resolved.receipt, harness.publicJwk, {
            expectedTyp: 'application/mana-brainbase-company-authority-human-approval+jws',
            expectedKeyId: 'company-authority-human-approval-test-key'
        })).not.toThrow();
        expect(harness.repository.getCompanyAuthorityApprovalReceipt(resolved.receipt.receipt_id))
            .toMatchObject({ consumed_by: 'person-approver' });
        expect(producerResolve).toHaveBeenCalledTimes(1);

        await expect(harness.service.resolve({
            step,
            input,
            actor: { person_id: 'person-approver' }
        })).rejects.toMatchObject({ code: 'company_authority_human_approval_replay' });
        expect(producerResolve).toHaveBeenCalledTimes(1);
    });

    it('元のAuthority TTLを超えたhuman delay後もfresh resolveで承認できる', async () => {
        const harness = createHarness();
        const input = observed();
        const step = await createBoundStep(harness, input);

        harness.setNow('2026-08-19T09:10:00Z');

        const resolved = await harness.service.resolve({
            step,
            input,
            actor: { person_id: 'person-approver' }
        });

        expect(resolved).toMatchObject({
            consumed_by: 'person-approver',
            receipt: {
                issued_at: '2026-08-19T09:10:00.000Z',
                expires_at: '2026-08-19T09:15:00.000Z'
            },
            fresh_context: {
                issued_at: '2026-08-19T09:10:00Z',
                expires_at: '2026-08-19T09:15:00Z'
            }
        });
    });

    it('rejects an approver mismatch before fresh Company Authority resolve', async () => {
        const harness = createHarness();
        const input = observed();
        const step = await createBoundStep(harness, input);
        const producerResolve = vi.spyOn(harness.producer, 'resolve');

        await expect(harness.service.resolve({
            step,
            input,
            actor: { person_id: 'person-other' }
        })).rejects.toMatchObject({
            code: 'company_authority_human_approval_approver_mismatch',
            statusCode: 403
        });
        expect(producerResolve).not.toHaveBeenCalled();
        expect(harness.repository.listCompanyAuthorityApprovalReceipts()).toHaveLength(0);
    });

    it('rejects tampered binding and cross-project/tenant replay before fresh resolve', async () => {
        const harness = createHarness();
        const input = observed();
        const step = await createBoundStep(harness, input);
        const producerResolve = vi.spyOn(harness.producer, 'resolve');

        const tampered = structuredClone(step);
        tampered.metadata.company_authority_human_approval.binding.project_id = 'project-other';
        await expect(harness.service.resolve({
            step: tampered,
            input,
            actor: { person_id: 'person-approver' }
        })).rejects.toMatchObject({ code: 'company_authority_human_approval_tampered' });

        const crossScope = {
            ...structuredClone(step),
            id: 'human-step-other-tenant',
            project_id: 'project-other-tenant',
            requested_by: 'person-other-requester'
        };
        await expect(harness.service.resolve({
            step: crossScope,
            input: { ...input, tenant_id: 'tenant-other' },
            actor: { person_id: 'person-approver' }
        })).rejects.toMatchObject({ code: 'company_authority_human_approval_binding_mismatch' });
        expect(producerResolve).not.toHaveBeenCalled();
    });

    it('rejects a changed fresh revision before issuing a receipt', async () => {
        const freshHarness = createHarness();
        const freshInput = observed();
        const freshStep = await createBoundStep(freshHarness, freshInput);
        freshHarness.authorityRepo.resolveCanonicalAuthority.mockImplementationOnce(async (request) =>
            authorityDecision(request, { resource_revision: '13' }));
        await expect(freshHarness.service.resolve({
            step: freshStep,
            input: freshInput,
            actor: { person_id: 'person-approver' }
        })).rejects.toMatchObject({ code: 'company_authority_human_approval_binding_mismatch' });
        expect(freshHarness.repository.listCompanyAuthorityApprovalReceipts()).toHaveLength(0);
    });
});
