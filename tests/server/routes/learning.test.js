import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createLearningRouter } from '../../../server/routes/learning.js';

describe('learning routes', () => {
    let app;
    let service;
    let healthService;

    beforeEach(() => {
        service = {
            recordEpisode: vi.fn(async (payload) => ({ id: 'lep_1', ...payload })),
            proposePromotions: vi.fn(async () => [{ id: 'prm_1', pillar: 'wiki' }]),
            dedupeExistingPromotions: vi.fn(async () => ({ merged: 1, scanned: 3 })),
            listPromotions: vi.fn(async () => [{ id: 'prm_1', pillar: 'wiki', status: 'evaluated' }]),
            getPromotion: vi.fn(async () => ({ id: 'prm_1', pillar: 'wiki', status: 'evaluated' })),
            applyPromotion: vi.fn(async () => ({ success: true, candidate: { id: 'prm_1' } })),
            markPromotionRejected: vi.fn(async () => ({ success: true })),
            searchPersonalKgCandidates: vi.fn(async () => [{
                id: 'mem_1',
                cognitive_type: 'claim',
                body: 'AI駆動経営は判断とShipを経営進捗KPIにする。',
                confidence: 0.95,
                source_system: 'test',
                created_at: '2026-05-16T00:00:00.000Z'
            }]),
            promoteMemoryCandidateToGraph: vi.fn(async () => ({ success: true, entity: { id: 'mem_mem_1' } })),
            recordSkillUsage: vi.fn(async (payload) => ({ id: 'sul_1', ...payload })),
            listStaleSkills: vi.fn(async () => [{ skill_name: 'old', last_used_at: new Date(), uses: 1, stale_threshold_days: 90 }])
        };
        healthService = {
            getHealth: vi.fn(async () => ({ status: 'healthy' }))
        };

        app = express();
        app.use(express.json());
        app.use((req, _res, next) => {
            req.access = {
                personId: 'person_authenticated',
                organizationId: 'org_unson'
            };
            req.personalKnowledgeAccess = req.access;
            next();
        });
        app.use('/api/learning', createLearningRouter(service, healthService));
    });

    it('POST /episodes records an episode', async () => {
        const res = await request(app)
            .post('/api/learning/episodes')
            .send({ source_type: 'review', outcome: 'success', summary: '学習イベント' });

        expect(res.status).toBe(201);
        expect(service.recordEpisode).toHaveBeenCalled();
    });

    it('POST /promotions/propose proposes candidates', async () => {
        const res = await request(app).post('/api/learning/promotions/propose').send({ applyMode: 'manual' });

        expect(res.status).toBe(200);
        expect(res.body.candidates).toHaveLength(1);
        expect(service.proposePromotions).toHaveBeenCalledWith({ applyMode: 'manual' });
    });

    it('POST /promotions/dedupe-existing merges semantic duplicates', async () => {
        const res = await request(app).post('/api/learning/promotions/dedupe-existing');

        expect(res.status).toBe(200);
        expect(res.body.merged).toBe(1);
        expect(service.dedupeExistingPromotions).toHaveBeenCalled();
    });

    it('story-knowledge-formalization-language:AC-001 GET /promotions lists candidates by the existing promotion status contract', async () => {
        const res = await request(app).get('/api/learning/promotions?status=evaluated');

        expect(res.status).toBe(200);
        expect(service.listPromotions).toHaveBeenCalledWith({
            status: 'evaluated',
            pillar: undefined,
            apply_mode: undefined
        });
    });

    it('GET /promotions/:id returns one candidate', async () => {
        const res = await request(app).get('/api/learning/promotions/prm_1');

        expect(res.status).toBe(200);
        expect(service.getPromotion).toHaveBeenCalledWith('prm_1');
    });

    it('GET /memory-candidates/search forwards compound Personal KG query contract', async () => {
        const res = await request(app)
            .get('/api/learning/memory-candidates/search')
            .query({
                q: 'AI駆動経営 判断 Ship',
                cognitive_type: 'claim,insight',
                limit: '5'
            });

        expect(res.status).toBe(200);
        expect(res.body.candidates).toHaveLength(1);
        expect(res.body.candidates[0]).toMatchObject({
            id: 'mem_1',
            cognitive_type: 'claim'
        });
        expect(service.searchPersonalKgCandidates).toHaveBeenCalledWith({
            query: 'AI駆動経営 判断 Ship',
            ownerPersonId: 'person_authenticated',
            organizationId: 'org_unson',
            cognitiveTypes: ['claim', 'insight'],
            limit: '5'
        }, { access: expect.objectContaining({ personId: 'person_authenticated' }) });
    });

    it('POST /memory-candidates/:id/promote-to-graph is fail-closed without an auth guard', async () => {
        const res = await request(app)
            .post('/api/learning/memory-candidates/mem_1/promote-to-graph')
            .send({ actor_person_id: 'spoofed_person' });

        expect(res.status).toBe(503);
        expect(service.promoteMemoryCandidateToGraph).not.toHaveBeenCalled();
    });

    it('POST /memory-candidates/:id/promote-to-graph uses the authenticated actor', async () => {
        const authenticatedApp = express();
        authenticatedApp.use(express.json());
        authenticatedApp.use('/api/learning', createLearningRouter(service, healthService, {
            promoteToGraphAuthGuard: (req, _res, next) => {
                req.auth = { sub: 'person_authenticated' };
                req.access = { personId: 'person_authenticated' };
                next();
            }
        }));

        const res = await request(authenticatedApp)
            .post('/api/learning/memory-candidates/mem_1/promote-to-graph')
            .send({
                actor_person_id: 'spoofed_person',
                decision_owner_person_id: 'spoofed_owner',
                reason: 'approved'
            });

        expect(res.status).toBe(201);
        expect(service.promoteMemoryCandidateToGraph).toHaveBeenCalledWith('mem_1', {
            actor_person_id: 'person_authenticated',
            access: { personId: 'person_authenticated' },
            reason: 'approved'
        });
    });

    it('story-knowledge-formalization-language:AC-001 POST /promotions/:id/apply preserves the existing promotion API path', async () => {
        const res = await request(app).post('/api/learning/promotions/prm_1/apply');

        expect(res.status).toBe(200);
        expect(service.applyPromotion).toHaveBeenCalledWith('prm_1');
    });

    it('POST /promotions/:id/reject rejects one candidate', async () => {
        const res = await request(app)
            .post('/api/learning/promotions/prm_1/reject')
            .send({ reason: 'not useful' });

        expect(res.status).toBe(200);
        expect(service.markPromotionRejected).toHaveBeenCalledWith('prm_1', 'not useful');
    });

    it('GET /health returns learning job health', async () => {
        const res = await request(app).get('/api/learning/health');

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('healthy');
        expect(healthService.getHealth).toHaveBeenCalled();
    });

    it('POST /usage records skill usage', async () => {
        const res = await request(app)
            .post('/api/learning/usage')
            .send({ skill_name: 'commit', session_id: 'sess_1', turn_id: 'claude-1' });

        expect(res.status).toBe(201);
        expect(service.recordSkillUsage).toHaveBeenCalledWith({
            skill_name: 'commit',
            session_id: 'sess_1',
            turn_id: 'claude-1'
        });
    });

    it('GET /usage/stale returns stale skills', async () => {
        const res = await request(app).get('/api/learning/usage/stale?days=30');

        expect(res.status).toBe(200);
        expect(res.body.stale_skills).toHaveLength(1);
        expect(service.listStaleSkills).toHaveBeenCalledWith({ days: 30 });
    });
});
