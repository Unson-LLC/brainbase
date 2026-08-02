import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InfoSSOTService } from '../../../server/services/info-ssot-service.js';
import { OntologyRegistry } from '../../../server/services/ontology-registry.js';
import { verifyPublicationReceipt } from '../../../server/services/ontology-publication.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const registry = new OntologyRegistry({ rootDir });
const release = registry.resolve({ version: '1.0.0' });

afterEach(() => vi.unstubAllEnvs());

function authorityService({ accountable = true, decision = true, decisionOverrides = {} } = {}) {
    const inputBindings = {
        ontology_release_version: '1.0.0',
        ontology_release_digest: release.digest,
        ontology_source_commit_sha: 'a'.repeat(40),
        ontology_scope_entity_id: 'project:brainbase'
    };
    const client = {
        query: async (sql) => {
            const text = String(sql);
            if (text.includes("entity_type = 'decision'")) return { rows: decision ? [{ payload: { ...inputBindings, ...decisionOverrides } }] : [] };
            if (text.includes("entity_type IN ('raci'")) return { rows: accountable ? [{ '?column?': 1 }] : [] };
            return { rows: [] };
        },
        release: () => {}
    };
    return new InfoSSOTService({ registry, ontologyRegistry: registry, pool: { connect: async () => client } });
}

function request() {
    return {
        release_version: '1.0.0',
        source_commit_sha: 'a'.repeat(40),
        release_digest: release.digest,
        decision_id: 'decision:ontology-v1',
        scope_entity_id: 'project:brainbase',
        applier_entity_id: 'person:applier'
    };
}

describe('Ontology publication authority', () => {
    it('binds Graph authority facts into a verifiable Ed25519 receipt', async () => {
        const { privateKey, publicKey } = generateKeyPairSync('ed25519');
        vi.stubEnv('ONTOLOGY_RECEIPT_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
        vi.stubEnv('ONTOLOGY_RECEIPT_KEY_ID', 'ontology-test-key');
        const receipt = await authorityService().authorizeOntologyPublication({
            role: 'gm', projectCodes: ['brainbase'], clearance: ['internal'], personId: 'person:applier'
        }, request());
        expect(receipt).toMatchObject({ signature_algorithm: 'ed25519', key_id: 'ontology-test-key' });
        expect(receipt.payload).toMatchObject({
            actor_entity_id: 'person:applier',
            applier_entity_id: 'person:applier',
            scope_entity_id: 'project:brainbase',
            release_version: '1.0.0'
        });
        expect(verifyPublicationReceipt(receipt, publicKey.export({ type: 'spki', format: 'pem' }))).toBe(true);
    });

    it('requires the accepted scope and applier request bindings', async () => {
        const publicationRequest = request();
        delete publicationRequest.scope_entity_id;
        delete publicationRequest.applier_entity_id;
        await expect(authorityService().authorizeOntologyPublication({
            role: 'gm', projectCodes: ['brainbase'], clearance: ['internal'], personId: 'person:applier'
        }, publicationRequest)).rejects.toMatchObject({
            code: 'ONTOLOGY_PUBLICATION_INPUT_INVALID',
            details: { missing: ['scope_entity_id', 'applier_entity_id'], http_status: 400 }
        });
    });

    it('rejects self-declared applier and missing Accountable authority', async () => {
        const { privateKey } = generateKeyPairSync('ed25519');
        vi.stubEnv('ONTOLOGY_RECEIPT_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
        vi.stubEnv('ONTOLOGY_RECEIPT_KEY_ID', 'ontology-test-key');
        await expect(authorityService().authorizeOntologyPublication({
            role: 'gm', projectCodes: ['brainbase'], clearance: ['internal'], personId: 'person:other'
        }, request())).rejects.toMatchObject({ code: 'ONTOLOGY_PUBLICATION_FORBIDDEN', details: { http_status: 403 } });
        await expect(authorityService({ accountable: false }).authorizeOntologyPublication({
            role: 'gm', projectCodes: ['brainbase'], clearance: ['internal'], personId: 'person:applier'
        }, request())).rejects.toMatchObject({ code: 'ONTOLOGY_PUBLICATION_FORBIDDEN', details: { http_status: 403 } });
    });

    it('rejects missing Decisions and Decision or scope binding mismatches', async () => {
        const { privateKey } = generateKeyPairSync('ed25519');
        vi.stubEnv('ONTOLOGY_RECEIPT_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
        vi.stubEnv('ONTOLOGY_RECEIPT_KEY_ID', 'ontology-test-key');
        const access = { role: 'gm', projectCodes: ['brainbase'], clearance: ['internal'], personId: 'person:applier' };

        await expect(authorityService({ decision: false }).authorizeOntologyPublication(access, request()))
            .rejects.toMatchObject({ code: 'ONTOLOGY_PUBLICATION_DECISION_NOT_FOUND', details: { http_status: 404 } });
        await expect(authorityService({ decisionOverrides: { ontology_release_digest: 'mismatch' } }).authorizeOntologyPublication(access, request()))
            .rejects.toMatchObject({ code: 'ONTOLOGY_PUBLICATION_BINDING_MISMATCH', details: { http_status: 409 } });
        await expect(authorityService().authorizeOntologyPublication(access, { ...request(), scope_entity_id: 'project:other' }))
            .rejects.toMatchObject({ code: 'ONTOLOGY_PUBLICATION_BINDING_MISMATCH', details: { http_status: 409 } });
    });
});
