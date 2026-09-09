import { describe, expect, it, vi } from 'vitest';

import {
    normalizeSlackChannelAuthorityPolicies,
    SlackChannelAuthorityRepository
} from '../../../../server/services/multitenant/slack-channel-authority-repository.js';

const policy = {
    provider: 'slack',
    workspace_id: 'W-1',
    app_id: 'A-1',
    tenant_id: 'ten-1',
    organization_id: 'org-tenant-1',
    graph_organization_id: 'org-graph-1',
    capability_id: 'runtime.execute',
    allowed_effects: ['read', 'external_side_effect'],
    policy_revision: '7',
    status: 'active',
    channel_id: 'C-1',
    projects: [{
        project_id: 'prj-1',
        project_code: 'back-office',
        placement_id: 'mana-accounting',
        resource_revision: '3'
    }]
};

function request(overrides = {}) {
    return {
        tenant_id: 'ten-1',
        connection_id: 'wsc-1',
        workspace_id: 'W-1',
        app_id: 'A-1',
        provider_identity: {
            provider: 'slack',
            authenticated_subject_id: 'U-1',
            workspace_id: 'W-1',
            app_id: 'A-1'
        },
        requested_action: {
            capability_id: 'runtime.execute',
            resource_ref: 'project:back-office',
            project_hint: 'back-office',
            desired_effect: 'read'
        },
        slack: { channel_id: 'C-1' },
        ...overrides
    };
}

function fixture({ projectRows = undefined, grantRows = undefined, membershipRows = undefined, legacyRows = [], bindingRows = [] } = {}) {
    const calls = [];
    const client = {
        query: vi.fn(async (sql, values) => {
            calls.push({ sql, values });
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK'
                || sql.includes("set_config('brainbase.tenant_id")) return { rows: [] };
            if (sql.includes('FROM tenant_projects')) {
                return { rows: projectRows ?? [{ project_id: 'prj-1', project_code: 'back-office', project_payload: { status: 'active' } }] };
            }
            if (sql.includes('FROM auth_grants')) {
                return { rows: grantRows ?? [{
                    grant_id: 'grant-1',
                    canonical_person_id: 'person-1',
                    person_name: 'Umeda',
                    role: 'operator',
                    project_codes: ['brainbase'],
                    clearance: ['company'],
                    active: true
                }] };
            }
            if (sql.includes('FROM tenant_memberships')) {
                return { rows: membershipRows ?? [{
                    membership_id: 'membership-1',
                    organization_id: 'org-tenant-1',
                    principal_id: 'person-1',
                    membership_payload: {
                        status: 'active', revision: '9', role: 'operator', project_codes: ['brainbase']
                    }
                }] };
            }
            if (sql.includes('FROM company_external_identities')) return { rows: legacyRows };
            if (sql.includes('FROM company_authority_bindings')) return { rows: bindingRows };
            return { rows: [] };
        }),
        release: vi.fn()
    };
    return {
        calls,
        client,
        pool: { connect: vi.fn(async () => client), query: vi.fn(async () => ({ rows: [] })) }
    };
}

describe('normalizeSlackChannelAuthorityPolicies', () => {
    it('freezes administrator policy and supports multiple projects per channel', () => {
        const normalized = normalizeSlackChannelAuthorityPolicies([{
            ...policy,
            projects: [policy.projects[0], {
                project_id: 'prj-2', project_code: 'mana', placement_id: 'mana-dev-biz'
            }]
        }]);

        expect(Object.isFrozen(normalized)).toBe(true);
        expect(Object.isFrozen(normalized[0].projects[0])).toBe(true);
        expect(normalized[0].projects[1].resource_revision).toBe('7');
    });

    it.each([
        ['D-1', 'channel_id'],
        ['c-1', 'channel_id'],
        ['', 'channel_id']
    ])('rejects non-public Slack channel %s', (channelId) => {
        expect(() => normalizeSlackChannelAuthorityPolicies([{ ...policy, channel_id: channelId }]))
            .toThrow(/Invalid Slack channel authority policy/);
    });
});

