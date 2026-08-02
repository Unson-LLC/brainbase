import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InfoSSOTController } from '../../../server/controllers/info-ssot-controller.js';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';
import { OntologyError } from '../../../server/services/ontology-kernel.js';
import { OntologyRegistry } from '../../../server/services/ontology-registry.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function createController() {
    return new InfoSSOTController(new InfoSSOTService({ ontologyRegistry: new OntologyRegistry({ rootDir }) }));
}

function responseRecorder() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

describe('InfoSSOTController ontology endpoints', () => {
    const access = { role: 'member', projectCodes: ['brainbase'], clearance: ['internal'] };

    it('requires the existing Info SSOT access context', async () => {
        const res = responseRecorder();
        await createController().getOntology({ query: {}, get: () => null }, res);
        expect(res.statusCode).toBe(400);
    });

    it('returns 404 with a stable code when current is unavailable', async () => {
        const res = responseRecorder();
        await createController().getOntology({ query: {}, access }, res);
        expect(res.statusCode).toBe(404);
        expect(res.body).toMatchObject({ code: 'ONTOLOGY_CURRENT_UNAVAILABLE' });
    });

    it('returns the proposed release when version is explicit', async () => {
        const res = responseRecorder();
        await createController().getOntology({ query: { version: '1.0.0' }, access }, res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ version: '1.0.0', effective_status: 'proposed' });
    });

    it('returns 503 for a versionless validation before current publication', async () => {
        const res = responseRecorder();
        await createController().validateOntology({ body: { snapshot: { entities: [], edges: [] } }, access }, res);
        expect(res.statusCode).toBe(503);
        expect(res.body).toMatchObject({ code: 'ONTOLOGY_CURRENT_UNAVAILABLE' });
    });

    it('returns 503 for atomic commit and DB audit while current is unavailable', async () => {
        for (const [method, body] of [
            ['commitOntologyGraph', { entity: {}, projectCode: 'brainbase' }],
            ['auditOntology', {}]
        ]) {
            const res = responseRecorder();
            await createController()[method]({ access, body }, res);
            expect(res.statusCode).toBe(503);
            expect(res.body).toMatchObject({ code: 'ONTOLOGY_CURRENT_UNAVAILABLE' });
        }
    });

    it('adds inactive_no_current to every dedicated legacy writer response', async () => {
        const writers = ['createDecision', 'createRaci', 'createGlossaryTerm', 'createKpi', 'createInitiative', 'createAiQuery', 'createAiDecisionLog'];
        const service = {
            getOntologyGuard: () => ({ guard_status: 'inactive_no_current', ontology_version: null })
        };
        for (const writer of writers) service[writer] = async () => ({ entity_id: `${writer}:1` });
        const controller = new InfoSSOTController(service);
        for (const writer of writers) {
            const res = responseRecorder();
            await controller[writer]({ body: {}, access }, res);
            expect(res.body, writer).toMatchObject({
                entity_id: `${writer}:1`,
                guard_status: 'inactive_no_current',
                ontology_version: null
            });
        }
    });

    it('preserves structured ontology violations for generic Graph writes', async () => {
        const violation = new OntologyError('ONTOLOGY_VALIDATION_FAILED', 'Ontology validation failed', {
            violations: [{ rule_id: 'relation-endpoint-owns', message: 'owns requires org -> app' }]
        });
        const missingEndpoint = new OntologyError('ONTOLOGY_EDGE_ENDPOINT_NOT_FOUND', 'Ontology edge endpoint not found', {
            missing_endpoint_ids: ['entity:missing']
        });
        const controller = new InfoSSOTController({
            createOrUpdateGraphEntity: async () => { throw violation; },
            createOrUpdateGraphEdge: async () => { throw missingEndpoint; }
        });

        const entityRes = responseRecorder();
        await controller.upsertGraphEntity({ body: {}, access }, entityRes);
        expect(entityRes.statusCode).toBe(400);
        expect(entityRes.body).toMatchObject({
            code: 'ONTOLOGY_VALIDATION_FAILED',
            details: {
                violations: [{ rule_id: 'relation-endpoint-owns', message: 'owns requires org -> app' }]
            }
        });

        const edgeRes = responseRecorder();
        await controller.upsertGraphEdge({ body: {}, access }, edgeRes);
        expect(edgeRes.statusCode).toBe(400);
        expect(edgeRes.body).toMatchObject({
            code: 'ONTOLOGY_EDGE_ENDPOINT_NOT_FOUND',
            details: { missing_endpoint_ids: ['entity:missing'] }
        });
    });
});
