/**
 * Info SSOT Routes
 * 情報SSOT（Decision/RACI/Events）のルーティング定義
 */
import express from 'express';
import { InfoSSOTController } from '../controllers/info-ssot-controller.js';

export function createInfoSSOTRouter(infoSSOTService, { auditTenantGuard = (_req, _res, next) => next() } = {}) {
    const router = express.Router();
    const controller = new InfoSSOTController(infoSSOTService);

    // Ontology contract (explicit version/as-of remains available before current publication)
    router.get('/ontology', controller.getOntology);
    router.get('/ontology/releases/:version', controller.getOntologyRelease);
    router.get('/ontology/types/:id', controller.getOntologyType);
    router.get('/ontology/relations/:id', controller.getOntologyRelation);
    router.post('/ontology/validate', controller.validateOntology);
    router.post('/ontology/infer/decisions', controller.inferOntology);
    router.post('/ontology/infer', controller.inferOntology);
    router.post('/ontology/impact', controller.impactOntology);
    router.post('/ontology/audit', auditTenantGuard, controller.auditOntology);
    router.post('/ontology/graph/commit', controller.commitOntologyGraph);
    router.post('/ontology/publications/authorize', controller.authorizeOntologyPublication);

    // Read (Graph SSOT only)
    router.get('/graph/entities', controller.listGraphEntities);
    router.get('/graph/edges', controller.listGraphEdges);
    router.get('/graph/expand', controller.expandGraph);
    router.get('/context', controller.getContext);
    router.get('/person/by-slack', controller.getPersonBySlack);

    // Write
    router.post('/graph/entities', controller.upsertGraphEntity);
    router.post('/graph/edges', controller.upsertGraphEdge);
    router.post('/graph/maintenance/snapshots', controller.exportGraphSnapshot);
    router.post('/graph/maintenance/human-gate-receipts', controller.recordGraphHumanGateReceipt);
    router.post('/graph/maintenance/plans', controller.planGraphMutations);
    router.post('/graph/maintenance/plans/:planId/apply', controller.applyGraphPlan);
    router.get('/graph/maintenance/plans/:planId/receipt', controller.getGraphPlanReceipt);
    router.post('/graph/maintenance/plans/:planId/rollback', controller.rollbackGraphPlan);
    router.post('/graph/maintenance/validate', controller.validateGraphMaintenance);
    router.post('/events', controller.createEvent);
    router.post('/decisions', controller.createDecision);
    router.post('/raci', controller.createRaci);
    router.post('/glossary', controller.createGlossaryTerm);
    router.post('/kpi', controller.createKpi);
    router.post('/initiative', controller.createInitiative);
    router.post('/ai/query', controller.createAiQuery);
    router.post('/ai/decision-log', controller.createAiDecisionLog);

    return router;
}