describe('SlackChannelAuthorityRepository.resolveSlackChannelAuthority', () => {
    it('derives canonical person and project authority from a selected channel', async () => {
        const db = fixture();
        const repository = new SlackChannelAuthorityRepository({ pool: db.pool, policies: [policy] });

        await expect(repository.resolveSlackChannelAuthority(request())).resolves.toMatchObject({
            identity: {
                tenant_id: 'ten-1',
                canonical_person_id: 'person-1',
                membership_id: 'membership-1',
                project_id: 'prj-1',
                project_code: 'back-office',
                placement_id: 'mana-accounting',
                membership_revision: '9'
            },
            authority: {
                decision: 'auto',
                capability_id: 'runtime.execute',
                allowed_effects: ['read', 'external_side_effect'],
                resource_revision: '3'
            }
        });
        expect(db.calls.some(({ sql }) => /\b(INSERT|UPDATE|DELETE)\b/u.test(sql))).toBe(false);
    });

    it('accepts existing projects without an optional status field', async () => {
        const db = fixture({ projectRows: [{ project_id: 'prj-1', project_code: 'back-office', project_payload: {} }] });
        const repository = new SlackChannelAuthorityRepository({ pool: db.pool, policies: [policy] });
        await expect(repository.resolveSlackChannelAuthority(request())).resolves.toMatchObject({ authority: { decision: 'auto' } });
    });

    it('rejects a project explicitly marked inactive', async () => {
        const db = fixture({ projectRows: [{ project_id: 'prj-1', project_code: 'back-office', project_payload: { status: 'inactive' } }] });
        const repository = new SlackChannelAuthorityRepository({ pool: db.pool, policies: [policy] });
        await expect(repository.resolveSlackChannelAuthority(request())).rejects.toMatchObject({ code: 'PROJECT_SCOPE_MISMATCH' });
    });

    it('returns null for an unknown channel so the existing identity path remains available', async () => {
        const db = fixture();
        const repository = new SlackChannelAuthorityRepository({ pool: db.pool, policies: [policy] });

        await expect(repository.resolveSlackChannelAuthority(request({ slack: { channel_id: 'C-unknown' } })))
            .resolves.toBeNull();
        expect(db.pool.connect).not.toHaveBeenCalled();
    });

    it('fails closed when a selected channel has a different workspace', async () => {
        const repository = new SlackChannelAuthorityRepository({ pool: fixture().pool, policies: [policy] });

        await expect(repository.resolveSlackChannelAuthority(request({
            workspace_id: 'W-other',
            provider_identity: { ...request().provider_identity, workspace_id: 'W-other' }
        }))).rejects.toMatchObject({ code: 'AUTHORITY_SCOPE_MISMATCH' });
    });

    it.each([
        [{ desired_effect: 'write' }, 'COMPANY_EFFECT_NOT_ALLOWED'],
        [{ capability_id: 'task.read' }, 'CAPABILITY_SCOPE_MISMATCH'],
        [{ resource_ref: 'task:123', project_hint: undefined }, 'PROJECT_SCOPE_MISMATCH'],
        [{ project_hint: 'mana' }, 'PROJECT_SCOPE_MISMATCH'],
        [{ resource_ref: 'project:mana', project_hint: 'back-office' }, 'PROJECT_SCOPE_MISMATCH']
    ])('fails closed for selected channel request scope %o', async (actionPatch, code) => {
        const repository = new SlackChannelAuthorityRepository({ pool: fixture().pool, policies: [policy] });
        const base = request();
        await expect(repository.resolveSlackChannelAuthority({
            ...base,
            requested_action: { ...base.requested_action, ...actionPatch }
        })).rejects.toMatchObject({ code });
    });

    it('does not apply channel policy to personal resources', async () => {
        const db = fixture();
        const repository = new SlackChannelAuthorityRepository({ pool: db.pool, policies: [policy] });
        const base = request();

        await expect(repository.resolveSlackChannelAuthority({
            ...base,
            requested_action: {
                ...base.requested_action,
                capability_id: 'personal_read',
                resource_ref: 'personal://person-1/notes',
                project_hint: undefined
            }
        })).resolves.toBeNull();
        expect(db.pool.connect).not.toHaveBeenCalled();
    });

    it('honors a revoked legacy identity before deriving synthetic authority', async () => {
        const db = fixture({ legacyRows: [{
            identity_id: 'legacy-1',
            identity_revision: '4',
            membership_id: 'legacy-membership',
            project_id: 'prj-1',
            status: 'revoked',
            legacy_membership_payload: { status: 'active', revision: '2' }
        }] });
        const repository = new SlackChannelAuthorityRepository({ pool: db.pool, policies: [policy] });

        await expect(repository.resolveSlackChannelAuthority(request()))
            .rejects.toMatchObject({ code: 'COMPANY_MEMBERSHIP_INACTIVE' });
    });

    it('preserves an explicit deny binding', async () => {
        const db = fixture({ bindingRows: [{
            binding_id: 'deny-1', binding_revision: 12, membership_id: 'legacy-membership',
            status: 'active', valid_from: '2020-01-01T00:00:00Z', valid_until: null,
            capability_id: 'runtime.execute', decision: 'deny', allowed_effects: [],
            policy_revision: '8', raci_revision: '4', resource_revision: '12', stop_conditions: ['stop']
        }] });
        const repository = new SlackChannelAuthorityRepository({ pool: db.pool, policies: [policy] });

        await expect(repository.resolveSlackChannelAuthority(request())).resolves.toMatchObject({
            authority: { decision: 'deny', binding_id: 'deny-1', allowed_effects: [] }
        });
    });

    it.each([
        { provider_identity: { ...request().provider_identity, workspace_id: 'W-other' } },
        { provider_identity: { ...request().provider_identity, app_id: 'A-other' } },
        { slack: { channel_id: 'C-1', requester_id: 'U-other' } }
    ])('rejects conflicting observed identity before accessing data: %o', async (patch) => {
        const db = fixture();
        const repository = new SlackChannelAuthorityRepository({ pool: db.pool, policies: [policy] });
        await expect(repository.resolveSlackChannelAuthority(request(patch)))
            .rejects.toMatchObject({ code: 'AUTHORITY_SCOPE_MISMATCH' });
        expect(db.pool.connect).not.toHaveBeenCalled();
    });

    it('does not treat a membership with missing status as active', async () => {
        const db = fixture({ membershipRows: [{
            membership_id: 'membership-1', principal_id: 'person-1',
            organization_id: 'org-tenant-1', membership_payload: { revision: '1' }
        }] });
        const repository = new SlackChannelAuthorityRepository({ pool: db.pool, policies: [policy] });
        await expect(repository.resolveSlackChannelAuthority(request()))
            .rejects.toMatchObject({ code: 'COMPANY_MEMBERSHIP_INACTIVE' });
    });

    it.each([
        { status: 'revoked' },
        { status: 'suspended' },
        { status: 'superseded' },
        { valid_until: '2021-01-01T00:00:00Z', decision: 'approval' },
        { valid_until: '2021-01-01T00:00:00Z', decision: 'deny' },
        { valid_from: '2099-01-01T00:00:00Z' }
    ])('does not replace stopped or out-of-period authority with automatic access: %o', async (patch) => {
        const db = fixture({ bindingRows: [{
            binding_id: 'binding-1', binding_revision: 1, membership_id: 'membership-1',
            status: 'active', valid_from: '2020-01-01T00:00:00Z', valid_until: null,
            capability_id: 'runtime.execute', decision: 'auto', allowed_effects: ['read'],
            policy_revision: '1', raci_revision: '1', resource_revision: '1', stop_conditions: [],
            ...patch
        }] });
        const repository = new SlackChannelAuthorityRepository({ pool: db.pool, policies: [policy] });
        await expect(repository.resolveSlackChannelAuthority(request())).rejects.toMatchObject({
            code: patch.status === 'superseded' ? 'COMPANY_AUTHORITY_UNRESOLVED' : 'COMPANY_AUTHORITY_DENIED'
        });
    });

    it('keeps current approval authority while ignoring its superseded predecessor', async () => {
        const binding = {
            binding_id: 'binding-2', binding_revision: 2, membership_id: 'membership-1',
            status: 'active', valid_from: '2020-01-01T00:00:00Z', valid_until: null,
            capability_id: 'runtime.execute', decision: 'approval', allowed_effects: ['read'],
            policy_revision: '1', raci_revision: '1', resource_revision: '1', stop_conditions: [],
            approver_person_id: 'approver-1'
        };
        const db = fixture({ bindingRows: [{ ...binding, binding_id: 'old', status: 'superseded' }, binding] });
        const repository = new SlackChannelAuthorityRepository({ pool: db.pool, policies: [policy] });
        await expect(repository.resolveSlackChannelAuthority(request())).resolves.toMatchObject({
            authority: { decision: 'approval', allowed_effects: ['read'], approver_person_id: 'approver-1' }
        });
    });
});

