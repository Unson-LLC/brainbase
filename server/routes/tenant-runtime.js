import express from 'express';
import { negotiateProtocol, toProblem } from '../services/multitenant/protocol-contract.js';
import { serializeVerificationKeys } from '../services/multitenant/tenant-context.js';

function asyncHandler(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
}

export function createTenantRuntimeRouter({
    serviceAuth,
    verificationKeys = () => [],
    tenantAuthority,
    connectionRegistry,
    credentialBroker,
    usageLedger,
    now = () => new Date()
}) {
    const router = express.Router();
    router.use(serviceAuth);

    router.post('/negotiate', asyncHandler(async (req, res) => {
        res.json(negotiateProtocol(req.body, { now: now() }));
    }));
    router.get('/verification-keys', asyncHandler(async (_req, res) => {
        res.json(serializeVerificationKeys(verificationKeys()));
    }));
    router.post('/tenant-context:resolve', asyncHandler(async (req, res) => {
        if (!tenantAuthority?.resolveContext) throw Object.assign(new Error('Tenant Authority unavailable'), { code: 'UPSTREAM_UNAVAILABLE', status: 503, retryable: true });
        res.json(await tenantAuthority.resolveContext(req.body));
    }));
    router.post('/workspace-connections:validate-revision', asyncHandler(async (req, res) => {
        res.json(await connectionRegistry.validateRevision(req.body));
    }));
    router.post('/credential-leases', asyncHandler(async (req, res) => {
        res.status(201).json(await credentialBroker.issueLease(req.body));
    }));
    router.post('/oauth-refresh:compare-and-swap', asyncHandler(async (req, res) => {
        res.json(await credentialBroker.compareAndSwapRefresh(req.body));
    }));
    router.post('/quota:decide', asyncHandler(async (req, res) => {
        res.json(await usageLedger.decideQuota(req.body));
    }));
    router.post('/usage-events', asyncHandler(async (req, res) => {
        res.status(202).json(await usageLedger.recordUsage(req.body));
    }));
    router.post('/operation-receipts:finalize', asyncHandler(async (req, res) => {
        res.status(201).json(await usageLedger.finalizeReceipt(req.body));
    }));

    router.use((error, req, res, _next) => {
        const problem = toProblem(error, req.body?.correlation_id ?? null);
        res.status(problem.status).type('application/problem+json').json(problem);
    });
    return router;
}
