import { describe, expect, it, vi } from 'vitest';

import {
    normalizeTenantProjectAccessManifest,
    provisionTenantProjectAccess,
    readbackTenantProjectAccess,
    TenantProjectAccessProvisioningError,
    TWO_USER_ACCESS_TARGET
} from '../../../../server/services/multitenant/tenant-project-access-provisioner.js';

const target = TWO_USER_ACCESS_TARGET;

function fakeClient({ grants = [], memberships = [], identities = [], missingConnection = false, missingBroker = false, missingUmeda = false, failUmedaGrantInsert = false } = {}) {
    const queries = [];
    const state = {
        project: null,
        connection: missingConnection ? null : {
            connection_id: target.connection_id, connection_revision: 1,
            installation_id: target.installation_id, status: 'active', credential_ref: 'opaque:canonical-control-plane'
        },
        grants: [...grants], memberships: [...memberships], identities: [...identities]
    };
    const query = vi.fn(async (sql, values = []) => {
        const compact = String(sql).replace(/\s+/gu, ' ').trim(); queries.push({ sql: compact, values });
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(compact) || compact.includes('set_config') || compact.includes('pg_advisory') || compact.startsWith('SET LOCAL')) return { rows: [] };
        if (compact.includes('FROM brainbase_tenants')) return { rows: [{ tenant_id: target.tenant_id, tenant_key: target.tenant_key, tenant_revision: 3, status: 'active' }] };
        if (compact.includes('FROM tenant_organizations')) return { rows: [{ organization_id: target.organization_id }] };
        if (compact.includes('FROM tenant_projects')) return { rows: state.project ? [state.project] : [] };
        if (compact.startsWith('INSERT INTO tenant_projects')) { state.project = { project_id: target.project_id, tenant_id: target.tenant_id, project_code: target.project_code }; return { rowCount: 1, rows: [state.project] }; }
        if (compact.includes('FROM workspace_connections')) return { rows: state.connection ? [state.connection] : [] };
        if (compact.includes('FROM credential_broker_refs')) return { rows: missingBroker ? [] : [{ credential_ref: state.connection.credential_ref }] };
        if (compact.includes('FROM people')) return { rows: missingUmeda && values[0] === target.umeda.person_id ? [] : [{ id: values[0], name: values[0] === target.sato.person_id ? '佐藤 圭吾' : '梅田 遼', status: 'active' }] };
        if (compact.includes('FROM auth_grants')) return { rows: state.grants.filter((grant) => grant.slack_user_id === values[0] && grant.slack_workspace_id === values[1] && (!values[2] || (grant.organization_id ?? target.auth_organization_id) === values[2])) };
        if (compact.startsWith('INSERT INTO auth_grants')) {
            if (failUmedaGrantInsert && values[1] === target.umeda.person_id) throw new Error('forced Umeda grant failure');
            state.grants.push({ id: values[0], person_id: values[1], person_name: values[2], slack_user_id: values[3], slack_workspace_id: values[4], organization_id: values[5], role: 'member', project_codes: values[6], clearance: values[7], active: true }); return { rows: [] };
        }
        if (compact.includes('FROM tenant_memberships')) return { rows: state.memberships.filter((membership) => membership.principal_id === values[2]) };
        if (compact.startsWith('UPDATE tenant_memberships SET membership_payload')) {
            const membership = state.memberships.find((entry) => entry.membership_id === values[0]);
            membership.membership_payload = JSON.parse(values[1]);
            return { rows: [] };
        }
        if (compact.startsWith('INSERT INTO tenant_memberships')) { state.memberships.push({ membership_id: values[0], principal_id: values[4], membership_payload: JSON.parse(values[5]) }); return { rows: [] }; }
        if (compact.includes('FROM company_external_identities') && compact.includes('MAX(identity_revision)')) return { rows: [{ max_revision: '0' }] };
        if (compact.includes('FROM company_external_identities')) return { rows: state.identities.filter((identity) => identity.authenticated_subject_id === values[1]) };
        if (compact.startsWith('INSERT INTO company_external_identities')) { state.identities.push({ identity_id: values[0], authenticated_subject_id: values[4], membership_id: values[7], placement_id: values[9], principal_type: 'person' }); return { rows: [] }; }
        return { rows: [] };
    });
    return { query, queries, state };
}