describe('SlackChannelAuthorityRepository.resolveObservedRoute', () => {
    it('resolves selected channel route from the active tenant connection', async () => {
        const db = fixture();
        db.client.query.mockImplementation(async (sql, values) => {
            db.calls.push({ sql, values });
            if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK'
                || sql.includes("set_config('brainbase.tenant_id")) return { rows: [] };
            if (sql.includes('FROM brainbase_tenants')) {
                return { rows: [{ tenant_id: 'ten-1', tenant_revision: 11, status: 'active' }] };
            }
            if (sql.includes('FROM workspace_connections')) {
                return { rows: [{
                    connection_id: 'wsc-1', connection_revision: 6, tenant_id: 'ten-1',
                    provider: 'slack', workspace_id: 'W-1', app_id: 'A-1', status: 'active'
                }] };
            }
            return { rows: [] };
        });
        const repository = new SlackChannelAuthorityRepository({ pool: db.pool, policies: [policy] });

        await expect(repository.resolveObservedRoute(request())).resolves.toMatchObject({
            tenant_id: 'ten-1', tenant_revision: 11,
            connection_id: 'wsc-1', connection_revision: 6,
            channel_id: 'C-1', project_id: 'prj-1'
        });
    });

    it('delegates unknown channels to the original route function', async () => {
        const route = { tenant_id: 'ten-existing', tenant_revision: 4, connection_id: 'wsc-existing' };
        const pool = { query: vi.fn(async () => ({ rows: [route] })) };
        const repository = new SlackChannelAuthorityRepository({ pool, policies: [policy] });

        await expect(repository.resolveObservedRoute(request({ slack: { channel_id: 'C-unknown' } })))
            .resolves.toEqual(route);
        expect(pool.query).toHaveBeenCalledWith(
            expect.stringContaining('public.resolve_company_authority_route'),
            expect.any(Array)
        );
    });
});
