import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../server/services/auth-service.js';

describe('AuthService auth grant precedence', () => {
    it('selects the exact organization grant for the same Slack identity', async () => {
        const observed = [];
        const client = {
            query: async (sql, params) => {
                observed.push({ sql, params });
                return { rows: [{
                    id: 'grant_personal',
                    person_id: 'per_sato',
                    person_name: '佐藤 圭吾',
                    slack_user_id: 'U_SATO',
                    slack_workspace_id: 'T_UNSON',
                    organization_id: 'sato-personal',
                    role: 'ceo',
                    project_codes: ['fx', 'keiba'],
                    clearance: ['internal'],
                    active: true
                }] };
            },
            release: () => {}
        };
        const authService = new AuthService();
        authService.pool = { connect: async () => client };

        const grant = await authService.findGrant({
            slackUserId: 'U_SATO',
            slackWorkspaceId: 'T_UNSON',
            organizationId: 'sato-personal'
        });

        expect(grant.organization_id).toBe('sato-personal');
        expect(observed[0].sql).toContain('organization_id = $3');
        expect(observed[0].sql).toContain('JOIN projects p');
        expect(observed[0].sql).toContain('p.organization_id = ag.organization_id');
        expect(observed[0].params).toEqual(['U_SATO', 'T_UNSON', 'sato-personal']);
    });

    it('lists active organization grants across Slack workspaces for the authenticated person', async () => {
        const observed = [];
        const client = {
            query: async (sql, params) => {
                observed.push({ sql, params });
                return { rows: [
                { organization_id: 'sato-personal', organization_name: '佐藤個人', role: 'ceo', project_codes: ['fx', 'keiba'] },
                { organization_id: 'unson', organization_name: 'UNSON', role: 'ceo', project_codes: ['brainbase'] }
                ] };
            },
            release: () => {}
        };
        const authService = new AuthService();
        authService.pool = { connect: async () => client };

        const organizations = await authService.listOrganizationAccess({
            personId: 'per_sato'
        });

        expect(organizations).toEqual([
            { organizationId: 'sato-personal', name: '佐藤個人', role: 'ceo', projectCodes: ['fx', 'keiba'] },
            { organizationId: 'unson', name: 'UNSON', role: 'ceo', projectCodes: ['brainbase'] }
        ]);
        expect(observed[0].sql).toContain('JOIN projects p');
        expect(observed[0].sql).toContain('p.organization_id = COALESCE(ag.organization_id, o.id)');
        expect(observed[0].sql).toContain('ag.person_id = $1');
        expect(observed[0].sql).not.toContain('o.workspace_id = $2');
        expect(observed[0].params).toEqual(['per_sato']);
    });

    it('uses the organization workspace grant as canonical access when another Slack identity has narrower access', async () => {
        const client = {
            query: async () => ({ rows: [
                {
                    organization_id: 'unson', organization_name: 'UNSON', organization_workspace_id: 'T_UNSON',
                    slack_workspace_id: 'T_CUSTOMER', role: 'member', project_codes: ['brainbase'], clearance: ['internal']
                },
                {
                    organization_id: 'unson', organization_name: 'UNSON', organization_workspace_id: 'T_UNSON',
                    slack_workspace_id: 'T_UNSON', role: 'ceo', project_codes: ['brainbase', 'mana'],
                    clearance: ['internal', 'restricted']
                }
            ] }),
            release: () => {}
        };
        const authService = new AuthService();
        authService.pool = { connect: async () => client };

        await expect(authService.listOrganizationAccess({ personId: 'per_sato' })).resolves.toEqual([
            {
                organizationId: 'unson', name: 'UNSON', role: 'ceo',
                projectCodes: ['brainbase', 'mana']
            }
        ]);
    });

    it('deduplicates equivalent organization access granted through multiple Slack identities', async () => {
        const client = {
            query: async () => ({ rows: [
                {
                    organization_id: 'techknight', organization_name: 'Tech Knight', role: 'ceo',
                    project_codes: ['aitle', 'techknight'], clearance: ['internal']
                },
                {
                    organization_id: 'techknight', organization_name: 'Tech Knight', role: 'ceo',
                    project_codes: ['techknight', 'aitle'], clearance: ['internal']
                },
                {
                    organization_id: 'unson', organization_name: 'UNSON', role: 'ceo',
                    project_codes: ['brainbase'], clearance: ['internal']
                }
            ] }),
            release: () => {}
        };
        const authService = new AuthService();
        authService.pool = { connect: async () => client };

        await expect(authService.listOrganizationAccess({ personId: 'per_sato' })).resolves.toEqual([
            { organizationId: 'techknight', name: 'Tech Knight', role: 'ceo', projectCodes: ['aitle', 'techknight'] },
            { organizationId: 'unson', name: 'UNSON', role: 'ceo', projectCodes: ['brainbase'] }
        ]);
    });

    it('switches to a grant in another Slack workspace through the same person', async () => {
        const authService = new AuthService();
        authService.findGrantForPerson = vi.fn().mockResolvedValue({
            person_id: 'per_sato',
            person_name: '佐藤 圭吾',
            slack_user_id: 'U_TECHKNIGHT',
            slack_workspace_id: 'T_TECHKNIGHT',
            organization_id: 'techknight',
            role: 'ceo',
            project_codes: ['techknight'],
            clearance: ['internal']
        });
        authService.ensurePerson = vi.fn(async ({ personId }) => personId);
        authService.issueToken = vi.fn().mockReturnValue('techknight-access-token');
        authService.issueRefreshToken = vi.fn().mockReturnValue('techknight-refresh-token');
        authService.createAuditLog = vi.fn();

        const result = await authService.switchOrganization({
            personId: 'per_sato',
            organizationId: 'techknight'
        });

        expect(authService.findGrantForPerson).toHaveBeenCalledWith({
            personId: 'per_sato',
            organizationId: 'techknight'
        });
        expect(authService.issueToken).toHaveBeenCalledWith(expect.objectContaining({
            personId: 'per_sato',
            slackUserId: 'U_TECHKNIGHT',
            slackWorkspaceId: 'T_TECHKNIGHT',
            organizationId: 'techknight'
        }));
        expect(authService.issueRefreshToken).toHaveBeenCalledWith({
            slackUserId: 'U_TECHKNIGHT',
            slackWorkspaceId: 'T_TECHKNIGHT',
            organizationId: 'techknight'
        });
        expect(result.access.organizationId).toBe('techknight');
    });

    it('accepts equivalent organization grants for the same person and selects one identity deterministically', async () => {
        const client = {
            query: async () => ({ rows: [
                {
                    id: 'grant-new', person_id: 'per_sato', organization_id: 'techknight',
                    slack_user_id: 'U_TECHKNIGHT', slack_workspace_id: 'T_TECHKNIGHT', role: 'ceo',
                    project_codes: ['aitle', 'techknight'], clearance: ['internal']
                },
                {
                    id: 'grant-old', person_id: 'per_sato', organization_id: 'techknight',
                    slack_user_id: 'U_UNSON', slack_workspace_id: 'T_UNSON', role: 'ceo',
                    project_codes: ['techknight', 'aitle'], clearance: ['internal']
                }
            ] }),
            release: () => {}
        };
        const authService = new AuthService();
        authService.pool = { connect: async () => client };

        await expect(authService.findGrantForPerson({
            personId: 'per_sato',
            organizationId: 'techknight'
        })).resolves.toMatchObject({
            id: 'grant-new',
            slack_user_id: 'U_TECHKNIGHT'
        });
    });

    it('selects the grant from the organization canonical workspace over a conflicting cross-workspace grant', async () => {
        const client = {
            query: async () => ({ rows: [
                {
                    id: 'grant-canonical', person_id: 'per_sato', organization_id: 'unson',
                    slack_user_id: 'U_UNSON', slack_workspace_id: 'T_UNSON', organization_workspace_id: 'T_UNSON',
                    role: 'ceo', project_codes: ['brainbase', 'mana'], clearance: ['internal', 'restricted']
                },
                {
                    id: 'grant-cross-workspace', person_id: 'per_sato', organization_id: 'unson',
                    slack_user_id: 'U_CUSTOMER', slack_workspace_id: 'T_CUSTOMER', organization_workspace_id: 'T_UNSON',
                    role: 'member', project_codes: ['brainbase'], clearance: ['internal']
                }
            ] }),
            release: () => {}
        };
        const authService = new AuthService();
        authService.pool = { connect: async () => client };

        await expect(authService.findGrantForPerson({
            personId: 'per_sato',
            organizationId: 'unson'
        })).resolves.toMatchObject({
            id: 'grant-canonical',
            role: 'ceo'
        });
    });

    it('rejects conflicting organization grants for the same person', async () => {
        const client = {
            query: async () => ({ rows: [
                {
                    id: 'grant-1', person_id: 'per_sato', organization_id: 'techknight', role: 'ceo',
                    project_codes: ['techknight'], clearance: ['internal']
                },
                {
                    id: 'grant-2', person_id: 'per_sato', organization_id: 'techknight', role: 'member',
                    project_codes: [], clearance: ['internal']
                }
            ] }),
            release: () => {}
        };
        const authService = new AuthService();
        authService.pool = { connect: async () => client };

        await expect(authService.findGrantForPerson({
            personId: 'per_sato',
            organizationId: 'techknight'
        })).rejects.toThrow('Organization access is ambiguous');
    });

    it('keeps refresh bound to the organization embedded in the refresh token', async () => {
        const authService = new AuthService();
        authService.verifyRefreshToken = vi.fn().mockReturnValue({
            typ: 'refresh',
            slackUserId: 'U_SATO',
            slackWorkspaceId: 'T_UNSON',
            organizationId: 'sato-personal'
        });
        authService.findGrant = vi.fn().mockResolvedValue({
            person_id: 'per_sato',
            person_name: '佐藤 圭吾',
            slack_user_id: 'U_SATO',
            slack_workspace_id: 'T_UNSON',
            organization_id: 'sato-personal',
            role: 'ceo',
            project_codes: ['fx', 'keiba'],
            clearance: ['internal']
        });
        authService.ensurePerson = vi.fn(async ({ personId }) => personId);
        authService.issueToken = vi.fn().mockReturnValue('personal-access-token');
        authService.issueRefreshToken = vi.fn().mockReturnValue('personal-refresh-token');
        authService.createAuditLog = vi.fn();

        authService.findUserBySlackId = vi.fn().mockResolvedValue(null);
        const result = await authService.refreshSession('old-refresh-token');

        expect(authService.findGrant).toHaveBeenCalledWith({
            slackUserId: 'U_SATO',
            slackWorkspaceId: 'T_UNSON',
            organizationId: 'sato-personal'
        });
        expect(authService.issueToken).toHaveBeenCalledWith(expect.objectContaining({
            organizationId: 'sato-personal',
            projectCodes: ['fx', 'keiba']
        }));
        expect(authService.issueRefreshToken).toHaveBeenCalledWith(expect.objectContaining({
            organizationId: 'sato-personal'
        }));
        expect(result.access.organizationId).toBe('sato-personal');
    });

    it('refresh時もgrant権限を使いながらログイン時と同じGraph人物IDを維持する', async () => {
        const authService = new AuthService();
        authService.verifyRefreshToken = vi.fn().mockReturnValue({
            typ: 'refresh',
            slackUserId: 'U_MEMBER',
            slackWorkspaceId: 'T_EXACT'
        });
        authService.findGrant = vi.fn().mockResolvedValue({
            person_id: 'per_legacy',
            person_name: 'Legacy Person',
            slack_user_id: 'U_MEMBER',
            slack_workspace_id: 'T_EXACT',
            role: 'gm',
            project_codes: ['brainbase'],
            clearance: ['internal']
        });
        authService.findUserBySlackId = vi.fn().mockResolvedValue({
            person_id: 'per_graph',
            name: 'Graph Person',
            workspace_id: 'unson'
        });
        authService.ensurePerson = vi.fn(async ({ personId }) => personId);
        authService.issueToken = vi.fn().mockReturnValue('access-token');
        authService.issueRefreshToken = vi.fn().mockReturnValue('refresh-token');
        authService.createAuditLog = vi.fn();

        const result = await authService.refreshSession('refresh-token-before');

        expect(authService.findUserBySlackId).toHaveBeenCalledWith('U_MEMBER', 'T_EXACT');
        expect(authService.ensurePerson).toHaveBeenCalledWith({
            personId: 'per_graph',
            personName: 'Graph Person'
        });
        expect(authService.issueToken).toHaveBeenCalledWith(expect.objectContaining({
            personId: 'per_graph',
            projectCodes: ['brainbase'],
            organizationId: 'unson'
        }));
        expect(result.access.personId).toBe('per_graph');
        expect(result.access.organizationId).toBe('unson');
    });

    it('resolves the organization for a legacy user token from the exact active user identity', async () => {
        const queries = [];
        const client = {
            query: async (sql, params) => {
                queries.push({ sql, params });
                return { rows: [{ organization_id: 'unson' }] };
            },
            release: () => {}
        };
        const authService = new AuthService();
        authService.pool = { connect: async () => client };

        const organizationId = await authService.resolveOrganizationIdForAccess({
            personId: 'per_sato',
            slackUserId: 'U_SATO',
            slackWorkspaceId: 'T_UNSON'
        });

        expect(organizationId).toBe('unson');
        expect(queries[0].sql).toContain("u.status = 'active'");
        expect(queries[0].sql).toContain('o.workspace_id = $3');
        expect(queries[0].params).toEqual(['per_sato', 'U_SATO', 'T_UNSON']);
    });

    it('uses auth_grants project_codes even when users.project_codes is an empty stale array', async () => {
        const queries = [
            {
                rows: [{
                    slack_user_id: 'U07LNUP582X',
                    person_id: 'per_user',
                    workspace_id: 'unson',
                    name: 'Test User',
                    role: 'CEO / CTO',
                    project_codes: [],
                    clearance: []
                }]
            },
            {
                rows: [{
                    person_id: 'per_grant',
                    name: 'Test User Grant',
                    slack_user_id: 'U07LNUP582X',
                    workspace_id: 'unson',
                    role: 'ceo',
                    project_codes: ['brainbase', 'sato-portfolio'],
                    clearance: ['internal', 'restricted'],
                    status: true
                }]
            }
        ];
        const client = {
            query: async () => queries.shift(),
            release: () => {}
        };
        const authService = new AuthService();
        authService.pool = { connect: async () => client };

        const user = await authService.findUserBySlackId('U07LNUP582X');

        expect(user.project_codes).toEqual(['brainbase', 'sato-portfolio']);
        expect(user.clearance).toEqual(['internal', 'restricted']);
        expect(user.role).toBe('ceo');
    });

    it('requires an active grant for the exact Slack workspace when authenticating', async () => {
        const queries = [
            {
                rows: [{
                    slack_user_id: 'U_MEMBER',
                    person_id: 'per_user',
                    workspace_id: 'legacy-workspace',
                    name: 'Legacy User',
                    role: 'member',
                    project_codes: ['brainbase'],
                    clearance: ['internal'],
                    status: 'active'
                }]
            },
            { rows: [] }
        ];
        const client = {
            query: async () => queries.shift(),
            release: () => {}
        };
        const authService = new AuthService();
        authService.pool = { connect: async () => client };

        const user = await authService.findUserBySlackId('U_MEMBER', 'T_EXACT');

        expect(user).toBeNull();
    });

    it('uses only the grant for the exact Slack user and workspace pair', async () => {
        const observedQueries = [];
        const queries = [
            { rows: [] },
            {
                rows: [{
                    person_id: 'per_grant',
                    name: 'Granted User',
                    slack_user_id: 'U_MEMBER',
                    slack_workspace_id: 'T_EXACT',
                    organization_id: 'unson',
                    role: 'gm',
                    project_codes: ['brainbase'],
                    clearance: ['internal', 'restricted'],
                    status: true
                }]
            }
        ];
        const client = {
            query: async (sql, params) => {
                observedQueries.push({ sql, params });
                return queries.shift();
            },
            release: () => {}
        };
        const authService = new AuthService();
        authService.pool = { connect: async () => client };

        const user = await authService.findUserBySlackId('U_MEMBER', 'T_EXACT');

        expect(user.person_id).toBe('per_grant');
        expect(user.workspace_id).toBe('unson');
        expect(observedQueries[1].params).toEqual(['U_MEMBER', 'T_EXACT']);
        expect(observedQueries[1].sql).toContain('ag.slack_workspace_id = $2');
        expect(observedQueries[1].sql).toContain('COALESCE(ag.organization_id, o.id) as organization_id');
    });

    it('keeps the users workspace as the default organization when multiple grants share one Slack identity', async () => {
        const observedQueries = [];
        const queries = [
            { rows: [{ slack_user_id: 'U_SATO', person_id: 'per_sato', workspace_id: 'unson', status: 'active' }] },
            { rows: [{
                person_id: 'per_sato',
                slack_user_id: 'U_SATO',
                slack_workspace_id: 'T_UNSON',
                organization_id: 'unson',
                role: 'ceo',
                project_codes: ['brainbase'],
                clearance: ['internal'],
                status: true
            }] }
        ];
        const client = {
            query: async (sql, params) => {
                observedQueries.push({ sql, params });
                return queries.shift();
            },
            release: () => {}
        };
        const authService = new AuthService();
        authService.pool = { connect: async () => client };

        const user = await authService.findUserBySlackId('U_SATO', 'T_UNSON');

        expect(user.workspace_id).toBe('unson');
        expect(observedQueries[1].sql).toContain('SELECT preferred.workspace_id');
        expect(observedQueries[1].sql).toContain('ag.organization_id IS NULL');
    });

    it('maps a logical grant workspace to the provider Slack team before authorizing', async () => {
        const observedQueries = [];
        const client = {
            query: async (sql, params) => {
                observedQueries.push({ sql, params });
                const isCanonicalMapping = sql.includes('o.workspace_id = $2');
                const isUnsonTeam = params[1] === 'T089CNQ4D1A';
                return {
                    rows: isCanonicalMapping && isUnsonTeam
                        ? [{
                            id: 'grant_unson',
                            person_id: 'per_sato',
                            person_name: '佐藤 圭吾',
                            slack_user_id: 'U_SATO',
                            slack_workspace_id: 'unson',
                            organization_id: 'unson',
                            role: 'ceo',
                            project_codes: ['brainbase'],
                            clearance: ['internal'],
                            active: true
                        }]
                        : []
                };
            },
            release: () => {}
        };
        const authService = new AuthService();
        authService.pool = { connect: async () => client };

        const grant = await authService.findGrant({
            slackUserId: 'U_SATO',
            slackWorkspaceId: 'T089CNQ4D1A'
        });
        const wrongTeamGrant = await authService.findGrant({
            slackUserId: 'U_SATO',
            slackWorkspaceId: 'T_WRONG'
        });

        expect(grant?.organization_id).toBe('unson');
        expect(wrongTeamGrant).toBeNull();
        expect(observedQueries[0].sql).toContain('JOIN organizations');
        expect(observedQueries[0].sql).toContain('o.workspace_id = $2');
    });

    it('keeps direct provider IDs working for legacy grants without an organization mapping', async () => {
        const client = {
            query: async (sql, params) => ({
                rows: sql.includes('ag.slack_workspace_id = $2') && params[1] === 'T_LEGACY'
                    ? [{ slack_user_id: 'U_LEGACY', slack_workspace_id: 'T_LEGACY', active: true }]
                    : []
            }),
            release: () => {}
        };
        const authService = new AuthService();
        authService.pool = { connect: async () => client };

        const grant = await authService.findGrant({
            slackUserId: 'U_LEGACY',
            slackWorkspaceId: 'T_LEGACY'
        });

        expect(grant?.slack_workspace_id).toBe('T_LEGACY');
    });

    it('authorizes a Slack team through organizations.workspace_id and rejects another team', async () => {
        const observedQueries = [];
        const userRow = {
            slack_user_id: 'U_SATO',
            person_id: 'per_sato',
            workspace_id: 'unson',
            name: '佐藤 圭吾',
            role: 'member',
            project_codes: [],
            clearance: [],
            status: 'active'
        };
        const grantRow = {
            person_id: 'per_sato',
            name: '佐藤 圭吾',
            slack_user_id: 'U_SATO',
            slack_workspace_id: 'unson',
            organization_id: 'unson',
            role: 'ceo',
            project_codes: ['brainbase'],
            clearance: ['internal'],
            status: true
        };
        const client = {
            query: async (sql, params) => {
                observedQueries.push({ sql, params });
                const isUsersQuery = sql.includes('FROM users') && !sql.includes('FROM auth_grants ag');
                const isGrantQuery = sql.includes('FROM auth_grants ag');
                const isCanonicalMapping = sql.includes('o.workspace_id = $2');
                const isUnsonTeam = params[1] === 'T089CNQ4D1A';
                if (isUsersQuery && isCanonicalMapping && isUnsonTeam) return { rows: [userRow] };
                if (isGrantQuery && isCanonicalMapping && isUnsonTeam) return { rows: [grantRow] };
                return { rows: [] };
            },
            release: () => {}
        };
        const authService = new AuthService();
        authService.pool = { connect: async () => client };

        const user = await authService.findUserBySlackId('U_SATO', 'T089CNQ4D1A');
        const wrongTeamUser = await authService.findUserBySlackId('U_SATO', 'T_WRONG');

        expect(user?.workspace_id).toBe('unson');
        expect(wrongTeamUser).toBeNull();
        expect(observedQueries[0].sql).toContain('JOIN organizations');
        expect(observedQueries[0].sql).toContain('o.workspace_id = $2');
        expect(observedQueries[1].sql).toContain('o.id = COALESCE');
        expect(observedQueries[1].sql).toContain('o.workspace_id = $2');
    });

    it('uses the same canonical Slack workspace mapping for the configured Slack provider path', async () => {
        const queries = [];
        const userRow = {
            slack_user_id: 'U_SATO',
            person_id: 'per_sato',
            workspace_id: 'unson',
            name: '佐藤 圭吾',
            role: 'ceo',
            project_codes: ['brainbase'],
            clearance: ['internal'],
            status: 'active'
        };
        const grantRow = {
            person_id: 'per_sato',
            name: '佐藤 圭吾',
            slack_user_id: 'U_SATO',
            slack_workspace_id: 'unson',
            organization_id: 'unson',
            role: 'ceo',
            project_codes: ['brainbase'],
            clearance: ['internal'],
            status: true
        };
        const client = {
            query: async (sql, params) => {
                queries.push({ sql, params });
                const isUsersQuery = sql.includes('FROM users') && !sql.includes('FROM auth_grants ag');
                const isGrantQuery = sql.includes('FROM auth_grants ag');
                const isCanonicalMapping = sql.includes('o.workspace_id = $2');
                if (isCanonicalMapping && params[1] === 'T089CNQ4D1A') {
                    return { rows: isUsersQuery ? [userRow] : isGrantQuery ? [grantRow] : [] };
                }
                return { rows: [] };
            },
            release: () => {}
        };
        const authService = new AuthService();
        authService.pool = { connect: async () => client };

        const user = await authService.findUserByExternalIdentity({
            provider: 'slack',
            subject: 'U_SATO',
            tenantId: 'T089CNQ4D1A'
        });

        expect(user?.workspace_id).toBe('unson');
        expect(queries.some(({ sql }) => sql.includes('o.workspace_id = $2'))).toBe(true);
    });
});
