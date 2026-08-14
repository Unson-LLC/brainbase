import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../../server/services/auth-service.js';

describe('AuthService auth grant precedence', () => {
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
        expect(observedQueries[1].sql).toContain('o.id as organization_id');
    });
});
