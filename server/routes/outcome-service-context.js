import express from 'express';

import { ContractError } from '../services/multitenant/errors.js';
import { toProblem } from '../services/multitenant/protocol-contract.js';

function asyncHandler(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
function unavailable(req, res) {
    const problem = toProblem(new ContractError('outcome_issuer_unconfigured', {
        status: 503,
        retryable: true,
        fault_domain: 'brainbase_cloud'
    }), req.body?.correlation_id ?? null);
    return res.status(problem.status).type('application/problem+json').json(problem);
}

function trustedOutcomeAuthorityReadback(req) {
    const encoded = req.get('brainbase-outcome-authority-readback');
    if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > 8192) return null;
    try {
        const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
        return null;
    }
}

/**
 * The outcome context issuer is deliberately supplied by production
 * composition. This router does not resolve tenants, profiles, credentials,
 * or authority from request data; those checks belong to the issuer adapters.
 */
export function createOutcomeServiceContextRouter({
    serviceAuth = null,
    outcomeServiceContextIssuer = null
} = {}) {
    const router = express.Router();
    router.post(/^\/outcome-service-context:issue$/u,
        typeof serviceAuth === 'function' ? serviceAuth : unavailable, asyncHandler(async (req, res) => {
        if (typeof outcomeServiceContextIssuer?.issue !== 'function') {
            throw new ContractError('outcome_issuer_unconfigured', {
                status: 503,
                retryable: true,
                fault_domain: 'brainbase_cloud'
            });
        }
        // The middleware has already verified the complete service token. Keep
        // the transport identity as the public shape while carrying the
        // verified claims to Mana readback adapters; request/body claims are
        // never used for this purpose.
        const outcomeAuthorityReadback = trustedOutcomeAuthorityReadback(req);
        const serviceIdentity = req.serviceTokenClaims
            ? Object.freeze({ ...req.serviceIdentity, serviceTokenClaims: req.serviceTokenClaims,
                ...(outcomeAuthorityReadback ? { outcomeAuthorityReadback } : {}) })
            : req.serviceIdentity;
        const response = await outcomeServiceContextIssuer.issue(req.body, serviceIdentity);
        res.set('Cache-Control', 'no-store');
        return res.status(200).json(response);
    }));
    router.use((error, req, res, _next) => {
        const problem = toProblem(error, req.body?.correlation_id ?? null);
        return res.status(problem.status).type('application/problem+json').json(problem);
    });
    return router;
}
