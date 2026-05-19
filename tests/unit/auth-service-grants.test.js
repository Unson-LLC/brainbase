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
});
