// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { createTenantRuntimeRouter } from '../../../server/routes/tenant-runtime.js';

function setup(enabled = true) {
    const resolve = vi.fn(async () => ({ status: 'resolved', project_code: 'unson' }));
    const app = express();
    app.use(express.json());
    app.use('/api/v1/runtime', createTenantRuntimeRouter({
        tenantContextVerifier: () => { throw new Error('Knowledge service verifies its own authority'); },
        serviceAuth: (req, res, next) => req.get('authorization') === 'Bearer test' ? next() : res.sendStatus(401),
        authorityKnowledgeResolutionService: enabled ? { resolve } : undefined
    }));
    return { app, resolve };
}
describe('signed knowledge runtime transport', () => {
    it('requires service authentication before processing authority', async () => {
        const test = setup();
        expect((await request(test.app).post('/api/v1/runtime/knowledge:resolve').send({})).status).toBe(401);
        expect(test.resolve).not.toHaveBeenCalled();
    });
    it('delegates the signed envelope and forbids caching', async () => {
        const test = setup();
        const body = { project_code: 'unson', intent: 'lookup', audience: 'team', content_type: 'canonical_fact', company_authority_response: { signed: true } };
        const response = await request(test.app).post('/api/v1/runtime/knowledge:resolve').set('authorization', 'Bearer test').send(body);
        expect(response.status).toBe(200);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(test.resolve).toHaveBeenCalledWith(body);
    });
    it('does not match another runtime operation suffix', async () => {
        const test = setup();
        const response = await request(test.app).post('/api/v1/runtime/knowledge:other').set('authorization', 'Bearer test').send({});
        expect(response.status).not.toBe(200);
        expect(test.resolve).not.toHaveBeenCalled();
    });
    it('fails closed when the knowledge service is not configured', async () => {
        const test = setup(false);
        expect((await request(test.app).post('/api/v1/runtime/knowledge:resolve').set('authorization', 'Bearer test').send({})).status).toBe(503);
    });
});
