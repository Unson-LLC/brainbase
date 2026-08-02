#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTENSIONS = new Set(['.js', '.mjs', '.py']);
const SELF = 'scripts/ontology-writer-inventory.js';
const WRITE_PATTERNS = [
    new RegExp(`(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+graph_${'(?:entities|edges)'}`, 'i'),
    new RegExp(`${'upsert' + 'Graph'}(?:Entity|Edge)`),
    new RegExp(`/api/info/graph/${'(?:entities|edges)'}`)
];

function walk(directory) {
    return readdirSync(directory).flatMap((name) => {
        const target = path.join(directory, name);
        return statSync(target).isDirectory() ? walk(target) : [target];
    });
}

export function verifyWriterInventory({ rootDir = process.cwd() } = {}) {
    const inventory = JSON.parse(readFileSync(path.join(rootDir, 'config/ontology/writer-inventory.json'), 'utf8'));
    const detected = new Set();
    for (const scope of ['server', 'scripts']) {
        for (const file of walk(path.join(rootDir, scope))) {
            if (!EXTENSIONS.has(path.extname(file))) continue;
            const relative = path.relative(rootDir, file);
            if (relative === SELF) continue;
            const source = readFileSync(file, 'utf8');
            if (WRITE_PATTERNS.some((pattern) => pattern.test(source))) detected.add(relative);
        }
    }
    const classified = new Set(Object.keys(inventory.writers || {}));
    const unclassified = [...detected].filter((file) => !classified.has(file)).sort();
    const missing = [...classified].filter((file) => !detected.has(file)).sort();
    if (unclassified.length || missing.length) {
        throw new Error(`Graph writer inventory mismatch: unclassified=[${unclassified.join(', ')}] missing=[${missing.join(', ')}]`);
    }
    return { writer_count: detected.size, writers: [...detected].sort() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        process.stdout.write(`${JSON.stringify(verifyWriterInventory())}\n`);
    } catch (error) {
        process.stderr.write(`ontology:inventory: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
