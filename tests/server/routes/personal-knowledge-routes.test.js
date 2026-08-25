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
        listOrganizationReviews: vi.fn(async () => [{
            request_id: 'kpr_1', status: 'pending_org_review', organization_id: 'org_a',
            project_code: 'brainbase', normalized_payload: { kind: 'decision' },
            personal_event_id: 'pke_private', sanitized_preview: 'private preview', body_hash: 'sha256:private'
        }]),
        saveNormalizedPromotion: vi.fn(async () => ({
            request_id: 'kpr_1', status: 'pending_org_review', normalized_payload_hash: 'sha256:abc'
        })),
        reviewOrganizationPromotion: vi.fn(async () => ({
            request_id: 'kpr_1', status: 'org_rejected', organization_review_receipt_id: 'pkor_1',
            personal_event_id: 'pke_private', sanitized_preview: 'private preview', body_hash: 'sha256:private'
        }))
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
    const attachAuthority = (req, _res, next) => {
        req.personalKnowledgePromotionAuthority = { operationId: 'op_test' };
        next();
    };
    app.use('/api/personal-knowledge', createPersonalKnowledgeRouter({
        personalKnowledgeService,
        promotionService,
        promotionAuthorityGuards: { request: attachAuthority, owner: attachAuthority, organization: attachAuthority }
    }));
    return { app, personalKnowledgeService, promotionService };
}

describe('personal knowledge routes', () => {
    it('fails closed when promotion authority guards are omitted', async () => {
        const personalKnowledgeService = {};
        const promotionService = { requestPromotion: vi.fn() };
        const app = express();
        app.use(express.json());
        app.use(createPersonalKnowledgeRouter({ personalKnowledgeService, promotionService }));
        await request(app).post('/events/pke_1/promotion-requests').send({}).expect(503, {
            error: 'personal_knowledge_promotion_authority_unavailable'
        });
        expect(promotionService.requestPromotion).not.toHaveBeenCalled();
    });
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

    it('exposes normalization, organization review queue, and decision as separate contracts', async () => {
        const { app, promotionService } = createApp();
        const normalizedPayload = {
            schema_version: 'personal_knowledge_normalized.v1',
            kind: 'decision',
            entity: { id: 'decision_1', type: 'decision', payload: { statement: '採用する' } },
            decision_domain: 'general'
        };

        const queue = await request(app)
            .get('/api/personal-knowledge/organization-reviews?limit=10')
            .expect(200);
        const normalization = await request(app)
            .put('/api/personal-knowledge/promotions/kpr_1/normalized-payload')
            .send({ normalized_payload: normalizedPayload })
            .expect(200);
        const decision = await request(app)
            .post('/api/personal-knowledge/promotions/kpr_1/organization-decision')
            .send({ decision: 'reject', reason: '局所的' })
            .expect(200);

        expect(queue.body.reviews).toHaveLength(1);
        expect(queue.body.reviews[0]).not.toHaveProperty('personal_event_id');
        expect(queue.body.reviews[0]).not.toHaveProperty('sanitized_preview');
        expect(queue.body.reviews[0]).not.toHaveProperty('body_hash');
        expect(normalization.body.normalized_payload_hash).toBe('sha256:abc');
        expect(decision.body.status).toBe('org_rejected');
        expect(decision.body.organization_review_receipt_id).toBe('pkor_1');
        expect(decision.body).not.toHaveProperty('personal_event_id');
        expect(decision.body).not.toHaveProperty('sanitized_preview');
        expect(decision.body).not.toHaveProperty('body_hash');
        expect(promotionService.listOrganizationReviews).toHaveBeenCalledWith(
            { limit: '10' },
            expect.objectContaining({ access: expect.objectContaining({ role: 'gm' }) })
        );
        expect(promotionService.saveNormalizedPromotion).toHaveBeenCalledWith(
            'kpr_1',
            { normalized_payload: normalizedPayload },
            expect.objectContaining({
                access: expect.objectContaining({ actorPersonId: 'person_a_auth' }),
                promotionAuthority: expect.objectContaining({ operationId: 'op_test' })
            })
        );
        expect(promotionService.reviewOrganizationPromotion).toHaveBeenCalledWith(
            'kpr_1',
            { decision: 'reject', reason: '局所的' },
            expect.any(Object)
        );
    });

    it('propagates promotion authorization status and structured quarantine details', async () => {
        const { app, promotionService } = createApp();
        promotionService.reviewOrganizationPromotion.mockRejectedValueOnce(
            Object.assign(new Error('personal_knowledge_graph_promotion_quarantined'), {
                status: 409,
                details: { reason: 'decision_authority_unverified' }
            })
        );

        const res = await request(app)
            .post('/api/personal-knowledge/promotions/kpr_1/organization-decision')
            .send({ decision: 'approve' })
            .expect(409);

        expect(res.body).toEqual({
            error: 'personal_knowledge_graph_promotion_quarantined',
            details: { reason: 'decision_authority_unverified' }
        });
    });
});
