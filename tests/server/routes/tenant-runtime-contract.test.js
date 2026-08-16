import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createTenantRuntimeRouter } from '../../../server/routes/tenant-runtime.js';
import { registerTenantRuntimeApiRoute } from '../../../server/bootstrap/register-api-routes.js';

const tenantContext = {
    tenant: { tenant_id: 'ten_01ARZ3NDEKTSV4RRFFQ69G5FAV', tenant_revision: 3 },
    workspace_connection: {
        connection_id: 'wsc_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        connection_revision: 1,
        workspace_id: 'workspace-opaque',
        app_id: 'app-opaque'
    },
    placement: { deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    operation_id: 'op_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    correlation_id: 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    contract_revision: 'ctr_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    credential: { mode: 'customer_oauth', credential_ref: 'credref:opaque' }
};

function createApp(overrides = {}) {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/runtime', createTenantRuntimeRouter({
        serviceAuth: (req, res, next) => req.get('authorization') === 'Bearer service-test' ? next() : res.status(401).json({ code: 'SERVICE_AUTH_REQUIRED' }),
        tenantContextVerifier: (input) => input,
        verificationKeys: () => [{ key_id: 'key-current', algorithm: 'EdDSA', public_key_format: 'jwk', public_key: { kty: 'OKP', crv: 'Ed25519', x: 'public-opaque' }, status: 'current' }],
        connectionRegistry: { validateRevision: (input) => ({ valid: true, authoritative: true, ...input, credential_ref: tenantContext.credential.credential_ref, credential_mode: tenantContext.credential.mode }) },
        credentialBroker: { issueLease: (input) => ({ lease_ref: 'lease:opaque', expires_at: '2026-08-16T00:01:00Z', ...input }) },
        usageLedger: { recordUsage: (input) => ({ accepted: true, ...input }) },
        ...overrides
    }));
    return app;
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
        const response = await request(app).post('/api/v1/runtime/negotiate').send({
            deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV', deployment_profile: 'shared_cloud',
            supported_range: '>=1.0 <2.0', required_capabilities: []
        });
        expect(response.status).toBe(200);
    });

    it('AC-301/AC-302: service auth後にCloud/OSS共通v1 negotiationを返す', async () => {
        const response = await request(createApp())
            .post('/api/v1/runtime/negotiate')
            .set('authorization', 'Bearer service-test')
            .send({ deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV', deployment_profile: 'customer_managed_oss', supported_range: '>=1.0 <2.0', required_capabilities: ['signed_tenant_context'] });
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
        const revision = await request(createApp()).post('/api/v1/runtime/workspace-connections:validate-revision').set(headers).send({ tenant_context: tenantContext, tenant_id: tenantContext.tenant.tenant_id, connection_id: tenantContext.workspace_connection.connection_id, expected_connection_revision: 1 });
        const lease = await request(createApp()).post('/api/v1/runtime/credential-leases').set(headers).send({ tenant_context: tenantContext, tenant_id: tenantContext.tenant.tenant_id, connection_id: tenantContext.workspace_connection.connection_id, connection_revision: 1, credential_mode: 'customer_oauth', credential_ref: 'credref:opaque', operation_id: tenantContext.operation_id, audience: 'mana-runtime', ttl_seconds: 60 });
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
                expected_connection_revision: 1
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
