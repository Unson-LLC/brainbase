import { describe, expect, it, vi } from 'vitest';
import { createServiceAuthMiddleware } from '../../../../server/services/multitenant/service-auth.js';

function invoke(middleware, authorization = 'Bearer service-opaque') {
    const req = { get: (name) => name.toLowerCase() === 'authorization' ? authorization : undefined };
    const response = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        type() { return this; },
        json(body) { this.body = body; return this; }
    };
    const next = vi.fn();
    return Promise.resolve(middleware(req, response, next)).then(() => ({ req, response, next }));
}

function validClaims(overrides = {}) {
    return {
        issuer: 'brainbase',
        subject: 'svc_mana_runtime',
        audience: ['brainbase-api'],
        deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV',
        expires_at: '2026-08-16T00:05:00.000Z',
        capabilities: ['tenant_context:resolve'],
        ...overrides
    };
}

describe('service authentication boundary', () => {
    it('D-001/AC-301: issuer subject audience deployment expiry capabilityを検証する', async () => {
        const middleware = createServiceAuthMiddleware({
            verifyToken: async () => validClaims(),
            issuer: 'brainbase',
            audience: 'brainbase-api',
            deploymentId: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            requiredCapabilities: ['tenant_context:resolve'],
            now: () => new Date('2026-08-16T00:04:59.000Z')
        });
        const { req, next } = await invoke(middleware);
        expect(next).toHaveBeenCalledOnce();
        expect(req.serviceIdentity).toMatchObject({ subject: 'svc_mana_runtime' });
    });

    it.each([
        ['issuer', { issuer: 'unknown' }],
        ['subject', { subject: '' }],
        ['audience', { audience: ['other-api'] }],
        ['deployment', { deployment_id: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAW' }],
        ['expiry', { expires_at: '2026-08-16T00:04:58.000Z' }],
        ['capability', { capabilities: [] }]
    ])('D-001: %s不一致を業務処理前に拒否する', async (_field, overrides) => {
        const middleware = createServiceAuthMiddleware({
            verifyToken: async () => validClaims(overrides),
            issuer: 'brainbase',
            audience: 'brainbase-api',
            deploymentId: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV',
            requiredCapabilities: ['tenant_context:resolve'],
            now: () => new Date('2026-08-16T00:04:59.000Z')
        });
        const { response, next } = await invoke(middleware);
        expect(next).not.toHaveBeenCalled();
        expect(response.statusCode).toBe(401);
        expect(response.body).toMatchObject({ code: 'SERVICE_AUTH_INVALID' });
    });

    it('D-001/AC-003: token内tenant自己申告をservice identityとして採用しない', async () => {
        const middleware = createServiceAuthMiddleware({
            verifyToken: async () => validClaims({ tenant_id: 'ten_untrusted' }),
            issuer: 'brainbase', audience: 'brainbase-api', deploymentId: 'dep_01ARZ3NDEKTSV4RRFFQ69G5FAV', now: () => new Date('2026-08-16T00:04:59.000Z')
        });
        const { req } = await invoke(middleware);
        expect(req.serviceIdentity).not.toHaveProperty('tenant_id');
    });
});
