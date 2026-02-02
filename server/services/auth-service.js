import crypto from 'crypto';
import { Pool } from 'pg';
import { ulid } from 'ulid';
import jwt from 'jsonwebtoken';

const DEFAULT_SCOPES = 'openid profile email';
const DEFAULT_CLEARANCE = ['internal', 'restricted'];
const FULL_CLEARANCE = ['internal', 'restricted', 'finance', 'hr', 'contract'];

const ROLE_RANK = {
    member: 1,
    gm: 2,
    ceo: 3
};

export class AuthService {
    constructor() {
        this.databaseUrl = process.env.INFO_SSOT_DATABASE_URL || process.env.INFO_SSOT_DB_URL || '';
        this.pool = this.databaseUrl ? new Pool({ connectionString: this.databaseUrl }) : null;
        this.jwtSecret = process.env.BRAINBASE_JWT_SECRET || '';

        this.slackClientId = process.env.SLACK_CLIENT_ID || '';
        this.slackClientSecret = process.env.SLACK_CLIENT_SECRET || '';
        this.slackRedirectUri = process.env.SLACK_REDIRECT_URI || '';
        this.slackScopes = process.env.SLACK_AUTH_SCOPES || DEFAULT_SCOPES;
        this.slackMode = (process.env.SLACK_AUTH_MODE || 'oidc').toLowerCase();

        this.authorizeUrl = process.env.SLACK_AUTH_AUTHORIZE_URL
            || (this.slackMode === 'oauth'
                ? 'https://slack.com/oauth/v2/authorize'
                : 'https://slack.com/openid/connect/authorize');
        this.tokenUrl = process.env.SLACK_AUTH_TOKEN_URL
            || (this.slackMode === 'oauth'
                ? 'https://slack.com/api/oauth.v2.access'
                : 'https://slack.com/api/openid.connect.token');
        this.userInfoUrl = process.env.SLACK_AUTH_USERINFO_URL
            || 'https://slack.com/api/openid.connect.userInfo';

        this.stateStore = new Map();
        this.stateTtlMs = 10 * 60 * 1000;
    }

    assertReady() {
        if (!this.pool) {
            throw new Error('Info SSOT database is not configured');
        }
        if (!this.jwtSecret) {
            throw new Error('BRAINBASE_JWT_SECRET is not set');
        }
        if (!this.slackClientId || !this.slackClientSecret || !this.slackRedirectUri) {
            throw new Error('Slack OAuth configuration is missing');
        }
    }

    generateId(prefix) {
        return `${prefix}_${ulid()}`;
    }

    createState() {
        const state = crypto.randomBytes(16).toString('hex');
        this.stateStore.set(state, Date.now());
        return state;
    }

    consumeState(state) {
        const createdAt = this.stateStore.get(state);
        this.stateStore.delete(state);
        if (!createdAt) {
            return false;
        }
        return Date.now() - createdAt < this.stateTtlMs;
    }

    buildAuthorizeUrl(state) {
        const url = new URL(this.authorizeUrl);
        url.searchParams.set('client_id', this.slackClientId);
        url.searchParams.set('redirect_uri', this.slackRedirectUri);
        url.searchParams.set('state', state);
        url.searchParams.set('scope', this.slackScopes);
        url.searchParams.set('response_type', 'code');
        return url.toString();
    }

