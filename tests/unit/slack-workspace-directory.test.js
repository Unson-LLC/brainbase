import { describe, expect, it, vi } from 'vitest';

import { SlackWorkspaceDirectory } from '../../server/services/auth/slack-workspace-directory.js';

describe('SlackWorkspaceDirectory', () => {
    function tenantPool(rows) {
        const query = vi.fn(async () => ({ rows }));
        const release = vi.fn();
        return { pool: { connect: vi.fn(async () => ({ query, release })) }, query, release };
    }

    it('uses the exact active workspace connection and returns only human members', async () => {
        const { pool, query, release } = tenantPool([{
            tenant_id: 'ten_baao', connection_id: 'wsc_baao', connection_revision: 3,
            provider: 'slack', workspace_id: 'T_BAAO', credential_ref: 'credential://baao',
            granted_scopes: ['users:read', 'users:read.email']
        }]);
        const materialize = vi.fn(async () => Buffer.from('xoxb-secret'));
        const fetchImpl = vi.fn(async (_url, init) => {
            expect(init.headers.authorization).toBe('Bearer xoxb-secret');
            return Response.json({ ok: true, members: [
                { id: 'UYAMAMOTO1', real_name: '山本 力弥', profile: { display_name: '山本さん', email: 'Yamamoto@Example.jp', image_72: 'https://example.test/yamamoto.png' } },
                { id: 'UBOT000001', is_bot: true, real_name: 'Bot', profile: {} },
                { id: 'UDELETED01', deleted: true, real_name: '退職者', profile: {} },
                { id: 'UNOEMAIL01', real_name: 'メールなし', profile: { display_name: 'メールなし' } }
            ], response_metadata: { next_cursor: '' } });
        });
        const directory = new SlackWorkspaceDirectory({
            pool, credentialMaterializer: { materialize }, fetchImpl
        });

        await expect(directory.listMembers({ tenantId: 'ten_baao', workspaceId: 'T_BAAO', query: '山本' })).resolves.toEqual([{
            slackUserId: 'UYAMAMOTO1', displayName: '山本さん', realName: '山本 力弥',
            email: 'yamamoto@example.jp', avatarUrl: 'https://example.test/yamamoto.png'
        }]);
        expect(query.mock.calls.map(([sql]) => sql)).toEqual(expect.arrayContaining([
            'BEGIN', "SELECT set_config('brainbase.tenant_id', $1, true)", 'COMMIT'
        ]));
        expect(query).toHaveBeenCalledWith("SELECT set_config('brainbase.tenant_id', $1, true)", ['ten_baao']);
        expect(query.mock.calls.find(([sql]) => sql.includes('FROM workspace_connections'))[1]).toEqual(['ten_baao', 'T_BAAO']);
        expect(release).toHaveBeenCalled();
        expect(materialize).toHaveBeenCalledWith('credential://baao', {
            tenant_id: 'ten_baao', connection_id: 'wsc_baao', connection_revision: '3', provider: 'slack'
        });
    });

    it('fails closed when more than one connection matches the workspace', async () => {
        const { pool } = tenantPool([{}, {}]);
        const directory = new SlackWorkspaceDirectory({
            pool,
            credentialMaterializer: { materialize: async () => Buffer.from('unused') },
            fetchImpl: vi.fn()
        });
        await expect(directory.listMembers({ tenantId: 'ten_baao', workspaceId: 'T_BAAO' }))
            .rejects.toThrow('unavailable or ambiguous');
    });

    it('fails closed before querying when tenant context is missing', async () => {
        const { pool, query } = tenantPool([]);
        const directory = new SlackWorkspaceDirectory({
            pool,
            credentialMaterializer: { materialize: async () => Buffer.from('unused') },
            fetchImpl: vi.fn()
        });
        await expect(directory.listMembers({ workspaceId: 'T_BAAO' }))
            .rejects.toThrow('tenant context is required');
        expect(query).not.toHaveBeenCalled();
    });

    it('selects the unique active connection from organization-linked workspace candidates', async () => {
        const { pool, query } = tenantPool([{
            tenant_id: 'ten_unson', connection_id: 'wsc_business', connection_revision: 2,
            provider: 'slack', workspace_id: 'T_BUSINESS', credential_ref: 'credential://business',
            granted_scopes: ['users:read', 'users:read.email']
        }]);
        const directory = new SlackWorkspaceDirectory({
            pool,
            credentialMaterializer: { materialize: async () => Buffer.from('xoxb-secret') },
            fetchImpl: vi.fn(async () => Response.json({ ok: true, members: [], response_metadata: { next_cursor: '' } }))
        });

        await directory.listMembers({ tenantId: 'ten_unson', workspaceIds: ['T_LOGIN', 'T_BUSINESS'] });

        const connectionQuery = query.mock.calls.find(([sql]) => sql.includes('FROM workspace_connections'));
        expect(connectionQuery[1]).toEqual(['ten_unson', ['T_LOGIN', 'T_BUSINESS']]);
        expect(connectionQuery[0]).toContain('wc.workspace_id = ANY($2::text[])');
    });

    it('fails closed when the connection cannot read member email addresses', async () => {
        const { pool } = tenantPool([{ granted_scopes: ['users:read'] }]);
        const directory = new SlackWorkspaceDirectory({
            pool,
            credentialMaterializer: { materialize: async () => Buffer.from('unused') },
            fetchImpl: vi.fn()
        });
        await expect(directory.listMembers({ tenantId: 'ten_baao', workspaceId: 'T_BAAO' }))
            .rejects.toThrow('users:read.email');
    });
});
