import { createHash, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../../middleware/auth.js';
import {
    createJwtServiceTokenVerifier,
    createServiceAuthMiddleware
} from './service-auth.js';
import { createSlackInstallationAccessResolver } from './slack-installation-access.js';

export const SLACK_INSTALLATION_AUTHORIZE_PATH = '/slack-installations:authorize';
export const SLACK_INSTALLATION_EXCHANGE_PATH = '/slack-installations:exchange-and-register';
export const SLACK_INSTALLATION_CALLBACK_PATH = '/slack-installations:callback';
export const SLACK_INSTALLATION_SERVICE_CAPABILITY = 'slack_installation:exchange_and_register';

function problem(res, status, code, retryable = false) {
    return res.status(status).type('application/problem+json').json({
        type: `https://brainbase.example/problems/${code.toLowerCase().replaceAll('_', '-')}`,
        status,
        code,
        title: 'サービス認証を確認できません',
        retryable,
        fault_domain: 'brainbase_cloud',
        correlation_id: null,
        details: { required_action: retryable ? 'retry' : 'contact_operator' }
    });
}

function unavailableMiddleware(code = 'SERVICE_AUTH_CONFIGURATION_REQUIRED') {
    return (_req, res, _next) => problem(res, 503, code, true);
}

function required(env, name) {
    const value = env?.[name];
    if (typeof value !== 'string' || value.trim().length === 0) return null;
    return value.trim();
}

function bearerToken(req) {
    const value = typeof req?.headers?.authorization === 'string'
        ? req.headers.authorization
        : typeof req?.get === 'function'
            ? req.get('authorization')
            : null;
    const match = /^Bearer\s+([^\s]+)$/i.exec(value || '');
    return match?.[1] ?? null;
}

function includesAudience(actual, expected) {
    return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
}

function sameSecretValue(actual, expected) {
    if (typeof actual !== 'string' || typeof expected !== 'string') return false;
    const actualDigest = createHash('sha256').update(actual, 'utf8').digest();
    const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
    return timingSafeEqual(actualDigest, expectedDigest);
}

function exactExchangeRequestPath(req) {
    const path = typeof req?.path === 'string'
        ? req.path
        : typeof req?.originalUrl === 'string'
            ? req.originalUrl.split('?')[0]
            : '';
    return path === `/api/v1${SLACK_INSTALLATION_EXCHANGE_PATH}`;
}

function exactAuthorizeRequestPath(req) {
    const path = typeof req?.path === 'string'
        ? req.path
        : typeof req?.originalUrl === 'string'
            ? req.originalUrl.split('?')[0]
            : '';
    return path === `/api/v1${SLACK_INSTALLATION_AUTHORIZE_PATH}`;
}

function routePath(req) {
    const value = typeof req?.path === 'string' ? req.path : '';
    if (value === SLACK_INSTALLATION_AUTHORIZE_PATH || value === SLACK_INSTALLATION_EXCHANGE_PATH
        || value === SLACK_INSTALLATION_CALLBACK_PATH) {
        return value;
    }
    const original = typeof req?.originalUrl === 'string' ? req.originalUrl.split('?')[0] : '';
    const marker = original.indexOf('/api/v1');
    if (marker >= 0) {
        const mounted = original.slice(marker + '/api/v1'.length);
        if (mounted === SLACK_INSTALLATION_AUTHORIZE_PATH || mounted === SLACK_INSTALLATION_EXCHANGE_PATH
            || mounted === SLACK_INSTALLATION_CALLBACK_PATH) {
            return mounted;
        }
    }
    return value;
}

/**
 * Build the two route guards used by the Slack installation control plane.
 *
 * The authorize endpoint is a normal user-authenticated endpoint; the
 * exchange endpoint only accepts an exact, signed Brainbase service JWT with
 * the dedicated capability. The latter is intentionally not the generic
 * tenant-runtime/member service token.
 */
export function createSlackInstallationControlPlaneAuthMiddleware({
    authService,
    env = process.env,
    now = () => new Date(),
    resolveCanonicalAccess,
    graphResolver,
    companyAuthorityRepository,
    trustedAppId
} = {}) {
    const userGuard = authService
        ? requireAuth(authService, { allowInsecureHeaders: false })
        : unavailableMiddleware('USER_AUTH_CONFIGURATION_REQUIRED');
    const canonicalAccessResolver = createSlackInstallationAccessResolver({
        authService,
        resolveCanonicalAccess,
        graphResolver,
        companyAuthorityRepository,
        trustedAppId
    });

    const serviceToken = required(env, 'BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_SERVICE_TOKEN')
        ?? required(env, 'BRAINBASE_SLACK_INSTALLATION_SERVICE_TOKEN');
    const serviceSecret = required(env, 'BRAINBASE_SERVICE_TOKEN_SECRET');
    const serviceIssuer = required(env, 'BRAINBASE_SLACK_INSTALLATION_SERVICE_ISSUER')
        ?? 'brainbase';
    const serviceAudience = required(env, 'BRAINBASE_SLACK_INSTALLATION_SERVICE_AUDIENCE')
        ?? 'mana-runtime';
    const deploymentId = required(env, 'BRAINBASE_SLACK_INSTALLATION_SERVICE_DEPLOYMENT_ID');
    const capability = required(env, 'BRAINBASE_SLACK_INSTALLATION_SERVICE_CAPABILITY')
        ?? SLACK_INSTALLATION_SERVICE_CAPABILITY;

    let serviceGuard = unavailableMiddleware();
    if (serviceToken && serviceSecret && deploymentId) {
        try {
            serviceGuard = createServiceAuthMiddleware({
                verifyToken: createJwtServiceTokenVerifier({
                    secret: serviceSecret,
                    expectedToken: serviceToken
                }),
                issuer: serviceIssuer,
                audience: serviceAudience,
                deploymentId,
                requiredCapabilities: [capability],
                now
            });
        } catch {
            serviceGuard = unavailableMiddleware();
        }
    }

    const canonicalUserGuard = async (req, res, next) => {
        await userGuard(req, res, async () => {
            try {
                const resolved = await canonicalAccessResolver({
                    req,
                    auth: req.auth,
                    access: req.access
                });
                if (!resolved) {
                    return problem(res, 403, 'INSTALLATION_AUTHORIZATION_REQUIRED');
                }
                req.access = resolved;
                return next();
            } catch {
                return problem(res, 403, 'INSTALLATION_AUTHORIZATION_REQUIRED');
            }
        });
    };

    return (req, res, next) => {
        const path = routePath(req);
        if (path === SLACK_INSTALLATION_AUTHORIZE_PATH) return canonicalUserGuard(req, res, next);
        if (path === SLACK_INSTALLATION_EXCHANGE_PATH) return serviceGuard(req, res, next);
        if (path === SLACK_INSTALLATION_CALLBACK_PATH && req.method === 'GET') return next();
        return problem(res, 404, 'INSTALLATION_ROUTE_NOT_ALLOWED');
    };
}

/**
 * The global CSRF middleware runs before route registration. It may bypass CSRF
 * only for this exact mounted exchange endpoint after independently verifying
 * the same dedicated service JWT that the route guard verifies. User/browser
 * JWTs, stale tokens, and the dedicated token on any other endpoint never pass.
 */
export function isDedicatedSlackInstallationExchangeRequest(req, {
    env = process.env,
    now = () => new Date()
} = {}) {
    if (req?.method !== 'POST' || !exactExchangeRequestPath(req)) return false;
    const token = bearerToken(req);
    const expectedToken = required(env, 'BRAINBASE_SLACK_INSTALLATION_CONTROL_PLANE_SERVICE_TOKEN')
        ?? required(env, 'BRAINBASE_SLACK_INSTALLATION_SERVICE_TOKEN');
    const secret = required(env, 'BRAINBASE_SERVICE_TOKEN_SECRET');
    const issuer = required(env, 'BRAINBASE_SLACK_INSTALLATION_SERVICE_ISSUER') ?? 'brainbase';
    const audience = required(env, 'BRAINBASE_SLACK_INSTALLATION_SERVICE_AUDIENCE') ?? 'mana-runtime';
    const deploymentId = required(env, 'BRAINBASE_SLACK_INSTALLATION_SERVICE_DEPLOYMENT_ID');
    const capability = required(env, 'BRAINBASE_SLACK_INSTALLATION_SERVICE_CAPABILITY')
        ?? SLACK_INSTALLATION_SERVICE_CAPABILITY;
    if (!token || !expectedToken || !token.startsWith('bbsvc_') || !expectedToken.startsWith('bbsvc_')
        || !secret || !deploymentId || !sameSecretValue(token, expectedToken)) {
        return false;
    }
    try {
        const claims = jwt.verify(token.startsWith('bbsvc_') ? token.slice('bbsvc_'.length) : token, secret);
        const expiresAt = Date.parse(claims?.expires_at);
        const capabilities = Array.isArray(claims?.capabilities) ? claims.capabilities : [];
        return claims?.typ === 'service'
            && claims?.issuer === issuer
            && typeof claims?.subject === 'string' && claims.subject.length > 0
            && includesAudience(claims?.audience, audience)
            && claims?.deployment_id === deploymentId
            && Number.isFinite(expiresAt) && expiresAt > now().getTime()
            && capabilities.includes(capability);
    } catch {
        return false;
    }
}

/**
 * The authorize endpoint is called by a non-cookie runtime client before the
 * normal route auth middleware runs. Exempt only an exact POST carrying a
 * currently valid Brainbase human JWT. The route guard still resolves the
 * canonical tenant/person membership and enforces the administrative role.
 */
export function isAuthenticatedSlackInstallationAuthorizeRequest(req, {
    env = process.env
} = {}) {
    if (req?.method !== 'POST' || !exactAuthorizeRequestPath(req)) return false;
    const token = bearerToken(req);
    const secret = required(env, 'BRAINBASE_JWT_SECRET');
    if (!token || token.startsWith('bbsvc_') || !secret) return false;
    try {
        const claims = jwt.verify(token, secret);
        const principal = claims?.sub ?? claims?.personId;
        return claims?.typ !== 'service'
            && typeof principal === 'string'
            && principal.length > 0;
    } catch {
        return false;
    }
}
