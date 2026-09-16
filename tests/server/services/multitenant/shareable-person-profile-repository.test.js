import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createTenantRuntimeServicesFromEnv } from '../../../../server/services/multitenant/tenant-runtime-services.js';
import { ShareablePersonProfileRepository } from '../../../../server/services/multitenant/shareable-person-profile-repository.js';
import { ShareablePersonProfileService } from '../../../../server/services/multitenant/shareable-person-profile-service.js';

const tenantId = 'tenant-a';
const organizationId = 'org-back-office';
const projectId = 'project-back-office';
const projectCode = 'back-office';
const connectionId = 'connection-a';
const workspaceId = 'workspace-a';
const appId = 'app-a';
const targetSlackUserId = 'UTARGET123';

function context() {
    return {
        actor: {
            canonical_person_id: 'person-requester',
            external_subject_id: 'UREQUESTER123',
            membership_id: 'membership-requester',
            membership_revision: '4'
        },
        scope: {
            organization_id: organizationId,
            project_id: projectId
        },
        tenant_context: {
            tenant: { tenant_id: tenantId, tenant_revision: '7' },
            workspace_connection: {
                connection_id: connectionId,
                connection_revision: '11',
                provider: 'slack',
                workspace_id: workspaceId,
                app_id: appId,
                status: 'active'
            },
            actor: {
                principal_id: 'person-requester',
                principal_type: 'person',
                authenticated_subject_id: 'UREQUESTER123'
            },
            authorization: {
                organization_ids: [organizationId],
                project_ids: [projectId]
            },
            slack: {
                channel_id: 'C123',
                event_id: 'event-1'
            }
        }
    };
}

function requesterRow(overrides = {}) {
    return {
        membership_id: 'membership-requester',
        tenant_id: tenantId,
        organization_id: organizationId,
        principal_id: 'person-requester',
        membership_payload: {
            status: 'active',
            revision: '4',
            role: 'gm',
            project_codes: [projectCode, 'other-project'],
            clearance: ['internal', 'restricted']
        },
        tenant_revision: '7',
        tenant_status: 'active',
        project_id: projectId,
        project_code: projectCode,
        project_payload: { status: 'active' },
        connection_id: connectionId,
        connection_revision: '11',
        provider: 'slack',
        workspace_id: workspaceId,
        app_id: appId,
        connection_status: 'active',
        ...overrides
    };
}

function targetRow(overrides = {}) {
    return {
        identity_id: 'identity-target',
        identity_revision: '3',
        tenant_id: tenantId,
        authenticated_subject_id: targetSlackUserId,
        workspace_id: workspaceId,
        app_id: appId,
        membership_id: 'membership-target',
        project_id: projectId,
        principal_type: 'person',
        identity_status: 'active',
        person_id: 'person-target',
        target_organization_id: organizationId,
        membership_payload: { status: 'active', revision: '8' },
        project_code: projectCode,
        connection_id: connectionId,
        connection_revision: '11',
        target_connection_status: 'active',
        target_tenant_revision: '7',
        target_tenant_status: 'active',
        ...overrides
    };
}

function graphRow() {
    return {
        id: 'person-target',
        version: 2,
        shareable_profile: {
            version: 'shareable-person-profile.v1',
            revision: '6',
            fields: {
                name: {
                    value: 'Target Name',
                    reader_person_ids: ['person-requester'],
                    audiences: [{ workspace_id: workspaceId, channel_id: 'C123', extra: 'drop' }]
                },
                affiliation: {
                    value: 'Unson',
                    reader_person_ids: ['person-requester'],
                    audiences: [{ workspace_id: workspaceId, channel_id: 'C123' }]
                },
                role: {
                    value: 'Engineer',
                    reader_person_ids: ['person-requester'],
                    audiences: [{ workspace_id: workspaceId, channel_id: 'C123' }]
                }
            },
            private_field: 'do-not-return'
        }
    };
}

function fixture({ requester = requesterRow(), target = targetRow(), graph = graphRow(), failOn = null } = {}) {
    const calls = [];
    const client = {
        query: vi.fn(async (sql, values) => {
            calls.push({ sql, values });
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK'
                || sql.includes("set_config('brainbase.tenant_id'")) return { rows: [] };
            if (sql.includes('FROM tenant_memberships AS requester')) {
                if (failOn === 'requester') throw new Error('requester unavailable');
                return { rows: Array.isArray(requester) ? requester : [requester] };
            }
            if (sql.includes('FROM company_external_identities AS target_identity')) {
                if (failOn === 'target') throw new Error('target unavailable');
                return { rows: Array.isArray(target) ? target : [target] };
            }
            if (sql.includes('FROM graph_entities AS graph_entity')) {
                if (failOn === 'graph') throw new Error('graph unavailable');
                return { rows: Array.isArray(graph) ? graph : [graph] };
            }
            if (sql.includes('SELECT set_config($1, $2, true)')) return { rows: [] };
            throw new Error(`unexpected query: ${sql}`);
        }),
        release: vi.fn()
    };
    const pool = { connect: vi.fn(async () => client) };
    return { calls, client, pool, repository: new ShareablePersonProfileRepository({ pool }) };
}

