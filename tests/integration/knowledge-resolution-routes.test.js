import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createKnowledgeResolutionRouter } from '../../server/routes/knowledge-resolution.js';
import { KnowledgeResolutionService } from '../../server/services/knowledge-resolution-service.js';

describe('knowledge resolution API', () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.access = { projectCodes: ['brainbase'] };
        next();
    });
    app.use('/api/knowledge', createKnowledgeResolutionRouter({
        service: new KnowledgeResolutionService({ id: () => 'kr_test' })
    }));

    it('POST /resolve returns a routing receipt', async () => {
        const response = await request(app).post('/api/knowledge/resolve').send({
            intent: 'team UX knowledge', audience: 'team', project_code: 'brainbase', content_type: 'team_document'
        });
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ resolution_id: 'kr_test', status: 'resolved', source_class: 'owning_repo' });
    });

    it('invalid input remains an explicit 400 error', async () => {
        const response = await request(app).post('/api/knowledge/resolve').send({ audience: 'team', content_type: 'unknown' });
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('knowledge_resolution_input_invalid');
    });

    it('audienceとcontent typeの矛盾を400で拒否する', async () => {
        const response = await request(app).post('/api/knowledge/resolve').send({
            intent: 'team knowledge', audience: 'team', content_type: 'personal_knowledge'
        });
        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('knowledge_resolution_input_invalid');
    });
});
