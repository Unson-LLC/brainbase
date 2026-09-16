// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { createTenantRuntimeRouter } from '../../../server/routes/tenant-runtime.js';

function setup(enabled = true) {
    const read = vi.fn(async () => ({ status: 'unavailable', target_slack_user_id: 'UTARGET', fields: {} }));
    const app = express();
    app.use(express.json());
    app.use('/api/v1/runtime', createTenantRuntimeRouter({
        tenantContextVerifier: () => { throw new Error('Profile service verifies its own authority'); },
        serviceAuth: (req, res, next) => req.get('authorization') === 'Bearer test' ? next() : res.sendStatus(401),
        shareablePersonProfileService: enabled ? { read } : undefined
    }));
    return { app, read };
}
describe('shareable profile runtime transport', () => {
    it('requires service authentication before processing authority', async () => {
        const test = setup();
        expect((await request(test.app).post('/api/v1/runtime/person-profile:read').send({})).status).toBe(401);
        expect(test.read).not.toHaveBeenCalled();
    });
    it('delegates the signed envelope and forbids caching', async () => {
        const test = setup();
        const body = { target_slack_user_id: 'UTARGET', company_authority_response: { signed: true } };
        const response = await request(test.app).post('/api/v1/runtime/person-profile:read').set('authorization', 'Bearer test').send(body);
        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(test.read).toHaveBeenCalledWith(body);
    });
    it('fails closed when the profile service is not configured', async () => {
        const test = setup(false);
        expect((await request(test.app).post('/api/v1/runtime/person-profile:read').set('authorization', 'Bearer test').send({})).status).toBe(503);
    });
});
