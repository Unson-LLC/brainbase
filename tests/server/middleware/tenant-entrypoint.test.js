import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createTenantEntrypointGuard } from '../../../server/middleware/tenant-entrypoint.js';
import { ContractError } from '../../../server/services/multitenant/errors.js';

function encodeHeader(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

describe('production tenant entrypoint guard', () => {
    it('AC-005: signed tenant contextとowned resourceをactual middlewareで検証する', async () => {
        const context = {
            tenant: { tenant_id: 'ten_a', tenant_revision: '3' },
            correlation_id: 'cor_a'
        };
        const tenantContextVerifier = vi.fn(async () => context);
        const tenantBoundaryGateway = {
            authorize: vi.fn(async () => ({ authorized: true, tenant_id: 'ten_a' }))
        };
        const app = express();
        app.get('/admin', createTenantEntrypointGuard({
            tenantContextVerifier,
            tenantBoundaryGateway
        }, 'admin_api'), (req, res) => res.json({ authorization: req.tenantAuthorization }));

        const response = await request(app).get('/admin').set({
            'Brainbase-Tenant-Context': encodeHeader({ signed: 'context' }),
            'Brainbase-Resource-Ref': encodeHeader({ object_type: 'project', resource_id: 'project-a' })
        });

        expect(response.status).toBe(200);
        expect(tenantContextVerifier).toHaveBeenCalledWith({ signed: 'context' }, { service_identity: 'brainbase-admin-api' });
        expect(tenantBoundaryGateway.authorize).toHaveBeenCalledWith({
            tenant_context: context,
            entry_point: 'admin_api',
            resource_ref: { object_type: 'project', resource_id: 'project-a' }
        });
    });

    it('AC-005: missing bindingとcross-tenant判定をfallbackなしで拒否する', async () => {
        const tenantBoundaryGateway = {
            authorize: vi.fn(async () => {
                throw new ContractError('CROSS_TENANT_CANDIDATE', { status: 403 });
            })
        };
        const guard = createTenantEntrypointGuard({
            tenantContextVerifier: async () => ({ tenant: { tenant_id: 'ten_a', tenant_revision: '3' } }),
            tenantBoundaryGateway
        }, 'audit_log');
        const app = express();
        app.post('/audit', express.json(), guard, (_req, res) => res.json({ ok: true }));

        const missing = await request(app).post('/audit').send({});
        expect(missing.status).toBe(400);
        expect(missing.body.code).toBe('TENANT_CONTEXT_INVALID');
        const response = await request(app).post('/audit').set({
            'Brainbase-Tenant-Context': encodeHeader({ signed: 'context' }),
            'Brainbase-Resource-Ref': encodeHeader({ object_type: 'project', resource_id: 'project-b' })
        }).send({});
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('CROSS_TENANT_CANDIDATE');
    });
});
