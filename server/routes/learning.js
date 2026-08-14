import express from 'express';
import { LearningController } from '../controllers/learning-controller.js';

export function createLearningRouter(learningService, learningHealthService = null, options = {}) {
    const router = express.Router();
    const controller = new LearningController(learningService, learningHealthService, options);
    const promoteToGraphAuthGuard = typeof options.promoteToGraphAuthGuard === 'function'
        ? options.promoteToGraphAuthGuard
        : (_req, res) => res.status(503).json({ error: 'Learning Graph promotion auth guard not configured' });

    router.post('/episodes', controller.recordEpisode);
    router.post('/promotions/propose', controller.proposePromotions);
    router.post('/promotions/dedupe-existing', controller.dedupeExistingPromotions);
    router.get('/promotions', controller.listPromotions);
    router.post('/memory-candidates', controller.createMemoryCandidate);
    router.get('/memory-candidates/search', controller.searchPersonalKg);
    router.get('/memory-candidates', controller.listMemoryCandidates);
    router.post('/memory-candidates/:id/classify', controller.classifyMemoryCandidate);
    router.post('/memory-candidates/:id/approve', controller.approveMemoryCandidate);
    router.post('/memory-candidates/:id/reject', controller.rejectMemoryCandidate);
    router.post('/memory-candidates/:id/expire', controller.expireMemoryCandidate);
    router.post(
        '/memory-candidates/:id/promote-to-graph',
        promoteToGraphAuthGuard,
        controller.promoteMemoryCandidateToGraph
    );
    router.get('/health', controller.getHealth);
    router.get('/promotions/:id', controller.getPromotion);
    router.post('/promotions/:id/apply', controller.markApplied);
    router.post('/promotions/:id/reject', controller.rejectPromotion);
    router.post('/promotions/:id/applied', controller.markApplied);
    router.post('/usage', controller.recordSkillUsage);
    router.get('/usage/stale', controller.listStaleSkills);

    return router;
}