describe('ShareablePersonProfileRepository', () => {
    it('reads only an explicitly shareable profile subdocument within the current tenant boundary', async () => {
        const test = fixture();

        await expect(test.repository.readProfile({ context: context(), targetSlackUserId }))
            .resolves.toEqual({
                person_id: 'person-target',
                profile: {
                    version: 'shareable-person-profile.v1',
                    revision: '6',
                    fields: {
                        name: {
                            value: 'Target Name',
                            reader_person_ids: ['person-requester'],
                            audiences: [{ workspace_id: workspaceId, channel_id: 'C123' }]
                        },
                        affiliation: {
                            value: 'Unson',
                            reader_person_ids: ['person-requester'],
                            audiences: [{ workspace_id: workspaceId, channel_id: 'C123' }]
                        },
                        role: {
                            value: 'Engineer',
                            reader_person_ids: ['person-requester'],
                            audiences: [{ workspace_id: workspaceId, channel_id: 'C123' }]
                        }
                    }
                }
            });

        const graphQuery = test.calls.find(({ sql }) => sql.includes('FROM graph_entities AS graph_entity'));
        expect(graphQuery.sql).toContain("graph_entity.payload->'shareable_profile'");
        expect(graphQuery.sql).not.toContain('graph_entity.payload,');
        expect(graphQuery.sql).toContain('graph_entity.sensitivity = ANY');
        expect(graphQuery.sql).toContain('graph_entity.role_min');
        expect(graphQuery.sql).toContain("membership_edge.rel_type = 'member_of'");
        expect(graphQuery.sql).toContain('membership_edge.sensitivity = ANY');
    });

    it('uses the canonical project id for tenant authorization and compact target query parameters', async () => {
        const test = fixture();
        await test.repository.readProfile({ context: context(), targetSlackUserId });

        const requesterQuery = test.calls.find(({ sql }) => sql.includes('FROM tenant_memberships AS requester'));
        expect(requesterQuery.sql).toContain('project.project_id = ANY($9::text[])');
        expect(requesterQuery.values[8]).toEqual([projectId]);
        expect(requesterQuery.values[8]).not.toContain(projectCode);

        const targetQuery = test.calls.find(({ sql }) => sql.includes('FROM company_external_identities AS target_identity'));
        expect(targetQuery.values).toHaveLength(10);
        expect(targetQuery.sql).not.toContain('$11');
        expect(targetQuery.sql).not.toContain('$12');
        expect(targetQuery.sql).toContain('target_identity.project_id = $5');
        expect(targetQuery.sql).toContain('target_project.project_code = $10');
    });

    it('binds Graph access to the requester role, clearance, and current project code', async () => {
        const test = fixture();
        await test.repository.readProfile({ context: context(), targetSlackUserId });

        const settings = test.calls
            .filter(({ sql }) => sql.includes('SELECT set_config($1, $2, true)'))
            .map(({ values }) => values);
        expect(settings).toEqual([
            ['app.role', 'gm'],
            ['app.project_codes', projectCode],
            ['app.clearance', 'internal,restricted']
        ]);
        expect(settings.flat()).not.toContain(organizationId);
    });

    it('fails closed for ambiguous targets or inactive requester membership', async () => {
        const ambiguous = fixture({ target: [targetRow(), targetRow({ identity_id: 'identity-target-old' })] });
        await expect(ambiguous.repository.readProfile({ context: context(), targetSlackUserId }))
            .resolves.toBeNull();

        const inactiveRequester = requesterRow({
            membership_payload: {
                ...requesterRow().membership_payload,
                status: 'inactive'
            }
        });
        const inactive = fixture({ requester: inactiveRequester });
        await expect(inactive.repository.readProfile({ context: context(), targetSlackUserId }))
            .resolves.toBeNull();
    });

    it('rolls back when the authoritative read fails and never commits a failed transaction', async () => {
        const test = fixture({ failOn: 'graph' });

        await expect(test.repository.readProfile({ context: context(), targetSlackUserId }))
            .rejects.toThrow('graph unavailable');
        expect(test.client.query.mock.calls.map(([sql]) => sql)).toContain('ROLLBACK');
        expect(test.client.query.mock.calls.map(([sql]) => sql)).not.toContain('COMMIT');
    });
});

describe('tenant runtime profile wiring', () => {
    it('constructs the profile repository and authority-bound service on the production env path', () => {
        const { privateKey } = generateKeyPairSync('ed25519');
        const services = createTenantRuntimeServicesFromEnv({
            env: {
                BRAINBASE_TENANT_RUNTIME_ENABLED: '1',
                BRAINBASE_TENANT_RUNTIME_SERVICE_TOKEN: 'test-service-token',
                BRAINBASE_SERVICE_TOKEN_SECRET: 'test-service-secret',
                BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_ID: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAX',
                BRAINBASE_TENANT_RUNTIME_DEPLOYMENT_PROFILE: 'shared_cloud',
                BRAINBASE_TENANT_CONTEXT_SIGNING_KEY_ID: 'test-key',
                BRAINBASE_TENANT_CONTEXT_SIGNING_KEY_JWK: JSON.stringify(privateKey.export({ format: 'jwk' }))
            },
            pool: { query: vi.fn(async () => ({ rows: [] })) }
        });

        expect(services.shareablePersonProfileService).toBeInstanceOf(ShareablePersonProfileService);
        expect(services.shareablePersonProfileService.profileRepository)
            .toBeInstanceOf(ShareablePersonProfileRepository);
        expect(services.shareablePersonProfileService.publicJwk)
            .toMatchObject({ kty: 'OKP', crv: 'Ed25519' });
    });
});
