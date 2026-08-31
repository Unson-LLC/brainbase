// @ts-check

import { normalizeExternalIdentity } from '../auth-provider-registry.js';

export const GOOGLE_WORKSPACE_AUTH_PROVIDER_ID = 'google-workspace';

export class GoogleWorkspaceAuthProviderError extends Error {
    constructor(message, code = 'google_workspace_auth_error') {
        super(message);
        this.name = 'GoogleWorkspaceAuthProviderError';
        this.code = code;
    }
}

function list(value) {
    const values = Array.isArray(value) ? value : String(value || '').split(',');
    return [...new Set(values.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
}

function headerValue(req, name) {
    if (!req) return '';
    if (typeof req.get === 'function') return String(req.get(name) || '').trim();
    return String(req.headers?.[name] || req.headers?.[name.toLowerCase()] || '').trim();
}

/** @param {{ clientId?: string, clientSecret?: string, redirectUri?: string, callbackPath?: string, allowedDomains?: string[]|string, fetchImpl?: typeof fetch }} [options] */
export function createGoogleWorkspaceAuthProvider(options = {}) {
    const clientId = String(options.clientId ?? process.env.GOOGLE_AUTH_CLIENT_ID ?? '').trim();
    const clientSecret = String(options.clientSecret ?? process.env.GOOGLE_AUTH_CLIENT_SECRET ?? '');
    const configuredRedirectUri = String(options.redirectUri ?? process.env.GOOGLE_AUTH_REDIRECT_URI ?? '').trim();
    const callbackPath = String(options.callbackPath || '/api/auth/google/callback');
    const allowedDomains = list(options.allowedDomains ?? process.env.GOOGLE_WORKSPACE_ALLOWED_DOMAINS);
    const fetchImpl = options.fetchImpl || globalThis.fetch;

    function resolveRedirectUri(req) {
        const proto = headerValue(req, 'x-forwarded-proto') || req?.protocol || 'https';
        const host = headerValue(req, 'x-forwarded-host') || headerValue(req, 'host');
        if (host && !host.startsWith('localhost')) return `${proto}://${host}${callbackPath}`;
        return configuredRedirectUri;
    }

    function requireConfig(req, withSecret = false) {
        if (!clientId) throw new GoogleWorkspaceAuthProviderError('Google client id is not configured', 'client_id_missing');
        if (withSecret && !clientSecret) throw new GoogleWorkspaceAuthProviderError('Google client secret is not configured', 'client_secret_missing');
        if (!resolveRedirectUri(req)) throw new GoogleWorkspaceAuthProviderError('Google redirect URI is not configured', 'redirect_uri_missing');
    }

    function resolveIdentity(input = {}) {
        const profile = input.userInfo || input;
        const email = String(profile.email || '').trim().toLowerCase();
        const hostedDomain = String(profile.hd || email.split('@')[1] || '').trim().toLowerCase();
        if (profile.email_verified !== true) {
            throw new GoogleWorkspaceAuthProviderError('Google Workspace email must be verified', 'email_not_verified');
        }
        if (!allowedDomains.length) {
            throw new GoogleWorkspaceAuthProviderError('Google Workspace allowed domain is not configured', 'domain_not_configured');
        }
        if (!hostedDomain || !allowedDomains.includes(hostedDomain)) {
            throw new GoogleWorkspaceAuthProviderError('Google Workspace domain is not allowed', 'domain_not_allowed');
        }
        return normalizeExternalIdentity({
            provider: GOOGLE_WORKSPACE_AUTH_PROVIDER_ID,
            // A verified Workspace email is the provisionable account key.
            // Google's opaque `sub` can be retained in provider audit metadata,
            // but must not force administrators to discover it before onboarding.
            subject: email,
            tenantId: hostedDomain,
            email,
            name: profile.name
        });
    }

    return {
        id: GOOGLE_WORKSPACE_AUTH_PROVIDER_ID,
        displayName: 'Google Workspace',
        authMethods: ['oidc'],
        capabilities: ['login', 'identity'],
        mode: 'oidc',
        callbackPath,
        buildAuthorizationUrl(state, req) {
            requireConfig(req);
            const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
            url.searchParams.set('client_id', clientId);
            url.searchParams.set('redirect_uri', resolveRedirectUri(req));
            url.searchParams.set('response_type', 'code');
            url.searchParams.set('scope', 'openid profile email');
            url.searchParams.set('state', state);
            url.searchParams.set('access_type', 'offline');
            if (allowedDomains.length === 1) url.searchParams.set('hd', allowedDomains[0]);
            return url.toString();
        },
        async exchangeCode(code, req) {
            requireConfig(req, true);
            const response = await fetchImpl('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: resolveRedirectUri(req),
                    code: String(code),
                    grant_type: 'authorization_code'
                })
            });
            const data = await response.json();
            if (!response.ok || !data.access_token) {
                throw new GoogleWorkspaceAuthProviderError('Google token exchange failed', 'provider_exchange_failed');
            }
            return data;
        },
        async fetchUserInfo(accessToken) {
            const response = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const data = await response.json();
            if (!response.ok) throw new GoogleWorkspaceAuthProviderError('Google userinfo failed', 'userinfo_failed');
            return data;
        },
        resolveIdentity,
        resolveRedirectUri
    };
}
