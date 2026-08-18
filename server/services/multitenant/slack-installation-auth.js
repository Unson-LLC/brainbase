import { requireAuth } from '../../middleware/auth.js';
import {
    createJwtServiceTokenVerifier,
    createServiceAuthMiddleware
} from './service-auth.js';

export const SLACK_INSTALLATION_AUTHORIZE_PATH = '/slack-installations:authorize';
export const SLACK_INSTALLATION_EXCHANGE_PATH = '/slack-installations:exchange-and-register';
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

function routePath(req) {
    const value = typeof req?.path === 'string' ? req.path : '';
    if (value === SLACK_INSTALLATION_AUTHORIZE_PATH || value === SLACK_INSTALLATION_EXCHANGE_PATH) {
        return value;
    }
    const original = typeof req?.originalUrl === 'string' ? req.originalUrl.split('?')[0] : '';
    const marker = original.indexOf('/api/v1');
    if (marker >= 0) {
        const mounted = original.slice(marker + '/api/v1'.length);
        if (mounted === SLACK_INSTALLATION_AUTHORIZE_PATH || mounted === SLACK_INSTALLATION_EXCHANGE_PATH) {
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
    now = () => new Date()
} = {}) {
    const userGuard = authService
        ? requireAuth(authService, { allowInsecureHeaders: false })
        : unavailableMiddleware('USER_AUTH_CONFIGURATION_REQUIRED');

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

    return (req, res, next) => {
        const path = routePath(req);
        if (path === SLACK_INSTALLATION_AUTHORIZE_PATH) return userGuard(req, res, next);
        if (path === SLACK_INSTALLATION_EXCHANGE_PATH) return serviceGuard(req, res, next);
        return problem(res, 404, 'INSTALLATION_ROUTE_NOT_ALLOWED');
    };
}

