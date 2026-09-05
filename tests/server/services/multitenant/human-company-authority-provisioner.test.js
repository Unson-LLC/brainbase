import { describe, expect, it, vi } from 'vitest';

import {
    createInitialSlackInstallationAuthorization,
    HumanCompanyAuthorityProvisioningError,
    normalizeHumanCompanyAuthorityManifest,
    normalizeInitialTenantAdminManifest,
    provisionHumanCompanyAuthority,
    provisionInitialTenantAdmin,
    readbackInitialTenantAdmin
} from '../../../../server/services/multitenant/human-company-authority-provisioner.js';
import {
    parseProvisionHumanAuthorityArgs,
    runProvisionHumanCompanyAuthority
} from '../../../../scripts/provision-human-company-authority.js';

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const satoPersonId = 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY';
const umedaPersonId = 'per_01ARZ3NDEKTSV4RRFFQ69G5FAZ';

function manifest(overrides = {}) {
    return {
        version: 'human-company-authority.v1',
        tenant_id: tenantId,
        organization: {
            organization_id: 'org_techknight_business',
            graph_organization_id: 'techknight',
            display_name: 'Tech Knight'
        },
        project: { project_id: 'prj_techknight', project_code: 'techknight' },
        transport: { provider: 'slack', workspace_id: 'T_TECHKNIGHT', app_id: 'A_TECHKNIGHT' },
        humans: [
            {
                person_id: satoPersonId,
                person_name: '佐藤 圭吾',
                slack_user_id: 'U_KEIGO',
                login_role: 'ceo',
                project_codes: ['techknight'],
                clearance: ['internal'],
                tenant_role: 'tenant_admin',
                placement_id: 'techknight-slack-admin'
            },
            {
                person_id: umedaPersonId,
                person_name: '梅田遼',
                slack_user_id: 'U_UMEDA',
                login_role: 'member',
                project_codes: ['techknight'],
                clearance: ['internal'],
                tenant_role: 'member',
                placement_id: 'techknight-slack-member'
            }
        ],
        ...overrides
    };
}

function clone(value) {
    return structuredClone(value);
}

