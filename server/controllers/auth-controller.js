// @ts-check
import { logger } from '../utils/logger.js';
import { clearAuthCookies, getAuthTokensFromRequest, setAuthCookies } from '../lib/auth-cookies.js';

/** @typedef {any} Request */
/** @typedef {any} Response */
/** @typedef {{ token?: string, access?: any, refresh_token?: string }} AuthCallbackPayload */

/** @param {unknown} error */
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error || '');
}

const STORAGE_TOKEN_KEY = 'brainbase.auth.token';
const STORAGE_ACCESS_KEY = 'brainbase.auth.access';
const STORAGE_REFRESH_KEY = 'brainbase.auth.refresh';

const DEFAULT_ALLOWED_ORIGINS = new Set([
    'https://bb.unson.jp'
]);

/** @param {string | null | undefined} value */
function normalizeOrigin(value) {
    if (typeof value !== 'string' || value.length === 0) return null;
    try {
        const url = new URL(value);
        return url.origin;
    } catch {
        return null;
    }
}

/** @param {string | null | undefined} origin */
function isLocalOrigin(origin) {
    if (!origin) return false;
    try {
        const url = new URL(origin);
        return ['localhost', '127.0.0.1'].includes(url.hostname);
    } catch {
        return false;
    }
}

function getAllowedOrigins() {
    const envList = (process.env.BRAINBASE_AUTH_ALLOWED_ORIGINS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map(normalizeOrigin)
        .filter(Boolean);
    const origins = new Set(DEFAULT_ALLOWED_ORIGINS);
    for (const origin of /** @type {string[]} */ (envList)) {
        origins.add(origin);
    }
    return origins;
}

/** @param {string | null | undefined} origin */
function resolvePostMessageOrigin(origin) {
    const normalized = normalizeOrigin(origin);
    if (!normalized) return null;
    if (isLocalOrigin(normalized)) return normalized;
    const allowed = getAllowedOrigins();
    return allowed.has(normalized) ? normalized : null;
}

/** @param {Request} req */
function wantsHtmlResponse(req) {
    const jsonFlag = String(req.query.json || '').toLowerCase() === 'true';
    if (jsonFlag) return false;
    const accept = req.get('accept') || '';
    if (accept.includes('application/json')) return false;
    return accept.includes('text/html');
}

/** @param {string | null | undefined} value */
function resolveRedirectPath(value) {
    if (typeof value !== 'string') return '/';
    // 相対パスを許可
    if (value.startsWith('/') && !value.startsWith('//')) return value;
    // localhostへの絶対URLを許可（Device Code Flow用）
    try {
        const url = new URL(value);
        const origin = normalizeOrigin(url.origin);
        if (origin && isLocalOrigin(origin)) {
            return value;
        }
    } catch (e) {
        // Invalid URL
    }
    return '/';
}

/**
 * @param {AuthCallbackPayload} payload
 * @param {string} [redirectTo]
 * @param {string | null} [postMessageOrigin]
 */
function renderAuthCallbackHtml({ token, access, refresh_token: refreshToken }, redirectTo = '/', postMessageOrigin = null) {
    const payloadJson = JSON.stringify({ token, access, refresh_token: refreshToken }).replace(/</g, '\\u003c');
    const redirectJson = JSON.stringify(redirectTo);
    const postMessageOriginJson = JSON.stringify(postMessageOrigin || '');
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Slack auth complete</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; background: #0b1120; color: #e2e8f0; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
      .card { background: rgba(15, 23, 42, 0.9); border: 1px solid rgba(148, 163, 184, 0.2); padding: 32px; border-radius: 16px; text-align: center; width: min(420px, 90vw); }
      .title { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
      .desc { font-size: 14px; color: #94a3b8; margin-bottom: 16px; }
      .btn { display: inline-block; padding: 10px 16px; background: #2563eb; color: #fff; border-radius: 8px; text-decoration: none; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="title">Login completed</div>
      <div class="desc">Returning to brainbase-ui...</div>
      <a class="btn" href=${redirectJson}>Continue</a>
    </div>
    <script>
      const payload = ${payloadJson};
      const redirectTo = ${redirectJson};
      const postMessageOrigin = ${postMessageOriginJson};
      try {
        localStorage.setItem('${STORAGE_TOKEN_KEY}', payload.token);
        localStorage.setItem('${STORAGE_ACCESS_KEY}', JSON.stringify(payload.access || {}));
        if (payload.refresh_token) {
          localStorage.setItem('${STORAGE_REFRESH_KEY}', payload.refresh_token);
        }
      } catch (e) {}
      try {
        if (window.opener) {
          const targetOrigin = postMessageOrigin || window.location.origin;
          window.opener.postMessage({ type: 'brainbase-auth', token: payload.token, refresh_token: payload.refresh_token, access: payload.access }, targetOrigin);
          window.close();
        }
      } catch (e) {}
      setTimeout(() => {
        if (!window.opener) {
          window.location.replace(redirectTo);
        }
      }, 150);
    </script>
  </body>
</html>`;
}

export class AuthController {
    /** @param {any} authService */
    constructor(authService) {
        this.authService = authService;
    }

    /** @param {Request} req @param {Response} res */
    slackStart = async (req, res) => {
        try {
            this.authService.assertReady();
            const origin = typeof req.query.origin === 'string' ? req.query.origin : '';
            const codeChallenge = typeof req.query.code_challenge === 'string' ? req.query.code_challenge : '';
            const state = this.authService.createState({ origin, codeChallenge });
            const url = this.authService.buildAuthorizeUrl(state, req);
            if (String(req.query.json || '').toLowerCase() === 'true') {
                return res.json({ url, state });
            }
            return res.redirect(url);
        } catch (error) {
            logger.error('Failed to start Slack auth', { error });
            return res.status(500).json({ error: getErrorMessage(error) || 'Failed to start Slack auth' });
        }
    };

    /** @param {Request} req @param {Response} res */
    slackCallback = async (req, res) => {
        try {
            logger.info(`[AUTH] slackCallback HIT: ${req.method} ${req.originalUrl}`);
            this.authService.assertReady();
            const { code, state } = req.query;
            if (!code || !state) {
                return res.status(400).json({ error: 'code and state are required' });
            }
            const stateResult = this.authService.consumeState(String(state));
            if (!stateResult?.ok) {
                return res.status(400).json({ error: 'Invalid state' });
            }

            // Store code_challenge for PKCE verification (if provided)
            if (stateResult.codeChallenge) {
                this.authService.storeCodeChallenge(String(code), stateResult.codeChallenge);
            }

            logger.info(`[AUTH] exchangeCode starting, redirectUri=${this.authService.resolveRedirectUri(req)}`);
            const tokenPayload = await this.authService.exchangeCode(String(code), req);
            logger.info(`[AUTH] exchangeCode ok=${tokenPayload?.ok}`);
            let userInfo = null;
            if (this.authService.slackMode !== 'oauth') {
                const accessToken = tokenPayload.access_token;
                if (!accessToken) {
                    return res.status(401).json({ error: 'Slack access token missing' });
                }
                userInfo = await this.authService.fetchUserInfo(accessToken);
            }

            const { slackUserId, slackWorkspaceId } = this.authService.resolveSlackIdentity(tokenPayload, userInfo);
            logger.info(`[AUTH] callback identity: uid=${slackUserId} wid=${slackWorkspaceId} mode=${this.authService.slackMode} tkeys=${Object.keys(tokenPayload||{}).join(',')} authedUser=${JSON.stringify(tokenPayload?.authed_user)} team=${JSON.stringify(tokenPayload?.team)}`);
            if (!slackUserId || !slackWorkspaceId) {
                return res.status(401).json({ error: 'Slack identity could not be resolved' });
            }

            // Phase 1: PostgreSQLベース権限管理
            const user = await this.authService.findUserBySlackId(slackUserId);
            logger.info(`[AUTH] findUser: uid=${slackUserId} found=${!!user} name=${user?.name} role=${user?.role}`);
            if (!user) {
                await this.authService.createAuditLog({
                    slackUserId,
                    slackWorkspaceId,
                    eventType: 'AUTH_DENY',
                    metadata: { reason: 'user_not_found_or_inactive' }
                });
                return res.status(403).json({ error: 'Access is not granted' });
            }

            // JWT発行（Phase 1仕様 + wiki access fields）
            const token = this.authService.issueToken({
                sub: user.person_id,
                slackUserId: user.slack_user_id,
                level: user.access_level,
                employmentType: user.employment_type,
                role: user.role || 'member',
                projectCodes: user.project_codes || [],
                clearance: user.clearance || [],
                tenantId: null, // Phase 1はsingle-tenant
                slackWorkspaceId
            });
            const refreshToken = this.authService.issueRefreshToken({
                slackUserId,
                slackWorkspaceId
            });

            await this.authService.createAuditLog({
                personId: user.person_id,
                slackUserId,
                slackWorkspaceId,
                eventType: 'AUTH_LOGIN',
                metadata: {
                    level: user.access_level,
                    employment_type: user.employment_type,
                    workspace_id: user.workspace_id
                }
            });

            const responsePayload = {
                token,
                refresh_token: refreshToken,
                access: {
                    level: user.access_level,
                    employmentType: user.employment_type,
                    personId: user.person_id,
                    slackUserId: user.slack_user_id,
                    workspaceId: user.workspace_id,
                    name: user.name,
                    role: user.role,
                    projectCodes: user.project_codes || []
                }
            };

            setAuthCookies(res, req, this.authService, {
                accessToken: token,
                refreshToken,
                targetOrigin: stateResult.origin
            });

            if (wantsHtmlResponse(req)) {
                const redirectTo = resolveRedirectPath(req.query.redirect || stateResult.origin);
                const postMessageOrigin = resolvePostMessageOrigin(stateResult.origin);
                return res.status(200).type('html').send(renderAuthCallbackHtml(
                    responsePayload,
                    redirectTo,
                    postMessageOrigin
                ));
            }

            return res.json(responsePayload);
        } catch (error) {
            logger.info(`[AUTH] callback ERROR: ${getErrorMessage(error)}`);
            logger.error('Slack auth callback failed', { error });
            return res.status(500).json({ error: getErrorMessage(error) || 'Slack auth failed' });
        }
    };

    /** @param {Request} req @param {Response} res */
    refresh = async (req, res) => {
        try {
            this.authService.assertReady();
            const header = req.headers.authorization || '';
            const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
            const { refreshToken: cookieRefreshToken } = getAuthTokensFromRequest(req);
            const refreshToken = req.body?.refresh_token || req.body?.refreshToken || bearer || cookieRefreshToken;
            if (!refreshToken) {
                return res.status(400).json({ error: 'refresh_token is required' });
            }
            const payload = await this.authService.refreshSession(refreshToken);
            setAuthCookies(res, req, this.authService, {
                accessToken: payload.token,
                refreshToken: payload.refresh_token || refreshToken,
                targetOrigin: null
            });
            return res.json(payload);
        } catch (error) {
            logger.error('Refresh token exchange failed', { error });
            return res.status(401).json({ error: getErrorMessage(error) || 'Refresh failed' });
        }
    };

    /** @param {Request & { access?: any }} req @param {Response} res */
    logout = async (req, res) => {
        try {
            const access = req.access || {};
            await this.authService.createAuditLog({
                personId: access.personId || null,
                slackUserId: access.slackUserId || null,
                slackWorkspaceId: access.slackWorkspaceId || null,
                eventType: 'AUTH_LOGOUT',
                metadata: {}
            });
            clearAuthCookies(res, req);
            return res.json({ ok: true });
        } catch (error) {
            logger.error('Logout failed', { error });
            return res.status(500).json({ error: getErrorMessage(error) || 'Logout failed' });
        }
    };

    /** @param {Request & { access?: any, auth?: any, authSource?: string }} req @param {Response} res */
    verify = async (req, res) => {
        try {
            const access = req.access || {};
            const exp = req.auth?.exp ? new Date(req.auth.exp * 1000).toISOString() : null;
            return res.json({
                ok: true,
                access,
                sessionExpiresAt: exp,
                authMode: req.authSource || 'unknown'
            });
        } catch (error) {
            logger.error('Verify failed', { error });
            return res.status(500).json({ error: getErrorMessage(error) || 'Verify failed' });
        }
    };

    /** @param {Request} req @param {Response} res */
    tokenExchange = async (req, res) => {
        try {
            logger.info(`[AUTH] tokenExchange HIT: ${req.method} ${req.originalUrl} body=${JSON.stringify(req.body||{}).slice(0,200)}`);
            this.authService.assertReady();
            const { code, code_verifier } = req.body;
            if (!code || !code_verifier) {
                return res.status(400).json({ error: 'code and code_verifier are required' });
            }

            // code_verifier検証（保存されたcode_challengeと照合）
            const isValid = this.authService.verifyCodeVerifier(String(code), String(code_verifier));
            if (!isValid) {
                return res.status(403).json({ error: 'Invalid code or code_verifier' });
            }

            // Slack OAuth code exchangeでslackUserIdを取得
            const tokenPayload = await this.authService.exchangeCode(String(code), req);
            let userInfo = null;
            if (this.authService.slackMode !== 'oauth') {
                const accessToken = tokenPayload.access_token;
                if (!accessToken) {
                    return res.status(401).json({ error: 'Slack access token missing' });
                }
                userInfo = await this.authService.fetchUserInfo(accessToken);
            }

            const { slackUserId, slackWorkspaceId } = this.authService.resolveSlackIdentity(tokenPayload, userInfo);
            if (!slackUserId || !slackWorkspaceId) {
                return res.status(401).json({ error: 'Slack identity could not be resolved' });
            }

            // PostgreSQLからユーザー情報取得
            logger.info(`[AUTH] tokenExchange: findUserBySlackId uid=${slackUserId} wid=${slackWorkspaceId}`);
            const user = await this.authService.findUserBySlackId(slackUserId);
            logger.info(`[AUTH] tokenExchange: found=${!!user} name=${user?.name}`);
            if (!user) {
                await this.authService.createAuditLog({
                    slackUserId,
                    slackWorkspaceId,
                    eventType: 'AUTH_DENY',
                    metadata: { reason: 'user_not_found_or_inactive', source: 'token_exchange' }
                });
                logger.info(`[AUTH] tokenExchange: DENY uid=${slackUserId}`);
                return res.status(403).json({ error: 'Access is not granted' });
            }

            // JWT発行（include wiki access fields from auth_grants）
            const token = this.authService.issueToken({
                sub: user.person_id,
                slackUserId: user.slack_user_id,
                level: user.access_level,
                employmentType: user.employment_type,
                role: user.role || 'member',
                projectCodes: user.project_codes || [],
                clearance: user.clearance || [],
                tenantId: null,
                slackWorkspaceId
            });
            const refreshToken = this.authService.issueRefreshToken({
                slackUserId,
                slackWorkspaceId
            });

            await this.authService.createAuditLog({
                personId: user.person_id,
                slackUserId,
                slackWorkspaceId,
                eventType: 'AUTH_LOGIN',
                metadata: {
                    level: user.access_level,
                    employment_type: user.employment_type,
                    workspace_id: user.workspace_id,
                    source: 'token_exchange'
                }
            });

            setAuthCookies(res, req, this.authService, {
                accessToken: token,
                refreshToken,
                targetOrigin: null
            });

            return res.json({
                token,
                refresh_token: refreshToken
            });
        } catch (error) {
            logger.error('Token exchange failed', { error });
            return res.status(500).json({ error: getErrorMessage(error) || 'Token exchange failed' });
        }
    };

    /**
     * Device Code Flow: Request device code
     * POST /api/auth/device/code
     * Body: { code_verifier }
     * Response: { device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval }
     */
    /** @param {Request} req @param {Response} res */
    deviceCodeRequest = async (req, res) => {
        try {
            this.authService.assertReady();
            const { code_verifier } = req.body;
            if (!code_verifier) {
                return res.status(400).json({ error: 'code_verifier is required' });
            }

            const response = this.authService.createDeviceCodeRequest(String(code_verifier));
            return res.json(response);
        } catch (error) {
            logger.error('Device code request failed', { error });
            return res.status(500).json({ error: getErrorMessage(error) || 'Device code request failed' });
        }
    };

    /**
     * Device Code Flow: Verify user code (called by frontend)
     * POST /api/auth/device/verify-user-code
     * Body: { user_code }
     * Response: { ok: true, device_code, status } or { ok: false, error }
     */
    /** @param {Request} req @param {Response} res */
    verifyUserCodeEndpoint = async (req, res) => {
        logger.info('🔍 verifyUserCodeEndpoint called', { body: req.body, headers: req.headers });
        try {
            const { user_code } = req.body;
            if (!user_code) {
                return res.status(400).json({ ok: false, error: 'user_code is required' });
            }

            const result = this.authService.verifyUserCode(String(user_code));
            if (!result) {
                return res.status(404).json({ ok: false, error: 'Invalid or expired user code' });
            }

            return res.json({ ok: true, device_code: result.deviceCode, status: result.status });
        } catch (error) {
            logger.error('Verify user code failed', { error });
            return res.status(500).json({ ok: false, error: getErrorMessage(error) || 'Verify user code failed' });
        }
    };

    /**
     * Device Code Flow: Approve device (after Slack OAuth)
     * POST /api/auth/device/approve
     * Body: { device_code, slack_user_id, slack_workspace_id }
     * Response: { ok: true }
     */
    /** @param {Request} req @param {Response} res */
    approveDevice = async (req, res) => {
        try {
            this.authService.assertReady();
            const { device_code, slack_user_id, slack_workspace_id } = req.body;
            if (!device_code || !slack_user_id || !slack_workspace_id) {
                return res.status(400).json({ error: 'device_code, slack_user_id, and slack_workspace_id are required' });
            }

            this.authService.approveDeviceCode(String(device_code), String(slack_user_id), String(slack_workspace_id));
            return res.json({ ok: true });
        } catch (error) {
            logger.error('Approve device failed', { error });
            return res.status(500).json({ error: getErrorMessage(error) || 'Approve device failed' });
        }
    };

    /**
     * Device Code Flow: Deny device
     * POST /api/auth/device/deny
     * Body: { device_code }
     * Response: { ok: true }
     */
    /** @param {Request} req @param {Response} res */
    denyDevice = async (req, res) => {
        try {
            const { device_code } = req.body;
            if (!device_code) {
                return res.status(400).json({ error: 'device_code is required' });
            }

            this.authService.denyDeviceCode(String(device_code));
            return res.json({ ok: true });
        } catch (error) {
            logger.error('Deny device failed', { error });
            return res.status(500).json({ error: getErrorMessage(error) || 'Deny device failed' });
        }
    };

    /**
     * Device Code Flow: Poll for token (CLI polling)
     * POST /api/auth/device/token
     * Body: { device_code }
     * Response: { access_token, refresh_token, token_type, expires_in } or { error, error_description }
     */
    /** @param {Request} req @param {Response} res */
    deviceTokenRequest = async (req, res) => {
        try {
            this.authService.assertReady();
            const { device_code } = req.body;
            if (!device_code) {
                return res.status(400).json({ error: 'invalid_request', error_description: 'device_code is required' });
            }

            const response = await this.authService.pollDeviceToken(String(device_code));

            // OAuth 2.0 Device Flow error codes (RFC 8628)
            if (response.error === 'authorization_pending') {
                return res.status(400).json(response);
            }
            if (response.error === 'slow_down') {
                return res.status(400).json(response);
            }
            if (response.error === 'expired_token') {
                return res.status(400).json(response);
            }
            if (response.error === 'access_denied') {
                return res.status(403).json(response);
            }
            if (response.error) {
                return res.status(400).json(response);
            }

            return res.json(response);
        } catch (error) {
            logger.error('Device token request failed', { error });
            return res.status(500).json({ error: 'server_error', error_description: getErrorMessage(error) || 'Device token request failed' });
        }
    };
}
