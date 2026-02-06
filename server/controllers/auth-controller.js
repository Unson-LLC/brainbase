import { logger } from '../utils/logger.js';

const STORAGE_TOKEN_KEY = 'brainbase.auth.token';
const STORAGE_ACCESS_KEY = 'brainbase.auth.access';
const STORAGE_REFRESH_KEY = 'brainbase.auth.refresh';

const DEFAULT_ALLOWED_ORIGINS = new Set([
    'https://bb.unson.jp'
]);

function normalizeOrigin(value) {
    if (typeof value !== 'string' || value.length === 0) return null;
    try {
        const url = new URL(value);
        return url.origin;
    } catch {
        return null;
    }
}

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
    for (const origin of envList) {
        origins.add(origin);
    }
    return origins;
}

function resolvePostMessageOrigin(origin) {
    const normalized = normalizeOrigin(origin);
    if (!normalized) return null;
    if (isLocalOrigin(normalized)) return normalized;
    const allowed = getAllowedOrigins();
    return allowed.has(normalized) ? normalized : null;
}

function wantsHtmlResponse(req) {
    const jsonFlag = String(req.query.json || '').toLowerCase() === 'true';
    if (jsonFlag) return false;
    const accept = req.get('accept') || '';
    if (accept.includes('application/json')) return false;
    return accept.includes('text/html');
}

function resolveRedirectPath(value) {
    if (typeof value !== 'string') return '/';
    if (value.startsWith('/') && !value.startsWith('//')) return value;
    return '/';
}

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
    constructor(authService) {
        this.authService = authService;
    }

    slackStart = async (req, res) => {
        try {
            this.authService.assertReady();
            const origin = typeof req.query.origin === 'string' ? req.query.origin : '';
            const state = this.authService.createState({ origin });
            const url = this.authService.buildAuthorizeUrl(state);
            if (String(req.query.json || '').toLowerCase() === 'true') {
                return res.json({ url, state });
            }
            return res.redirect(url);
        } catch (error) {
            logger.error('Failed to start Slack auth', { error });
            return res.status(500).json({ error: error.message || 'Failed to start Slack auth' });
        }
    };

    slackCallback = async (req, res) => {
        try {
            this.authService.assertReady();
            const { code, state } = req.query;
            if (!code || !state) {
                return res.status(400).json({ error: 'code and state are required' });
            }
            const stateResult = this.authService.consumeState(String(state));
            if (!stateResult?.ok) {
                return res.status(400).json({ error: 'Invalid state' });
            }

            const tokenPayload = await this.authService.exchangeCode(String(code));
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

            const grant = await this.authService.findGrant({ slackUserId, slackWorkspaceId });
            if (!grant) {
                await this.authService.createAuditLog({
                    slackUserId,
                    slackWorkspaceId,
                    eventType: 'AUTH_DENY',
                    metadata: { reason: 'grant_not_found' }
                });
                return res.status(403).json({ error: 'Access is not granted' });
            }

            const personId = await this.authService.ensurePerson({
                personId: grant.person_id,
                personName: grant.person_name
            });

            const access = this.authService.buildAccessFromGrant({ ...grant, person_id: personId });
            const token = this.authService.issueToken({
                role: access.role,
                projectCodes: access.projectCodes,
                clearance: access.clearance,
                personId,
                slackUserId,
                slackWorkspaceId
            });
            const refreshToken = this.authService.issueRefreshToken({
                slackUserId,
                slackWorkspaceId
            });

            await this.authService.createAuditLog({
                personId,
                slackUserId,
                slackWorkspaceId,
                eventType: 'AUTH_LOGIN',
                metadata: { role: access.role, project_codes: access.projectCodes }
            });

            const responsePayload = {
                token,
                refresh_token: refreshToken,
                access: {
                    role: access.role,
                    projectCodes: access.projectCodes,
                    clearance: access.clearance,
                    personId
                }
            };

            if (wantsHtmlResponse(req)) {
                const redirectTo = resolveRedirectPath(req.query.redirect);
                const postMessageOrigin = resolvePostMessageOrigin(stateResult.origin);
                return res.status(200).type('html').send(renderAuthCallbackHtml(
                    responsePayload,
                    redirectTo,
                    postMessageOrigin
                ));
            }

            return res.json(responsePayload);
        } catch (error) {
            logger.error('Slack auth callback failed', { error });
            return res.status(500).json({ error: error.message || 'Slack auth failed' });
        }
    };

    refresh = async (req, res) => {
        try {
            this.authService.assertReady();
            const header = req.headers.authorization || '';
            const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
            const refreshToken = req.body?.refresh_token || req.body?.refreshToken || bearer;
            if (!refreshToken) {
                return res.status(400).json({ error: 'refresh_token is required' });
            }
            const payload = await this.authService.refreshSession(refreshToken);
            return res.json(payload);
        } catch (error) {
            logger.error('Refresh token exchange failed', { error });
            return res.status(401).json({ error: error.message || 'Refresh failed' });
        }
    };

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
            return res.json({ ok: true });
        } catch (error) {
            logger.error('Logout failed', { error });
            return res.status(500).json({ error: error.message || 'Logout failed' });
        }
    };

    verify = async (req, res) => {
        try {
            const access = req.access || {};
            return res.json({ ok: true, access });
        } catch (error) {
            logger.error('Verify failed', { error });
            return res.status(500).json({ error: error.message || 'Verify failed' });
        }
    };
}
