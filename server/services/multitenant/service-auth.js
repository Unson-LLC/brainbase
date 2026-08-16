import { deepFreeze } from './canonical-json.js';

function reject(res, details = {}) {
    return res.status(401).type('application/problem+json').json({
        type: 'https://brainbase.example/problems/service-auth-invalid',
        status: 401,
        code: 'SERVICE_AUTH_INVALID',
        title: 'サービス認証を確認できません',
        retryable: false,
        fault_domain: 'protocol',
        correlation_id: null,
        details: { required_action: 'reauthorize', ...details }
    });
}

function bearerToken(header) {
    if (typeof header !== 'string') return null;
    const match = /^Bearer\s+([^\s]+)$/i.exec(header);
    return match?.[1] ?? null;
}

function includesAudience(actual, expected) {
    return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
}

export function createServiceAuthMiddleware({
    verifyToken,
    issuer,
    audience,
    deploymentId,
    requiredCapabilities = [],
    now = () => new Date()
}) {
    if (typeof verifyToken !== 'function') throw new TypeError('verifyToken is required');
    return async function serviceAuth(req, res, next) {
        const token = bearerToken(req.get('authorization'));
        if (!token) return reject(res);
        try {
            const claims = await verifyToken(token);
            const expiresAt = Date.parse(claims?.expires_at);
            const capabilities = Array.isArray(claims?.capabilities) ? claims.capabilities : [];
            const valid = claims?.issuer === issuer
                && typeof claims?.subject === 'string' && claims.subject.length > 0
                && includesAudience(claims?.audience, audience)
                && claims?.deployment_id === deploymentId
                && Number.isFinite(expiresAt) && expiresAt > now().getTime()
                && requiredCapabilities.every((capability) => capabilities.includes(capability));
            if (!valid) return reject(res);

            // Tenant selection is resolved by Tenant Authority; token self-claims are intentionally omitted.
            req.serviceIdentity = deepFreeze({
                issuer: claims.issuer,
                subject: claims.subject,
                audience: Array.isArray(claims.audience) ? [...claims.audience] : [claims.audience],
                deployment_id: claims.deployment_id,
                expires_at: claims.expires_at,
                capabilities: [...capabilities]
            });
            return next();
        } catch {
            return reject(res);
        }
    };
}
