// @ts-check

import { normalizeExternalIdentity } from '../auth-provider-registry.js';

export const GOOGLE_WORKSPACE_AUTH_PROVIDER_ID = 'google-workspace';
export const GOOGLE_MEET_READ_SCOPES = Object.freeze([
    'https://www.googleapis.com/auth/meetings.space.readonly',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/documents.readonly',
    'https://www.googleapis.com/auth/gmail.compose'
]);

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

function requireAccessToken(accessToken) {
    if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
        throw new GoogleWorkspaceAuthProviderError('Google Workspace access token is required', 'access_token_missing');
    }
    return accessToken.trim();
}

function requireResourceName(value, pattern) {
    const normalized = String(value || '').trim();
    if (!pattern.test(normalized)) {
        throw new GoogleWorkspaceAuthProviderError('Google Workspace resource name is invalid', 'resource_name_invalid');
    }
    return normalized;
}

/** @param {{ clientId?: string, clientSecret?: string, redirectUri?: string, callbackPath?: string, allowedDomains?: string[]|string, fetchImpl?: typeof fetch }} [options] */
export function createGoogleWorkspaceAuthProvider(options = {}) {
    const clientId = String(options.clientId ?? process.env.GOOGLE_AUTH_CLIENT_ID ?? '').trim();
    const clientSecret = String(options.clientSecret ?? process.env.GOOGLE_AUTH_CLIENT_SECRET ?? '').trim();
    const configuredRedirectUri = String(options.redirectUri ?? process.env.GOOGLE_AUTH_REDIRECT_URI ?? '').trim();
    const callbackPath = String(options.callbackPath || '/api/auth/google/callback');
    const integrationCallbackPath = String(options.integrationCallbackPath || '/api/auth/google/meet/callback');
    const configuredIntegrationRedirectUri = String(
        options.integrationRedirectUri ?? process.env.GOOGLE_MEET_REDIRECT_URI ?? ''
    ).trim();
    const allowedDomains = list(options.allowedDomains ?? process.env.GOOGLE_WORKSPACE_ALLOWED_DOMAINS);
    const fetchImpl = options.fetchImpl || globalThis.fetch;

    function resolveRedirectUri(req) {
        const proto = headerValue(req, 'x-forwarded-proto') || req?.protocol || 'https';
        const host = headerValue(req, 'x-forwarded-host') || headerValue(req, 'host');
        if (host && !host.startsWith('localhost')) return `${proto}://${host}${callbackPath}`;
        return configuredRedirectUri;
    }

    function resolveIntegrationRedirectUri(req) {
        const proto = headerValue(req, 'x-forwarded-proto') || req?.protocol || 'https';
        const host = headerValue(req, 'x-forwarded-host') || headerValue(req, 'host');
        if (host && !host.startsWith('localhost')) return `${proto}://${host}${integrationCallbackPath}`;
        if (configuredIntegrationRedirectUri) return configuredIntegrationRedirectUri;
        const loginRedirectUri = resolveRedirectUri(req);
        if (!loginRedirectUri) return '';
        const url = new URL(loginRedirectUri);
        url.pathname = integrationCallbackPath;
        url.search = '';
        url.hash = '';
        return url.toString();
    }

    function requireIntegrationConfig(req, withSecret = false) {
        if (!clientId) throw new GoogleWorkspaceAuthProviderError('Google client id is not configured', 'client_id_missing');
        if (withSecret && !clientSecret) throw new GoogleWorkspaceAuthProviderError('Google client secret is not configured', 'client_secret_missing');
        if (!resolveIntegrationRedirectUri(req)) throw new GoogleWorkspaceAuthProviderError('Google Meet redirect URI is not configured', 'redirect_uri_missing');
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
        assertReady() {
            if (!clientId) throw new GoogleWorkspaceAuthProviderError('Google client id is not configured', 'client_id_missing');
            if (!clientSecret) throw new GoogleWorkspaceAuthProviderError('Google client secret is not configured', 'client_secret_missing');
            if (!allowedDomains.length) throw new GoogleWorkspaceAuthProviderError('Google Workspace allowed domain is not configured', 'domain_not_configured');
        },
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
        buildMeetAuthorizationUrl(state, req) {
            requireIntegrationConfig(req);
            const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
            url.searchParams.set('client_id', clientId);
            url.searchParams.set('redirect_uri', resolveIntegrationRedirectUri(req));
            url.searchParams.set('response_type', 'code');
            url.searchParams.set('scope', GOOGLE_MEET_READ_SCOPES.join(' '));
            url.searchParams.set('state', state);
            url.searchParams.set('access_type', 'offline');
            url.searchParams.set('include_granted_scopes', 'true');
            url.searchParams.set('prompt', 'consent');
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
        async exchangeMeetCode(code, req) {
            requireIntegrationConfig(req, true);
            const response = await fetchImpl('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uri: resolveIntegrationRedirectUri(req),
                    code: String(code),
                    grant_type: 'authorization_code'
                })
            });
            const data = await response.json();
            if (!response.ok || !data.access_token || !data.refresh_token) {
                throw new GoogleWorkspaceAuthProviderError('Google Meet token exchange failed', 'provider_exchange_failed');
            }
            return data;
        },
        async refreshMeetAccessToken(refreshToken) {
            if (!clientId) throw new GoogleWorkspaceAuthProviderError('Google client id is not configured', 'client_id_missing');
            if (!clientSecret) throw new GoogleWorkspaceAuthProviderError('Google client secret is not configured', 'client_secret_missing');
            const response = await fetchImpl('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    refresh_token: String(refreshToken),
                    grant_type: 'refresh_token'
                })
            });
            const data = await response.json();
            if (!response.ok || !data.access_token) {
                throw new GoogleWorkspaceAuthProviderError('Google Meet token refresh failed', 'provider_refresh_failed');
            }
            return data;
        },
        async listMeetConferenceRecords(accessToken, { pageSize = 100, pageToken = '' } = {}) {
            const token = requireAccessToken(accessToken);
            const url = new URL('https://meet.googleapis.com/v2/conferenceRecords');
            url.searchParams.set('pageSize', String(Math.min(Math.max(Number(pageSize) || 100, 1), 100)));
            if (pageToken) url.searchParams.set('pageToken', String(pageToken));
            const response = await fetchImpl(url, {
                headers: { Authorization: `Bearer ${token}` }
            });
            const data = await response.json();
            if (!response.ok) {
                throw new GoogleWorkspaceAuthProviderError('Google Meet conference records request failed', 'provider_request_failed');
            }
            return data;
        },
        async listCalendarEvents(accessToken, {
            calendarId = 'primary', timeMin = '', timeMax = '', pageToken = '', maxResults = 100, q = ''
        } = {}) {
            const token = requireAccessToken(accessToken);
            const normalizedCalendarId = requireResourceName(calendarId, /^[A-Za-z0-9@._+-]+$/);
            const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(normalizedCalendarId)}/events`);
            url.searchParams.set('maxResults', String(Math.min(Math.max(Number(maxResults) || 100, 1), 2500)));
            url.searchParams.set('singleEvents', 'true');
            url.searchParams.set('orderBy', 'startTime');
            if (timeMin) url.searchParams.set('timeMin', String(timeMin));
            if (timeMax) url.searchParams.set('timeMax', String(timeMax));
            if (pageToken) url.searchParams.set('pageToken', String(pageToken));
            if (q) url.searchParams.set('q', String(q));
            const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
            const data = await response.json();
            if (!response.ok) {
                throw new GoogleWorkspaceAuthProviderError('Google Calendar events request failed', 'provider_request_failed');
            }
            return data;
        },
        async getGoogleDocument(accessToken, documentId) {
            const token = requireAccessToken(accessToken);
            const normalizedDocumentId = requireResourceName(documentId, /^[A-Za-z0-9_-]+$/);
            const response = await fetchImpl(
                `https://docs.googleapis.com/v1/documents/${encodeURIComponent(normalizedDocumentId)}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            const data = await response.json();
            if (!response.ok) {
                throw new GoogleWorkspaceAuthProviderError('Google Docs document request failed', 'provider_request_failed');
            }
            return data;
        },
        async listMeetTranscripts(accessToken, conferenceRecordName, { pageSize = 100, pageToken = '' } = {}) {
            const token = requireAccessToken(accessToken);
            const parent = requireResourceName(conferenceRecordName, /^conferenceRecords\/[A-Za-z0-9_-]+$/);
            const url = new URL(`https://meet.googleapis.com/v2/${parent}/transcripts`);
            url.searchParams.set('pageSize', String(Math.min(Math.max(Number(pageSize) || 100, 1), 100)));
            if (pageToken) url.searchParams.set('pageToken', String(pageToken));
            const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
            const data = await response.json();
            if (!response.ok) {
                throw new GoogleWorkspaceAuthProviderError('Google Meet transcripts request failed', 'provider_request_failed');
            }
            return data;
        },
        async listMeetTranscriptEntries(accessToken, transcriptName, { pageSize = 100, pageToken = '' } = {}) {
            const token = requireAccessToken(accessToken);
            const parent = requireResourceName(
                transcriptName,
                /^conferenceRecords\/[A-Za-z0-9_-]+\/transcripts\/[A-Za-z0-9_-]+$/
            );
            const url = new URL(`https://meet.googleapis.com/v2/${parent}/entries`);
            url.searchParams.set('pageSize', String(Math.min(Math.max(Number(pageSize) || 100, 1), 100)));
            if (pageToken) url.searchParams.set('pageToken', String(pageToken));
            const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
            const data = await response.json();
            if (!response.ok) {
                throw new GoogleWorkspaceAuthProviderError('Google Meet transcript entries request failed', 'provider_request_failed');
            }
            return data;
        },
        async createGmailDraft(accessToken, rawMessage) {
            const token = requireAccessToken(accessToken);
            const raw = String(rawMessage || '').trim();
            if (!raw) {
                throw new GoogleWorkspaceAuthProviderError('Gmail draft message is required', 'draft_message_missing');
            }
            const response = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'content-type': 'application/json'
                },
                body: JSON.stringify({ message: { raw } })
            });
            const data = await response.json();
            if (!response.ok || !data?.id) {
                throw new GoogleWorkspaceAuthProviderError('Gmail draft request failed', 'provider_request_failed');
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
        resolveRedirectUri,
        resolveIntegrationRedirectUri
    };
}
