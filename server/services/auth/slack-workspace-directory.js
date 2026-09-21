import {
    createRemoteCredentialMaterializer,
    isRemoteCredentialStoreConfigured
} from '../multitenant/remote-credential-store.js';

const SLACK_USERS_URL = 'https://slack.com/api/users.list';

function normalizedMember(member) {
    if (!member || member.deleted || member.is_bot || member.is_app_user || member.id === 'USLACKBOT') return null;
    const realName = String(member.real_name || member.profile?.real_name || '').trim();
    const displayName = String(member.profile?.display_name || realName || member.name || '').trim();
    const email = String(member.profile?.email || '').trim().toLowerCase();
    if (!/^U[A-Z0-9]{8,}$/u.test(String(member.id || '')) || !displayName || !/^[^\s@]+@[^\s@]+$/u.test(email)) return null;
    return {
        slackUserId: member.id,
        displayName,
        realName: realName || displayName,
        email,
        avatarUrl: String(member.profile?.image_72 || '').trim() || null
    };
}

export class SlackWorkspaceDirectory {
    constructor({ pool, credentialMaterializer, fetchImpl = globalThis.fetch } = {}) {
        this.pool = pool;
        this.credentialMaterializer = credentialMaterializer;
        this.fetchImpl = fetchImpl;
    }

    async connection({ tenantId, workspaceIds }) {
        const requestedTenantId = String(tenantId || '').trim();
        if (!requestedTenantId) throw new Error('Organization Slack directory tenant context is required');
        const candidates = [...new Set((Array.isArray(workspaceIds) ? workspaceIds : [workspaceIds])
            .map((value) => String(value || '').trim())
            .filter(Boolean))];
        if (candidates.length === 0) throw new Error('Organization Slack directory connection is unavailable or ambiguous');
        const workspacePredicate = candidates.length === 1
            ? 'wc.workspace_id = $2'
            : 'wc.workspace_id = ANY($2::text[])';
        const client = await this.pool.connect();
        let rows;
        try {
            await client.query('BEGIN');
            await client.query("SELECT set_config('brainbase.tenant_id', $1, true)", [requestedTenantId]);
            ({ rows } = await client.query(
            `SELECT wc.tenant_id, wc.connection_id, wc.connection_revision, wc.provider,
                    wc.workspace_id, wc.credential_ref, wc.granted_scopes
               FROM workspace_connections wc
              WHERE wc.tenant_id = $1 AND wc.provider = 'slack'
                AND ${workspacePredicate} AND wc.status = 'active'
              ORDER BY wc.installed_at DESC
              LIMIT 2`,
            [requestedTenantId, candidates.length === 1 ? candidates[0] : candidates]
            ));
            await client.query('COMMIT');
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch {
                // Preserve the directory lookup failure.
            }
            throw error;
        } finally {
            client.release();
        }
        if (rows.length !== 1) throw new Error('Organization Slack directory connection is unavailable or ambiguous');
        const scopes = new Set(rows[0].granted_scopes || []);
        if (!scopes.has('users:read') || !scopes.has('users:read.email')) {
            throw new Error('Organization Slack directory requires users:read and users:read.email scopes');
        }
        return rows[0];
    }

    async resolveWorkspaceId({ tenantId, workspaceIds }) {
        const connection = await this.connection({ tenantId, workspaceIds });
        return connection.workspace_id;
    }

    async listMembers({ tenantId, workspaceId, workspaceIds, query = '' }) {
        if (!this.credentialMaterializer || typeof this.fetchImpl !== 'function') {
            throw new Error('Organization Slack directory is not configured');
        }
        const connection = await this.connection({ tenantId, workspaceIds: workspaceIds || workspaceId });
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
        return members.filter((member) => !needle || [member.displayName, member.realName, member.email]
            .some((value) => value.toLocaleLowerCase('ja').includes(needle)));
    }

    async findMember({ tenantId, workspaceId, slackUserId }) {
        const members = await this.listMembers({ tenantId, workspaceId });
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
