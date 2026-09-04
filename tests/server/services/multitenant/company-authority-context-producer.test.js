import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
    acceptCompanyAuthorityResponse,
    COMPANY_AUTHORITY_CAPABILITY
} from '../../../../contracts/mana-brainbase-company-authority/v1/reference/wire.mjs';
import { CompanyAuthorityContextProducer } from '../../../../server/services/multitenant/company-authority-context-producer.js';
import { CompanyAuthorityResolver } from '../../../../server/services/multitenant/company-authority-resolver.js';
import { ContractError } from '../../../../server/services/multitenant/errors.js';
import { TenantContextProducer } from '../../../../server/services/multitenant/company-authority-tenant-context-producer.js';

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const connectionId = 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW';
const deploymentId = 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX';
const now = new Date('2026-08-19T09:00:00Z');

function observed(overrides = {}) {
    return {
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
        delivery: {
            event_id: 'Ev-company-authority-outer-1',
            channel_id: 'C-backoffice',
            thread_ts: '1.0'
        },
        correlation_id: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAY',
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
        resolveCanonicalAuthority: vi.fn(async (input) => ({
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
            authority_resolution_receipt_id: 'authres-task-read'
        }))
    };
}

function createProducer({ routeRepository, repository = authorityRepository() } = {}) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const signingKey = {
        key_id: 'company-authority-outer-test-key',
        private_key: privateKey,
        public_key: publicKey
    };
    const effectiveRouteRepository = routeRepository ?? {
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
        companyAuthorityResolver: new CompanyAuthorityResolver({ repository }),
        signingKey,
        audience: 'mana-runtime',
        deploymentId,
        deploymentProfile: 'shared_cloud',
        now: () => now
    });
    return {
        producer: new CompanyAuthorityContextProducer({
            routeRepository: effectiveRouteRepository,
            tenantContextProducer,
            signingKey,
            audience: 'mana-runtime',
            deploymentId,
            now: () => now
        }),
        routeRepository: effectiveRouteRepository,
        publicJwk: publicKey.export({ format: 'jwk' })
    };
}

describe('CompanyAuthorityContextProducer', () => {
    it('resolves the tenant internally and emits two verifiable, request-bound signatures', async () => {
        const input = observed();
        const { producer, routeRepository, publicJwk } = createProducer();

        const response = await producer.resolve(input);

        expect(routeRepository.resolveObservedRoute).toHaveBeenCalledWith(input);
        expect(response.error).toBeNull();
        expect(response.context.tenant_context.authorization.capability_ids).toContain(
            COMPANY_AUTHORITY_CAPABILITY
        );
        expect(response.context.tenant_context.authorization.capability_ids).toContain('task.read');
        expect(response.context.authority.capability_id).toBe('task.read');
        expect(response.context.actor.canonical_person_id).toBe('person-umeda');
        expect(response.context.scope).toMatchObject({
            organization_id: 'organization-unson',
            project_id: 'project-unson-backoffice',
            resource_ref: 'project:unson-backoffice',
            owner_person_id: null,
            placement_id: deploymentId
        });
        expect(() => acceptCompanyAuthorityResponse(response, {
            expectedAudience: 'mana-runtime',
            expectedDeploymentId: deploymentId,
            now,
            publicJwk,
            request: input
        })).not.toThrow();
    });

    it('rejects runtime-supplied authority before route lookup or any business effect', async () => {
        const { producer, routeRepository } = createProducer();

        await expect(producer.resolve(observed({
            actor: { canonical_person_id: 'person-attacker' }
        }))).rejects.toMatchObject({
            code: 'AUTHORITY_CONTEXT_INVALID_SIGNATURE'
        });
        expect(routeRepository.resolveObservedRoute).not.toHaveBeenCalled();
    });

    it.each([
        ['COMPANY_IDENTITY_UNRESOLVED', 'PERSON_UNKNOWN'],
        ['COMPANY_IDENTITY_AMBIGUOUS', 'PERSON_AMBIGUOUS'],
        ['UPSTREAM_UNAVAILABLE', 'AUTHORITY_UNAVAILABLE']
    ])('maps %s to the canonical fail-closed response %s', async (sourceCode, expectedCode) => {
        const routeRepository = {
            resolveObservedRoute: vi.fn(async () => {
                throw new ContractError(sourceCode, {
                    status: sourceCode === 'UPSTREAM_UNAVAILABLE' ? 503 : 403,
                    retryable: sourceCode === 'UPSTREAM_UNAVAILABLE'
                });
            })
        };
        const { producer } = createProducer({ routeRepository });

        const response = await producer.resolve(observed());

        expect(response.context).toBeNull();
        expect(response.error).toMatchObject({
            code: expectedCode,
            phase: 'authority',
            retryable: sourceCode === 'UPSTREAM_UNAVAILABLE',
            business_effect: false
        });
    });

    it('preserves the personal owner mismatch as a canonical non-retryable denial', async () => {
        const { producer } = createProducer();
        const response = await producer.resolve(observed({
            requested_action: {
                capability_id: 'knowledge.read',
                resource_ref: 'personal://person-other/knowledge/item-1',
                project_hint: 'unson-backoffice',
                desired_effect: 'read'
            }
        }));

        expect(response).toMatchObject({
            context: null,
            error: {
                code: 'PERSONAL_SCOPE_MISMATCH',
                retryable: false,
                business_effect: false
            }
        });
    });
});