const projectResolver = { resolveCanonicalProject: vi.fn(async () => ({ project_id: target.project_id, matches: 1 })) };
function makeSatoExistingMembership({ projectCodes = ['mana'] } = {}) {
    return {
        membership_id: 'membership:unson-business:U088D1HBY6L', principal_id: target.sato.person_id,
        membership_payload: {
            status: 'active', revision: '1', role: 'tenant_admin', clearance: ['internal'],
            project_codes: [...projectCodes], slack_user_id: target.sato.slack_user_id,
            slack_workspace_id: target.workspace_id, preserved_field: 'must-remain'
        }
    };
}

describe('approved Brainbase two-user access provisioner', () => {
    it('accepts no caller-configurable tenant, project, workspace, role, or principal fields', () => {
        expect(() => normalizeTenantProjectAccessManifest({ tenant_id: 'ten_other' })).toThrow(/no caller-configurable/u);
        expect(() => normalizeTenantProjectAccessManifest({ humans: [] })).toThrow(TenantProjectAccessProvisioningError);
        expect(normalizeTenantProjectAccessManifest()).toBe(target);
    });

    it('preserves Sato tenant-admin membership and appends only Brainbase while creating Umeda minimum access', async () => {
        const existingSato = makeSatoExistingMembership();
        const expectedSatoPayload = { ...existingSato.membership_payload, project_codes: ['mana', 'brainbase'] };
        const client = fakeClient({ memberships: [existingSato] });
        const result = await provisionTenantProjectAccess({ client, actorId: 'operator-keigo', projectResolver, commit: false });
        expect(result.persisted).toBe(false);
        expect(client.state.grants).toEqual(expect.arrayContaining([
            expect.objectContaining({ person_id: target.sato.person_id, slack_user_id: target.sato.slack_user_id, role: 'member', project_codes: ['brainbase'], clearance: ['internal'] }),
            expect.objectContaining({ person_id: target.umeda.person_id, slack_user_id: target.umeda.slack_user_id, role: 'member', project_codes: ['brainbase'], clearance: ['internal'] })
        ]));
        expect(client.state.memberships.find((membership) => membership.principal_id === target.sato.person_id)?.membership_payload).toEqual(expectedSatoPayload);
        expect(client.state.memberships.find((membership) => membership.principal_id === target.umeda.person_id)?.membership_payload).toEqual(expect.objectContaining({ role: 'member', tenant_role: 'member', project_codes: ['brainbase'], clearance: ['internal'] }));
        expect(result.plan.map((entry) => entry.entity)).toEqual(expect.arrayContaining(['tenant_project', 'workspace_connection', 'auth_grant', 'tenant_membership', 'company_external_identity']));
        expect(client.queries.some(({ sql }) => /brainbase_service_actor|tenant_contract|UPDATE people|UPDATE auth_grants/iu.test(sql))).toBe(false);
        expect(client.queries.filter(({ sql }) => sql.startsWith('UPDATE tenant_memberships SET membership_payload')).length).toBe(1);
        expect(client.queries.some(({ values = [] }) => values.includes('T07LL5WV7N1') || values.includes('U090R3E72UA') || values.includes('per_umeda_haruka'))).toBe(false);
        expect(client.queries.some(({ sql, values }) => sql.includes('FROM tenant_organizations') && values[0] === target.tenant_id && values[1] === target.organization_id)).toBe(true);
        expect(client.queries.some(({ sql }) => sql.includes("set_config('brainbase.tenant_id'"))).toBe(true);
        expect(client.queries.map(({ sql }) => sql)).toContain('ROLLBACK');
    });

    it('fails closed rather than updating a legacy Umeda record', async () => {
        const client = fakeClient({ memberships: [makeSatoExistingMembership()], grants: [{ id: 'legacy', person_id: 'per_umeda_haruka', person_name: '梅田', slack_user_id: target.umeda.slack_user_id, slack_workspace_id: target.workspace_id, role: 'member', project_codes: ['brainbase'], clearance: ['internal'], active: true }] });
        await expect(provisionTenantProjectAccess({ client, actorId: 'operator-keigo', projectResolver, commit: false })).rejects.toMatchObject({ code: 'LEGACY_PERSON_FORBIDDEN' });
        expect(client.queries.some(({ sql }) => sql.startsWith('UPDATE auth_grants'))).toBe(false);
    });

    it('fails closed when a pre-existing grant exceeds the approved minimum scope', async () => {
        const client = fakeClient({ memberships: [makeSatoExistingMembership()], grants: [{ id: 'sato-overbroad', person_id: target.sato.person_id, person_name: '佐藤 圭吾', slack_user_id: target.sato.slack_user_id, slack_workspace_id: target.workspace_id, role: 'ceo', project_codes: ['brainbase', 'mana'], clearance: ['internal'], active: true }] });
        await expect(provisionTenantProjectAccess({ client, actorId: 'operator-keigo', projectResolver, commit: false })).rejects.toMatchObject({ code: 'AUTH_GRANT_NOT_LEAST_PRIVILEGE' });
    });

    it('fails closed rather than changing an unexpected Sato membership scope', async () => {
        const client = fakeClient({ memberships: [makeSatoExistingMembership({ projectCodes: ['mana', 'other-project'] })] });
        await expect(provisionTenantProjectAccess({ client, actorId: 'operator-keigo', projectResolver, commit: false })).rejects.toMatchObject({ code: 'SATO_MEMBERSHIP_SCOPE_CONFLICT' });
        expect(client.queries.some(({ sql }) => /^(INSERT|UPDATE) /u.test(sql))).toBe(false);
    });

    it('fails closed rather than widening an existing Umeda membership', async () => {
        const client = fakeClient({
            memberships: [
                makeSatoExistingMembership(),
                { membership_id: 'umeda-overbroad', principal_id: target.umeda.person_id, membership_payload: { status: 'active', revision: '1', principal_type: 'person', role: 'member', tenant_role: 'member', slack_user_id: target.umeda.slack_user_id, slack_workspace_id: target.workspace_id, project_codes: ['brainbase', 'mana'], clearance: ['internal'], placement_id: target.umeda.placement_id } }
            ]
        });
        await expect(provisionTenantProjectAccess({ client, actorId: 'operator-keigo', projectResolver, commit: false })).rejects.toMatchObject({ code: 'UMEDA_MEMBERSHIP_NOT_LEAST_PRIVILEGE' });
        expect(client.queries.some(({ sql }) => /^(INSERT|UPDATE) /u.test(sql))).toBe(false);
    });

    it('reads both exact grants, memberships, and identities through a separate RLS transaction', async () => {
        const client = fakeClient({ memberships: [makeSatoExistingMembership()] });
        await provisionTenantProjectAccess({ client, actorId: 'operator-keigo', projectResolver, commit: true });
        await expect(readbackTenantProjectAccess({ client })).resolves.toMatchObject({ project_id: target.project_id, sato_person_id: target.sato.person_id, umeda_person_id: target.umeda.person_id });
        expect(client.queries.filter(({ sql }) => sql.includes("set_config('brainbase.tenant_id'")).length).toBe(2);
        expect(client.queries.map(({ sql }) => sql)).toContain('COMMIT');
    });

    it('rolls back Sato writes when Umeda fails later in the same transaction', async () => {
        const client = fakeClient({ memberships: [makeSatoExistingMembership()], failUmedaGrantInsert: true });
        await expect(provisionTenantProjectAccess({ client, actorId: 'operator-keigo', projectResolver, commit: true })).rejects.toMatchObject({ code: 'PROVISIONING_FAILED' });
        expect(client.queries.some(({ sql, values }) => sql.startsWith('INSERT INTO auth_grants') && values.includes(target.sato.person_id))).toBe(true);
        expect(client.queries.map(({ sql }) => sql)).toContain('ROLLBACK');
    });

    it('does no INSERT or UPDATE when the exact state is already present', async () => {
        const exactGrant = (person, name) => ({ id: `grant-${person.slack_user_id}`, person_id: person.person_id, person_name: name, slack_user_id: person.slack_user_id, slack_workspace_id: target.workspace_id, role: 'member', project_codes: ['brainbase'], clearance: ['internal'], active: true });
        const exactMembership = (person) => ({ membership_id: `membership-${person.slack_user_id}`, principal_id: person.person_id, membership_payload: { status: 'active', revision: '1', principal_type: 'person', role: 'member', tenant_role: 'member', slack_user_id: person.slack_user_id, slack_workspace_id: target.workspace_id, project_codes: ['brainbase'], clearance: ['internal'], placement_id: person.placement_id } });
        const sato = { person_id: target.sato.person_id, ...target.sato }; const umeda = { person_id: target.umeda.person_id, ...target.umeda };
        const memberships = [makeSatoExistingMembership({ projectCodes: ['mana', 'brainbase'] }), exactMembership(umeda)];
        expect(memberships[0].membership_payload).toEqual(expect.objectContaining({ status: 'active', role: 'tenant_admin', clearance: ['internal'], project_codes: ['mana', 'brainbase'], slack_user_id: target.sato.slack_user_id, slack_workspace_id: target.workspace_id }));
        const identities = memberships.map((membership, index) => ({ identity_id: `identity-${index}`, authenticated_subject_id: [sato, umeda][index].slack_user_id, membership_id: membership.membership_id, placement_id: [sato, umeda][index].placement_id, principal_type: 'person' }));
        const client = fakeClient({ grants: [exactGrant(sato, '佐藤 圭吾'), exactGrant(umeda, '梅田 遼')], memberships, identities });
        client.state.project = { project_id: target.project_id, tenant_id: target.tenant_id, project_code: target.project_code };
        await provisionTenantProjectAccess({ client, actorId: 'operator-keigo', projectResolver, commit: false });
        expect(client.queries.some(({ sql }) => /^(INSERT|UPDATE) /u.test(sql))).toBe(false);
    });

    it.each([
        ['workspace connection', () => fakeClient({ missingConnection: true }), 'WORKSPACE_CONNECTION_REQUIRED'],
        ['credential broker reference', () => fakeClient({ missingBroker: true }), 'CREDENTIAL_BROKER_REF_REQUIRED'],
        ['duplicate membership', () => fakeClient({ memberships: [{ membership_id: 'one', principal_id: target.sato.person_id, membership_payload: {} }, { membership_id: 'two', principal_id: target.sato.person_id, membership_payload: {} }] }), 'MEMBERSHIP_AMBIGUOUS'],
        ['duplicate identity', () => fakeClient({ memberships: [makeSatoExistingMembership()], identities: [{ identity_id: 'one', authenticated_subject_id: target.sato.slack_user_id }, { identity_id: 'two', authenticated_subject_id: target.sato.slack_user_id }] }), 'EXTERNAL_IDENTITY_AMBIGUOUS']
    ])('fails closed before any write when %s is missing or ambiguous', async (_label, makeClient, code) => {
        const client = makeClient();
        await expect(provisionTenantProjectAccess({ client, actorId: 'operator-keigo', projectResolver, commit: false })).rejects.toMatchObject({ code });
        expect(client.queries.some(({ sql }) => /^(INSERT|UPDATE) /u.test(sql))).toBe(false);
        expect(client.queries.some(({ values = [] }) => values.includes('T07LL5WV7N1') || values.includes('U090R3E72UA') || values.includes('per_umeda_haruka'))).toBe(false);
    });
});
