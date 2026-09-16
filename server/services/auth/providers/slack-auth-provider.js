// @ts-check

import { normalizeExternalIdentity } from '../auth-provider-registry.js';

export const SLACK_AUTH_PROVIDER_ID = 'slack';

const DEFAULT_SCOPES = 'openid profile email';
const DEFAULT_AUTHORIZE_URLS = Object.freeze({
    oidc: 'https://slack.com/openid/connect/authorize',
    oauth: 'https://slack.com/oauth/v2/authorize'
});
const DEFAULT_TOKEN_URLS = Object.freeze({
    oidc: 'https://slack.com/api/openid.connect.token',
    oauth: 'https://slack.com/api/oauth.v2.access'
});
const DEFAULT_USERINFO_URL = 'https://slack.com/api/openid.connect.userInfo';
const DEFAULT_CALLBACK_PATH = '/api/auth/slack/callback';
const OIDC_LOGIN_SCOPES = Object.freeze(['openid', 'profile', 'email']);
const LEGACY_LOGIN_SCOPE = 'identity.basic';

function normalizeScopes(value) {
    return [...new Set(String(value || '')
        .split(/[\s,]+/)
        .map((scope) => scope.trim())
        .filter(Boolean))];
}

function normalizeMode(value) {
    const mode = String(value || 'oidc').trim().toLowerCase();
    if (mode !== 'oidc' && mode !== 'oauth') {
        throw new SlackAuthProviderError(`Unsupported Slack auth mode: ${mode}`, {
            code: 'unsupported_auth_mode'
        });
    }
    return mode;
}

function headerValue(req, name) {
    if (!req) return '';
    if (typeof req.get === 'function') return String(req.get(name) || '').trim();
    const headers = req.headers || {};
    return String(headers[name] || headers[name.toLowerCase()] || '').trim();
}

function contextValues(requestOrContext) {
    if (!requestOrContext || typeof requestOrContext !== 'object') {
        return { req: null, redirectUri: '' };
    }
    if ('req' in requestOrContext || 'redirectUri' in requestOrContext) {
        return {
            req: requestOrContext.req || null,
            redirectUri: typeof requestOrContext.redirectUri === 'string'
                ? requestOrContext.redirectUri.trim()
                : ''
        };
    }
    return { req: requestOrContext, redirectUri: '' };
}

function parseJsonResponse(text, { operation, code, status }) {
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        throw new SlackAuthProviderError(`Slack ${operation} returned an invalid response`, {
            code,
            status
        });
    }
}

class SlackAuthProviderError extends Error {
    constructor(message, { code = 'slack_auth_error', status = null } = {}) {
        super(message);
        this.name = 'SlackAuthProviderError';
        this.code = code;
        this.status = status;
    }
}

export { SlackAuthProviderError };

/**
 * Slack adapter for the provider-neutral auth contract. It intentionally
 * keeps the old `resolveSlackIdentity` helper as a compatibility seam while
 * exposing `resolveIdentity` for the new common auth service.
 *
 * @param {{ mode?: string, clientId?: string, clientSecret?: string, redirectUri?: string, callbackPath?: string, scopes?: string, userScopes?: string, authorizeUrl?: string, tokenUrl?: string, userInfoUrl?: string, fetchImpl?: typeof fetch }} [options]
 */
