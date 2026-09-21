import { describe, expect, it } from 'vitest';

import { AuthService } from '../../server/services/auth-service.js';

function serviceWithClient(query, slackDirectory = null) {
    const service = new AuthService();
    service.pool = {
        connect: async () => ({ query, release: () => {} })
    };
    service.slackDirectory = slackDirectory;
    return service;
}

describe('AuthService organization member administration', () => {
    it('lists only grants belonging to the authenticated organization scope', async () => {
        const observed = [];
        const service = serviceWithClient(async (sql, params) => {
            observed.push({ sql, params });
            return { rows: [{ id: 'grant_1', person_name: '佐藤 圭吾', role: 'ceo' }] };
        });

        await expect(service.listOrganizationMembers('unson')).resolves.toEqual([
            { id: 'grant_1', person_name: '佐藤 圭吾', role: 'ceo' }
        ]);
        expect(observed[0].sql).toContain('WHERE organization_id = $1');
        expect(observed[0].params).toEqual(['unson']);
    });

    it('registers BAAO member Yamamoto with the baao project in the authenticated tenant', async () => {
        const statements = [];
        const createdMember = {
            id: 'grant_yamamoto',
            person_id: 'person_yamamoto',
            person_name: '山本 力弥',
            slack_user_id: 'UTESTBAAO1',
            role: 'member',
            project_codes: ['baao'],
            active: true
        };
        const slackDirectory = {
            findMember: async ({ workspaceId, slackUserId }) => {
                expect({ workspaceId, slackUserId }).toEqual({ workspaceId: 'T_BAAO', slackUserId: 'UTESTBAAO1' });
                return { slackUserId: 'UTESTBAAO1', displayName: '山本 力弥', realName: '山本 力弥' };
            }
        };
        const service = serviceWithClient(async (sql, params) => {
            statements.push({ sql, params });
            if (sql.startsWith('SELECT workspace_id')) return { rows: [{ workspace_id: 'T_BAAO' }], rowCount: 1 };
            if (sql.startsWith('SELECT code FROM projects')) return { rows: [{ code: 'baao' }], rowCount: 1 };
            if (sql.startsWith('SELECT 1 FROM auth_grants')) return { rows: [], rowCount: 0 };
            if (sql.includes('INSERT INTO auth_grants')) return { rows: [createdMember], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        }, slackDirectory);

        await expect(service.createOrganizationMember({
            organizationId: 'baao-organization',
            slackUserId: 'UTESTBAAO1',
            role: 'member',
            projectCodes: ['baao']
        })).resolves.toEqual(createdMember);

        const grantInsert = statements.find(({ sql }) => sql.includes('INSERT INTO auth_grants'));
        expect(grantInsert.params.slice(2)).toEqual([
            '山本 力弥', 'UTESTBAAO1', 'T_BAAO', 'baao-organization', 'member', ['baao']
        ]);
        expect(statements.at(-1).sql).toBe('COMMIT');
    });

    it('searches the authenticated tenant Slack workspace and hides registered users', async () => {
        const slackDirectory = {
            listMembers: async ({ workspaceId, query }) => {
                expect({ workspaceId, query }).toEqual({ workspaceId: 'T_BAAO', query: '山本' });
                return [
                    { slackUserId: 'UYAMAMOTO1', displayName: '山本 力弥', realName: '山本 力弥' },
                    { slackUserId: 'UREGISTERED1', displayName: '登録済み', realName: '登録済み' }
                ];
            }
        };
        const service = serviceWithClient(async (sql) => {
            if (sql.startsWith('SELECT workspace_id')) return { rows: [{ workspace_id: 'T_BAAO' }], rowCount: 1 };
            if (sql.includes('FROM auth_grants')) return { rows: [{ slack_user_id: 'UREGISTERED1' }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        }, slackDirectory);

        await expect(service.listSlackWorkspaceMembers('baao-organization', '山本')).resolves.toEqual([
            { slackUserId: 'UYAMAMOTO1', displayName: '山本 力弥', realName: '山本 力弥' }
        ]);
    });

    it('rejects a forged Slack ID that is not in the tenant workspace', async () => {
        const statements = [];
        const service = serviceWithClient(async (sql) => {
            statements.push(sql);
            if (sql.startsWith('SELECT workspace_id')) return { rows: [{ workspace_id: 'T_BAAO' }], rowCount: 1 };
            if (sql.startsWith('SELECT code FROM projects')) return { rows: [{ code: 'baao' }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        }, { findMember: async () => null });

        await expect(service.createOrganizationMember({
            organizationId: 'baao-organization',
            slackUserId: 'UFORGED001',
            role: 'member',
            projectCodes: ['baao']
        })).rejects.toThrow('Slack member was not found in the organization workspace');
        expect(statements).toContain('ROLLBACK');
        expect(statements.some((sql) => sql.startsWith('INSERT INTO people'))).toBe(false);
    });

    it('rejects a project code outside the organization and rolls back creation', async () => {
        const statements = [];
        const service = serviceWithClient(async (sql) => {
            statements.push(sql);
            if (sql.startsWith('SELECT workspace_id')) return { rows: [{ workspace_id: 'T_UNSON' }], rowCount: 1 };
            if (sql.startsWith('SELECT code FROM projects')) return { rows: [], rowCount: 0 };
            return { rows: [], rowCount: 0 };
        });

        await expect(service.createOrganizationMember({
            organizationId: 'unson',
            personName: '山田 太郎',
            slackUserId: 'U12345678',
            role: 'member',
            projectCodes: ['other-tenant-project']
        })).rejects.toThrow('project outside the organization');
        expect(statements).toContain('ROLLBACK');
        expect(statements.some((sql) => sql.startsWith('INSERT INTO people'))).toBe(false);
    });

    it('serializes tenant grants and preserves the global person when one grant is disabled', async () => {
        const statements = [];
        const current = {
            id: 'grant_member', person_id: 'person_1', person_name: '山田 太郎',
            role: 'member', project_codes: ['brainbase'], active: true
        };
        const service = serviceWithClient(async (sql, params) => {
            statements.push({ sql, params });
            if (sql.startsWith('SELECT id FROM auth_grants')) return { rows: [{ id: current.id }], rowCount: 1 };
            if (sql.startsWith('SELECT * FROM auth_grants')) return { rows: [current], rowCount: 1 };
            if (sql.startsWith('SELECT code FROM projects')) return { rows: [{ code: 'brainbase' }], rowCount: 1 };
            if (sql.startsWith('UPDATE auth_grants')) return { rows: [{ ...current, active: false }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        });

        await service.updateOrganizationMember({ organizationId: 'unson', grantId: current.id, active: false });

        expect(statements[1].sql).toContain('organization_id = $1 FOR UPDATE');
        const personUpdate = statements.find(({ sql }) => sql.startsWith('UPDATE people'));
        expect(personUpdate.sql).toBe('UPDATE people SET name = $2 WHERE id = $1');
        expect(personUpdate.params).toEqual(['person_1', '山田 太郎']);
    });

    it('does not allow the final active CEO to be demoted', async () => {
        const statements = [];
        const service = serviceWithClient(async (sql) => {
            statements.push(sql);
            if (sql.startsWith('SELECT id FROM auth_grants')) return { rows: [{ id: 'grant_ceo' }], rowCount: 1 };
            if (sql.startsWith('SELECT * FROM auth_grants')) return {
                rows: [{
                    id: 'grant_ceo', person_id: 'person_ceo', person_name: '佐藤 圭吾',
                    role: 'ceo', project_codes: ['brainbase'], active: true
                }],
                rowCount: 1
            };
            if (sql.startsWith('SELECT code FROM projects')) return { rows: [{ code: 'brainbase' }], rowCount: 1 };
            if (sql.includes("role = 'ceo'")) return { rows: [], rowCount: 0 };
            return { rows: [], rowCount: 0 };
        });

        await expect(service.updateOrganizationMember({
            organizationId: 'unson', grantId: 'grant_ceo', role: 'gm'
        })).rejects.toThrow('last active CEO');
        expect(statements).toContain('ROLLBACK');
    });
});
