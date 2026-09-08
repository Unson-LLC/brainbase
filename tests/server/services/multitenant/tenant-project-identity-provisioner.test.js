import { describe, expect, it, vi } from 'vitest';

import {
    normalizeTenantProjectIdentityManifest,
    provisionTenantProjectIdentity,
    readbackTenantProjectIdentity,
    TenantProjectIdentityProvisioningError
} from '../../../../server/services/multitenant/tenant-project-identity-provisioner.js';

const TARGET = {
    tenant_id: 'ten_01M0HMA228ES64N4TFX846V8T8',
    tenant_key: 'unson-business',
    organization_id: 'ten_01M0HMA228ES64N4TFX846V8T8',
    project_id: 'prj_01KGCS8BC76XRHFCHRRQ8G25MY',
    project_code: 'baao',
    connection_id: 'wsc_01M0HRK94FG2Y8DMBFYJHYT14K',
    installation_id: 'slack_T0882T8N9UH_A0BPM2J33SN',
    workspace_id: 'T0882T8N9UH',
    app_id: 'A0BPM2J33SN',
    person_id: 'per_01KGYC7NNS0VXADK7NP48W4VR5',
    slack_user_id: 'U088D1HBY6L',
    membership_id: 'membership:unson-business:U088D1HBY6L',
    placement_id: 'minutes-baao-growin'
};

function manifest(overrides = {}) {
    return {
        version: 'tenant-project-identity.v1',
        tenant_id: TARGET.tenant_id,
        tenant_key: TARGET.tenant_key,
        organization_id: TARGET.organization_id,
        project: { project_id: TARGET.project_id, project_code: TARGET.project_code },
        transport: {
            provider: 'slack',
            workspace_id: TARGET.workspace_id,
            app_id: TARGET.app_id,
            connection_id: TARGET.connection_id,
            installation_id: TARGET.installation_id
        },
        humans: [{
            person_id: TARGET.person_id,
            slack_user_id: TARGET.slack_user_id,
            membership_id: TARGET.membership_id,
            membership_revision: '1',
            expected_project_codes: ['mana', 'brainbase'],
            expected_role: 'tenant_admin',
            expected_tenant_role: null,
            membership_repairs: {
                tenant_role: { from: null, to: 'tenant_admin' },
                principal_type: { from: null, to: 'person' }
            },
            expected_clearance: ['internal'],
            placement_id: TARGET.placement_id
        }],
        ...overrides
    };
}

function satoMembership(projectCodes = ['mana', 'brainbase'], {
    tenantRole = null,
    principalType = null
} = {}) {
    return {
        membership_id: TARGET.membership_id,
        tenant_id: TARGET.tenant_id,
        organization_id: TARGET.organization_id,
        principal_id: TARGET.person_id,
        membership_payload: {
            status: 'active',
            revision: '1',
            role: 'tenant_admin',
            tenant_role: tenantRole,
            principal_type: principalType,
            slack_user_id: TARGET.slack_user_id,
            slack_workspace_id: TARGET.workspace_id,
            project_codes: [...projectCodes],
            clearance: ['internal'],
            preserved_field: 'keep-existing-value'
        }
    };
}

function missingFieldRepairManifest() {
    const value = manifest();
    value.humans[0].membership_repairs = {
        tenant_role: { from_missing: true, to: 'tenant_admin' },
        principal_type: { from_missing: true, to: 'person' }
    };
    return value;
}

