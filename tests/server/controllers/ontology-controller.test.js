import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InfoSSOTController } from '../../../server/controllers/info-ssot-controller.js';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';
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
});
