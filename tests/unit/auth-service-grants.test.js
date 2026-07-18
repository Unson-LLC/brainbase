import { describe, expect, it } from 'vitest';

import { AuthService } from '../../server/services/auth-service.js';

describe('AuthService auth grant precedence', () => {
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
                    workspace_id: 'T_EXACT',
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
        expect(user.workspace_id).toBe('T_EXACT');
        expect(observedQueries[1].params).toEqual(['U_MEMBER', 'T_EXACT']);
        expect(observedQueries[1].sql).toContain('slack_workspace_id = $2');
    });
});