function fakeClient({
    project = null,
    membership = satoMembership(['mana', 'brainbase']),
    identity = null,
    queryFailure = null,
    organizationStatus = 'active'
} = {}) {
    const queries = [];
    const state = {
        project,
        memberships: membership ? [structuredClone(membership)] : [],
        identities: identity ? [structuredClone(identity)] : [],
        connection: {
            connection_id: TARGET.connection_id,
            connection_revision: 1,
            provider: 'slack',
            installation_id: TARGET.installation_id,
            workspace_id: TARGET.workspace_id,
            app_id: TARGET.app_id,
            status: 'active',
            credential_ref: 'opaque:broker-ref'
        }
    };
    let transactionSnapshot = null;
    const query = vi.fn(async (sql, values = []) => {
        const compact = String(sql).replace(/\s+/gu, ' ').trim();
        queries.push({ sql: compact, values });
        const failure = queryFailure?.({ sql: compact, values });
        if (failure) throw failure;
        if (compact === 'BEGIN') {
            transactionSnapshot = structuredClone(state);
            return { rows: [] };
        }
        if (compact === 'COMMIT') {
            transactionSnapshot = null;
            return { rows: [] };
        }
        if (compact === 'ROLLBACK') {
            if (transactionSnapshot) {
                state.project = transactionSnapshot.project;
                state.memberships = transactionSnapshot.memberships;
                state.identities = transactionSnapshot.identities;
                state.connection = transactionSnapshot.connection;
            }
            transactionSnapshot = null;
            return { rows: [] };
        }
        if (compact.includes('set_config') || compact.includes('pg_advisory') || compact.startsWith('SET LOCAL')) {
            return { rows: [] };
        }
        if (compact.includes('FROM brainbase_tenants')) {
            return { rows: [{
                tenant_id: TARGET.tenant_id,
                tenant_key: TARGET.tenant_key,
                tenant_revision: 7,
                status: 'active'
            }] };
        }
        if (compact.includes('FROM tenant_organizations')) {
            return {
                rows: [{
                    organization_id: TARGET.organization_id,
                    tenant_id: TARGET.tenant_id,
                    organization_payload: { status: organizationStatus }
                }]
            };
        }
        if (compact.includes('FROM workspace_connections')) {
            return { rows: state.connection ? [state.connection] : [] };
        }
        if (compact.includes('FROM credential_broker_refs')) {
            return { rows: [{ credential_ref: state.connection.credential_ref }] };
        }
        if (compact.startsWith('INSERT INTO tenant_projects')) {
            state.project = {
                project_id: values[0],
                tenant_id: values[1],
                project_code: values[3],
                project_payload: JSON.parse(values[4])
            };
            return { rowCount: 1, rows: [state.project] };
        }
        if (compact.includes('FROM tenant_projects')) {
            if (compact.includes('project_code = $2')) {
                return { rows: state.project && state.project.project_code === values[1] ? [state.project] : [] };
            }
            if (compact.includes('project_id = $1')) {
                return { rows: state.project && state.project.project_id === values[0] ? [state.project] : [] };
            }
            return { rows: state.project ? [state.project] : [] };
        }
        if (compact.includes('FROM people')) {
            return { rows: [{ id: TARGET.person_id, name: '佐藤 圭吾', status: 'active' }] };
        }
        if (compact.startsWith('UPDATE tenant_memberships')) {
            const current = state.memberships.find((entry) => entry.membership_id === values[0]);
            current.membership_payload = JSON.parse(values[1]);
            return { rowCount: 1, rows: [] };
        }
        if (compact.includes('FROM tenant_memberships')) {
            return { rows: state.memberships.filter((entry) => entry.principal_id === values[2]) };
        }
        if (compact.includes('MAX(identity_revision)')) {
            const max = state.identities.reduce((highest, entry) => Math.max(highest, Number(entry.identity_revision) || 0), 0);
            return { rows: [{ max_revision: String(max) }] };
        }
        if (compact.startsWith('INSERT INTO company_external_identities')) {
            const created = {
                identity_id: values[0],
                identity_revision: values[1],
                tenant_id: values[2],
                provider: values[4],
                authenticated_subject_id: values[5],
                workspace_id: values[6],
                app_id: values[7],
                membership_id: values[8],
                project_id: values[9],
                placement_id: values[10],
                principal_type: 'person',
                status: 'active'
            };
            state.identities.push(created);
            return { rowCount: 1, rows: [] };
        }
        if (compact.includes('FROM company_external_identities')) {
            return { rows: state.identities.filter((entry) => entry.authenticated_subject_id === values[2]) };
        }
        throw new Error(`Unhandled SQL in test fake: ${compact}`);
    });
    return { query, queries, state };
}

function identity() {
    return {
        identity_id: 'human_identity_existing_baao',
        identity_revision: 1,
        tenant_id: TARGET.tenant_id,
        provider: 'slack',
        authenticated_subject_id: TARGET.slack_user_id,
        workspace_id: TARGET.workspace_id,
        app_id: TARGET.app_id,
        membership_id: TARGET.membership_id,
        project_id: TARGET.project_id,
        placement_id: TARGET.placement_id,
        principal_type: 'person',
        status: 'active'
    };
}

const projectResolver = {
    resolveCanonicalProject: vi.fn(async () => ({ project_id: TARGET.project_id, matches: 1 }))
};

