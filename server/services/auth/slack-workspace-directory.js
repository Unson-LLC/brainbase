import {
    createRemoteCredentialMaterializer,
    isRemoteCredentialStoreConfigured
} from '../multitenant/remote-credential-store.js';

const SLACK_USERS_URL = 'https://slack.com/api/users.list';

function normalizedMember(member) {
    if (!member || member.deleted || member.is_bot || member.is_app_user || member.id === 'USLACKBOT') return null;
    const realName = String(member.real_name || member.profile?.real_name || '').trim();
    const displayName = String(member.profile?.display_name || realName || member.name || '').trim();
    if (!/^U[A-Z0-9]{8,}$/u.test(String(member.id || '')) || !displayName) return null;
    return {
        slackUserId: member.id,
        displayName,
        realName: realName || displayName,
        avatarUrl: String(member.profile?.image_72 || '').trim() || null
    };
}

export class SlackWorkspaceDirectory {
    constructor({ pool, credentialMaterializer, fetchImpl = globalThis.fetch } = {}) {
        this.pool = pool;
        this.credentialMaterializer = credentialMaterializer;
        this.fetchImpl = fetchImpl;
    }

    async connection(workspaceId) {
        const { rows } = await this.pool.query(
            `SELECT wc.tenant_id, wc.connection_id, wc.connection_revision, wc.provider,
                    wc.workspace_id, wc.credential_ref
               FROM workspace_connections wc
              WHERE wc.provider = 'slack' AND wc.workspace_id = $1 AND wc.status = 'active'
                AND 'users:read' = ANY(wc.granted_scopes)
              ORDER BY wc.installed_at DESC
              LIMIT 2`,
            [workspaceId]
        );
        if (rows.length !== 1) throw new Error('Organization Slack directory connection is unavailable or ambiguous');
        return rows[0];
    }

    async listMembers({ workspaceId, query = '' }) {
        if (!this.credentialMaterializer || typeof this.fetchImpl !== 'function') {
            throw new Error('Organization Slack directory is not configured');
        }
        const connection = await this.connection(workspaceId);
        const token = await this.credentialMaterializer.materialize(connection.credential_ref, {
            tenant_id: connection.tenant_id,
            connection_id: connection.connection_id,
            connection_revision: String(connection.connection_revision),
            provider: 'slack'
        });
        const members = [];
        let cursor = '';
        do {
            const url = new URL(SLACK_USERS_URL);
            url.searchParams.set('limit', '200');
            if (cursor) url.searchParams.set('cursor', cursor);
            const response = await this.fetchImpl(url, {
                headers: { authorization: `Bearer ${Buffer.from(token).toString('utf8')}` }
            });
            const payload = await response.json();
            if (!response.ok || payload.ok === false) throw new Error('Slack member directory lookup failed');
            members.push(...(payload.members || []).map(normalizedMember).filter(Boolean));
            cursor = String(payload.response_metadata?.next_cursor || '').trim();
        } while (cursor && members.length < 1000);
        const needle = String(query || '').trim().toLocaleLowerCase('ja');
        return members.filter((member) => !needle || [member.displayName, member.realName]
            .some((value) => value.toLocaleLowerCase('ja').includes(needle)));
    }

    async findMember({ workspaceId, slackUserId }) {
        const members = await this.listMembers({ workspaceId });
        return members.find((member) => member.slackUserId === slackUserId) || null;
    }
}

export function createSlackWorkspaceDirectory({ pool, env = process.env, fetchImpl } = {}) {
    if (!pool || !isRemoteCredentialStoreConfigured(env)) return null;
    return new SlackWorkspaceDirectory({
        pool,
        credentialMaterializer: createRemoteCredentialMaterializer({ env, fetchImpl }),
        fetchImpl
    });
}
