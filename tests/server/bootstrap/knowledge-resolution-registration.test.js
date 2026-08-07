import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { registerKnowledgeResolutionApiRoute } from '../../../server/bootstrap/register-api-routes.js';

function createApp() {
    const resolve = vi.fn(() => ({ resolution_id: 'kr_registered', status: 'resolved' }));
    const app = express();
    app.use(express.json());
    registerKnowledgeResolutionApiRoute(app, {
        authService: {
            verifyToken: vi.fn((token) => {
                if (token !== 'test-token') throw new Error('invalid token');
                return { sub: 'per_owner', role: 'ceo', projectCodes: ['brainbase'] };
            })
        },
        service: { resolve }
    });
    return { app, resolve };
}

describe('knowledge resolution production API registration', () => {
    it('unauthenticated requestをauth boundaryで拒否する', async () => {
        const { app, resolve } = createApp();
        await request(app).post('/api/knowledge/resolve').send({}).expect(401);
        expect(resolve).not.toHaveBeenCalled();
    });

    it('Bearer認証後だけresolverを呼ぶ', async () => {
        const { app, resolve } = createApp();
        const response = await request(app).post('/api/knowledge/resolve')
            .set('authorization', 'Bearer test-token')
            .send({ intent: 'x', audience: 'team', content_type: 'team_document' })
            .expect(200);
        expect(response.body.resolution_id).toBe('kr_registered');
        expect(resolve).toHaveBeenCalledOnce();
    });

    it('認証済みでもscope外projectはresolverの前で拒否する', async () => {
        const { app, resolve } = createApp();
        const response = await request(app).post('/api/knowledge/resolve')
            .set('authorization', 'Bearer test-token')
            .send({ project_code: 'salestailor', intent: 'x', audience: 'team', content_type: 'team_document' })
            .expect(403);
        expect(response.body.error.code).toBe('knowledge_resolution_project_not_accessible');
        expect(resolve).not.toHaveBeenCalled();
    });
});
