import { generateKeyPairSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

import {
    CompanyAuthorityResolver,
    normalizeObservedExecutionRequest
} from '../../../../server/services/multitenant/company-authority-resolver.js';
import {
    actionForRuntimeCapability,
    assertPersonalKnowledgePromotionAuthority,
    runtimeCapabilityForAction
} from '../../../../server/services/personal-knowledge/promotion-authority-contract.js';
import { TenantContextProducer } from '../../../../server/services/multitenant/tenant-context-producer.js';

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const connectionId = 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW';
const deploymentId = 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX';
const correlationId = 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAY';
const operationId = 'op_01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const now = new Date('2026-08-19T09:00:00Z');

function observed(overrides = {}) {
    return {
        tenant_id: tenantId,
        expected_tenant_revision: '7',
        connection_id: connectionId,
        expected_connection_revision: '11',
        workspace_id: 'workspace-a',
        app_id: 'app-a',
        provider_identity: {
            provider: 'slack',
            authenticated_subject_id: 'U-UMEDA',
            workspace_id: 'workspace-a',
            app_id: 'app-a'
        },
        requested_action: {
            capability_id: 'task.read',
            resource_ref: 'project:unson-backoffice',
            project_hint: 'unson-backoffice',
            desired_effect: 'read'
        },
        slack: {
            event_id: 'Ev-company-authority-1',
            channel_id: 'C-backoffice',
            thread_ts: '1.0',
            requester_id: 'U-UMEDA'
        },
        correlation_id: correlationId,
        operation_id: operationId,
        ...overrides
    };
}

function canonicalRepository() {
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
        resolveCanonicalAuthority: vi.fn(async () => ({
            binding_id: 'binding-task-read',
            binding_revision: '4',
            capability_id: 'task.read',
            decision: 'auto',
            allowed_effects: ['read'],
            responsible_person_id: 'person-umeda',
            accountable_person_id: 'person-sato',
            approver_person_id: null,
            delegated_by_person_id: null,
            policy_revision: '8',
            raci_revision: '5',
            resource_revision: '12',
            stop_conditions: [],
            authority_resolution_receipt_id: 'authres-task-read'
        }))
    };
}

function canonicalRuntime() {
    return {
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
    };
}

describe('CompanyAuthorityResolver', () => {
    it('rejects malformed provider connection scopes before authority resolution', () => {
        expect(() => normalizeObservedExecutionRequest(observed({
            required_connection_scopes: ['chat:write', '']
        }))).toThrowError(expect.objectContaining({
            code: 'COMPANY_AUTHORITY_REQUEST_INVALID'
        }));
    });

    it('rejects runtime self-asserted actor and authorization in the canonical request shape', () => {
        expect(() => normalizeObservedExecutionRequest(observed({
            actor: { principal_id: 'attacker' },
            authorization: { organization_ids: ['other-org'] }
        }))).toThrowError(expect.objectContaining({
            code: 'COMPANY_AUTHORITY_SELF_ASSERTION_FORBIDDEN'
        }));
    });

    it('derives actor and authorization only from Brainbase-owned repository results', async () => {
        const repository = canonicalRepository();
        const resolver = new CompanyAuthorityResolver({ repository });
        const resolved = await resolver.resolve(observed(), canonicalRuntime());

        expect(repository.resolveCanonicalIdentity).toHaveBeenCalledWith(expect.objectContaining({
            authenticated_subject_id: 'U-UMEDA',
            project_hint: 'unson-backoffice'
        }));
        expect(repository.resolveCanonicalAuthority).toHaveBeenCalledWith(expect.objectContaining({
            canonical_person_id: 'person-umeda',
            membership_revision: '3',
            organization_id: 'organization-unson',
            project_id: 'project-unson-backoffice',
            capability_id: 'task.read'
        }));
        expect(resolved.actor).toEqual({
            principal_id: 'person-umeda',
            principal_type: 'person',
            authenticated_subject_id: 'U-UMEDA'
        });
        expect(resolved.authorization.organization_ids).toEqual(['organization-unson']);
        expect(resolved.authorization.project_ids).toEqual(['project-unson-backoffice']);
        expect(resolved.authorization.data_scopes).toContain('company_authority:raci:5');
        expect(resolved.authorization.data_scopes).toContain('company_authority:policy:8');
    });

    it('fails closed when the requested effect is not present in the binding', async () => {
        const repository = canonicalRepository();
        repository.resolveCanonicalAuthority.mockResolvedValue({
            ...(await repository.resolveCanonicalAuthority()),
            allowed_effects: ['write']
        });
        const resolver = new CompanyAuthorityResolver({ repository });
        await expect(resolver.resolve(observed(), canonicalRuntime())).rejects.toMatchObject({
            code: 'COMPANY_EFFECT_NOT_ALLOWED'
        });
    });
});

