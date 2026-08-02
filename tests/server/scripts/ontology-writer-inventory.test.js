import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyWriterInventory } from '../../../scripts/ontology-writer-inventory.js';

const roots = [];

function fixture({ source, vocabulary }) {
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
        writers: {
            'server/writer.js': {
                mode: 'runtime_guarded',
                reason: 'fixture',
                vocabulary
            }
        }
    }));
    return root;
}

afterEach(() => {
    while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true });
});

describe('ontology writer inventory vocabulary contract', () => {
    it('accepts writer literals classified by the manifest', () => {
        const rootDir = fixture({
            source: "upsertGraphEntity({ entityType: 'app' }); upsertGraphEdge({ relType: 'owned_by' });",
            vocabulary: { types: ['app'], relations: ['owned_by'] }
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
});
