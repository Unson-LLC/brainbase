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
        const serviceIdentity = req.serviceTokenClaims
            ? Object.freeze({ ...req.serviceIdentity, serviceTokenClaims: req.serviceTokenClaims })
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
