import crypto from 'crypto';
import { Pool } from 'pg';
import { ulid } from 'ulid';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger.js';

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
        this.refreshSecret = process.env.BRAINBASE_REFRESH_SECRET || this.jwtSecret || '';
        this.refreshTtlSeconds = Number(process.env.BRAINBASE_REFRESH_TTL_SECONDS || 60 * 60 * 24 * 30);
        this.stateSecret = process.env.BRAINBASE_AUTH_STATE_SECRET || this.jwtSecret || '';

        this.slackClientId = process.env.SLACK_CLIENT_ID || '';
        this.slackClientSecret = process.env.SLACK_CLIENT_SECRET || '';
        this.slackRedirectUri = process.env.SLACK_REDIRECT_URI || '';
        this.slackScopes = process.env.SLACK_AUTH_SCOPES;
        if (this.slackScopes === undefined || this.slackScopes === null) {
            this.slackScopes = DEFAULT_SCOPES;
        }
        this.slackUserScopes = process.env.SLACK_AUTH_USER_SCOPES || '';
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
        this.codeChallengeStore = new Map(); // code → { codeChallenge, createdAt }

        // Device Code Flow stores
        this.deviceCodeStore = new Map(); // device_code → { codeVerifier, userCode, createdAt, status, slackUserId, slackWorkspaceId }
        this.userCodeStore = new Map(); // user_code → device_code
        this.deviceCodeTtlMs = 10 * 60 * 1000; // 10 minutes (RFC 8628 recommends 5-15 minutes)
        this.deviceCodePollingInterval = 5; // 5 seconds

        // Device Code cleanup interval (every 1 minute)
        setInterval(() => this.cleanupExpiredDeviceCodes(), 60 * 1000);
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

    createState({ origin, codeChallenge } = {}) {
        if (this.stateSecret) {
            return this.createSignedState({ origin, codeChallenge });
        }
        const state = crypto.randomBytes(16).toString('hex');
        this.stateStore.set(state, {
            createdAt: Date.now(),
            origin: typeof origin === 'string' ? origin : null,
            codeChallenge: typeof codeChallenge === 'string' ? codeChallenge : null
        });
        return state;
    }

    consumeState(state) {
        if (this.stateSecret) {
            return this.consumeSignedState(state);
        }
        const record = this.stateStore.get(state);
        this.stateStore.delete(state);
        if (!record || !record.createdAt) {
            return { ok: false, origin: null, codeChallenge: null };
        }
        const ok = Date.now() - record.createdAt < this.stateTtlMs;
        return { ok, origin: record.origin || null, codeChallenge: record.codeChallenge || null };
    }

    createSignedState({ origin, codeChallenge } = {}) {
        const ts = Date.now();
        const nonce = crypto.randomBytes(16).toString('hex');
        const originValue = typeof origin === 'string' && origin.length > 0
            ? Buffer.from(origin, 'utf8').toString('base64url')
            : '';
        const codeChallengeValue = typeof codeChallenge === 'string' && codeChallenge.length > 0
            ? Buffer.from(codeChallenge, 'utf8').toString('base64url')
            : '';

        let payload = `${ts}.${nonce}`;
        if (originValue) payload += `.${originValue}`;
        if (codeChallengeValue) payload += `.${codeChallengeValue}`;

        const signature = crypto
            .createHmac('sha256', this.stateSecret)
            .update(payload)
            .digest('hex');
        return `${payload}.${signature}`;
    }

    consumeSignedState(state) {
        if (typeof state !== 'string') return { ok: false, origin: null, codeChallenge: null };
        const parts = state.split('.');
        // 3: ts.nonce.signature
        // 4: ts.nonce.origin.signature
        // 5: ts.nonce.origin.codeChallenge.signature
        if (parts.length < 3 || parts.length > 5) {
            return { ok: false, origin: null, codeChallenge: null };
        }

        const signature = parts[parts.length - 1];
        const tsRaw = parts[0];
        const nonce = parts[1];
        const originEncoded = parts.length >= 4 ? parts[2] : '';
        const codeChallengeEncoded = parts.length === 5 ? parts[3] : '';

        if (!tsRaw || !nonce || !signature) {
            return { ok: false, origin: null, codeChallenge: null };
        }

        // Reconstruct payload
        let payload = `${tsRaw}.${nonce}`;
        if (originEncoded) payload += `.${originEncoded}`;
        if (codeChallengeEncoded) payload += `.${codeChallengeEncoded}`;

        const expected = crypto
            .createHmac('sha256', this.stateSecret)
            .update(payload)
            .digest('hex');
        try {
            const sigBuf = Buffer.from(signature, 'hex');
            const expBuf = Buffer.from(expected, 'hex');
            if (sigBuf.length !== expBuf.length) {
                return { ok: false, origin: null, codeChallenge: null };
            }
            if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
                return { ok: false, origin: null, codeChallenge: null };
            }
        } catch {
            return { ok: false, origin: null, codeChallenge: null };
        }
        const ts = Number(tsRaw);
        if (!Number.isFinite(ts)) return { ok: false, origin: null, codeChallenge: null };
        const ageMs = Math.abs(Date.now() - ts);
        if (ageMs >= this.stateTtlMs) {
            return { ok: false, origin: null, codeChallenge: null };
        }

        let origin = null;
        if (originEncoded) {
            try {
                origin = Buffer.from(originEncoded, 'base64url').toString('utf8');
            } catch {
                origin = null;
            }
        }

        let codeChallenge = null;
        if (codeChallengeEncoded) {
            try {
                codeChallenge = Buffer.from(codeChallengeEncoded, 'base64url').toString('utf8');
            } catch {
                codeChallenge = null;
            }
        }

        return { ok: true, origin, codeChallenge };
    }

    buildAuthorizeUrl(state) {
        const url = new URL(this.authorizeUrl);
        url.searchParams.set('client_id', this.slackClientId);
        url.searchParams.set('redirect_uri', this.slackRedirectUri);
        url.searchParams.set('state', state);
        if (this.slackScopes !== undefined && this.slackScopes !== null) {
            url.searchParams.set('scope', this.slackScopes);
        }
        if (this.slackMode === 'oauth' && this.slackUserScopes) {
            url.searchParams.set('user_scope', this.slackUserScopes);
        }
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

    /**
     * Find user by Slack user ID (Permission System Phase 1)
     * @param {string} slackUserId - Slack user ID (e.g., 'U07LNUP582X')
     * @returns {Promise<Object|null>} - User object or null if not found
     */
    async findUserBySlackId(slackUserId) {
        if (!this.pool) {
            throw new Error('Database pool is not configured');
        }

        const client = await this.pool.connect();
        try {
            const { rows } = await client.query(
                `SELECT *
                 FROM users
                 WHERE slack_user_id = $1
                   AND status = 'active'
                 LIMIT 1`,
                [slackUserId]
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

    issueRefreshToken(payload) {
        const now = Math.floor(Date.now() / 1000);
        const exp = now + this.refreshTtlSeconds;
        return jwt.sign(
            { ...payload, typ: 'refresh', iat: now, exp },
            this.refreshSecret
        );
    }

    verifyToken(token) {
        return jwt.verify(token, this.jwtSecret);
    }

    verifyRefreshToken(token) {
        return jwt.verify(token, this.refreshSecret);
    }

    async refreshSession(refreshToken) {
        if (!refreshToken) {
            throw new Error('Refresh token is required');
        }
        const payload = this.verifyRefreshToken(refreshToken);
        if (!payload || payload.typ !== 'refresh') {
            throw new Error('Invalid refresh token');
        }
        const slackUserId = payload.slackUserId || payload.slack_user_id || payload.sub || null;
        const slackWorkspaceId = payload.slackWorkspaceId || payload.slack_workspace_id || payload.team_id || null;
        if (!slackUserId || !slackWorkspaceId) {
            throw new Error('Refresh token missing Slack identity');
        }
        const grant = await this.findGrant({ slackUserId, slackWorkspaceId });
        if (!grant) {
            await this.createAuditLog({
                slackUserId,
                slackWorkspaceId,
                eventType: 'AUTH_DENY',
                metadata: { reason: 'grant_not_found' }
            });
            throw new Error('Access is not granted');
        }
        const personId = await this.ensurePerson({
            personId: grant.person_id,
            personName: grant.person_name
        });
        const access = this.buildAccessFromGrant({ ...grant, person_id: personId });
        const token = this.issueToken({
            role: access.role,
            projectCodes: access.projectCodes,
            clearance: access.clearance,
            personId,
            slackUserId,
            slackWorkspaceId
        });
        const nextRefreshToken = this.issueRefreshToken({
            slackUserId,
            slackWorkspaceId
        });
        await this.createAuditLog({
            personId,
            slackUserId,
            slackWorkspaceId,
            eventType: 'AUTH_REFRESH',
            metadata: { role: access.role, project_codes: access.projectCodes }
        });
        return {
            token,
            access_token: token,
            refresh_token: nextRefreshToken,
            access: {
                role: access.role,
                projectCodes: access.projectCodes,
                clearance: access.clearance,
                personId
            }
        };
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

    /**
     * Store code_challenge for later verification (PKCE flow)
     * @param {string} code - OAuth authorization code from Slack
     * @param {string} codeChallenge - code_challenge from state
     */
    storeCodeChallenge(code, codeChallenge) {
        if (!codeChallenge) return;
        this.codeChallengeStore.set(code, {
            codeChallenge,
            createdAt: Date.now()
        });
    }

    /**
     * Verify code_verifier against code_challenge (OAuth2 PKCE)
     * @param {string} code - OAuth authorization code
     * @param {string} codeVerifier - code_verifier from CLI client
     * @returns {boolean} - true if verification succeeds
     */
    verifyCodeVerifier(code, codeVerifier) {
        const record = this.codeChallengeStore.get(code);
        this.codeChallengeStore.delete(code); // One-time use

        if (!record || !record.codeChallenge) {
            return false;
        }

        // Check expiration (10 minutes)
        const ageMs = Date.now() - record.createdAt;
        if (ageMs >= this.stateTtlMs) {
            return false;
        }

        // SHA256(code_verifier) = code_challenge
        const hash = crypto.createHash('sha256').update(codeVerifier).digest();
        const computedChallenge = hash.toString('base64url');

        return computedChallenge === record.codeChallenge;
    }

    /**
     * Generate user_code (8 characters, high visibility character set)
     * Format: XXXX-XXXX
     * Character set: 28 characters (excluding confusing characters like 0, O, 1, I)
     * @returns {string} - user_code in XXXX-XXXX format
     */
    generateUserCode() {
        // 28-character set (excluding 0, O, 1, I, L for clarity)
        const charset = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
        let code = '';
        for (let i = 0; i < 8; i++) {
            const randomIndex = crypto.randomInt(0, charset.length);
            code += charset[randomIndex];
        }
        // Format as XXXX-XXXX
        return `${code.slice(0, 4)}-${code.slice(4)}`;
    }

    /**
     * Generate device_code (32 bytes, 256-bit entropy, RFC 8628 recommended)
     * @returns {string} - device_code (hex string)
     */
    generateDeviceCode() {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Create device authorization request (POST /api/auth/device/code)
     * @param {string} codeVerifier - code_verifier from CLI client
     * @returns {Object} - { device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval }
     */
    createDeviceCodeRequest(codeVerifier) {
        const deviceCode = this.generateDeviceCode();
        const userCode = this.generateUserCode();
        const now = Date.now();
        const expiresIn = Math.floor(this.deviceCodeTtlMs / 1000); // seconds

        const publicUrl = process.env.BRAINBASE_PUBLIC_URL || 'http://localhost:31013';
        const verificationUri = `${publicUrl}/device`;
        const verificationUriComplete = `${verificationUri}?user_code=${encodeURIComponent(userCode)}`;

        this.deviceCodeStore.set(deviceCode, {
            codeVerifier,
            userCode,
            createdAt: now,
            status: 'pending', // pending, approved, denied
            slackUserId: null,
            slackWorkspaceId: null
        });

        this.userCodeStore.set(userCode, deviceCode);

        return {
            device_code: deviceCode,
            user_code: userCode,
            verification_uri: verificationUri,
            verification_uri_complete: verificationUriComplete,
            expires_in: expiresIn,
            interval: this.deviceCodePollingInterval
        };
    }

    /**
     * Verify user_code (called by frontend)
     * @param {string} userCode - user_code from user input
     * @returns {Object|null} - { deviceCode, status } or null if invalid
     */
    verifyUserCode(userCode) {
        const deviceCode = this.userCodeStore.get(userCode);
        if (!deviceCode) {
            return null;
        }

        const record = this.deviceCodeStore.get(deviceCode);
        if (!record) {
            return null;
        }

        // Check expiration
        const ageMs = Date.now() - record.createdAt;
        if (ageMs >= this.deviceCodeTtlMs) {
            this.deviceCodeStore.delete(deviceCode);
            this.userCodeStore.delete(userCode);
            return null;
        }

        return {
            deviceCode,
            status: record.status
        };
    }

    /**
     * Approve device authorization (after Slack OAuth)
     * @param {string} deviceCode - device_code
     * @param {string} slackUserId - Slack user ID
     * @param {string} slackWorkspaceId - Slack workspace ID
     */
    approveDeviceCode(deviceCode, slackUserId, slackWorkspaceId) {
        const record = this.deviceCodeStore.get(deviceCode);
        if (!record) {
            throw new Error('Device code not found');
        }

        // Check expiration
        const ageMs = Date.now() - record.createdAt;
        if (ageMs >= this.deviceCodeTtlMs) {
            this.deviceCodeStore.delete(deviceCode);
            this.userCodeStore.delete(record.userCode);
            throw new Error('Device code expired');
        }

        record.status = 'approved';
        record.slackUserId = slackUserId;
        record.slackWorkspaceId = slackWorkspaceId;
    }

    /**
     * Deny device authorization
     * @param {string} deviceCode - device_code
     */
    denyDeviceCode(deviceCode) {
        const record = this.deviceCodeStore.get(deviceCode);
        if (!record) {
            throw new Error('Device code not found');
        }

        record.status = 'denied';
    }

    /**
     * Poll for device token (POST /api/auth/device/token)
     * @param {string} deviceCode - device_code from CLI client
     * @returns {Object} - { access_token, refresh_token } or error response
     */
    async pollDeviceToken(deviceCode) {
        const record = this.deviceCodeStore.get(deviceCode);
        if (!record) {
            return { error: 'expired_token', error_description: 'Device code has expired or is invalid' };
        }

        // Check expiration
        const ageMs = Date.now() - record.createdAt;
        if (ageMs >= this.deviceCodeTtlMs) {
            this.deviceCodeStore.delete(deviceCode);
            this.userCodeStore.delete(record.userCode);
            return { error: 'expired_token', error_description: 'Device code has expired' };
        }

        // Check status
        if (record.status === 'pending') {
            return { error: 'authorization_pending', error_description: 'User has not yet authorized the device' };
        }

        if (record.status === 'denied') {
            this.deviceCodeStore.delete(deviceCode);
            this.userCodeStore.delete(record.userCode);
            return { error: 'access_denied', error_description: 'User denied the authorization request' };
        }

        if (record.status === 'approved') {
            // Clean up device code (one-time use)
            this.deviceCodeStore.delete(deviceCode);
            this.userCodeStore.delete(record.userCode);

            const { slackUserId, slackWorkspaceId } = record;

            // Fetch user from database
            const user = await this.findUserBySlackId(slackUserId);
            if (!user) {
                await this.createAuditLog({
                    slackUserId,
                    slackWorkspaceId,
                    eventType: 'AUTH_DENY',
                    metadata: { reason: 'user_not_found_or_inactive', source: 'device_flow' }
                });
                return { error: 'access_denied', error_description: 'Access is not granted' };
            }

            // Issue JWT
            const token = this.issueToken({
                sub: user.person_id,
                slackUserId: user.slack_user_id,
                level: user.access_level,
                employmentType: user.employment_type,
                tenantId: null,
                slackWorkspaceId
            });
            const refreshToken = this.issueRefreshToken({
                slackUserId,
                slackWorkspaceId
            });

            await this.createAuditLog({
                personId: user.person_id,
                slackUserId,
                slackWorkspaceId,
                eventType: 'AUTH_LOGIN',
                metadata: {
                    level: user.access_level,
                    employment_type: user.employment_type,
                    workspace_id: user.workspace_id,
                    source: 'device_flow'
                }
            });

            return {
                access_token: token,
                refresh_token: refreshToken,
                token_type: 'Bearer',
                expires_in: 3600
            };
        }

        return { error: 'invalid_request', error_description: 'Unknown device code status' };
    }

    /**
     * Cleanup expired device codes (called every 1 minute)
     */
    cleanupExpiredDeviceCodes() {
        const now = Date.now();
        const expiredDeviceCodes = [];

        for (const [deviceCode, record] of this.deviceCodeStore.entries()) {
            const ageMs = now - record.createdAt;
            if (ageMs >= this.deviceCodeTtlMs) {
                expiredDeviceCodes.push({ deviceCode, userCode: record.userCode });
            }
        }

        for (const { deviceCode, userCode } of expiredDeviceCodes) {
            this.deviceCodeStore.delete(deviceCode);
            this.userCodeStore.delete(userCode);
        }

        if (expiredDeviceCodes.length > 0) {
            logger.info('Cleaned up expired device codes', { count: expiredDeviceCodes.length });
        }
    }
}