    async exchangeCode(code) {
        const body = new URLSearchParams({
            client_id: this.slackClientId,
            client_secret: this.slackClientSecret,
            redirect_uri: this.slackRedirectUri,
            code
        });
        if (this.slackMode !== 'oauth') {
            body.set('grant_type', 'authorization_code');
        }
        const res = await fetch(this.tokenUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body
        });
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`Slack token exchange failed: ${res.status} ${text}`);
        }
        const data = text ? JSON.parse(text) : {};
        if (data.ok === false) {
            throw new Error(`Slack token exchange failed: ${data.error || 'unknown_error'}`);
        }
        return data;
    }

    async fetchUserInfo(accessToken) {
        const res = await fetch(this.userInfoUrl, {
            method: 'GET',
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`Slack userinfo failed: ${res.status} ${text}`);
        }
        const data = text ? JSON.parse(text) : {};
        if (data.ok === false) {
            throw new Error(`Slack userinfo failed: ${data.error || 'unknown_error'}`);
        }
        return data;
    }

    resolveSlackIdentity(tokenPayload, userInfo) {
        const fromTokenUser = tokenPayload?.authed_user?.id || tokenPayload?.user?.id || tokenPayload?.user_id || tokenPayload?.sub || null;
        const fromTokenTeam = tokenPayload?.team?.id || tokenPayload?.team_id || tokenPayload?.enterprise_id || tokenPayload?.workspace_id || null;

        const userIdCandidates = [
            userInfo?.user_id,
            userInfo?.sub,
            userInfo?.id,
            userInfo?.['https://slack.com/user_id'],
            fromTokenUser
        ].filter(Boolean);

        const teamIdCandidates = [
            userInfo?.team_id,
            userInfo?.['https://slack.com/team_id'],
            userInfo?.team?.id,
            fromTokenTeam
        ].filter(Boolean);

        return {
            slackUserId: userIdCandidates[0] || null,
            slackWorkspaceId: teamIdCandidates[0] || null
        };
    }

    async findGrant({ slackUserId, slackWorkspaceId }) {
        const client = await this.pool.connect();
        try {
            const { rows } = await client.query(
                `SELECT *
                 FROM auth_grants
                 WHERE slack_user_id = $1
                   AND slack_workspace_id = $2
                   AND active = true
                 LIMIT 1`,
                [slackUserId, slackWorkspaceId]
            );
            return rows[0] || null;
        } finally {
            client.release();
        }
    }

    async ensurePerson({ personId, personName }) {
        const client = await this.pool.connect();
        try {
            if (personId) {
                const { rows } = await client.query(
                    'SELECT id FROM people WHERE id = $1 LIMIT 1',
                    [personId]
                );
                if (rows.length > 0) {
                    return personId;
                }
            }
            if (!personName) {
                throw new Error('personName is required');
            }
            const { rows } = await client.query(
                'SELECT id FROM people WHERE name = $1 LIMIT 1',
                [personName]
            );
            if (rows.length > 0) {
                return rows[0].id;
            }
            const id = this.generateId('per');
            await client.query(
                'INSERT INTO people (id, name, status) VALUES ($1, $2, $3)',
                [id, personName, 'active']
            );
            return id;
        } finally {
            client.release();
        }
    }

    deriveRoleFromText(text) {
        const roleText = (text || '').toLowerCase();
        if (roleText.includes('ceo') || roleText.includes('cto') || roleText.includes('代表') || roleText.includes('founder')) {
            return 'ceo';
        }
        if (roleText.includes('gm')) {
            return 'gm';
        }
        return 'member';
    }

    normalizeRole(role) {
        const normalized = typeof role === 'string' ? role.toLowerCase() : '';
        return ROLE_RANK[normalized] ? normalized : 'member';
    }

    buildAccessFromGrant(grant) {
        const role = this.normalizeRole(grant.role);
        const projectCodes = Array.isArray(grant.project_codes) ? grant.project_codes : [];
        let clearance = Array.isArray(grant.clearance) ? grant.clearance : [];
        if (!clearance.length) {
            clearance = role === 'member' ? DEFAULT_CLEARANCE : FULL_CLEARANCE;
        }
        return {
            role,
            projectCodes,
            clearance,
            personId: grant.person_id || null,
            slackUserId: grant.slack_user_id,
            slackWorkspaceId: grant.slack_workspace_id
        };
    }

    issueToken(payload) {
        const now = Math.floor(Date.now() / 1000);
        const exp = now + 60 * 60;
        return jwt.sign(
            { ...payload, iat: now, exp },
            this.jwtSecret
        );
    }

    verifyToken(token) {
        return jwt.verify(token, this.jwtSecret);
    }

    async createAuditLog({ personId, slackUserId, slackWorkspaceId, eventType, metadata }) {
        const client = await this.pool.connect();
        try {
            const id = this.generateId('aud');
            await client.query(
                `INSERT INTO auth_audit_logs (
                    id,
                    person_id,
                    slack_user_id,
                    slack_workspace_id,
                    event_type,
                    metadata,
                    created_at
                ) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
                [
                    id,
                    personId || null,
                    slackUserId || null,
                    slackWorkspaceId || null,
                    eventType,
                    JSON.stringify(metadata || {})
                ]
            );
        } finally {
            client.release();
        }
    }
}
