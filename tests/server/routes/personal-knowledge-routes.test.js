import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createPersonalKnowledgeRouter } from '../../../server/routes/personal-knowledge.js';

function createApp() {
    const personalKnowledgeService = {
        ingest: vi.fn(async () => ({ event_id: 'pke_1', processing_stage: 'received' })),
        search: vi.fn(async () => [{ event_id: 'pke_1' }]),
        getCycle: vi.fn(async () => ({ event_id: 'pke_1', processing_stage: 'received' }))
    };
    const promotionService = {
        requestPromotion: vi.fn(async () => ({ request_id: 'kpr_1', status: 'pending_owner_approval' })),
        decidePromotion: vi.fn(async () => ({ request_id: 'kpr_1', status: 'approved', organization_event_id: 'kev_prom_1' }))
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.personalKnowledgeAccess = { personId: 'person_a', organizationId: 'org_a' };
        req.access = { personId: 'person_a', organizationId: 'org_a', projectCodes: ['brainbase'] };
        next();
    });
    app.use('/api/personal-knowledge', createPersonalKnowledgeRouter({ personalKnowledgeService, promotionService }));
    return { app, personalKnowledgeService, promotionService };
}

describe('personal knowledge routes', () => {
    it('registers and searches the authenticated Personal Vault', async () => {
        const { app, personalKnowledgeService } = createApp();
        await request(app).post('/api/personal-knowledge/events').send({ event_id: 'pke_1' }).expect(201);
        await request(app).get('/api/personal-knowledge/search?q=判断&limit=3').expect(200);

        expect(personalKnowledgeService.ingest).toHaveBeenCalledWith({ event_id: 'pke_1' }, expect.objectContaining({ access: expect.any(Object) }));
        expect(personalKnowledgeService.search).toHaveBeenCalledWith({ query: '判断', limit: '3' }, expect.objectContaining({ access: expect.any(Object) }));
    });

    it('exposes cycle, promotion request, and owner decision contracts', async () => {
        const { app, personalKnowledgeService, promotionService } = createApp();

        await request(app).get('/api/personal-knowledge/cycles/pke_1').expect(200);
        await request(app).post('/api/personal-knowledge/events/pke_1/promotion-requests').send({ project_code: 'brainbase' }).expect(202);
        await request(app).post('/api/personal-knowledge/promotions/kpr_1/decision').send({ decision: 'approve' }).expect(200);

        expect(personalKnowledgeService.getCycle).toHaveBeenCalledWith('pke_1', expect.any(Object));
        expect(promotionService.requestPromotion).toHaveBeenCalledWith('pke_1', { project_code: 'brainbase' }, expect.any(Object));
        expect(promotionService.decidePromotion).toHaveBeenCalledWith('kpr_1', { decision: 'approve' }, expect.any(Object));
    });
});
