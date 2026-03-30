import express from 'express';
import { LearningController } from '../controllers/learning-controller.js';

export function createLearningRouter(learningService, learningHealthService = null) {
    const router = express.Router();
    const controller = new LearningController(learningService, learningHealthService);

    router.post('/episodes', controller.recordEpisode);
    router.post('/promotions/propose', controller.proposePromotions);
    router.post('/promotions/dedupe-existing', controller.dedupeExistingPromotions);
    router.get('/promotions', controller.listPromotions);
    router.get('/health', controller.getHealth);
    router.get('/promotions/:id', controller.getPromotion);
    router.post('/promotions/:id/apply', controller.markApplied);
    router.post('/promotions/:id/reject', controller.rejectPromotion);
    router.post('/promotions/:id/applied', controller.markApplied);

    return router;
}
