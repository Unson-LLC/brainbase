import { createHmac, timingSafeEqual } from 'node:crypto';

import { canonicalJson } from './canonical-json.js';
import { ContractError } from './errors.js';
import { validateSlackInstallationBinding } from './slack-installation-control-plane.js';

const CALLBACK_PATH = '/api/v1/slack-installations:callback';
const DEFAULT_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
const DEFAULT_TTL_SECONDS = 600;

function invalid() {
    throw new ContractError('INSTALLATION_STATE_INVALID', {
        status: 400,
        fault_domain: 'protocol'
    });
}

function httpsUrl(value, { callback = false } = {}) {
    try {
        const url = new URL(String(value));
        if (url.protocol !== 'https:' || url.username || url.password || url.hash
            || (callback && (url.pathname !== CALLBACK_PATH || url.search))) invalid();
        return url;
    } catch (error) {
        if (error instanceof ContractError) throw error;
        invalid();
    }
}

function normalizedScopes(value) {
    const scopes = [...new Set(String(value ?? '').split(',')
        .map((scope) => scope.trim())
        .filter(Boolean))];
    if (scopes.length === 0 || scopes.some((scope) => !/^[a-z][a-z0-9_.:-]{0,127}$/u.test(scope))) {
        invalid();
    }
    return scopes.join(',');
}

function signature(payload, secret) {
    return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
}

function sameSignature(actual, expected) {
    if (typeof actual !== 'string' || typeof expected !== 'string') return false;
    const actualBytes = Buffer.from(actual, 'utf8');
    const expectedBytes = Buffer.from(expected, 'utf8');
    return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function createSlackInstallationOAuthFlow({
    clientId,
    redirectUri,
    stateSecret,
    botScopes,
    authorizeUrl = DEFAULT_AUTHORIZE_URL,
    ttlSeconds = DEFAULT_TTL_SECONDS,
    now = () => new Date()
} = {}) {
    if (typeof clientId !== 'string' || clientId.length === 0
        || typeof stateSecret !== 'string' || stateSecret.length < 32
        || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 900) {
        throw new Error('slack_installation_oauth_configuration_invalid');
    }
    const redirect = httpsUrl(redirectUri, { callback: true }).toString();
    const authorize = httpsUrl(authorizeUrl);
    const scope = normalizedScopes(botScopes);

    return {
        createAuthorization(input) {
            const intent = validateSlackInstallationBinding(input);
            const issuedAt = Math.floor(now().getTime() / 1000);
            if (!Number.isSafeInteger(issuedAt)) invalid();
            const payload = Buffer.from(canonicalJson({
                exp: issuedAt + ttlSeconds,
                intent,
                redirect_uri: redirect,
                version: 1
            }), 'utf8').toString('base64url');
            const oauthState = `${payload}.${signature(payload, stateSecret)}`;
            const url = new URL(authorize);
            url.searchParams.set('client_id', clientId);
            url.searchParams.set('scope', scope);
            url.searchParams.set('redirect_uri', redirect);
            url.searchParams.set('state', oauthState);
            if (intent.expected_workspace_id) url.searchParams.set('team', intent.expected_workspace_id);
            return {
                authorization_url: url.toString(),
                oauth_state: oauthState,
                redirect_uri: redirect
            };
        },
        open(value) {
            try {
                if (typeof value !== 'string' || value.length > 8192) invalid();
                const [payload, actualSignature, ...remainder] = value.split('.');
                if (!payload || !actualSignature || remainder.length > 0
                    || !sameSignature(actualSignature, signature(payload, stateSecret))) invalid();
                const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
                const current = Math.floor(now().getTime() / 1000);
                if (decoded?.version !== 1 || decoded?.redirect_uri !== redirect
                    || !Number.isSafeInteger(decoded?.exp) || decoded.exp <= current) invalid();
                return {
                    intent: validateSlackInstallationBinding(decoded.intent),
                    redirect_uri: redirect
                };
            } catch (error) {
                if (error instanceof ContractError && error.code === 'INSTALLATION_STATE_INVALID') throw error;
                invalid();
            }
        }
    };
}

export { CALLBACK_PATH as SLACK_INSTALLATION_CALLBACK_PATH };
