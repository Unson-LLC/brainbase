/**
 * Info SSOT Routes
 * 情報SSOT（Decision/RACI/Events）のルーティング定義
 */
import express from 'express';
import { InfoSSOTController } from '../controllers/info-ssot-controller.js';

export function createInfoSSOTRouter(infoSSOTService) {
    const router = express.Router();
    const controller = new InfoSSOTController(infoSSOTService);

    // Read (Graph SSOT only)
    router.get('/graph/entities', controller.listGraphEntities);
    router.get('/graph/edges', controller.listGraphEdges);
    router.get('/graph/expand', controller.expandGraph);

    // Write
    router.post('/events', controller.createEvent);
    router.post('/decisions', controller.createDecision);
    router.post('/raci', controller.createRaci);
    router.post('/ai/query', controller.createAiQuery);
    router.post('/ai/decision-log', controller.createAiDecisionLog);

    return router;
}
