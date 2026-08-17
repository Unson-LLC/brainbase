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

function credentialLeaseRequest(req) {
    const context = req.tenantContext;
    const supplied = req.body?.binding ?? {};
    const binding = {
        tenant_id: context.tenant.tenant_id,
        connection_id: context.workspace_connection.connection_id,
        connection_revision: context.workspace_connection.connection_revision,
        contract_revision: context.contract_revision,
        operation_id: context.operation_id,
        audience: supplied.audience,
        credential_mode: context.credential.mode,
        credential_ref: context.credential.credential_ref
    };
    for (const [field, canonical] of Object.entries(binding)) {
        if (field === 'audience') continue;
        if (supplied[field] !== undefined && supplied[field] !== canonical) {
            throw new ContractError(field === 'tenant_id' ? 'CROSS_TENANT_CANDIDATE' : 'CREDENTIAL_LEASE_BINDING_MISMATCH', {
                status: 403,
                fault_domain: 'protocol'
            });
        }
    }
    return {
        message_type: req.body?.message_type,
        protocol_version: req.body?.protocol_version,
        binding,
        requested_ttl_seconds: req.body?.requested_ttl_seconds
    };
}

function wireInput(req, fields, bindings) {
    const source = req.body ?? {};
    const allowed = new Set(['tenant_context', ...fields]);
    if (Object.keys(source).some((field) => !allowed.has(field))) {
        throw new ContractError('SCHEMA_INVALID', { status: 400, fault_domain: 'protocol' });
    }
    const result = {};
    for (const field of fields) {
        if (source[field] !== undefined) result[field] = source[field];
    }
    for (const [field, value] of Object.entries(bindings)) {
        if (result[field] !== undefined && result[field] !== value) {
            throw new ContractError(field === 'tenant_id' ? 'CROSS_TENANT_CANDIDATE' : 'FALLBACK_FORBIDDEN', {
                status: 403,
                fault_domain: 'protocol'
            });
        }
        result[field] = value;
    }
    return result;
}

function quotaInput(req) {
    const context = req.tenantContext;
    return wireInput(req, [
        'quota_revision', 'metric', 'observed_quantity', 'requested_quantity', 'unit',
        'window_started_at', 'window_ends_at'
    ], {
        tenant_id: context.tenant.tenant_id,
        contract_revision: context.contract_revision,
        idempotency_key: context.idempotency_key
    });
}

function usageEventInput(req) {
    const context = req.tenantContext;
    return wireInput(req, [
        'message_type', 'usage_event_id', 'protocol_version', 'kind', 'quantity', 'unit',
        'collection_state', 'outcome', 'failure_code', 'unknown_fields', 'observed_at'
    ], {
        tenant_id: context.tenant.tenant_id,
        connection_id: context.workspace_connection.connection_id,
        connection_revision: context.workspace_connection.connection_revision,
        contract_revision: context.contract_revision,
        deployment_id: context.placement.deployment_id,
        correlation_id: context.correlation_id,
        operation_id: context.operation_id,
        idempotency_key: context.idempotency_key
    });
}

function operationReceiptInput(req) {
    const context = req.tenantContext;
    return wireInput(req, [
        'message_type', 'receipt_id', 'protocol_version', 'operation_ids', 'idempotency_keys',
        'actor_principal_id', 'project_id', 'capability_id', 'quota_decision', 'credential_mode',
        'collection_state', 'outcome', 'failure_code', 'usage_event_ids', 'reply', 'completed_at'
    ], {
        tenant_id: context.tenant.tenant_id,
        connection_id: context.workspace_connection.connection_id,
        connection_revision: context.workspace_connection.connection_revision,
        contract_revision: context.contract_revision,
        deployment_id: context.placement.deployment_id,
        correlation_id: context.correlation_id
    });
}

function operationReceiptWithPricingInput(req) {
    const source = req.body ?? {};
    const allowed = new Set(['tenant_context', 'receipt', 'pricing_snapshot']);
    if (!source.receipt || !source.pricing_snapshot
        || Object.keys(source).some((field) => !allowed.has(field))) {
        throw new ContractError('SCHEMA_INVALID', { status: 400, fault_domain: 'protocol' });
    }
    return {
        receipt: operationReceiptInput({
            tenantContext: req.tenantContext,
            body: { tenant_context: source.tenant_context, ...source.receipt }
        }),
        pricing_snapshot: source.pricing_snapshot
    };
}

