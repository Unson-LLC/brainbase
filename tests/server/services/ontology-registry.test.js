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

    it('rejects implicit historical resolution until a current release exists', () => {
        const registry = new OntologyRegistry({ rootDir });
        expect(() => registry.resolve({ asOf: '2026-08-01T00:00:00.000Z' })).toThrowError(expect.objectContaining({
            code: 'ONTOLOGY_CURRENT_UNAVAILABLE'
        }));
        registry.index.current = '1.0.0';
        expect(registry.resolve({ asOf: '2026-08-01T00:00:00.000Z' }).kernel.version).toBe('1.0.0');
        expect(() => registry.resolve({ asOf: '2026-07-31T23:59:59.999Z' })).toThrow(OntologyError);
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
});
