import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { createOutcomeServiceContextIssuerFromEnv } from '../../../server/bootstrap/outcome-service-context.js';
import { outcomeOperationId } from '../../../server/services/multitenant/outcome-service-context-issuer.js';

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const organizationId = 'org_01ARZ3NDEKTSV4RRFFQ69G5FAU';
const connectionId = 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW';
const deploymentId = 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX';

describe('outcome service context production bootstrap', () => {
    it('uses explicit authority readback without requiring outcome claims on the caller token', async () => {
        const { privateKey } = generateKeyPairSync('ed25519');
        const transport = {
            fetch: vi.fn(async () => ({
                ok: true,
                json: async () => ({
                    principal: {
                        tenant_id: tenantId,
                        project_id: 'project-a',
                        actor_principal_id: 'svc-outcome-generator'
                    },
                    persisted: {
                        contract_id: 'contract-a',
                        contract_version: '4',
                        run_id: 'run-a',
                        resource_ref: 'meeting-minutes:github'
                    },
                    authority_revision: '9',
                    profile_id: 'meeting_minutes_github_v1',
                    run_mode: 'normal',
                    contract_status: 'active'
                })
            }))
        };
        const profile = {
            profile_id: 'meeting_minutes_github_v1',
            audience: 'mana-runtime',
            capability_id: 'outcome.generate',
            deployment_id: deploymentId,
            workspace_id: 'outcome-runtime',
            app_id: 'mana-outcome-generator',
            authenticated_subject_id: 'service-binding:outcome-generator',
            connection_id: connectionId,
            resource_ref: 'meeting-minutes:github',
            organization_ids: [organizationId],
            data_scopes: ['meeting_minutes:read']
        };
        const issuer = createOutcomeServiceContextIssuerFromEnv({
            env: {},
            tenantRuntimeServices: {},
            signingKey: { key_id: 'brainbase-outcome-1', private_key: privateKey },
            transport,
            resource: 'meeting-minutes:github',
            adapters: {
                authorizeService: async () => true,
                resolveProfile: async () => profile,
                resolveTenant: async () => ({ tenant_id: tenantId, tenant_revision: '3' }),
                resolveConnection: async () => ({
                    snapshot: {
                        connection_id: connectionId,
                        connection_revision: '7',
                        tenant_id: tenantId,
                        installation_id: 'outcome-service-profile-v1',
                        workspace_id: 'outcome-runtime',
                        app_id: 'mana-outcome-generator',
                        granted_scopes: ['outcome.generate'],
                        status: 'active',
                        deployment_id: deploymentId,
                        profile: 'shared_cloud',
                        credential_mode: 'cloud_standard',
                        contract_revision: '11'
                    },
                    credential: {
                        mode: 'cloud_standard',
                        credential_ref: 'credential-outcome-service',
                        billing_principal_id: 'billing-a'
                    }
                })
            }
        });
        const serviceIdentity = {
            issuer: 'brainbase',
            subject: 'svc_mana_runtime',
            audience: ['brainbase-api'],
            deployment_id: deploymentId,
            capabilities: ['tenant_context:resolve']
        };

        const result = await issuer.issue({
            profile: profile.profile_id,
            principal: {
                tenant_id: tenantId,
                project_id: 'project-a',
                actor_principal_id: 'svc-outcome-generator'
            },
            persisted: {
                contract_id: 'contract-a',
                contract_version: '4',
                run_id: 'run-a',
                resource_ref: profile.resource_ref
            },
            required: {
                audience: profile.audience,
                capability_id: profile.capability_id,
                deployment_id: profile.deployment_id,
                workspace_id: profile.workspace_id,
                app_id: profile.app_id,
                operation_id: outcomeOperationId('run-a'),
                authenticated_subject_id: profile.authenticated_subject_id,
                run_mode: 'normal'
            }
        }, serviceIdentity);

        expect(result.tenant_context.service_actor).toMatchObject({
            contract_id: 'contract-a',
            contract_version: '4',
            run_id: 'run-a',
            run_mode: 'normal'
        });
        expect(JSON.parse(transport.fetch.mock.calls[0][1].body)).toEqual({
            tenant: tenantId,
            project: 'project-a',
            actor: 'svc-outcome-generator',
            contract: 'contract-a',
            version: 4,
            run: 'run-a',
            resource: 'meeting-minutes:github'
        });

        profile.organization_ids = [tenantId];
        await expect(issuer.issue({
            profile: profile.profile_id,
            principal: {
                tenant_id: tenantId,
                project_id: 'project-a',
                actor_principal_id: 'svc-outcome-generator'
            },
            persisted: {
                contract_id: 'contract-a',
                contract_version: '4',
                run_id: 'run-a',
                resource_ref: profile.resource_ref
            },
            required: {
                audience: profile.audience,
                capability_id: profile.capability_id,
                deployment_id: profile.deployment_id,
                workspace_id: profile.workspace_id,
                app_id: profile.app_id,
                operation_id: outcomeOperationId('run-a'),
                authenticated_subject_id: profile.authenticated_subject_id,
                run_mode: 'normal'
            }
        }, serviceIdentity)).rejects.toThrow('Outcome service tenant and organization must be distinct');
        expect(transport.fetch).toHaveBeenCalledTimes(1);
    });
});
