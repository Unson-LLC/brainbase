import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createLearningRouter } from '../../../server/routes/learning.js';

describe('learning routes', () => {
    let app;
    let service;

    beforeEach(() => {
        service = {
            recordEpisode: vi.fn(async (payload) => ({ id: 'lep_1', ...payload })),
            proposePromotions: vi.fn(async () => [{ id: 'prm_1', pillar: 'wiki' }]),
            listPromotions: vi.fn(async () => [{ id: 'prm_1', pillar: 'wiki', status: 'evaluated' }]),
            markPromotionApplied: vi.fn(async () => ({ success: true }))
        };

        app = express();
        app.use(express.json());
        app.use('/api/learning', createLearningRouter(service));
    });

    it('POST /episodes records an episode', async () => {
        const res = await request(app)
            .post('/api/learning/episodes')
            .send({ source_type: 'review', outcome: 'success', summary: '学習イベント' });

        expect(res.status).toBe(201);
        expect(service.recordEpisode).toHaveBeenCalled();
    });

    it('POST /promotions/propose proposes candidates', async () => {
        const res = await request(app).post('/api/learning/promotions/propose').send({});

        expect(res.status).toBe(200);
        expect(res.body.candidates).toHaveLength(1);
    });

    it('GET /promotions lists candidates by status', async () => {
        const res = await request(app).get('/api/learning/promotions?status=evaluated');

        expect(res.status).toBe(200);
        expect(service.listPromotions).toHaveBeenCalledWith({
            status: 'evaluated',
            pillar: undefined,
            apply_mode: undefined
        });
    });
});
