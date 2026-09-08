import { describe, expect, it, vi } from 'vitest';

import {
    parseInitialSlackAuthorizationArgs,
    runCreateInitialSlackInstallationAuthorization
} from '../../../scripts/create-initial-slack-installation-authorization.js';

const tenantId = 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const personId = 'per_01ARZ3NDEKTSV4RRFFQ69G5FAY';

function manifest() {
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
        humans: [{
            person_id: personId,
            person_name: '佐藤 圭吾',
            slack_user_id: 'U_KEIGO',
            login_role: 'ceo',
            project_codes: ['techknight'],
            clearance: ['internal'],
            tenant_role: 'tenant_admin',
            placement_id: 'techknight-slack-admin'
        }]
    };
}

function verifiedAdminClient() {
    const membershipPayload = {
        status: 'active', revision: '1', principal_type: 'person', role: 'ceo', tenant_role: 'tenant_admin',
        slack_user_id: 'U_KEIGO', slack_workspace_id: 'T_TECHKNIGHT', project_codes: ['techknight'],
        clearance: ['internal'], placement_id: 'techknight-slack-admin'
    };
    const release = vi.fn();
    return {
        release,
        query: vi.fn(async (sql) => {
            const compact = String(sql).replace(/\s+/gu, ' ').trim();
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(compact)
                || compact.includes("set_config('brainbase.tenant_id'")
                || compact.includes('pg_advisory_xact_lock')) return { rows: [] };
            if (compact.includes('FROM brainbase_tenants')) return { rows: [{
                tenant_id: tenantId, tenant_key: 'techknight-business', tenant_revision: 1, status: 'active'
            }] };
            if (compact.includes('FROM tenant_projects')) {
                return { rows: [{ project_id: 'prj_techknight', project_code: 'techknight' }] };
            }
            if (compact.includes('FROM organizations')) return { rows: [{ id: 'techknight', name: 'Tech Knight' }] };
            if (compact.includes('FROM tenant_organizations')) return { rows: [{
                organization_id: 'org_techknight_business',
                organization_payload: { status: 'active', graph_organization_id: 'techknight', display_name: 'Tech Knight' }
            }] };
            if (compact.includes('FROM people')) return { rows: [{ id: personId, name: '佐藤 圭吾', status: 'active' }] };
            if (compact.includes('FROM auth_grants')) return { rows: [{
                id: 'grant_existing', person_id: personId, person_name: '佐藤 圭吾',
                slack_user_id: 'U_KEIGO', slack_workspace_id: 'T_TECHKNIGHT', organization_id: 'techknight', role: 'ceo',
                project_codes: ['techknight'], clearance: ['internal'], active: true
            }] };
            if (compact.includes('FROM tenant_memberships')) return { rows: [{
                membership_id: 'membership_existing', organization_id: 'org_techknight_business',
                principal_id: personId, membership_payload: membershipPayload
            }] };
            throw new Error(`unexpected query: ${compact}`);
        })
    };
}

describe('initial Slack installation authorization CLI', () => {
    it('requires explicit approval and an operator actor', () => {
        expect(() => parseInitialSlackAuthorizationArgs(
            ['--authorize', '--manifest', 'manifest.json'], { BRAINBASE_PROVISIONING_ACTOR: 'operator' }
        )).toThrowError(expect.objectContaining({ code: 'AUTHORIZATION_APPROVAL_REQUIRED' }));
        expect(() => parseInitialSlackAuthorizationArgs(
            ['--authorize', '--approve-authorize', '--manifest', 'manifest.json'], {}
        )).toThrowError(expect.objectContaining({ code: 'ACTOR_REQUIRED' }));
        expect(() => parseInitialSlackAuthorizationArgs(
            ['--authorize', '--authorize', '--approve-authorize', '--manifest', 'manifest.json'],
            { BRAINBASE_PROVISIONING_ACTOR: 'operator' }
        )).toThrowError(expect.objectContaining({ code: 'AUTHORIZATION_APPROVAL_REQUIRED' }));
    });

    it('rejects a configured app that differs from the manifest before database access', async () => {
        const pool = { connect: vi.fn() };
        await expect(runCreateInitialSlackInstallationAuthorization({
            argv: ['--authorize', '--approve-authorize', '--manifest', 'manifest.json'],
            env: { BRAINBASE_PROVISIONING_ACTOR: 'operator', BRAINBASE_SLACK_INSTALLATION_APP_ID: 'A_OTHER' },
            pool,
            readManifest: async () => JSON.stringify(manifest())
        })).rejects.toMatchObject({ code: 'SLACK_INSTALLATION_APP_MISMATCH' });
        expect(pool.connect).not.toHaveBeenCalled();
    });

    it('verifies the initial admin and emits only the bounded authorization result', async () => {
        const client = verifiedAdminClient();
        const pool = { connect: vi.fn(async () => client) };
        const authorizeBinding = vi.fn(async (binding) => binding);
        const result = await runCreateInitialSlackInstallationAuthorization({
            argv: ['--authorize', '--approve-authorize', '--manifest', 'manifest.json'],
            env: { BRAINBASE_PROVISIONING_ACTOR: 'operator', BRAINBASE_SLACK_INSTALLATION_APP_ID: 'A_TECHKNIGHT' },
            pool,
            repository: {},
            controlPlane: { authorizeBinding },
            oauthFlow: { createAuthorization: (binding) => ({
                authorization_url: `https://slack.example/authorize?state=${binding.installation_intent_id}`,
                oauth_state: 'must-not-be-a-separate-cli-field',
                redirect_uri: 'https://bb.example/api/v1/slack-installations:callback'
            }) },
            readManifest: async () => JSON.stringify(manifest())
        });
        expect(result).toMatchObject({
            ok: true,
            tenant_id: tenantId,
            initiated_by_person_id: personId,
            authorization_url: expect.stringContaining('https://slack.example/authorize')
        });
        expect(result).not.toHaveProperty('oauth_state');
        expect(authorizeBinding).toHaveBeenCalledWith(expect.any(Object), { client });
        expect(client.release).toHaveBeenCalledWith();
    });

    it('closes an internally created pool when OAuth configuration is invalid', async () => {
        const end = vi.fn(async () => {});
        const connect = vi.fn();

        await expect(runCreateInitialSlackInstallationAuthorization({
            argv: ['--authorize', '--approve-authorize', '--manifest', 'manifest.json'],
            env: {
                BRAINBASE_PROVISIONING_ACTOR: 'operator',
                BRAINBASE_SLACK_INSTALLATION_APP_ID: 'A_TECHKNIGHT',
                INFO_SSOT_DATABASE_URL: 'postgres://unused'
            },
            createPool: () => ({ connect, end }),
            readManifest: async () => JSON.stringify(manifest())
        })).rejects.toMatchObject({ code: 'SLACK_INSTALLATION_CONFIGURATION_REQUIRED' });

        expect(connect).not.toHaveBeenCalled();
        expect(end).toHaveBeenCalledOnce();
    });
});
