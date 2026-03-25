import express from 'express';
import { LearningController } from '../controllers/learning-controller.js';

export function createLearningRouter(learningService) {
    const router = express.Router();
    const controller = new LearningController(learningService);

    router.post('/episodes', controller.recordEpisode);
    router.post('/promotions/propose', controller.proposePromotions);
    router.get('/promotions', controller.listPromotions);
    router.post('/promotions/:id/applied', controller.markApplied);

    return router;
}
