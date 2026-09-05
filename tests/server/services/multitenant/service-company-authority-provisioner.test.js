import { describe, expect, it } from 'vitest';

import {
    normalizeServiceCompanyAuthorityManifest,
    provisionServiceCompanyAuthority,
    ServiceCompanyAuthorityProvisioningError
} from '../../../../server/services/multitenant/service-company-authority-provisioner.js';

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';

function manifest(overrides = {}) {
    return {
        version: 'service-company-authority.v1',
        tenant_id: tenantId,
        organization_id: 'unson',
        project: {
            project_id: 'prj_brainbase_deployment',
            project_code: 'brainbase-deployment'
        },
        transport: {
            workspace_id: 'T_UNSON',
            app_id: 'A_MANA'
        },
        service_actor: {
            actor_id: 'mana_autonomy_v0',
            placement_id: 'mana-autonomy',
            bindings: [
                {
                    registry_capability: 'create_task',
                    resource_ref: 'project:brainbase-deployment',
                    capability_id: 'task.create',
                    decision: 'auto',
                    allowed_effects: ['write'],
                    resource_revision: '1',
                    policy_revision: '1',
                    raci_revision: '1',
                    stop_conditions: ['autonomy_kill_switch_active'],
                    valid_from: '2026-08-26T00:00:00.000Z',
                    valid_until: '2026-08-27T00:00:00.000Z'
                },
                {
                    registry_capability: 'read_graph',
                    resource_ref: 'project:brainbase-deployment',
                    capability_id: 'graph.read',
                    decision: 'auto',
                    allowed_effects: ['read'],
                    resource_revision: '1',
                    policy_revision: '1',
                    raci_revision: '1',
                    stop_conditions: ['autonomy_kill_switch_active'],
                    valid_from: '2026-08-26T00:00:00.000Z',
                    valid_until: '2026-08-27T00:00:00.000Z'
                }
            ]
        },
        ...overrides
    };
}

function clone(value) {
    return structuredClone(value);
}

function fakeClient() {
    const state = {
        membership: [],
        identities: [],
        bindings: []
    };
    let transactionSnapshot = null;
    const queries = [];
    const query = async (sql, parameters = []) => {
        const compact = String(sql).replace(/\s+/gu, ' ').trim();
        queries.push({ sql: compact, parameters: clone(parameters) });
        if (compact === 'BEGIN') {
            transactionSnapshot = clone(state);
            return { rows: [] };
        }
        if (compact === 'ROLLBACK') {
            if (transactionSnapshot) {
                state.membership = transactionSnapshot.membership;
                state.identities = transactionSnapshot.identities;
                state.bindings = transactionSnapshot.bindings;
            }
            transactionSnapshot = null;
            return { rows: [] };
        }
        if (compact === 'COMMIT') {
            transactionSnapshot = null;
            return { rows: [] };
        }
        if (compact.includes("set_config('brainbase.tenant_id'")) return { rows: [{ set_config: tenantId }] };
        if (compact.includes('pg_advisory_xact_lock')) return { rows: [{ pg_advisory_xact_lock: null }] };
        if (compact.includes('FROM brainbase_tenants')) {
            return { rows: [{ tenant_id: tenantId, tenant_key: 'unson-business', tenant_revision: 7, status: 'active' }] };
        }
        if (compact.includes('FROM tenant_organizations')) return { rows: [{ organization_id: 'unson' }] };
        if (compact.includes('FROM tenant_projects')) {
            return { rows: [{ project_id: 'prj_brainbase_deployment', project_code: 'brainbase-deployment' }] };
        }
        if (compact.includes('FROM brainbase_service_actors')) {
            return { rows: [{ actor_id: 'mana_autonomy_v0', tenant_key: 'unson-business', canonical_project_id: 'prj_service_home', status: 'active' }] };
        }
        if (compact.includes('FROM brainbase_service_actor_capabilities')) {
            return { rows: [{ capability_id: parameters[2] }] };
        }
        if (compact.startsWith('SELECT membership_id') && compact.includes('FROM tenant_memberships')) {
            return { rows: state.membership.filter((row) =>
                row.organization_id === parameters[1] && row.principal_id === parameters[2]).slice(0, 2) };
        }
        if (compact.startsWith('INSERT INTO tenant_memberships')) {
            state.membership.push({
                membership_id: parameters[0],
                organization_id: parameters[3],
                principal_id: parameters[4],
                membership_payload: JSON.parse(parameters[5])
            });
            return { rows: [] };
        }
        if (compact.startsWith('SELECT identity_id') && compact.includes('FROM company_external_identities')) {
            return { rows: state.identities.filter((row) =>
                row.authenticated_subject_id === parameters[1]
                && row.workspace_id === parameters[2]
                && row.app_id === parameters[3]
                && row.project_id === parameters[4])
                .sort((left, right) => Number(right.identity_revision) - Number(left.identity_revision))
                .slice(0, 2) };
        }
        if (compact.startsWith('INSERT INTO company_external_identities')) {
            state.identities.push({
                identity_id: parameters[0],
                identity_revision: parameters[1],
                provider: 'service',
                authenticated_subject_id: parameters[4],
                workspace_id: parameters[5],
                app_id: parameters[6],
                membership_id: parameters[7],
                project_id: parameters[8],
                placement_id: parameters[9],
                principal_type: 'service',
                status: 'active'
            });
            return { rows: [] };
        }
        if (compact.startsWith('SELECT binding_id') && compact.includes('FROM company_authority_bindings')) {
            return { rows: state.bindings.filter((row) =>
                row.membership_id === parameters[1]
                && row.organization_id === parameters[2]
                && row.project_id === parameters[3]
                && row.resource_ref === parameters[4]
                && row.capability_id === parameters[5])
                .sort((left, right) => Number(right.binding_revision) - Number(left.binding_revision))
                .slice(0, 2) };
        }
        if (compact.startsWith('INSERT INTO company_authority_bindings')) {
            state.bindings.push({
                binding_id: parameters[0],
                binding_revision: parameters[1],
                membership_id: parameters[4],
                organization_id: parameters[5],
                project_id: parameters[6],
                resource_ref: parameters[7],
                resource_revision: parameters[8],
                capability_id: parameters[9],
                decision: parameters[10],
                allowed_effects: clone(parameters[11]),
                responsible_person_id: parameters[12],
                accountable_person_id: parameters[13],
                approver_person_id: parameters[14],
                delegated_by_person_id: parameters[15],
                policy_revision: parameters[16],
                raci_revision: parameters[17],
                stop_conditions: clone(parameters[18]),
                status: 'active',
                valid_from: parameters[19],
                valid_until: parameters[20]
            });
            return { rows: [] };
        }
        throw new Error(`unexpected query: ${compact}`);
    };
    return { query, state, queries };
}

