import { describe, expect, it, vi } from 'vitest';

import {
    readServiceCompanyAuthorityFoundation,
    ServiceAuthorityFoundationError
} from '../../scripts/read-service-company-authority-foundation.js';

function client(overrides = {}) {
    const queries = [];
    const query = vi.fn(async (sql, parameters = []) => {
        const compact = String(sql).replace(/\s+/gu, ' ').trim();
        queries.push({ sql: compact, parameters });
        if (compact === 'BEGIN READ ONLY' || compact === 'COMMIT' || compact === 'ROLLBACK') {
            return { rows: [] };
        }
        if (compact.includes("set_config('brainbase.tenant_id'")) return { rows: [{ set_config: 'ok' }] };
        if (compact.includes('FROM brainbase_tenants')) {
            return { rows: overrides.tenants ?? [{
                tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
                tenant_key: 'unson-business',
                tenant_revision: 7,
                status: 'active'
            }] };
        }
        if (compact.includes('FROM tenant_organizations')) {
            return { rows: overrides.organizations ?? [{ organization_id: 'unson' }] };
        }
        if (compact.includes('FROM tenant_projects')) {
            return { rows: overrides.projects ?? [{
                project_id: 'proj_brainbase',
                project_code: 'brainbase'
            }] };
        }
        if (compact.includes('FROM workspace_connections')) {
            return { rows: overrides.connections ?? [{
                connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW',
                connection_revision: 11,
                installation_id: 'installation-unson',
                workspace_id: 'T_UNSON',
                app_id: 'A_MANA',
                granted_scopes: ['chat:write', 'app_mentions:read'],
                status: 'active'
            }] };
        }
        if (compact.includes('FROM brainbase_service_actors')) {
            return { rows: overrides.actors ?? [{
                actor_id: 'mana_autonomy_v0',
                tenant_key: 'unson-business',
                canonical_project_id: 'proj_brainbase',
                status: 'active'
            }] };
        }
        if (compact.includes('FROM brainbase_service_actor_capabilities')) {
            return { rows: overrides.capabilities ?? [
                { capability_id: 'create_task' },
                { capability_id: 'read_graph' }
            ] };
        }
        if (compact.includes('FROM tenant_service_actor_registrations')) {
            return { rows: overrides.registrations ?? [{
                placement_id: 'mana-autonomy',
                registration_revision: 1,
                status: 'active'
            }] };
        }
        if (compact.includes('FROM company_external_identities')) {
            return { rows: overrides.identities ?? [{
                identity_id: 'svc_identity_1',
                identity_revision: 1,
                membership_id: 'svc_membership_1',
                project_id: 'proj_brainbase',
                placement_id: 'mana-autonomy',
                principal_type: 'service',
                status: 'active'
            }] };
        }
        if (compact.includes('FROM company_authority_bindings')) {
            return { rows: overrides.bindings ?? [{
                binding_id: 'svc_binding_1',
                binding_revision: 1,
                membership_id: 'svc_membership_1',
                resource_ref: 'project:brainbase',
                capability_id: 'task.create',
                decision: 'auto',
                allowed_effects: ['write'],
                policy_revision: '1',
                raci_revision: '1',
                status: 'active',
                valid_from: '2026-08-26T00:00:00.000Z',
                valid_until: '2026-08-27T00:00:00.000Z'
            }] };
        }
        throw new Error(`unexpected query: ${compact}`);
    });
    return { query, queries };
}

describe('service Company Authority foundation readback', () => {
    it('returns only canonical non-secret identifiers from one read-only transaction', async () => {
        const current = client();
        const result = await readServiceCompanyAuthorityFoundation({
            client: current,
            tenantKey: 'unson-business',
            projectCode: 'brainbase',
            actorId: 'mana_autonomy_v0',
            workspaceId: 'T_UNSON',
            appId: 'A_MANA'
        });
        expect(result).toMatchObject({
            ok: true,
            mode: 'read-only',
            tenant: {
                tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV',
                tenant_key: 'unson-business',
                tenant_revision: '7',
                status: 'active'
            },
            organization: { organization_id: 'unson' },
            project: { project_id: 'proj_brainbase', project_code: 'brainbase' },
            workspace_connection: {
                connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAW',
                connection_revision: '11',
                workspace_id: 'T_UNSON',
                app_id: 'A_MANA'
            },
            service_actor: {
                actor_id: 'mana_autonomy_v0',
                canonical_project_id: 'proj_brainbase',
                placement_id: 'mana-autonomy',
                capabilities: ['create_task', 'read_graph']
            },
            company_identity: {
                identity_id: 'svc_identity_1',
                principal_type: 'service'
            }
        });
        expect(current.queries[0].sql).toBe('BEGIN READ ONLY');
        expect(current.queries.at(-1).sql).toBe('COMMIT');
        expect(current.queries.every(({ sql }) => !/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/iu.test(sql)))
            .toBe(true);
    });

    it('reports a missing actor without inventing registration or authority', async () => {
        const current = client({ actors: [], identities: [], bindings: [] });
        const result = await readServiceCompanyAuthorityFoundation({
            client: current,
            tenantKey: 'unson-business',
            projectCode: 'brainbase',
            actorId: 'mana_autonomy_v0',
            workspaceId: 'T_UNSON',
            appId: 'A_MANA'
        });
        expect(result.service_actor).toBeNull();
        expect(result.company_identity).toBeNull();
        expect(result.company_authority_bindings).toEqual([]);
        expect(current.queries.some(({ sql }) => sql.includes('FROM brainbase_service_actor_capabilities')))
            .toBe(false);
    });

    it('fails closed on ambiguity and rolls back', async () => {
        const current = client({
            organizations: [{ organization_id: 'unson' }, { organization_id: 'other' }]
        });
        await expect(readServiceCompanyAuthorityFoundation({
            client: current,
            tenantKey: 'unson-business',
            projectCode: 'brainbase',
            actorId: 'mana_autonomy_v0',
            workspaceId: 'T_UNSON',
            appId: 'A_MANA'
        })).rejects.toBeInstanceOf(ServiceAuthorityFoundationError);
        expect(current.queries.at(-1).sql).toBe('ROLLBACK');
    });

    it('requires workspace and app filters together', async () => {
        const current = client();
        await expect(readServiceCompanyAuthorityFoundation({
            client: current,
            tenantKey: 'unson-business',
            projectCode: 'brainbase',
            actorId: 'mana_autonomy_v0',
            workspaceId: 'T_UNSON'
        })).rejects.toMatchObject({ code: 'WORKSPACE_FILTER_INCOMPLETE' });
        expect(current.query).not.toHaveBeenCalled();
    });
});