export function createSlackAuthProvider(options = {}) {
    const mode = normalizeMode(options.mode || process.env.SLACK_AUTH_MODE || 'oidc');
    const clientId = typeof options.clientId === 'string'
        ? options.clientId.trim()
        : String(process.env.SLACK_CLIENT_ID || '').trim();
    const clientSecret = typeof options.clientSecret === 'string'
        ? options.clientSecret
        : String(process.env.SLACK_CLIENT_SECRET || '');
    const configuredRedirectUri = typeof options.redirectUri === 'string'
        ? options.redirectUri.trim()
        : String(process.env.SLACK_REDIRECT_URI || '').trim();
    const callbackPath = typeof options.callbackPath === 'string' && options.callbackPath.trim()
        ? options.callbackPath.trim()
        : DEFAULT_CALLBACK_PATH;
    const scopes = options.scopes === undefined
        ? (process.env.SLACK_AUTH_SCOPES === undefined ? DEFAULT_SCOPES : process.env.SLACK_AUTH_SCOPES)
        : options.scopes;
    const userScopes = options.userScopes === undefined
        ? String(process.env.SLACK_AUTH_USER_SCOPES || '')
        : String(options.userScopes || '');
    const authorizeUrl = typeof options.authorizeUrl === 'string' && options.authorizeUrl.trim()
        ? options.authorizeUrl.trim()
        : DEFAULT_AUTHORIZE_URLS[mode];
    const tokenUrl = typeof options.tokenUrl === 'string' && options.tokenUrl.trim()
        ? options.tokenUrl.trim()
        : DEFAULT_TOKEN_URLS[mode];
    const userInfoUrl = typeof options.userInfoUrl === 'string' && options.userInfoUrl.trim()
        ? options.userInfoUrl.trim()
        : DEFAULT_USERINFO_URL;
    const fetchImpl = options.fetchImpl || globalThis.fetch;

    function resolveRedirectUri(requestOrContext) {
        const { req, redirectUri } = contextValues(requestOrContext);
        if (redirectUri) return redirectUri;

        const proto = headerValue(req, 'x-forwarded-proto') || req?.protocol || 'https';
        const host = headerValue(req, 'x-forwarded-host') || headerValue(req, 'host');
        if (host && !host.startsWith('localhost')) {
            return `${proto}://${host}${callbackPath}`;
        }
        return configuredRedirectUri;
    }

    function requireFetch() {
        if (typeof fetchImpl !== 'function') {
            throw new SlackAuthProviderError('Slack fetch implementation is not configured', {
                code: 'fetch_not_configured'
            });
        }
        return fetchImpl;
    }

    function requireLoginScopeConfiguration() {
        const configuredScopes = normalizeScopes(scopes);
        const configuredUserScopes = normalizeScopes(userScopes);

        if (mode === 'oidc') {
            const configuredScopeSet = new Set(configuredScopes);
            const identityOnly = configuredScopeSet.size === OIDC_LOGIN_SCOPES.length
                && OIDC_LOGIN_SCOPES.every((scope) => configuredScopeSet.has(scope));
            if (!identityOnly) {
                throw new SlackAuthProviderError(
                    'Slack OIDC login must use only openid, profile, and email',
                    { code: 'login_scope_not_oidc_only' }
                );
            }
            if (configuredUserScopes.length > 0) {
                throw new SlackAuthProviderError(
                    'Slack OIDC login must not request legacy user scopes',
                    { code: 'login_user_scope_forbidden' }
                );
            }
            return;
        }

        if (configuredScopes.length > 0) {
            throw new SlackAuthProviderError(
                'Slack login OAuth must not request bot scopes',
                { code: 'login_bot_scope_forbidden' }
            );
        }
        if (configuredUserScopes.length === 0) {
            throw new SlackAuthProviderError(
                'Slack login OAuth identity scope is not configured',
                { code: 'login_scope_missing' }
            );
        }
        if (configuredUserScopes.length !== 1 || configuredUserScopes[0] !== LEGACY_LOGIN_SCOPE) {
            throw new SlackAuthProviderError(
                `Slack login OAuth must use only ${LEGACY_LOGIN_SCOPE}`,
                { code: 'login_scope_not_identity_only' }
            );
        }
    }

    function requireGrantedLoginScopes(tokenPayload) {
        if (mode !== 'oauth') return;

        const grantedBotScopes = normalizeScopes(tokenPayload?.scope);
        const grantedUserScopes = normalizeScopes(tokenPayload?.authed_user?.scope);
        const identityOnly = grantedUserScopes.length === 1
            && grantedUserScopes[0] === LEGACY_LOGIN_SCOPE;
        if (grantedBotScopes.length > 0 || !identityOnly) {
            throw new SlackAuthProviderError(
                `Slack login grant must use only ${LEGACY_LOGIN_SCOPE}`,
                { code: 'login_granted_scope_not_identity_only' }
            );
        }
    }

    function requireClientConfiguration({ requireSecret = false, requestOrContext } = {}) {
        requireLoginScopeConfiguration();
        if (!clientId) {
            throw new SlackAuthProviderError('Slack client id is not configured', {
                code: 'client_id_missing'
            });
        }
        if (requireSecret && !clientSecret) {
            throw new SlackAuthProviderError('Slack client secret is not configured', {
                code: 'client_secret_missing'
            });
        }
        if (!resolveRedirectUri(requestOrContext)) {
            throw new SlackAuthProviderError('Slack redirect URI is not configured', {
                code: 'redirect_uri_missing'
            });
        }
    }

    /** @param {Record<string, unknown>} tokenPayload @param {Record<string, unknown>|null} userInfo */
    function resolveIdentity(tokenPayload = {}, userInfo = null) {
        const token = tokenPayload && typeof tokenPayload === 'object' ? tokenPayload : {};
        const profile = userInfo && typeof userInfo === 'object' ? userInfo : {};
        const fromTokenUser = token.authed_user?.id
            || token.user?.id
            || token.user_id
            || token.sub
            || null;
        const fromTokenTeam = token.team?.id
            || token.team_id
            || token.enterprise_id
            || token.workspace_id
            || null;
        const userId = [
            profile.user_id,
            profile.sub,
            profile.id,
            profile['https://slack.com/user_id'],
            fromTokenUser
        ].find(Boolean) || null;
        const workspaceId = [
            profile.team_id,
            profile['https://slack.com/team_id'],
            profile.team?.id,
            fromTokenTeam
        ].find(Boolean) || null;

        if (!userId || !workspaceId) {
            throw new SlackAuthProviderError('Slack identity could not be resolved', {
                code: 'identity_unresolved'
            });
        }

        const identity = normalizeExternalIdentity({
            provider: SLACK_AUTH_PROVIDER_ID,
            subject: String(userId),
            tenantId: String(workspaceId),
            email: profile.email,
            name: profile.name || profile.real_name || profile.display_name
        });
        return {
            ...identity,
            // Compatibility aliases for current AuthService/controller callers.
            slackUserId: identity.subject,
            slackWorkspaceId: identity.tenantId
        };
    }

    const provider = {
        id: SLACK_AUTH_PROVIDER_ID,
        displayName: 'Slack',
        authMethods: mode === 'oauth' ? ['oauth2_confidential'] : ['oidc'],
        capabilities: ['login', 'identity'],
        mode,
        authorizeUrl,
        tokenUrl,
        userInfoUrl,
        callbackPath,
        scopes,
        userScopes,

        assertReady() {
            requireLoginScopeConfiguration();
            if (!clientId) {
                throw new SlackAuthProviderError('Slack client id is not configured', {
                    code: 'client_id_missing'
                });
            }
            if (!clientSecret) {
                throw new SlackAuthProviderError('Slack client secret is not configured', {
                    code: 'client_secret_missing'
                });
            }
        },

        buildAuthorizationUrl(state, requestOrContext) {
            if (typeof state !== 'string' || !state.trim()) {
                throw new SlackAuthProviderError('Slack OAuth state is required', {
                    code: 'state_missing'
                });
            }
            requireClientConfiguration({ requestOrContext });
            const url = new URL(authorizeUrl);
            url.searchParams.set('client_id', clientId);
            url.searchParams.set('redirect_uri', resolveRedirectUri(requestOrContext));
            url.searchParams.set('state', state);
            if (scopes !== undefined && scopes !== null) {
                url.searchParams.set('scope', String(scopes));
            }
            if (mode === 'oauth' && userScopes) {
                url.searchParams.set('user_scope', userScopes);
            }
            url.searchParams.set('response_type', 'code');
            return url.toString();
        },

        async exchangeCode(code, requestOrContext) {
            if (typeof code !== 'string' || !code.trim()) {
                throw new SlackAuthProviderError('Slack authorization code is required', {
                    code: 'code_missing'
                });
            }
            requireClientConfiguration({ requireSecret: true, requestOrContext });
            const fetchFunction = requireFetch();
            const body = new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: resolveRedirectUri(requestOrContext),
                code
            });
            if (mode !== 'oauth') {
                body.set('grant_type', 'authorization_code');
            }

            let response;
            try {
                response = await fetchFunction(tokenUrl, {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body
                });
                const text = await response.text();
                const data = parseJsonResponse(text, {
                    operation: 'token exchange',
                    code: 'provider_exchange_failed',
                    status: response.status
                });
                if (!response.ok || data.ok === false) {
                    throw new SlackAuthProviderError(
                        `Slack token exchange failed: ${response.status || 400}`,
                        { code: 'provider_exchange_failed', status: response.status }
                    );
                }
                requireGrantedLoginScopes(data);
                return data;
            } catch (error) {
                if (error instanceof SlackAuthProviderError) throw error;
                throw new SlackAuthProviderError('Slack token exchange failed', {
                    code: 'provider_exchange_failed',
                    status: response?.status || null
                });
            }
        },

        async fetchUserInfo(accessToken) {
            if (typeof accessToken !== 'string' || !accessToken.trim()) {
                throw new SlackAuthProviderError('Slack access token is required', {
                    code: 'access_token_missing'
                });
            }
            const fetchFunction = requireFetch();
            let response;
            try {
                response = await fetchFunction(userInfoUrl, {
                    method: 'GET',
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                const text = await response.text();
                const data = parseJsonResponse(text, {
                    operation: 'userinfo',
                    code: 'userinfo_failed',
                    status: response.status
                });
                if (!response.ok || data.ok === false) {
                    throw new SlackAuthProviderError(
                        `Slack userinfo failed: ${response.status || 400}`,
                        { code: 'userinfo_failed', status: response.status }
                    );
                }
                return data;
            } catch (error) {
                if (error instanceof SlackAuthProviderError) throw error;
                throw new SlackAuthProviderError('Slack userinfo failed', {
                    code: 'userinfo_failed',
                    status: response?.status || null
                });
            }
        },

        resolveIdentity(input, userInfo) {
            // The common service passes a context object. Accepting the old
            // positional shape as well keeps the Slack adapter drop-in safe
            // for existing AuthService callers during migration.
            if (input && typeof input === 'object' && ('tokenPayload' in input || 'userInfo' in input)) {
                return resolveIdentity(input.tokenPayload, input.userInfo);
            }
            return resolveIdentity(input, userInfo);
        },

        resolveSlackIdentity(tokenPayload, userInfo) {
            const identity = resolveIdentity(tokenPayload, userInfo);
            return {
                slackUserId: identity.slackUserId,
                slackWorkspaceId: identity.slackWorkspaceId
            };
        },

        resolveRedirectUri
    };

    return provider;
}
