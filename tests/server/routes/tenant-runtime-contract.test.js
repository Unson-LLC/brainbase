import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createTenantRuntimeRouter } from '../../../server/routes/tenant-runtime.js';
import { registerTenantRuntimeApiRoute } from '../../../server/bootstrap/register-api-routes.js';
import { MeetingMinutesContextReceiptError } from '../../../server/services/meeting-minutes/context-receipt-service.js';
import { REQUIRED_CAPABILITIES } from '../../../server/services/multitenant/protocol-contract.js';

const tenantContext = {
    tenant: { tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV', tenant_revision: '3' },
    workspace_connection: {
        connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        connection_revision: '1',
        workspace_id: 'workspace-opaque',
        app_id: 'app-opaque'
    },
    placement: { deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    correlation_id: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    contract_revision: '1',
    actor: { principal_id: 'person-sato' },
    authorization: { project_ids: ['project-unson'] },
    credential: { mode: 'customer_oauth', credential_ref: 'credref:opaque' }
};

function createApp(overrides = {}) {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/runtime', createTenantRuntimeRouter({
        serviceAuth: (req, res, next) => req.get('authorization') === 'Bearer service-test' ? next() : res.status(401).json({ code: 'SERVICE_AUTH_REQUIRED' }),
        tenantContextVerifier: (input) => input,
        verificationKeys: () => [{ key_id: 'key-current', algorithm: 'EdDSA', public_key_format: 'jwk', public_key: { kty: 'OKP', crv: 'Ed25519', x: 'public-opaque' }, status: 'current' }],
        connectionRegistry: {
            validateRevision: (input) => ({ valid: true, authoritative: true, ...input, credential_ref: tenantContext.credential.credential_ref, credential_mode: tenantContext.credential.mode }),
            resolveProjectBinding: ({ project_ids, project_code }) => project_ids.includes('project-unson') && project_code === 'unson'
                ? { project_id: 'project-unson', project_code }
                : null
        },
        credentialBroker: { issueLease: (input) => ({ lease_ref: 'lease:opaque', expires_at: '2026-08-16T00:01:00Z', ...input }) },
        usageLedger: { recordUsage: (input) => ({ accepted: true, ...input }) },
        tenantBoundaryGateway: { authorize: (input) => ({ authorized: true, ...input }) },
        ...overrides
    }));
    return app;
}

function negotiationRequest(deploymentProfile) {
    return {
        message_type: 'protocol_negotiation_request',
        protocol_id: 'mana-brainbase-tenant-context',
        deployment_id: tenantContext.placement.deployment_id,
        deployment_profile: deploymentProfile,
        supported_range: '>=1.0 <2.0',
        supported_versions: ['1.0'],
        required_capabilities: [...REQUIRED_CAPABILITIES],
        optional_capabilities: []
    };
}

