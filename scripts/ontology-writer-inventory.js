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
const NON_VOCABULARY_LITERALS = new Set(['all', 'entity', 'string', 'unknown']);

function walk(directory) {
    return readdirSync(directory).flatMap((name) => {
        const target = path.join(directory, name);
        return statSync(target).isDirectory() ? walk(target) : [target];
    });
}

function graphVocabulary(source, manifest) {
    const knownTypes = new Set(Object.keys(manifest.entity_types || {}));
    const knownRelations = new Set(Object.keys(manifest.relation_types || {}));
    const detectedTypes = new Set();
    const detectedRelations = new Set();
    const unknown = new Set();
    for (const line of source.split('\n')) {
        const typeContext = /entity_type|entityType|GRAPH_ENTITY_TYPES/.test(line);
        const relationContext = /rel_type|relType|RELATION_TYPES/.test(line);
        if (!typeContext && !relationContext) continue;
        for (const match of line.matchAll(/['"]([a-z][a-z0-9_]*)['"]/g)) {
            const value = match[1];
            if (typeContext && knownTypes.has(value)) detectedTypes.add(value);
            else if (relationContext && knownRelations.has(value)) detectedRelations.add(value);
            else if ((typeContext || relationContext) && !NON_VOCABULARY_LITERALS.has(value)) unknown.add(value);
        }
    }
    return { types: [...detectedTypes].sort(), relations: [...detectedRelations].sort(), unknown: [...unknown].sort() };
}

export function verifyWriterInventory({ rootDir = process.cwd() } = {}) {
    const inventory = JSON.parse(readFileSync(path.join(rootDir, 'config/ontology/writer-inventory.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(path.join(rootDir, 'config/ontology/releases/1.0.0.json'), 'utf8'));
    const detected = new Set();
    const vocabularyByWriter = {};
    for (const scope of ['server', 'scripts']) {
        for (const file of walk(path.join(rootDir, scope))) {
            if (!EXTENSIONS.has(path.extname(file))) continue;
            const relative = path.relative(rootDir, file);
            if (relative === SELF) continue;
            const source = readFileSync(file, 'utf8');
            if (WRITE_PATTERNS.some((pattern) => pattern.test(source))) {
                detected.add(relative);
                vocabularyByWriter[relative] = graphVocabulary(source, manifest);
            }
        }
    }
    const classified = new Set(Object.keys(inventory.writers || {}));
    const unclassified = [...detected].filter((file) => !classified.has(file)).sort();
    const missing = [...classified].filter((file) => !detected.has(file)).sort();
    const vocabularyErrors = [];
    for (const file of detected) {
        const classification = inventory.writers[file] || {};
        const actual = vocabularyByWriter[file];
        if (classification.mode === 'deferred') {
            if (!classification.reason) vocabularyErrors.push(`${file}: deferred writer requires reason`);
        }
        const declared = classification.vocabulary || {};
        for (const kind of ['types', 'relations']) {
            const known = new Set(Object.keys(kind === 'types' ? manifest.entity_types || {} : manifest.relation_types || {}));
            const values = Array.isArray(declared[kind]) ? declared[kind] : [];
            const invalid = values.filter((value) => !known.has(value));
            const undeclared = actual[kind].filter((value) => !values.includes(value));
            if (invalid.length) vocabularyErrors.push(`${file}: invalid ${kind}=[${invalid.join(', ')}]`);
            if (undeclared.length) vocabularyErrors.push(`${file}: undeclared ${kind}=[${undeclared.join(', ')}]`);
        }
        const classifiedLiterals = classification.classified_literals || {};
        const literalCategories = ['compatibility', 'internal', 'rejected'];
        const declaredLiterals = literalCategories.flatMap((category) => (
            Array.isArray(classifiedLiterals[category]) ? classifiedLiterals[category] : []
        ));
        const duplicateLiterals = declaredLiterals.filter((value, index) => declaredLiterals.indexOf(value) !== index);
        const unclassifiedLiterals = actual.unknown.filter((value) => !declaredLiterals.includes(value));
        const staleLiterals = declaredLiterals.filter((value) => !actual.unknown.includes(value));
        if (classification.mode === 'deferred') {
            for (const category of literalCategories) {
                if (!Array.isArray(classifiedLiterals[category])) {
                    vocabularyErrors.push(`${file}: deferred writer requires classified_literals.${category}`);
                }
            }
        }
        if (duplicateLiterals.length) vocabularyErrors.push(`${file}: duplicate classified literals=[${[...new Set(duplicateLiterals)].join(', ')}]`);
        if (unclassifiedLiterals.length) vocabularyErrors.push(`${file}: unknown graph vocabulary=[${unclassifiedLiterals.join(', ')}]`);
        if (staleLiterals.length) vocabularyErrors.push(`${file}: stale classified literals=[${staleLiterals.join(', ')}]`);
    }
    if (unclassified.length || missing.length || vocabularyErrors.length) {
        throw new Error(`Graph writer inventory mismatch: unclassified=[${unclassified.join(', ')}] missing=[${missing.join(', ')}] vocabulary=[${vocabularyErrors.join('; ')}]`);
    }
    return {
        writer_count: detected.size,
        writers: [...detected].sort(),
        vocabulary: vocabularyByWriter,
        classifications: Object.fromEntries(
            [...detected].sort().map((file) => [file, inventory.writers[file]])
        )
    };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        process.stdout.write(`${JSON.stringify(verifyWriterInventory())}\n`);
    } catch (error) {
        process.stderr.write(`ontology:inventory: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