function fakeClient(sharedState = null) {
    const state = sharedState ?? {
        graphOrganizations: [{ id: 'techknight', name: 'Tech Knight' }],
        workspaceConnections: [{
            connection_id: 'wsc_techknight', connection_revision: 1, provider: 'slack',
            workspace_id: 'T_TECHKNIGHT', app_id: 'A_TECHKNIGHT', status: 'active'
        }],
        organizations: [], people: [], grants: [], memberships: [], identities: []
    };
    let snapshot = null;
    const queries = [];
    const query = async (sql, parameters = []) => {
        const compact = String(sql).replace(/\s+/gu, ' ').trim();
        queries.push({ sql: compact, parameters: clone(parameters) });
        if (compact === 'BEGIN') { snapshot = clone(state); return { rows: [] }; }
        if (compact === 'ROLLBACK') {
            Object.assign(state, snapshot ?? state);
            snapshot = null;
            return { rows: [] };
        }
        if (compact === 'COMMIT') { snapshot = null; return { rows: [] }; }
        if (compact.includes("set_config('brainbase.tenant_id'")) return { rows: [{ set_config: tenantId }] };
        if (compact.includes('pg_advisory_xact_lock')) return { rows: [{ pg_advisory_xact_lock: null }] };
        if (compact.includes('FROM brainbase_tenants')) {
            return { rows: [{ tenant_id: tenantId, tenant_key: 'techknight-business', tenant_revision: 1, status: 'active' }] };
        }
        if (compact.includes('FROM tenant_projects')) {
            return { rows: [{ project_id: 'prj_techknight', project_code: 'techknight' }] };
        }
        if (compact.includes('FROM organizations')) {
            return { rows: state.graphOrganizations.filter((row) => row.id === parameters[0]) };
        }
        if (compact.includes('FROM workspace_connections')) {
            return { rows: state.workspaceConnections.filter((row) =>
                row.provider === parameters[1] && row.workspace_id === parameters[2]
                && row.app_id === parameters[3] && row.status === 'active').slice(0, 2) };
        }
        if (compact.startsWith('SELECT organization_id') && compact.includes('FROM tenant_organizations')) {
            return { rows: state.organizations.filter((row) => row.organization_id === parameters[1]) };
        }
        if (compact.startsWith('INSERT INTO tenant_organizations')) {
            state.organizations.push({ organization_id: parameters[0], organization_payload: JSON.parse(parameters[3]) });
            return { rows: [] };
        }
        if (compact.startsWith('SELECT id, name, status FROM people')) {
            return { rows: state.people.filter((row) => row.id === parameters[0]) };
        }
        if (compact.startsWith('INSERT INTO people')) {
            state.people.push({ id: parameters[0], name: parameters[1], status: 'active' });
            return { rows: [] };
        }
        if (compact.startsWith('SELECT id, person_id') && compact.includes('FROM auth_grants')) {
            return { rows: state.grants.filter((row) =>
                row.slack_user_id === parameters[0] && row.slack_workspace_id === parameters[1]).slice(0, 2) };
        }
        if (compact.startsWith('INSERT INTO auth_grants')) {
            state.grants.push({
                id: parameters[0], person_id: parameters[1], person_name: parameters[2],
                slack_user_id: parameters[3], slack_workspace_id: parameters[4], role: parameters[5],
                project_codes: clone(parameters[6]), clearance: clone(parameters[7]), active: true
            });
            return { rows: [] };
        }
        if (compact.startsWith('SELECT membership_id') && compact.includes('FROM tenant_memberships')) {
            return { rows: state.memberships.filter((row) =>
                row.organization_id === parameters[1] && row.principal_id === parameters[2]).slice(0, 2) };
        }
        if (compact.startsWith('INSERT INTO tenant_memberships')) {
            state.memberships.push({
                membership_id: parameters[0], organization_id: parameters[3],
                principal_id: parameters[4], membership_payload: JSON.parse(parameters[5])
            });
            return { rows: [] };
        }
        if (compact.startsWith('SELECT identity_id') && compact.includes('FROM company_external_identities')) {
            return { rows: state.identities.filter((row) =>
                row.authenticated_subject_id === parameters[1]
                && row.workspace_id === parameters[2]
                && row.app_id === parameters[3]
                && row.project_id === parameters[4]
                && row.status === 'active')
                .sort((left, right) => Number(right.identity_revision) - Number(left.identity_revision))
                .slice(0, 2) };
        }
        if (compact.startsWith('SELECT COALESCE(MAX(identity_revision)')) {
            const revisions = state.identities.filter((row) =>
                row.authenticated_subject_id === parameters[1]
                && row.workspace_id === parameters[2]
                && row.app_id === parameters[3]
                && row.project_id === parameters[4])
                .map((row) => Number(row.identity_revision));
            return { rows: [{ max_revision: String(revisions.length ? Math.max(...revisions) : 0) }] };
        }
        if (compact.startsWith('INSERT INTO company_external_identities')) {
            state.identities.push({
                identity_id: parameters[0], identity_revision: parameters[1], provider: 'slack',
                authenticated_subject_id: parameters[4], workspace_id: parameters[5], app_id: parameters[6],
                membership_id: parameters[7], project_id: parameters[8], placement_id: parameters[9],
                principal_type: 'person', status: 'active'
            });
            return { rows: [] };
        }
        throw new Error(`unexpected query: ${compact}`);
    };
    return { query, state, queries };
}

