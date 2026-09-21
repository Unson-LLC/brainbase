import { describe, expect, it, vi } from 'vitest';

import { SlackWorkspaceDirectory } from '../../server/services/auth/slack-workspace-directory.js';

describe('SlackWorkspaceDirectory', () => {
    it('uses the exact active workspace connection and returns only human members', async () => {
        const pool = { query: vi.fn(async (_sql, params) => ({ rows: [{
            tenant_id: 'ten_baao', connection_id: 'wsc_baao', connection_revision: 3,
            provider: 'slack', workspace_id: 'T_BAAO', credential_ref: 'credential://baao'
        }], params })) };
        const materialize = vi.fn(async () => Buffer.from('xoxb-secret'));
        const fetchImpl = vi.fn(async (_url, init) => {
            expect(init.headers.authorization).toBe('Bearer xoxb-secret');
            return Response.json({ ok: true, members: [
                { id: 'UYAMAMOTO1', real_name: '山本 力弥', profile: { display_name: '山本さん', image_72: 'https://example.test/yamamoto.png' } },
                { id: 'UBOT000001', is_bot: true, real_name: 'Bot', profile: {} },
                { id: 'UDELETED01', deleted: true, real_name: '退職者', profile: {} }
            ], response_metadata: { next_cursor: '' } });
        });
        const directory = new SlackWorkspaceDirectory({
            pool, credentialMaterializer: { materialize }, fetchImpl
        });

        await expect(directory.listMembers({ workspaceId: 'T_BAAO', query: '山本' })).resolves.toEqual([{
            slackUserId: 'UYAMAMOTO1', displayName: '山本さん', realName: '山本 力弥',
            avatarUrl: 'https://example.test/yamamoto.png'
        }]);
        expect(pool.query.mock.calls[0][1]).toEqual(['T_BAAO']);
        expect(materialize).toHaveBeenCalledWith('credential://baao', {
            tenant_id: 'ten_baao', connection_id: 'wsc_baao', connection_revision: '3', provider: 'slack'
        });
    });

    it('fails closed when more than one connection matches the workspace', async () => {
        const directory = new SlackWorkspaceDirectory({
            pool: { query: async () => ({ rows: [{}, {}] }) },
            credentialMaterializer: { materialize: async () => Buffer.from('unused') },
            fetchImpl: vi.fn()
        });
        await expect(directory.listMembers({ workspaceId: 'T_BAAO' }))
            .rejects.toThrow('unavailable or ambiguous');
    });
});