function idempotencyClaimInput(req) {
    const context = req.tenantContext;
    return wireInput(req, [
        'message_type', 'owner', 'scope', 'slack_event_id', 'context_hash', 'payload_hash',
        'state', 'retention_until'
    ], {
        tenant_id: context.tenant.tenant_id,
        connection_id: context.workspace_connection.connection_id,
        operation_id: context.operation_id,
        idempotency_key: context.idempotency_key
    });
}

export function createTenantRuntimeRouter({
    serviceAuth,
    verificationKeys = () => [],
    tenantAuthority,
    connectionRegistry,
    credentialBroker,
    usageLedger,
    tenantBoundaryGateway,
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
        return { input, current };
    }
    router.post('/workspace-connections:validate-revision', asyncHandler(async (req, res) => {
        res.json(await connectionRegistry.validateRevision(contextBoundInput(req)));
    }));
    for (const [path, entryPoint] of Object.entries({
        'admin-api': 'admin_api',
        mcp: 'mcp',
        'background-job': 'background_job',
        migration: 'migration',
        'audit-log': 'audit_log'
    })) {
        router.post(`/tenant-boundaries/${path}:authorize`, asyncHandler(async (req, res) => {
            if (!tenantBoundaryGateway?.authorize) {
                throw new ContractError('UPSTREAM_UNAVAILABLE', { status: 503, retryable: true, fault_domain: 'brainbase_cloud' });
            }
            wireInput(req, ['resource_ref'], {});
            res.json(await tenantBoundaryGateway.authorize({
                tenant_context: req.tenantContext,
                entry_point: entryPoint,
                resource_ref: req.body.resource_ref
            }));
        }));
    }
    router.post('/credential-leases', asyncHandler(async (req, res) => {
        const { current } = await revalidateAuthoritativeBinding(req);
        if (typeof credentialBroker.register === 'function') credentialBroker.register(current);
        res.status(201).json(await credentialBroker.issueLease(credentialLeaseRequest(req)));
    }));
    router.post('/oauth-refresh:compare-and-swap', asyncHandler(async (req, res) => {
        const { input } = await revalidateAuthoritativeBinding(req);
        res.json(await credentialBroker.compareAndSwapRefresh(input));
    }));
    router.post('/quota:decide', asyncHandler(async (req, res) => {
        await revalidateAuthoritativeBinding(req);
        res.json(await usageLedger.decideQuota(quotaInput(req)));
    }));
    router.post('/usage-events', asyncHandler(async (req, res) => {
        await revalidateAuthoritativeBinding(req);
        res.status(202).json(await usageLedger.recordUsage(usageEventInput(req)));
    }));
    router.post(/^\/operation-receipts:finalize-with-pricing$/, asyncHandler(async (req, res) => {
        await revalidateAuthoritativeBinding(req);
        res.status(201).json(await usageLedger.finalizeReceiptWithPricing(operationReceiptWithPricingInput(req)));
    }));
    router.post(/^\/operation-receipts:finalize$/, asyncHandler(async (req, res) => {
        await revalidateAuthoritativeBinding(req);
        res.status(201).json(await usageLedger.finalizeReceipt(operationReceiptInput(req)));
    }));
    router.post('/operation-receipts/:receiptId/history:read', asyncHandler(async (req, res) => {
        await revalidateAuthoritativeBinding(req);
        wireInput(req, [], {});
        if (!/^receipt_[0-9A-HJKMNP-TV-Z]{26}$/.test(req.params.receiptId)) {
            throw new ContractError('SCHEMA_INVALID', { status: 400, fault_domain: 'protocol' });
        }
        res.json(await usageLedger.readReceiptHistory({
            tenant_id: req.tenantContext.tenant.tenant_id,
            receipt_id: req.params.receiptId
        }));
    }));
    router.post('/idempotency-claims', asyncHandler(async (req, res) => {
        await revalidateAuthoritativeBinding(req);
        res.status(201).json(await usageLedger.claimEffect(idempotencyClaimInput(req), {
            connection_revision: req.tenantContext.workspace_connection.connection_revision
        }));
    }));

    router.use((error, req, res, _next) => {
        const problem = toProblem(error, req.body?.correlation_id ?? null);
        res.status(problem.status).type('application/problem+json').json(problem);
    });
    return router;
}