describe('human company authority provisioning', () => {
    it('accepts exactly one initial tenant admin and rejects broader bootstrap scope', () => {
        const adminOnly = { ...manifest(), humans: [manifest().humans[0]] };
        expect(normalizeInitialTenantAdminManifest(adminOnly).humans).toHaveLength(1);
        expect(() => normalizeInitialTenantAdminManifest(manifest()))
            .toThrowError(expect.objectContaining({ code: 'INITIAL_TENANT_ADMIN_REQUIRED' }));
        expect(() => normalizeInitialTenantAdminManifest({ ...manifest(), humans: [manifest().humans[1]] }))
            .toThrowError(expect.objectContaining({ code: 'INITIAL_TENANT_ADMIN_REQUIRED' }));
        expect(() => normalizeInitialTenantAdminManifest({
            ...manifest(),
            humans: [{ ...manifest().humans[0], login_role: 'member' }]
        })).toThrowError(expect.objectContaining({ code: 'INITIAL_TENANT_ADMIN_REQUIRED' }));
    });

    it('bootstraps only the initial admin states without a workspace connection or external identity', async () => {
        const client = fakeClient();
        client.state.workspaceConnections = [];
        const adminOnly = { ...manifest(), humans: [manifest().humans[0]] };
        const result = await provisionInitialTenantAdmin({
            client, manifest: adminOnly, actorId: 'operator-keigo', commit: true
        });
        expect(result.persisted).toBe(true);
        expect(result.plan.map((entry) => entry.entity)).toEqual([
            'tenant_organization', 'person', 'auth_grant', 'tenant_membership'
        ]);
        expect(result.snapshot_after.human.external_identity).toBeUndefined();
        expect(client.state.memberships).toHaveLength(1);
        expect(client.state.identities).toHaveLength(0);
        await expect(readbackInitialTenantAdmin({ client, manifest: adminOnly })).resolves.toMatchObject({
            human: {
                person_id: satoPersonId,
                membership: { principal_id: satoPersonId }
            }
        });
    });

    it('issues an OAuth URL only after exact initial admin readback', async () => {
        const client = fakeClient();
        client.state.workspaceConnections = [];
        const adminOnly = { ...manifest(), humans: [manifest().humans[0]] };
        await provisionInitialTenantAdmin({
            client, manifest: adminOnly, actorId: 'operator-keigo', commit: true
        });
        const authorizeBinding = vi.fn(async (binding) => binding);
        const createAuthorization = vi.fn((binding) => ({
            authorization_url: `https://slack.example/authorize?intent=${binding.installation_intent_id}`,
            oauth_state: 'signed-state',
            redirect_uri: 'https://bb.example/api/v1/slack-installations:callback'
        }));
        const result = await createInitialSlackInstallationAuthorization({
            client,
            manifest: adminOnly,
            actorId: 'operator-keigo',
            controlPlane: { authorizeBinding },
            oauthFlow: { createAuthorization }
        });
        expect(authorizeBinding).toHaveBeenCalledWith(expect.objectContaining({
            tenant_id: tenantId,
            app_id: 'A_TECHKNIGHT',
            expected_workspace_id: 'T_TECHKNIGHT',
            initiated_by_person_id: satoPersonId,
            installation_intent_id: expect.stringMatching(/^insi_[0-9A-HJKMNP-TV-Z]{26}$/u)
        }), { client });
        expect(createAuthorization).toHaveBeenCalledOnce();
        expect(client.queries.filter((query) => query.sql.includes('FROM brainbase_tenants'))
            .some((query) => query.sql.includes('FOR SHARE'))).toBe(true);
        expect(result).toMatchObject({
            tenant_id: tenantId,
            initiated_by_person_id: satoPersonId,
            authorization_url: expect.stringContaining('https://slack.example/authorize')
        });
    });

    it('rolls back the initial authorization transaction when OAuth URL creation fails', async () => {
        const client = fakeClient();
        client.state.workspaceConnections = [];
        const adminOnly = { ...manifest(), humans: [manifest().humans[0]] };
        await provisionInitialTenantAdmin({
            client, manifest: adminOnly, actorId: 'operator-keigo', commit: true
        });
        const authorizeBinding = vi.fn(async (binding) => binding);

        await expect(createInitialSlackInstallationAuthorization({
            client,
            manifest: adminOnly,
            actorId: 'operator-keigo',
            controlPlane: { authorizeBinding },
            oauthFlow: { createAuthorization: () => { throw new Error('oauth-url-failed'); } }
        })).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });

        expect(authorizeBinding).toHaveBeenCalledWith(expect.any(Object), { client });
        expect(client.queries.at(-1)?.sql).toBe('ROLLBACK');
    });

    it('normalizes a strict manifest and rejects unknown fields and secrets', () => {
        const normalized = normalizeHumanCompanyAuthorityManifest(manifest());
        expect(normalized.humans).toHaveLength(2);
        expect(normalized.humans[0]).toMatchObject({ tenant_role: 'tenant_admin', login_role: 'ceo' });
        expect(() => normalizeHumanCompanyAuthorityManifest({ ...manifest(), unexpected: true }))
            .toThrowError(expect.objectContaining({ code: 'MANIFEST_FIELD_FORBIDDEN' }));
        expect(() => normalizeHumanCompanyAuthorityManifest({ ...manifest(), client_secret: 'hidden' }))
            .toThrowError(expect.objectContaining({ code: 'MANIFEST_SECRET_FORBIDDEN' }));
        expect(() => normalizeHumanCompanyAuthorityManifest({
            ...manifest(),
            humans: [{ ...manifest().humans[0], person_name: 'xoxb-secret-material' }]
        })).toThrowError(expect.objectContaining({ code: 'MANIFEST_SECRET_FORBIDDEN' }));
        expect(() => normalizeHumanCompanyAuthorityManifest({
            ...manifest(),
            humans: [{ ...manifest().humans[0], person_name: 'Bearer abcdefghijklmnopqrstuvwxyz' }]
        })).toThrowError(expect.objectContaining({ code: 'MANIFEST_SECRET_FORBIDDEN' }));
        expect(() => normalizeHumanCompanyAuthorityManifest({
            ...manifest(),
            humans: [{ ...manifest().humans[0], person_name: 'ghp_abcdefghijklmnopqrstuvwxyz' }]
        })).toThrowError(expect.objectContaining({ code: 'MANIFEST_SECRET_FORBIDDEN' }));
        expect(() => normalizeHumanCompanyAuthorityManifest({
            ...manifest(),
            humans: [{ ...manifest().humans[0], project_codes: ['techknight', 'unson'] }]
        })).toThrowError(expect.objectContaining({ code: 'MANIFEST_PROJECT_SCOPE_MISMATCH' }));
    });

    it('rejects legacy person IDs instead of treating them as canonical identities', () => {
        expect(() => normalizeHumanCompanyAuthorityManifest({
            ...manifest(),
            humans: [{ ...manifest().humans[0], person_id: 'per_umeda_haruka' }]
        })).toThrowError(
            expect.objectContaining({ code: 'MANIFEST_INVALID' })
        );
    });

    it('creates and exactly reads back every separate human access state, then rolls dry-run back', async () => {
        const client = fakeClient();
        const result = await provisionHumanCompanyAuthority({
            client, manifest: manifest(), actorId: 'operator-keigo', commit: false
        });
        expect(result.persisted).toBe(false);
        expect(result.snapshot_after.humans).toHaveLength(2);
        expect(result.snapshot_after.humans[1]).toMatchObject({
            person_id: umedaPersonId,
            login_grant: { slack_user_id: 'U_UMEDA', slack_workspace_id: 'T_TECHKNIGHT' },
            membership: {
                principal_id: umedaPersonId,
                membership_payload: {
                    slack_user_id: 'U_UMEDA', slack_workspace_id: 'T_TECHKNIGHT',
                    project_codes: ['techknight'], clearance: ['internal']
                }
            },
            external_identity: { provider: 'slack', authenticated_subject_id: 'U_UMEDA' }
        });
        expect(result.plan.filter((entry) => entry.operation === 'create')).toHaveLength(9);
        expect(client.state.organizations).toHaveLength(0);
        expect(client.state.people).toHaveLength(0);
        expect(client.queries.at(-1)?.sql).toBe('ROLLBACK');
    });

    it('commits once and treats an exact second declaration as noop', async () => {
        const client = fakeClient();
        await provisionHumanCompanyAuthority({ client, manifest: manifest(), actorId: 'operator-keigo', commit: true });
        const second = await provisionHumanCompanyAuthority({ client, manifest: manifest(), actorId: 'operator-keigo', commit: true });
        expect(second.plan.every((entry) => entry.operation === 'noop')).toBe(true);
        expect(client.state.organizations).toHaveLength(1);
        expect(client.state.people).toHaveLength(2);
        expect(client.state.grants).toHaveLength(2);
        expect(client.state.memberships).toHaveLength(2);
        expect(client.state.identities).toHaveLength(2);
    });

    it('fails closed on a conflicting login grant and rolls back all changes', async () => {
        const client = fakeClient();
        client.state.grants.push({
            id: 'grant_existing', person_id: 'per_someone_else', person_name: '別人',
            slack_user_id: 'U_KEIGO', slack_workspace_id: 'T_TECHKNIGHT', role: 'member',
            project_codes: ['other'], clearance: ['public'], active: true
        });
        await expect(provisionHumanCompanyAuthority({
            client, manifest: manifest(), actorId: 'operator-keigo', commit: true
        })).rejects.toMatchObject({ code: 'AUTH_GRANT_CONFLICT' });
        expect(client.state.organizations).toHaveLength(0);
        expect(client.state.people).toHaveLength(0);
        expect(client.queries.at(-1)?.sql).toBe('ROLLBACK');
    });

    it('fails closed when an organization ID is already owned outside the tenant', async () => {
        const client = fakeClient();
        const originalQuery = client.query;
        client.query = async (sql, parameters = []) => {
            if (String(sql).replace(/\s+/gu, ' ').trim().startsWith('INSERT INTO tenant_organizations')) {
                const error = new Error('duplicate key');
                error.code = '23505';
                throw error;
            }
            return originalQuery(sql, parameters);
        };
        await expect(provisionHumanCompanyAuthority({
            client, manifest: manifest(), actorId: 'operator-keigo', commit: true
        })).rejects.toMatchObject({ code: 'ORGANIZATION_CROSS_TENANT_CONFLICT' });
        expect(client.queries.at(-1)?.sql).toBe('ROLLBACK');
    });

    it('fails closed when tenant membership candidates are ambiguous', async () => {
        const client = fakeClient();
        client.state.memberships.push(
            {
                membership_id: 'membership_one', organization_id: 'org_techknight_business',
                principal_id: satoPersonId, membership_payload: { status: 'active' }
            },
            {
                membership_id: 'membership_two', organization_id: 'org_techknight_business',
                principal_id: satoPersonId, membership_payload: { status: 'active' }
            }
        );
        await expect(provisionHumanCompanyAuthority({
            client, manifest: manifest(), actorId: 'operator-keigo', commit: true
        })).rejects.toMatchObject({ code: 'MEMBERSHIP_AMBIGUOUS' });
        expect(client.queries.at(-1)?.sql).toBe('ROLLBACK');
    });

    it('fails closed when the declared active workspace connection is missing', async () => {
        const client = fakeClient();
        client.state.workspaceConnections = [];
        await expect(provisionHumanCompanyAuthority({
            client, manifest: manifest(), actorId: 'operator-keigo', commit: true
        })).rejects.toMatchObject({ code: 'WORKSPACE_CONNECTION_NOT_FOUND' });
        expect(client.queries.at(-1)?.sql).toBe('ROLLBACK');
    });

    it('does not hide an older active identity behind newer revoked revisions', async () => {
        const client = fakeClient();
        const identity = (revision, status, membershipId) => ({
            identity_id: `human_identity_${revision}`,
            identity_revision: revision,
            provider: 'slack',
            authenticated_subject_id: 'U_KEIGO',
            workspace_id: 'T_TECHKNIGHT',
            app_id: 'A_TECHKNIGHT',
            membership_id: membershipId,
            project_id: 'prj_techknight',
            placement_id: 'techknight-slack-admin',
            principal_type: 'person',
            status
        });
        client.state.identities.push(
            identity(1, 'active', 'wrong_membership'),
            identity(2, 'revoked', 'old_membership'),
            identity(3, 'suspended', 'old_membership')
        );
        await expect(provisionHumanCompanyAuthority({
            client, manifest: manifest(), actorId: 'operator-keigo', commit: true
        })).rejects.toMatchObject({ code: 'EXTERNAL_IDENTITY_CONFLICT' });
        expect(client.state.identities).toHaveLength(3);
        expect(client.queries.at(-1)?.sql).toBe('ROLLBACK');
    });

    it('requires an explicit apply approval and actor at the CLI boundary', () => {
        expect(() => parseProvisionHumanAuthorityArgs(['--apply', '--manifest', 'manifest.json'], {}))
            .toThrowError(expect.objectContaining({ code: 'APPLY_APPROVAL_REQUIRED' }));
        expect(() => parseProvisionHumanAuthorityArgs(
            ['--apply', '--approve-apply', '--manifest', 'manifest.json'], {}
        )).toThrowError(expect.objectContaining({ code: 'ACTOR_REQUIRED' }));
        expect(parseProvisionHumanAuthorityArgs(
            ['--apply', '--approve-apply', '--phase', 'bootstrap-admin', '--manifest', 'manifest.json'],
            { BRAINBASE_PROVISIONING_ACTOR: 'operator-keigo' }
        )).toMatchObject({ mode: 'apply', phase: 'bootstrap-admin', actorId: 'operator-keigo' });
        expect(() => parseProvisionHumanAuthorityArgs(
            ['--dry-run', '--phase', 'bootstrap-admin', '--phase', 'bootstrap-admin',
                '--manifest', 'manifest.json'], {}
        )).toThrowError(expect.objectContaining({ code: 'ARGUMENT_INVALID' }));
        expect(() => parseProvisionHumanAuthorityArgs(
            ['--apply', '--apply', '--approve-apply', '--manifest', 'manifest.json'],
            { BRAINBASE_PROVISIONING_ACTOR: 'operator-keigo' }
        )).toThrowError(expect.objectContaining({ code: 'ARGUMENT_INVALID' }));
    });

    it('uses bootstrap-admin provisioning and post-commit readback through the CLI phase', async () => {
        const sharedState = fakeClient().state;
        sharedState.workspaceConnections = [];
        let checkoutCount = 0;
        const pool = {
            connect: async () => {
                checkoutCount += 1;
                return { ...fakeClient(sharedState), release() {} };
            }
        };
        const adminOnly = { ...manifest(), humans: [manifest().humans[0]] };
        const result = await runProvisionHumanCompanyAuthority({
            argv: ['--apply', '--approve-apply', '--phase', 'bootstrap-admin', '--manifest', 'manifest.json'],
            env: { BRAINBASE_PROVISIONING_ACTOR: 'operator-keigo' },
            pool,
            readManifest: async () => JSON.stringify(adminOnly)
        });
        expect(checkoutCount).toBe(2);
        expect(result.post_commit_readback.human.person_id).toBe(satoPersonId);
        expect(sharedState.identities).toHaveLength(0);
    });

    it('checks out a fresh pool client for post-commit readback', async () => {
        const sharedState = fakeClient().state;
        let checkoutCount = 0;
        const pool = {
            connect: async () => {
                checkoutCount += 1;
                return { ...fakeClient(sharedState), release() {} };
            }
        };
        const result = await runProvisionHumanCompanyAuthority({
            argv: ['--apply', '--approve-apply', '--manifest', 'manifest.json'],
            env: { BRAINBASE_PROVISIONING_ACTOR: 'operator-keigo' },
            pool,
            readManifest: async () => JSON.stringify(manifest())
        });
        expect(checkoutCount).toBe(2);
        expect(result.post_commit_readback.humans).toHaveLength(2);
        expect(result.post_commit_readback.humans[1].person_id).toBe(umedaPersonId);
    });

    it('releases a primary client with the provisioning error when rollback also fails', async () => {
        const primaryError = new Error('primary query failed');
        const rollbackError = new Error('rollback query failed');
        const release = vi.fn();
        const client = {
            query: vi.fn(async (sql) => {
                if (String(sql).trim() === 'BEGIN') return { rows: [] };
                if (String(sql).trim() === 'ROLLBACK') throw rollbackError;
                throw primaryError;
            }),
            release
        };
        const pool = { connect: vi.fn(async () => client) };

        await expect(runProvisionHumanCompanyAuthority({
            argv: ['--dry-run', '--manifest', 'manifest.json'],
            pool,
            readManifest: async () => JSON.stringify(manifest())
        })).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });

        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
        expect(release).toHaveBeenCalledWith(expect.objectContaining({ code: 'UPSTREAM_UNAVAILABLE' }));
    });

    it('releases a failed post-commit readback client with the readback error', async () => {
        const sharedState = fakeClient().state;
        const primaryClient = fakeClient(sharedState);
        primaryClient.release = vi.fn();
        const readbackClient = fakeClient(sharedState);
        const readbackFailure = new Error('readback query failed');
        const originalReadbackQuery = readbackClient.query;
        readbackClient.query = async (sql, parameters = []) => {
            if (String(sql).replace(/\s+/gu, ' ').includes('FROM people')) throw readbackFailure;
            return originalReadbackQuery(sql, parameters);
        };
        readbackClient.release = vi.fn();
        let checkoutCount = 0;
        const pool = {
            connect: vi.fn(async () => {
                checkoutCount += 1;
                return checkoutCount === 1 ? primaryClient : readbackClient;
            })
        };

        await expect(runProvisionHumanCompanyAuthority({
            argv: ['--apply', '--approve-apply', '--manifest', 'manifest.json'],
            env: { BRAINBASE_PROVISIONING_ACTOR: 'operator-keigo' },
            pool,
            readManifest: async () => JSON.stringify(manifest())
        })).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });

        expect(primaryClient.release).toHaveBeenCalledWith();
        expect(readbackClient.release).toHaveBeenCalledWith(expect.objectContaining({ code: 'UPSTREAM_UNAVAILABLE' }));
    });
});
