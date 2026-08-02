import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OntologyError } from '../../../server/services/ontology-kernel.js';
import { OntologyRegistry } from '../../../server/services/ontology-registry.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('OntologyRegistry', () => {
    it('loads the immutable proposed release and verifies its digest', () => {
        const registry = new OntologyRegistry({ rootDir });
        const release = registry.resolve({ version: '1.0.0' });
        expect(release.kernel.describe()).toMatchObject({ version: '1.0.0', effective_status: 'proposed' });
        expect(release.digest).toMatch(/^[a-f0-9]{64}$/);
    });

    it('fails visibly when no current ontology exists', () => {
        const registry = new OntologyRegistry({ rootDir });
        expect(() => registry.resolve()).toThrowError(expect.objectContaining({ code: 'ONTOLOGY_CURRENT_UNAVAILABLE' }));
    });

    it('resolves as-of history only from an immutable published release', () => {
        const registry = new OntologyRegistry({ rootDir });
        expect(() => registry.resolve({ asOf: '2026-08-01T00:00:00.000Z' })).toThrowError(expect.objectContaining({
            code: 'ONTOLOGY_VERSION_UNKNOWN'
        }));
        registry.index.releases[0].receipt_path = 'receipts/1.0.0.json';
        expect(registry.resolve({ asOf: '2026-08-01T00:00:00.000Z' }).kernel.version).toBe('1.0.0');
        expect(() => registry.resolve({ asOf: '2026-07-31T23:59:59.999Z' })).toThrow(OntologyError);
    });

    it('does not trust a retired status without an immutable publication receipt', () => {
        const registry = new OntologyRegistry({ rootDir });
        registry.index.releases[0].status = 'retired';
        expect(() => registry.resolve({ asOf: '2026-08-02T00:00:00.000Z' })).toThrowError(expect.objectContaining({
            code: 'ONTOLOGY_VERSION_UNKNOWN'
        }));
    });

    it('derives proposed, approved, active, and retired lifecycle states from index evidence', () => {
        const registry = new OntologyRegistry({ rootDir });
        expect(registry.resolve({ version: '1.0.0' }).kernel.status).toBe('proposed');

        registry.index.releases[0].receipt_path = 'receipts/1.0.0.json';
        expect(registry.resolve({ version: '1.0.0' }).kernel.status).toBe('approved');

        registry.index.current = '1.0.0';
        expect(registry.resolve({ version: '1.0.0' }).kernel.status).toBe('active');

        registry.index.current = null;
        registry.index.releases[0].status = 'retired';
        expect(registry.resolve({ version: '1.0.0' }).kernel.status).toBe('retired');
    });

    it('interprets historical facts with their recorded ontology version', () => {
        const registry = new OntologyRegistry({ rootDir });
        const result = registry.interpretHistory({
            ontology_version: '1.0.0',
            entities: [{ id: 'org:legacy', type: 'org' }],
            evolution_events: [{
                event_id: 'ontology:rename:org:unson',
                event_type: 'ontology_rename',
                ontology_version: '1.0.0',
                canonical_id: 'org:unson',
                source_ids: ['org:legacy'],
                provenance: ['decision:rename'],
                effective_at: '2026-08-02T00:00:00.000Z'
            }]
        }, { asOf: '2026-08-03T00:00:00.000Z' });
        expect(result).toMatchObject({
            ontology_version: '1.0.0',
            recorded_ontology_version: '1.0.0',
            entities: [{ canonical_id: 'org:unson' }]
        });
    });

    it('falls back to the immutable as-of release when the fact has no recorded version', () => {
        const registry = new OntologyRegistry({ rootDir });
        registry.index.releases[0].receipt_path = 'receipts/1.0.0.json';
        expect(registry.interpretHistory({ entities: [{ id: 'org:legacy', type: 'org' }] }, {
            asOf: '2026-08-03T00:00:00.000Z'
        })).toMatchObject({
            ontology_version: '1.0.0',
            recorded_ontology_version: null,
            resolved_ontology_version: '1.0.0',
            verification: 'verified'
        });
    });

    it('returns structured unverified history when neither version nor as-of release can be resolved', () => {
        const registry = new OntologyRegistry({ rootDir });
        expect(registry.interpretHistory({ entities: [{ id: 'org:legacy', type: 'org' }] }, {
            asOf: '2026-08-03T00:00:00.000Z'
        })).toMatchObject({
            ontology_version: null,
            recorded_ontology_version: null,
            resolved_ontology_version: null,
            verification: 'unverified',
            unverified_reason: {
                code: 'ONTOLOGY_VERSION_UNKNOWN'
            },
            entities: [{ id: 'org:legacy', type: 'org' }]
        });
    });
});