describe('tenant project identity provisioner', () => {
    it('normalizes the additive manifest and rejects authority or secret fields', () => {
        const normalized = normalizeTenantProjectIdentityManifest(manifest());
        expect(normalized.project).toEqual({ project_id: TARGET.project_id, project_code: 'baao' });
        expect(normalized.humans[0].membership_repairs).toEqual({
            tenant_role: { from: null, to: 'tenant_admin' },
            principal_type: { from: null, to: 'person' }
        });
        expect(Object.isFrozen(normalized)).toBe(true);
        expect(() => normalizeTenantProjectIdentityManifest({ ...manifest(), auth_grants: [] }))
            .toThrow(TenantProjectIdentityProvisioningError);
        expect(() => normalizeTenantProjectIdentityManifest({ ...manifest(), client_secret: 'hidden' }))
            .toThrow(/secret/u);
        const invalidRepair = manifest();
        invalidRepair.humans[0].membership_repairs.tenant_role.from = 'member';
        expect(() => normalizeTenantProjectIdentityManifest(invalidRepair))
            .toThrow(/must be null/u);
    });

    it('plans the project, additive membership code, and identity without writing grants', async () => {
        const client = fakeClient({ membership: satoMembership(['mana', 'brainbase']) });
        const result = await provisionTenantProjectIdentity({
            client,
            manifest: manifest(),
            actorId: 'operator-keigo',
            projectResolver,
            commit: false
        });
        expect(result.persisted).toBe(false);
        expect(result.plan).toEqual(expect.arrayContaining([
            { operation: 'create', entity: 'tenant_project', id: TARGET.project_id },
            { operation: 'additive_update', entity: 'tenant_membership', id: TARGET.membership_id },
            expect.objectContaining({ operation: 'create', entity: 'company_external_identity' })
        ]));
        expect(result.snapshot_before.project).toBeNull();
        expect(result.snapshot_after.project).toEqual(expect.objectContaining({ project_id: TARGET.project_id, project_code: 'baao' }));
        expect(result.snapshot_before.humans[0].membership.membership_payload).toMatchObject({
            tenant_role: null,
            principal_type: null,
            project_codes: ['mana', 'brainbase']
        });
        expect(result.snapshot_after.humans[0].membership.membership_payload).toMatchObject({
            tenant_role: 'tenant_admin',
            principal_type: 'person',
            project_codes: ['mana', 'brainbase', 'baao']
        });
        expect(result.snapshot_after.humans[0].membership.membership_payload)
            .not.toHaveProperty('preserved_field');
        expect(client.state.project).toBeNull();
        expect(client.state.memberships[0].membership_payload.project_codes).toEqual(['mana', 'brainbase']);
        expect(client.state.identities).toHaveLength(0);
        expect(client.queries.some(({ sql }) => /auth_grants/u.test(sql))).toBe(false);
        expect(client.queries.map(({ sql }) => sql)).toContain('ROLLBACK');
    });

    it('fails before any write when the approved existing membership is missing', async () => {
        const client = fakeClient({ membership: null });
        await expect(provisionTenantProjectIdentity({
            client, manifest: manifest(), actorId: 'operator-keigo', projectResolver, commit: true
        })).rejects.toMatchObject({ code: 'MEMBERSHIP_REQUIRED' });
        expect(client.queries.some(({ sql }) => /^(INSERT|UPDATE)/u.test(sql))).toBe(false);
    });

    it('never overwrites a non-null membership repair field', async () => {
        const client = fakeClient({
            membership: satoMembership(['mana', 'brainbase'], { tenantRole: 'member' })
        });
        await expect(provisionTenantProjectIdentity({
            client, manifest: manifest(), actorId: 'operator-keigo', projectResolver, commit: true
        })).rejects.toMatchObject({ code: 'MEMBERSHIP_SCOPE_CONFLICT' });
        expect(client.queries.some(({ sql }) => /^UPDATE tenant_memberships/u.test(sql))).toBe(false);
    });

    it('does not treat a missing membership field as an explicit null', async () => {
        const client = fakeClient();
        delete client.state.memberships[0].membership_payload.tenant_role;
        await expect(provisionTenantProjectIdentity({
            client, manifest: manifest(), actorId: 'operator-keigo', projectResolver, commit: true
        })).rejects.toMatchObject({ code: 'MEMBERSHIP_SCOPE_CONFLICT' });
        expect(client.queries.some(({ sql }) => /^UPDATE tenant_memberships/u.test(sql))).toBe(false);
    });

    it('fills only membership fields explicitly declared as missing', async () => {
        const client = fakeClient();
        delete client.state.memberships[0].membership_payload.tenant_role;
        delete client.state.memberships[0].membership_payload.principal_type;
        const result = await provisionTenantProjectIdentity({
            client,
            manifest: missingFieldRepairManifest(),
            actorId: 'operator-keigo',
            projectResolver,
            commit: false
        });
        expect(result.snapshot_before.humans[0].membership.membership_payload)
            .not.toHaveProperty('tenant_role');
        expect(result.snapshot_before.humans[0].membership.membership_payload)
            .not.toHaveProperty('principal_type');
        expect(result.snapshot_after.humans[0].membership.membership_payload).toMatchObject({
            tenant_role: 'tenant_admin',
            principal_type: 'person',
            project_codes: ['mana', 'brainbase', 'baao']
        });
        expect(client.state.memberships[0].membership_payload)
            .not.toHaveProperty('tenant_role');
        expect(client.state.memberships[0].membership_payload)
            .not.toHaveProperty('principal_type');
    });

    it('rejects an inactive tenant organization before projection writes', async () => {
        const client = fakeClient({ organizationStatus: 'inactive' });
        await expect(provisionTenantProjectIdentity({
            client, manifest: manifest(), actorId: 'operator-keigo', projectResolver, commit: true
        })).rejects.toMatchObject({ code: 'ORGANIZATION_INACTIVE' });
        expect(client.queries.some(({ sql }) => /^(INSERT|UPDATE)/u.test(sql))).toBe(false);
    });

    it('preserves safe database error metadata and the failed operation', async () => {
        const upstream = new Error('password=must-not-print');
        upstream.name = 'DatabaseError';
        upstream.code = '57014';
        const client = fakeClient({
            queryFailure: ({ sql }) => sql.includes('FROM tenant_organizations') ? upstream : null
        });
        await expect(provisionTenantProjectIdentity({
            client, manifest: manifest(), actorId: 'operator-keigo', projectResolver, commit: true
        })).rejects.toMatchObject({
            code: 'PROVISIONING_FAILED',
            upstream_code: '57014',
            upstream_name: 'DatabaseError',
            operation: 'organization_read'
        });
        expect(client.queries.map(({ sql }) => sql)).toContain('ROLLBACK');
    });

    it('fails before BEGIN when the canonical project resolver returns another ID', async () => {
        const client = fakeClient();
        const resolver = { resolveCanonicalProject: vi.fn(async () => ({ project_id: 'prj_01KGCS8CAJKKDWACPNK1E5WX8H', matches: 1 })) };
        await expect(provisionTenantProjectIdentity({
            client, manifest: manifest(), actorId: 'operator-keigo', projectResolver: resolver, commit: true
        })).rejects.toMatchObject({ code: 'PROJECT_UNAVAILABLE' });
        expect(client.queries).toHaveLength(0);
    });

    it('is idempotent when the exact projected state already exists', async () => {
        const client = fakeClient({
            project: { project_id: TARGET.project_id, tenant_id: TARGET.tenant_id, project_code: TARGET.project_code },
            membership: satoMembership(['mana', 'brainbase', 'baao'], {
                tenantRole: 'tenant_admin', principalType: 'person'
            }),
            identity: identity()
        });
        const result = await provisionTenantProjectIdentity({
            client, manifest: manifest(), actorId: 'operator-keigo', projectResolver, commit: false
        });
        expect(result.plan).toEqual([
            { operation: 'noop', entity: 'tenant_project', id: TARGET.project_id },
            { operation: 'noop', entity: 'tenant_membership', id: TARGET.membership_id },
            { operation: 'noop', entity: 'company_external_identity', id: 'human_identity_existing_baao' }
        ]);
        expect(client.queries.some(({ sql }) => /^(INSERT|UPDATE)/u.test(sql))).toBe(false);
    });

    it('requires the Slack identity in committed readback', async () => {
        const client = fakeClient({
            project: { project_id: TARGET.project_id, tenant_id: TARGET.tenant_id, project_code: TARGET.project_code },
            membership: satoMembership(['mana', 'brainbase', 'baao'], {
                tenantRole: 'tenant_admin', principalType: 'person'
            })
        });
        await expect(readbackTenantProjectIdentity({ client, manifest: manifest() }))
            .rejects.toMatchObject({ code: 'READBACK_FAILED' });
        expect(client.queries.map(({ sql }) => sql)).toContain('ROLLBACK');
    });
});
