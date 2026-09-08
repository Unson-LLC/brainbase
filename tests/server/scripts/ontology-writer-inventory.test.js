import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyWriterInventory } from '../../../scripts/ontology-writer-inventory.js';

const roots = [];

function fixture({ source, vocabulary, mode = 'runtime_guarded', classifiedLiterals, graphHttpMutationOwners = [] }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-writer-inventory-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'server'), { recursive: true });
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(root, 'config/ontology/releases'), { recursive: true });
    fs.writeFileSync(path.join(root, 'server/writer.js'), source);
    fs.writeFileSync(path.join(root, 'config/ontology/releases/1.0.0.json'), JSON.stringify({
        entity_types: { app: {}, org: {} },
        relation_types: { owned_by: {} }
    }));
    fs.writeFileSync(path.join(root, 'config/ontology/writer-inventory.json'), JSON.stringify({
        graph_http_mutation_owners: graphHttpMutationOwners,
        writers: {
            'server/writer.js': {
                mode,
                reason: 'fixture',
                vocabulary,
                ...(classifiedLiterals ? { classified_literals: classifiedLiterals } : {})
            }
        }
    }));
    return root;
}

afterEach(() => {
    while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

describe('ontology writer inventory vocabulary contract', () => {
    it('classifies every Graph maintenance service vocabulary literal in the repository manifest', () => {
        expect(verifyWriterInventory({ rootDir: process.cwd() })).toMatchObject({
            classifications: {
                'server/services/graph-maintenance-service.js': {
                    mode: 'runtime_guarded',
                    vocabulary: {
                        types: expect.arrayContaining(['decision', 'person', 'product', 'project']),
                        relations: expect.arrayContaining(['governs', 'member_of'])
                    }
                }
            }
        });
    });

    it('accepts writer literals classified by the manifest', () => {
        const rootDir = fixture({
            source: "upsertGraphEntity({ entityType: 'app' }); upsertGraphEdge({ relType: 'owned_by' });",
            vocabulary: { types: ['app'], relations: ['owned_by'] }
        });
        expect(verifyWriterInventory({ rootDir })).toMatchObject({ writer_count: 1 });
    });

    it('classifies indirect writers that call the guarded InfoSSOT methods', () => {
        const rootDir = fixture({
            source: "infoSSOTService.createOrUpdateGraphEntity(access, { entityType: 'org' });",
            vocabulary: { types: ['org'], relations: [] }
        });
        expect(verifyWriterInventory({ rootDir })).toMatchObject({ writer_count: 1 });
    });

    it('fails when a classified writer adds an unknown or undeclared vocabulary literal', () => {
        const unknownRoot = fixture({
            source: "upsertGraphEntity({ entityType: 'unregistered_type' });",
            vocabulary: { types: [], relations: [] }
        });
        expect(() => verifyWriterInventory({ rootDir: unknownRoot })).toThrow('unknown graph vocabulary=[unregistered_type]');

        const undeclaredRoot = fixture({
            source: "upsertGraphEntity({ entityType: 'app' });",
            vocabulary: { types: [], relations: [] }
        });
        expect(() => verifyWriterInventory({ rootDir: undeclaredRoot })).toThrow('undeclared types=[app]');
    });

    it('requires deferred writers to classify every non-canonical literal', () => {
        const unclassifiedRoot = fixture({
            source: "upsertGraphEntity({ entityType: 'legacy_person' });",
            mode: 'deferred',
            vocabulary: { types: [], relations: [] },
            classifiedLiterals: { compatibility: [], internal: [], rejected: [] }
        });
        expect(() => verifyWriterInventory({ rootDir: unclassifiedRoot })).toThrow('unknown graph vocabulary=[legacy_person]');

        const classifiedRoot = fixture({
            source: "upsertGraphEntity({ entityType: 'legacy_person' });",
            mode: 'deferred',
            vocabulary: { types: [], relations: [] },
            classifiedLiterals: { compatibility: ['legacy_person'], internal: [], rejected: [] }
        });
        expect(verifyWriterInventory({ rootDir: classifiedRoot })).toMatchObject({
            writer_count: 1,
            classifications: {
                'server/writer.js': {
                    mode: 'deferred',
                    classified_literals: { compatibility: ['legacy_person'], internal: [], rejected: [] }
                }
            }
        });
    });

    it('rejects direct Graph HTTP mutations outside the declared owner module', () => {
        const rootDir = fixture({
            source: [
                "const graphPath = '/api/info/graph/' + 'entities';",
                "fetch(`https://bb.unson.jp${graphPath}`, { method: 'POST' });"
            ].join('\n'),
            vocabulary: { types: [], relations: [] },
            graphHttpMutationOwners: ['scripts/lib/brainbase-graph-http-client.mjs']
        });
        expect(() => verifyWriterInventory({ rootDir }))
            .toThrow('unauthorized Graph HTTP mutation owners=[server/writer.js]');
    });

    it('rejects a Graph mutation whose request options are stored in a variable', () => {
        const rootDir = fixture({
            source: [
                "const endpoint = '/api/info/graph/entities';",
                "const requestOptions = { method: 'POST' };",
                'fetch(endpoint, requestOptions);'
            ].join('\n'),
            vocabulary: { types: [], relations: [] }
        });
        expect(() => verifyWriterInventory({ rootDir }))
            .toThrow('unauthorized Graph HTTP mutation owners=[server/writer.js]');
    });

    it('rejects direct Graph edge mutations outside the declared owner module', () => {
        const rootDir = fixture({
            source: "fetch('/api/info/graph/edges', { method: 'POST' });",
            vocabulary: { types: [], relations: [] }
        });
        expect(() => verifyWriterInventory({ rootDir }))
            .toThrow('unauthorized Graph HTTP mutation owners=[server/writer.js]');
    });

    it('fails closed when an unresolved spread can override a known safe method', () => {
        const rootDir = fixture({
            source: [
                "const endpoint = '/api/info/graph/entities';",
                "const requestOptions = { method: 'GET', ...runtimeOptions };",
                'fetch(endpoint, requestOptions);'
            ].join('\n'),
            vocabulary: { types: [], relations: [] }
        });
        expect(() => verifyWriterInventory({ rootDir }))
            .toThrow('unauthorized Graph HTTP mutation owners=[server/writer.js]');
    });

    it('allows a known safe method that overrides an earlier unresolved spread', () => {
        const rootDir = fixture({
            source: [
                "const endpoint = '/api/info/graph/entities';",
                "const requestOptions = { ...runtimeOptions, method: 'GET' };",
                'fetch(endpoint, requestOptions);'
            ].join('\n'),
            vocabulary: { types: [], relations: [] }
        });
        expect(verifyWriterInventory({ rootDir })).toMatchObject({ writer_count: 1 });
    });

    it('rejects a mutation inherited through a known options spread', () => {
        const rootDir = fixture({
            source: [
                "const endpoint = '/api/info/graph/entities';",
                "const knownPostOptions = { method: 'POST' };",
                'const requestOptions = { ...knownPostOptions };',
                'fetch(endpoint, requestOptions);'
            ].join('\n'),
            vocabulary: { types: [], relations: [] }
        });
        expect(() => verifyWriterInventory({ rootDir }))
            .toThrow('unauthorized Graph HTTP mutation owners=[server/writer.js]');
    });

    it('fails closed when a shorthand method cannot be resolved', () => {
        const rootDir = fixture({
            source: [
                "const endpoint = '/api/info/graph/entities';",
                'const method = runtimeMethod;',
                'fetch(endpoint, { method });'
            ].join('\n'),
            vocabulary: { types: [], relations: [] }
        });
        expect(() => verifyWriterInventory({ rootDir }))
            .toThrow('unauthorized Graph HTTP mutation owners=[server/writer.js]');
    });

    it('resolves a safe shorthand GET method', () => {
        const rootDir = fixture({
            source: [
                "const endpoint = '/api/info/graph/entities';",
                "const method = 'GET';",
                'fetch(endpoint, { method });'
            ].join('\n'),
            vocabulary: { types: [], relations: [] }
        });
        expect(() => verifyWriterInventory({ rootDir })).not.toThrow();
    });

    it.each([
        "globalThis.fetch('/api/info/graph/entities', { method: 'POST' });",
        "axios.post('/api/info/graph/entities', { id: 'app_mana' });",
        "const endpoint = new URL('/api/info/graph/entities', baseUrl); fetch(endpoint, { method: 'POST' });"
    ])('rejects alternate direct Graph mutation calls: %s', (source) => {
        const rootDir = fixture({ source, vocabulary: { types: [], relations: [] } });
        expect(() => verifyWriterInventory({ rootDir }))
            .toThrow('unauthorized Graph HTTP mutation owners=[server/writer.js]');
    });

    it('fails closed when a computed option can hide the HTTP method', () => {
        const rootDir = fixture({
            source: [
                "const endpoint = '/api/info/graph/entities';",
                "fetch(endpoint, { [runtimeKey]: 'POST' });"
            ].join('\n'),
            vocabulary: { types: [], relations: [] }
        });
        expect(() => verifyWriterInventory({ rootDir }))
            .toThrow('unauthorized Graph HTTP mutation owners=[server/writer.js]');
    });

    it('runs the writer inventory for pull requests targeting develop', () => {
        const workflow = fs.readFileSync(path.resolve('.github/workflows/graph-writer-contract.yml'), 'utf8');
        expect(workflow).toContain('pull_request:');
        expect(workflow).toContain('- develop');
        expect(workflow).toContain('runs-on: [self-hosted, Linux, X64, wsl-linux]');
        expect(workflow).toContain('- 5432');
        expect(workflow).toContain("${{ job.services.postgres.ports['5432'] }}");
        expect(workflow).toContain('npm run ontology:inventory');
    });
});
