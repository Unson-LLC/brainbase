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
        decideOwnerPromotion: vi.fn(async () => ({ request_id: 'kpr_1', status: 'pending_org_review' })),
        listOrganizationReviews: vi.fn(async () => [{ request_id: 'kpr_1', status: 'pending_org_review' }]),
        reviewOrganizationPromotion: vi.fn(async () => ({ request_id: 'kpr_1', status: 'org_rejected' }))
    };
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.personalKnowledgeAccess = {
            personId: 'person_a', actorPersonId: 'person_a_auth', organizationId: 'org_a',
            role: 'gm', projectCodes: ['brainbase']
        };
        req.access = req.personalKnowledgeAccess;
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

        expect(personalKnowledgeService.ingest).toHaveBeenCalledWith(
            { event_id: 'pke_1' },
            expect.objectContaining({ access: expect.objectContaining({ personId: 'person_a' }) })
        );
        expect(personalKnowledgeService.search).toHaveBeenCalledWith(
            { query: '判断', limit: '3' },
            expect.objectContaining({ access: expect.objectContaining({ organizationId: 'org_a' }) })
        );
    });

    it('exposes cycle, promotion request, and owner-only decision contracts', async () => {
        const { app, personalKnowledgeService, promotionService } = createApp();

        await request(app).get('/api/personal-knowledge/cycles/pke_1').expect(200);
        await request(app)
            .post('/api/personal-knowledge/events/pke_1/promotion-requests')
            .send({ project_code: 'brainbase' })
            .expect(202);
        await request(app)
            .post('/api/personal-knowledge/promotions/kpr_1/owner-decision')
            .send({ decision: 'approve' })
            .expect(200);
        await request(app)
            .post('/api/personal-knowledge/promotions/kpr_1/decision')
            .send({ decision: 'approve' })
            .expect(200);

        expect(personalKnowledgeService.getCycle).toHaveBeenCalledWith('pke_1', expect.any(Object));
        expect(promotionService.requestPromotion).toHaveBeenCalledWith(
            'pke_1', { project_code: 'brainbase' }, expect.any(Object)
        );
        expect(promotionService.decideOwnerPromotion).toHaveBeenCalledTimes(2);
    });

    it('exposes a distinct organization review queue and decision path', async () => {
        const { app, promotionService } = createApp();

        const queue = await request(app)
            .get('/api/personal-knowledge/organization-reviews?limit=10')
            .expect(200);
        const decision = await request(app)
            .post('/api/personal-knowledge/promotions/kpr_1/organization-decision')
            .send({ decision: 'reject', reason: '局所的' })
            .expect(200);

        expect(queue.body.reviews).toHaveLength(1);
        expect(decision.body.status).toBe('org_rejected');
        expect(promotionService.listOrganizationReviews).toHaveBeenCalledWith(
            { limit: '10' },
            expect.objectContaining({ access: expect.objectContaining({ role: 'gm' }) })
        );
        expect(promotionService.reviewOrganizationPromotion).toHaveBeenCalledWith(
            'kpr_1',
            { decision: 'reject', reason: '局所的' },
            expect.any(Object)
        );
    });

    it('propagates promotion authorization status codes', async () => {
        const { app, promotionService } = createApp();
        promotionService.reviewOrganizationPromotion.mockRejectedValueOnce(
            Object.assign(new Error('personal_knowledge_distinct_organization_reviewer_required'), { status: 403 })
        );

        const res = await request(app)
            .post('/api/personal-knowledge/promotions/kpr_1/organization-decision')
            .send({ decision: 'approve' })
            .expect(403);

        expect(res.body.error).toBe('personal_knowledge_distinct_organization_reviewer_required');
    });
});