describe('tenant runtime API', () => {
    it('AC-005/301: production bootstrapへservice-auth付きruntime routeを登録する', async () => {
        const app = express();
        app.use(express.json());
        registerTenantRuntimeApiRoute(app, {
            serviceAuth: (_req, _res, next) => next(),
            tenantContextVerifier: (input) => input,
            verificationKeys: () => [],
            connectionRegistry: { validateRevision: () => ({ valid: true }) },
            credentialBroker: { issueLease: () => ({ lease_ref: 'lease:opaque' }) },
            usageLedger: { recordUsage: (input) => input }
        });
        const response = await request(app).post('/api/v1/runtime/negotiate').send(negotiationRequest('shared_cloud'));
        expect(response.status).toBe(200);
    });

    it('AC-301/AC-302: service auth後にCloud/OSS共通v1 negotiationを返す', async () => {
        const response = await request(createApp())
            .post('/api/v1/runtime/negotiate')
            .set('authorization', 'Bearer service-test')
            .send(negotiationRequest('customer_managed_oss'));
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ protocol_id: 'mana-brainbase-tenant-context', selected_version: '1.0' });
    });

    it('D-001: verification keys APIは公開鍵のcurrent/retiringだけを返す', async () => {
        const response = await request(createApp()).get('/api/v1/runtime/verification-keys').set('authorization', 'Bearer service-test');
        expect(response.status).toBe(200);
        expect(response.body.keys[0]).not.toHaveProperty('private_key');
        expect(response.body.keys[0]).not.toHaveProperty('secret');
    });

    it('D-003/D-005: authoritative revision検証とopaque credential leaseをAPI化する', async () => {
        const headers = { authorization: 'Bearer service-test', 'Brainbase-Protocol-Version': '1.0', 'Brainbase-Deployment-Id': tenantContext.placement.deployment_id };
        const revision = await request(createApp()).post('/api/v1/runtime/workspace-connections:validate-revision').set(headers).send({ tenant_context: tenantContext, tenant_id: tenantContext.tenant.tenant_id, connection_id: tenantContext.workspace_connection.connection_id, expected_connection_revision: '1' });
        const lease = await request(createApp()).post('/api/v1/runtime/credential-leases').set(headers).send({
            tenant_context: tenantContext,
            message_type: 'credential_lease_request',
            protocol_version: '1.0',
            binding: { audience: 'mana-runtime' },
            requested_ttl_seconds: 60
        });
        expect(revision.status).toBe(200);
        expect(lease.status).toBe(201);
        expect(lease.body).not.toHaveProperty('credential');
    });

    it('AC-304: failureをapplication/problem+jsonと機械判定可能なfault_domainで返す', async () => {
        const error = Object.assign(new Error('unavailable'), { code: 'WORKSPACE_CONNECTION_UNAVAILABLE', status: 503, fault_domain: 'brainbase_cloud', retryable: true });
        const app = createApp({ connectionRegistry: { validateRevision: () => { throw error; } } });
        const response = await request(app).post('/api/v1/runtime/workspace-connections:validate-revision').set({ authorization: 'Bearer service-test', 'Brainbase-Protocol-Version': '1.0', 'Brainbase-Deployment-Id': tenantContext.placement.deployment_id }).send({ tenant_context: tenantContext });
        expect(response.status).toBe(503);
        expect(response.headers['content-type']).toContain('application/problem+json');
        expect(response.body).toMatchObject({ code: 'WORKSPACE_CONNECTION_UNAVAILABLE', fault_domain: 'brainbase_cloud', retryable: true });
    });

    it('D-001/AC-301/AC-305: 各業務境界でEnvelopeを再検証しbodyの越境自己申告を拒否する', async () => {
        const tenantContextVerifier = vi.fn((input) => input);
        const connectionRegistry = { validateRevision: vi.fn() };
        const app = createApp({ tenantContextVerifier, connectionRegistry });
        const response = await request(app)
            .post('/api/v1/runtime/workspace-connections:validate-revision')
            .set({ authorization: 'Bearer service-test', 'Brainbase-Protocol-Version': '1.0', 'Brainbase-Deployment-Id': tenantContext.placement.deployment_id })
            .send({
                tenant_context: tenantContext,
                tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAW',
                connection_id: tenantContext.workspace_connection.connection_id,
                expected_connection_revision: '1'
            });
        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ code: 'CROSS_TENANT_CANDIDATE' });
        expect(tenantContextVerifier).toHaveBeenCalledOnce();
        expect(connectionRegistry.validateRevision).not.toHaveBeenCalled();
    });

    it('D-003/AC-105/AC-301: side effect直前にauthoritative revisionとcredential bindingを再検証する', async () => {
        const connectionRegistry = { validateRevision: vi.fn(() => { throw Object.assign(new Error('stale'), { code: 'WORKSPACE_CONNECTION_STALE_REVISION', status: 409 }); }) };
        const credentialBroker = { issueLease: vi.fn() };
        const response = await request(createApp({ connectionRegistry, credentialBroker }))
            .post('/api/v1/runtime/credential-leases')
            .set({ authorization: 'Bearer service-test', 'Brainbase-Protocol-Version': '1.0', 'Brainbase-Deployment-Id': tenantContext.placement.deployment_id })
            .send({ tenant_context: tenantContext, audience: 'mana-runtime', ttl_seconds: 60 });
        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({ code: 'WORKSPACE_CONNECTION_STALE_REVISION' });
        expect(connectionRegistry.validateRevision).toHaveBeenCalledOnce();
        expect(credentialBroker.issueLease).not.toHaveBeenCalled();
    });

    it('meeting contextをprivate tenant runtimeで作成・取得し、provider credential brokerを使わない', async () => {
        const identity = { run_id: 'run-unson-a', project_code: 'unson', transcript_sha256: 'a'.repeat(64) };
        const meetingMinutesContextReceiptService = {
            create: vi.fn(async (_identity, actor) => ({ receipt_id: 'receipt-unson-a', actor })),
            get: vi.fn(async (receiptId, _identity, actor) => ({ receipt_id: receiptId, actor }))
        };
        const credentialBroker = { issueLease: vi.fn(), forwardProviderRequest: vi.fn() };
        const app = createApp({ meetingMinutesContextReceiptService, credentialBroker });
        const headers = {
            authorization: 'Bearer service-test',
            'Brainbase-Protocol-Version': '1.0',
            'Brainbase-Deployment-Id': tenantContext.placement.deployment_id
        };

        const created = await request(app).post('/api/v1/runtime/meeting-minutes/context-receipts:create')
            .set(headers).send({ tenant_context: tenantContext, identity });
        const fetched = await request(app).post('/api/v1/runtime/meeting-minutes/context-receipts:get')
            .set(headers).send({ tenant_context: tenantContext, receipt_id: 'receipt-unson-a', identity });

        expect([created.status, fetched.status]).toEqual([201, 200]);
        expect(meetingMinutesContextReceiptService.create).toHaveBeenCalledWith(identity, expect.objectContaining({
            authType: 'tenant_runtime', person_id: 'person-sato', projectCodes: ['unson'], role: 'member'
        }));
        expect(meetingMinutesContextReceiptService.get).toHaveBeenCalledWith('receipt-unson-a', identity, expect.objectContaining({
            authType: 'tenant_runtime', projectCodes: ['unson']
        }));
        expect(credentialBroker.issueLease).not.toHaveBeenCalled();
        expect(credentialBroker.forwardProviderRequest).not.toHaveBeenCalled();
    });

    it('meeting contextのproject越境とstale bindingをservice呼出前に拒否する', async () => {
        const service = { create: vi.fn() };
        const crossProjectRegistry = {
            validateRevision: (input) => ({
                valid: true,
                authoritative: true,
                ...input,
                credential_ref: tenantContext.credential.credential_ref,
                credential_mode: tenantContext.credential.mode
            }),
            resolveProjectBinding: vi.fn(async () => null)
        };
        const headers = {
            authorization: 'Bearer service-test',
            'Brainbase-Protocol-Version': '1.0',
            'Brainbase-Deployment-Id': tenantContext.placement.deployment_id
        };
        const identity = { run_id: 'run-a', project_code: 'mana', transcript_sha256: 'b'.repeat(64) };
        const projectMismatch = await request(createApp({
            meetingMinutesContextReceiptService: service,
            connectionRegistry: crossProjectRegistry
        }))
            .post('/api/v1/runtime/meeting-minutes/context-receipts:create')
            .set(headers).send({ tenant_context: tenantContext, identity });
        const stale = await request(createApp({
            meetingMinutesContextReceiptService: service,
            connectionRegistry: { validateRevision: vi.fn(() => ({ authoritative: false })) }
        })).post('/api/v1/runtime/meeting-minutes/context-receipts:create')
            .set(headers).send({ tenant_context: tenantContext, identity: { ...identity, project_code: 'unson' } });

        expect(projectMismatch.status).toBe(403);
        expect(projectMismatch.body).toMatchObject({ code: 'PROJECT_SCOPE_MISMATCH' });
        expect(crossProjectRegistry.resolveProjectBinding).toHaveBeenCalledWith({
            tenant_id: tenantContext.tenant.tenant_id,
            project_ids: ['project-unson'],
            project_code: 'mana'
        });
        expect(stale.status).toBe(409);
        expect(stale.body).toMatchObject({ code: 'WORKSPACE_CONNECTION_STALE_REVISION' });
        expect(service.create).not.toHaveBeenCalled();
    });

    it('meeting contextの余分な入力を拒否し、service errorをproblem responseとして保持する', async () => {
        const identity = { run_id: 'run-a', project_code: 'unson', transcript_sha256: 'b'.repeat(64) };
        const headers = {
            authorization: 'Bearer service-test',
            'Brainbase-Protocol-Version': '1.0',
            'Brainbase-Deployment-Id': tenantContext.placement.deployment_id
        };
        const service = {
            create: vi.fn(async () => {
                throw new MeetingMinutesContextReceiptError(
                    'meeting_minutes_context_not_found', 'receipt not found', 404
                );
            })
        };
        const app = createApp({ meetingMinutesContextReceiptService: service });

        const extraField = await request(app).post('/api/v1/runtime/meeting-minutes/context-receipts:create')
            .set(headers).send({ tenant_context: tenantContext, identity, unexpected: true });
        const serviceError = await request(app).post('/api/v1/runtime/meeting-minutes/context-receipts:create')
            .set(headers).send({ tenant_context: tenantContext, identity });

        expect(extraField.status).toBe(400);
        expect(extraField.body).toMatchObject({ code: 'SCHEMA_INVALID' });
        expect(serviceError.status).toBe(404);
        expect(serviceError.type).toBe('application/problem+json');
        expect(serviceError.body).toMatchObject({
            code: 'meeting_minutes_context_not_found',
            status: 404,
            retryable: false
        });
    });

    it('D-006/D-007: quota・usage・receipt・business-effect claimをcanonical wireのまま実routeへ渡す', async () => {
        const usageLedger = {
            decideQuota: vi.fn((input) => input),
            recordUsage: vi.fn((input) => input),
            finalizeReceipt: vi.fn((input) => input),
            claimEffect: vi.fn((input) => input)
        };
        const headers = {
            authorization: 'Bearer service-test',
            'Brainbase-Protocol-Version': '1.0',
            'Brainbase-Deployment-Id': tenantContext.placement.deployment_id
        };
        const body = { tenant_context: tenantContext };
        const app = createApp({ usageLedger });

        const quota = await request(app).post('/api/v1/runtime/quota:decide').set(headers).send({
            ...body,
            metric: 'model_tokens',
            requested_quantity: 1
        });
        const usage = await request(app).post('/api/v1/runtime/usage-events').set(headers).send({
            ...body,
            message_type: 'usage_event',
            usage_event_id: 'usage_01ARZ3NDEKTSV4RRFFQ69G5FB2',
            protocol_version: '1.0',
            kind: 'provider_cost',
            quantity: null,
            unit: 'usd',
            collection_state: 'not_collected',
            outcome: 'timed_out',
            failure_code: 'UPSTREAM_TIMEOUT',
            unknown_fields: ['amount'],
            observed_at: '2026-08-16T13:01:34Z'
        });
        const receipt = await request(app).post('/api/v1/runtime/operation-receipts:finalize').set(headers).send({
            ...body,
            message_type: 'operation_receipt',
            receipt_id: 'receipt_01ARZ3NDEKTSV4RRFFQ69G5FB6',
            protocol_version: '1.0',
            operation_ids: [tenantContext.operation_id],
            idempotency_keys: [tenantContext.idempotency_key],
            actor_principal_id: 'person-a',
            project_id: 'project-a',
            capability_id: 'task.read',
            quota_decision: 'allowed',
            credential_mode: 'customer_oauth',
            collection_state: 'partial',
            outcome: 'failed',
            failure_code: 'UPSTREAM_PARTIAL',
            usage_event_ids: ['usage_01ARZ3NDEKTSV4RRFFQ69G5FB2'],
            reply: { state: 'failed', reply_count: 0, legacy_reply_count: 0 },
            completed_at: '2026-08-16T13:01:35Z'
        });
        const claim = await request(app).post('/api/v1/runtime/idempotency-claims').set(headers).send({
            ...body,
            message_type: 'idempotency_claim',
            owner: 'brainbase',
            scope: 'business_effect',
            slack_event_id: 'Ev-A-001',
            context_hash: `sha256:${'a'.repeat(64)}`,
            payload_hash: `sha256:${'b'.repeat(64)}`,
            state: 'succeeded',
            retention_until: '2026-09-16T13:01:35Z'
        });

        expect([quota.status, usage.status, receipt.status, claim.status]).toEqual([200, 202, 201, 201]);
        for (const call of [
            usageLedger.decideQuota.mock.calls[0][0],
            usageLedger.recordUsage.mock.calls[0][0],
            usageLedger.finalizeReceipt.mock.calls[0][0],
            usageLedger.claimEffect.mock.calls[0][0]
        ]) {
            expect(call).not.toHaveProperty('tenant_context');
            expect(call).not.toHaveProperty('tenant_revision_at_write');
            expect(call).not.toHaveProperty('credential_ref');
            expect(call).not.toHaveProperty('workspace_id');
        }
        expect(usageLedger.claimEffect).toHaveBeenCalledWith(expect.objectContaining({
            owner: 'brainbase',
            scope: 'business_effect',
            idempotency_key: tenantContext.idempotency_key
        }), { connection_revision: '1' });
    });

    it('D-006: quota authority rejects caller-supplied observed quantity and window fields', async () => {
        const decideQuota = vi.fn((input) => input);
        const app = createApp({ usageLedger: { decideQuota } });
        const headers = {
            authorization: 'Bearer service-test',
            'Brainbase-Protocol-Version': '1.0',
            'Brainbase-Deployment-Id': tenantContext.placement.deployment_id
        };

        const response = await request(app)
            .post('/api/v1/runtime/quota:decide')
            .set(headers)
            .send({
                tenant_context: tenantContext,
                metric: 'model_tokens',
                requested_quantity: 1,
                observed_quantity: 0,
                window_started_at: '2026-08-01T00:00:00Z'
            });

        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({ code: 'QUOTA_INPUT_INVALID' });
        expect(decideQuota).not.toHaveBeenCalled();
    });

    it.each([
        ['admin API', 'admin-api', 'admin_api'],
        ['MCP', 'mcp', 'mcp'],
        ['background job', 'background-job', 'background_job'],
        ['migration', 'migration', 'migration'],
        ['audit log', 'audit-log', 'audit_log']
    ])('AC-005: %s tenant boundaryは署名済みcontextと永続resource ownerを実routeで照合する', async (_label, route, entryPoint) => {
        const tenantBoundaryGateway = { authorize: vi.fn(async (input) => ({ authorized: true, entry_point: input.entry_point })) };
        const response = await request(createApp({ tenantBoundaryGateway }))
            .post(`/api/v1/runtime/tenant-boundaries/${route}:authorize`)
            .set({
                authorization: 'Bearer service-test',
                'Brainbase-Protocol-Version': '1.0',
                'Brainbase-Deployment-Id': tenantContext.placement.deployment_id
            })
            .send({
                tenant_context: tenantContext,
                resource_ref: { object_type: 'project', resource_id: 'project-a' }
            });

        expect(response.status).toBe(200);
        expect(tenantBoundaryGateway.authorize).toHaveBeenCalledWith({
            tenant_context: tenantContext,
            entry_point: entryPoint,
            resource_ref: { object_type: 'project', resource_id: 'project-a' }
        });
    });

    it('AC-205: HTTP finalize-with-pricingからledger保存とtenant限定history readbackへ接続する', async () => {
        const finalized = {
            receipt: { receipt_id: 'receipt_01ARZ3NDEKTSV4RRFFQ69G5FB6' },
            pricing_snapshot: { rate_card_revision: '8', fx_table_revision: '5', sales_price_revision: '3' }
        };
        const usageLedger = {
            finalizeReceiptWithPricing: vi.fn(async () => finalized),
            readReceiptHistory: vi.fn(async () => [finalized])
        };
        const headers = {
            authorization: 'Bearer service-test',
            'Brainbase-Protocol-Version': '1.0',
            'Brainbase-Deployment-Id': tenantContext.placement.deployment_id
        };
        const pricingSnapshot = {
            rate_card_revision: '8', fx_table_revision: '5', sales_price_revision: '3',
            purchase_currency: 'USD', purchase_minor_units: null,
            billing_currency: 'JPY', billing_minor_units: null,
            fx_rate_decimal: '150.1234', effective_at: '2026-08-16T13:01:35Z'
        };
        const receiptBody = {
            message_type: 'operation_receipt', receipt_id: finalized.receipt.receipt_id,
            protocol_version: '1.0', operation_ids: [tenantContext.operation_id],
            idempotency_keys: [tenantContext.idempotency_key], actor_principal_id: 'person-a',
            project_id: 'project-a', capability_id: 'task.read', quota_decision: 'allowed',
            credential_mode: 'customer_oauth', collection_state: 'partial', outcome: 'failed',
            failure_code: 'UPSTREAM_PARTIAL', usage_event_ids: [],
            reply: { state: 'failed', reply_count: 0, legacy_reply_count: 0 },
            completed_at: '2026-08-16T13:01:35Z'
        };
        const app = createApp({ usageLedger });
        const createResponse = await request(app)
            .post('/api/v1/runtime/operation-receipts:finalize-with-pricing')
            .set(headers)
            .send({ tenant_context: tenantContext, receipt: receiptBody, pricing_snapshot: pricingSnapshot });
        const historyResponse = await request(app)
            .post(`/api/v1/runtime/operation-receipts/${finalized.receipt.receipt_id}/history:read`)
            .set(headers)
            .send({ tenant_context: tenantContext });

        expect(createResponse.status, JSON.stringify(createResponse.body)).toBe(201);
        expect(historyResponse.status, JSON.stringify(historyResponse.body)).toBe(200);
        expect(usageLedger.finalizeReceiptWithPricing).toHaveBeenCalledWith({
            receipt: expect.objectContaining({ tenant_id: tenantContext.tenant.tenant_id }),
            pricing_snapshot: pricingSnapshot
        });
        expect(usageLedger.readReceiptHistory).toHaveBeenCalledWith({
            tenant_id: tenantContext.tenant.tenant_id,
            receipt_id: finalized.receipt.receipt_id
        });
    });

    it('D-009/AC-301/AC-305: runtime header欠損やdeployment不一致を拒否する', async () => {
        const missing = await request(createApp()).post('/api/v1/runtime/credential-leases').set('authorization', 'Bearer service-test').send({ tenant_context: tenantContext });
        expect(missing.status).toBe(400);
        expect(missing.body).toMatchObject({ code: 'PROTOCOL_VERSION_UNSUPPORTED' });
        const mismatch = await request(createApp()).post('/api/v1/runtime/credential-leases')
            .set({ authorization: 'Bearer service-test', 'Brainbase-Protocol-Version': '1.0', 'Brainbase-Deployment-Id': 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAW' })
            .send({ tenant_context: tenantContext });
        expect(mismatch.status).toBe(403);
        expect(mismatch.body).toMatchObject({ code: 'FALLBACK_FORBIDDEN' });
    });
});