describe('service company authority provisioning', () => {
    it('requires an explicit registry-to-company capability mapping and rejects secrets', () => {
        const normalized = normalizeServiceCompanyAuthorityManifest(manifest());
        expect(normalized.service_actor.bindings[0]).toMatchObject({
            registry_capability: 'create_task',
            capability_id: 'task.create'
        });
        const missingMapping = manifest();
        delete missingMapping.service_actor.bindings[0].registry_capability;
        expect(() => normalizeServiceCompanyAuthorityManifest(missingMapping)).toThrow(ServiceCompanyAuthorityProvisioningError);
        expect(() => normalizeServiceCompanyAuthorityManifest({
            ...manifest(),
            client_secret: 'must-not-enter-control-plane'
        })).toThrowError(expect.objectContaining({ code: 'MANIFEST_SECRET_FORBIDDEN' }));
    });

    it('proves the full mutation and readback in a transaction, then rolls it back for dry-run', async () => {
        const client = fakeClient();
        const result = await provisionServiceCompanyAuthority({
            client,
            manifest: manifest(),
            actorId: 'operator-keigo',
            commit: false
        });
        expect(result.persisted).toBe(false);
        expect(result.snapshot_before).toEqual({ membership: null, identity: null });
        expect(result.plan).toEqual(expect.arrayContaining([
            expect.objectContaining({ operation: 'create', entity: 'tenant_membership' }),
            expect.objectContaining({ operation: 'create', entity: 'company_external_identity' }),
            expect.objectContaining({ operation: 'create', entity: 'company_authority_binding', capability_id: 'task.create' }),
            expect.objectContaining({ operation: 'create', entity: 'company_authority_binding', capability_id: 'graph.read' })
        ]));
        expect(result.snapshot_after.identity).toMatchObject({
            provider: 'service',
            authenticated_subject_id: 'mana_autonomy_v0',
            project_id: 'prj_brainbase_deployment',
            placement_id: 'mana-autonomy'
        });
        expect(result.snapshot_after.bindings).toHaveLength(2);
        expect(client.state.membership).toHaveLength(0);
        expect(client.state.identities).toHaveLength(0);
        expect(client.state.bindings).toHaveLength(0);
        expect(client.queries.at(-1)?.sql).toBe('ROLLBACK');
    });

    it('scopes a tenant service actor to an explicitly bound project outside its registry home', async () => {
        const client = fakeClient();
        const result = await provisionServiceCompanyAuthority({
            client,
            manifest: manifest(),
            actorId: 'operator-keigo',
            commit: true
        });
        expect(result.snapshot_after.identity).toMatchObject({
            authenticated_subject_id: 'mana_autonomy_v0',
            project_id: 'prj_brainbase_deployment'
        });
        expect(result.snapshot_after.bindings.map((binding) => binding.project_id))
            .toEqual(['prj_brainbase_deployment', 'prj_brainbase_deployment']);
    });

    it('commits an exact authority set and becomes a no-op on replay', async () => {
        const client = fakeClient();
        const first = await provisionServiceCompanyAuthority({
            client,
            manifest: manifest(),
            actorId: 'operator-keigo',
            commit: true
        });
        expect(first.persisted).toBe(true);
        expect(client.state.membership).toHaveLength(1);
        expect(client.state.identities).toHaveLength(1);
        expect(client.state.bindings).toHaveLength(2);
        expect(client.queries.at(-1)?.sql).toBe('COMMIT');

        const second = await provisionServiceCompanyAuthority({
            client,
            manifest: manifest(),
            actorId: 'operator-keigo',
            commit: true
        });
        expect(second.plan.every((item) => item.operation === 'noop')).toBe(true);
        expect(client.state.membership).toHaveLength(1);
        expect(client.state.identities).toHaveLength(1);
        expect(client.state.bindings).toHaveLength(2);
    });

    it('fails closed and rolls back when canonical membership differs', async () => {
        const client = fakeClient();
        await provisionServiceCompanyAuthority({
            client,
            manifest: manifest(),
            actorId: 'operator-keigo',
            commit: true
        });
        client.state.membership[0].membership_payload.status = 'suspended';
        await expect(provisionServiceCompanyAuthority({
            client,
            manifest: manifest(),
            actorId: 'operator-keigo',
            commit: true
        })).rejects.toMatchObject({ code: 'SERVICE_MEMBERSHIP_CONFLICT' });
        expect(client.queries.at(-1)?.sql).toBe('ROLLBACK');
        expect(client.state.membership[0].membership_payload.status).toBe('suspended');
    });
});
