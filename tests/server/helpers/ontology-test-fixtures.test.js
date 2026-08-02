import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OntologyRegistry } from '../../../server/services/ontology-registry.js';
import { createProposedOntologyFixture, createSignedActiveOntologyFixture } from '../../helpers/ontology-test-fixtures.js';

const sourceRoot = path.resolve(import.meta.dirname, '../../..');
const fixtures = [];

afterEach(() => {
    for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

describe('ontology test fixtures', () => {
    it('isolates the historical proposed lifecycle from the repository publication state', () => {
        const fixture = createProposedOntologyFixture(sourceRoot);
        fixtures.push(fixture);
        const index = JSON.parse(readFileSync(path.join(fixture.configDir, 'index.json'), 'utf8'));
        const entry = index.releases.find(({ version }) => version === '1.0.0');

        expect(index.current).toBeNull();
        expect(entry).toMatchObject({ status: 'proposed' });
        expect(entry).not.toHaveProperty('receipt_path');
        expect(existsSync(path.join(fixture.configDir, 'publications'))).toBe(false);
        expect(existsSync(path.join(fixture.configDir, 'brainbase-ontology.v1.json'))).toBe(false);
    });

    it('creates an independently signed active release without ambient keys', () => {
        const fixture = createSignedActiveOntologyFixture(sourceRoot);
        fixtures.push(fixture);
        const registry = new OntologyRegistry({ rootDir: fixture.rootDir, publicKeyPem: fixture.publicKeyPem });

        expect(registry.resolve().kernel.describe()).toMatchObject({
            version: '1.0.0',
            effective_status: 'active'
        });
    });
});
