import express from 'express';
import { negotiateProtocol, toProblem } from '../services/multitenant/protocol-contract.js';
import { serializeVerificationKeys } from '../services/multitenant/tenant-context.js';
import { ContractError } from '../services/multitenant/errors.js';

function asyncHandler(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function contextBoundInput(req) {
    const context = req.tenantContext;
    const { tenant_context: _tenantContext, ...input } = req.body ?? {};
    const bindings = {
        tenant_id: context.tenant.tenant_id,
        tenant_revision_at_write: context.tenant.tenant_revision,
        connection_id: context.workspace_connection.connection_id,
        connection_revision: context.workspace_connection.connection_revision,
        workspace_id: context.workspace_connection.workspace_id,
        app_id: context.workspace_connection.app_id,
        deployment_id: context.placement.deployment_id,
        correlation_id: context.correlation_id,
        operation_id: context.operation_id,
        idempotency_key: context.idempotency_key,
        contract_revision: context.contract_revision,
        credential_ref: context.credential.credential_ref,
        credential_mode: context.credential.mode
    };
    for (const [field, canonical] of Object.entries(bindings)) {
        if (input[field] !== undefined && input[field] !== canonical) {
            const code = field === 'tenant_id' ? 'CROSS_TENANT_CANDIDATE' : 'FALLBACK_FORBIDDEN';
            throw new ContractError(code, { status: 403, fault_domain: 'protocol' });
        }
    }
    if (input.expected_connection_revision !== undefined
        && input.expected_connection_revision !== bindings.connection_revision) {
        throw new ContractError('WORKSPACE_CONNECTION_STALE_REVISION', { status: 409 });
    }
    return { ...input, ...bindings, expected_connection_revision: bindings.connection_revision };
}

export function createTenantRuntimeRouter({
    serviceAuth,
    verificationKeys = () => [],
    tenantAuthority,
    connectionRegistry,
    credentialBroker,
    usageLedger,
    tenantContextVerifier,
    now = () => new Date()
}) {
    if (typeof tenantContextVerifier !== 'function') {
        throw new Error('Tenant context verifier is required');
    }
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
    router.use(asyncHandler(async (req, _res, next) => {
        if (req.get('Brainbase-Protocol-Version') !== '1.0') {
            throw new ContractError('PROTOCOL_VERSION_UNSUPPORTED', { status: 400, fault_domain: 'protocol' });
        }
        if (!req.body?.tenant_context) {
            throw new ContractError('TENANT_CONTEXT_INVALID', { status: 400, fault_domain: 'protocol' });
        }
        req.tenantContext = await tenantContextVerifier(req.body.tenant_context, {
            service_identity: req.serviceIdentity
        });
        if (req.get('Brainbase-Deployment-Id') !== req.tenantContext.placement.deployment_id) {
            throw new ContractError('FALLBACK_FORBIDDEN', { status: 403, fault_domain: 'protocol' });
        }
        next();
    }));
    async function revalidateAuthoritativeBinding(req) {
        const input = contextBoundInput(req);
        const current = await connectionRegistry.validateRevision(input);
        if (!current?.authoritative
            || current.credential_ref !== input.credential_ref
            || current.credential_mode !== input.credential_mode) {
            throw new ContractError('WORKSPACE_CONNECTION_STALE_REVISION', { status: 409 });
        }
        return input;
    }
    router.post('/workspace-connections:validate-revision', asyncHandler(async (req, res) => {
        res.json(await connectionRegistry.validateRevision(contextBoundInput(req)));
    }));
    router.post('/credential-leases', asyncHandler(async (req, res) => {
        res.status(201).json(await credentialBroker.issueLease(await revalidateAuthoritativeBinding(req)));
    }));
    router.post('/oauth-refresh:compare-and-swap', asyncHandler(async (req, res) => {
        res.json(await credentialBroker.compareAndSwapRefresh(await revalidateAuthoritativeBinding(req)));
    }));
    router.post('/quota:decide', asyncHandler(async (req, res) => {
        res.json(await usageLedger.decideQuota(await revalidateAuthoritativeBinding(req)));
    }));
    router.post('/usage-events', asyncHandler(async (req, res) => {
        res.status(202).json(await usageLedger.recordUsage(await revalidateAuthoritativeBinding(req)));
    }));
    router.post('/operation-receipts:finalize', asyncHandler(async (req, res) => {
        res.status(201).json(await usageLedger.finalizeReceipt(await revalidateAuthoritativeBinding(req)));
    }));

    router.use((error, req, res, _next) => {
        const problem = toProblem(error, req.body?.correlation_id ?? null);
        res.status(problem.status).type('application/problem+json').json(problem);
    });
    return router;
}