describe('TenantContextProducer company authority cutover', () => {
    it('keeps the three runtime capabilities bound to versioned promotion actions', () => {
        expect(['request', 'owner_consent', 'organization_review'].map((action) => ({
            action,
            ...runtimeCapabilityForAction(action)
        }))).toEqual([
            {
                action: 'request',
                runtime_capability_id: 'personal_knowledge_promotion:request'
            },
            {
                action: 'owner_consent',
                runtime_capability_id: 'personal_knowledge_promotion:owner_consent'
            },
            {
                action: 'organization_review',
                runtime_capability_id: 'personal_knowledge_promotion:organization_review'
            }
        ]);
        expect(actionForRuntimeCapability('personal_knowledge_promotion:request')).toMatchObject({
            action: 'request', runtime_capability_id: 'personal_knowledge_promotion:request'
        });
    });

    it('issues a signed promotion authority from the customer-data-free fixture request', async () => {
        const fixture = JSON.parse(await readFile(
            'tests/fixtures/personal-knowledge-promotion/producer-request.json',
            'utf8'
        ));
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const repository = canonicalRepository();
        repository.resolveCanonicalAuthority.mockImplementation(async (input) => ({
            binding_id: 'binding-promotion-fixture',
            binding_revision: '1',
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
            authority_resolution_receipt_id: 'authres-promotion-fixture'
        }));
        const producer = new TenantContextProducer({
            resolveCanonicalContext: async () => canonicalRuntime(),
            companyAuthorityResolver: new CompanyAuthorityResolver({ repository }),
            signingKey: {
                key_id: 'company-authority-fixture-key',
                private_key: privateKey,
                public_key: publicKey
            },
            audience: 'mana-runtime',
            deploymentId,
            deploymentProfile: 'shared_cloud',
            now: () => now
        });

        const envelope = await producer.resolveContext(fixture);

        expect(assertPersonalKnowledgePromotionAuthority(envelope.authority)).toMatchObject({
            action: 'request',
            resource_ref: 'personal-knowledge://events/pke_fixture_1',
            request_id: null,
            normalized_payload_hash: null
        });
        expect(envelope.authorization.capability_ids).toEqual(['personal_knowledge_promotion:request']);
        expect(envelope.integrity).toMatchObject({
            method: 'jws_detached',
            algorithm: 'EdDSA',
            key_id: 'company-authority-fixture-key'
        });

        await expect(producer.resolveContext({
            ...fixture,
            promotion_authority: {
                ...fixture.promotion_authority,
                resource_ref: 'personal-knowledge://events/pke_other'
            }
        })).rejects.toMatchObject({
            code: 'PERSONAL_KNOWLEDGE_PROMOTION_AUTHORITY_INVALID',
            status: 403
        });
    });

    it('ignores legacy actor/organization claims and signs the canonical resolution', async () => {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const resolver = new CompanyAuthorityResolver({ repository: canonicalRepository() });
        const producer = new TenantContextProducer({
            resolveCanonicalContext: async () => canonicalRuntime(),
            companyAuthorityResolver: resolver,
            signingKey: {
                key_id: 'company-authority-test-key',
                private_key: privateKey,
                public_key: publicKey
            },
            audience: 'mana-runtime',
            deploymentId,
            deploymentProfile: 'shared_cloud',
            now: () => now
        });

        const envelope = await producer.resolveContext({
            tenant_id: tenantId,
            expected_tenant_revision: '7',
            connection_id: connectionId,
            expected_connection_revision: '11',
            workspace_id: 'workspace-a',
            app_id: 'app-a',
            actor: {
                principal_id: 'attacker-person',
                principal_type: 'person',
                authenticated_subject_id: 'attacker-subject'
            },
            authorization: {
                organization_ids: ['attacker-organization'],
                project_ids: ['unson-backoffice'],
                data_scopes: ['admin'],
                capability_ids: ['task.read']
            },
            slack: {
                event_id: 'Ev-company-authority-legacy',
                channel_id: 'C-backoffice',
                thread_ts: '1.0',
                requester_id: 'U-UMEDA'
            },
            correlation_id: correlationId,
            operation_id: operationId
        });

        expect(envelope.actor.principal_id).toBe('person-umeda');
        expect(envelope.actor.authenticated_subject_id).toBe('U-UMEDA');
        expect(envelope.authorization.organization_ids).toEqual(['organization-unson']);
        expect(envelope.authorization.organization_ids).not.toContain('attacker-organization');
        expect(envelope.authorization.data_scopes).not.toContain('admin');
        expect(envelope.credential.billing_principal_id).toBe('person-umeda');
    });

    it('keeps provider scopes separate from the requested business capability', async () => {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        const resolveCanonicalContext = vi.fn(async () => canonicalRuntime());
        const repository = canonicalRepository();
        repository.resolveCanonicalAuthority.mockResolvedValue({
            ...(await repository.resolveCanonicalAuthority()),
            capability_id: 'runtime.execute'
        });
        const producer = new TenantContextProducer({
            resolveCanonicalContext,
            companyAuthorityResolver: new CompanyAuthorityResolver({ repository }),
            signingKey: {
                key_id: 'company-authority-test-key',
                private_key: privateKey,
                public_key: publicKey
            },
            audience: 'mana-runtime',
            deploymentId,
            deploymentProfile: 'shared_cloud',
            now: () => now
        });

        await producer.resolveContext({
            ...observed(),
            requested_action: {
                ...observed().requested_action,
                capability_id: 'runtime.execute'
            },
            required_connection_scopes: ['app_mentions:read', 'chat:write']
        });

        expect(resolveCanonicalContext).toHaveBeenCalledWith(expect.objectContaining({
            authorization: { capability_ids: ['runtime.execute'] },
            required_connection_scopes: ['app_mentions:read', 'chat:write']
        }));
    });
});
