#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const EXTENSIONS = new Set(['.js', '.mjs', '.py']);
const SELF = 'scripts/ontology-writer-inventory.js';
const WRITE_PATTERNS = [
    new RegExp(`(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+graph_${'(?:entities|edges)'}`, 'i'),
    new RegExp(`${'upsert' + 'Graph'}(?:Entity|Edge)`),
    new RegExp(`createOrUpdate${'Graph'}(?:Entity|Edge)`),
    new RegExp(`createBrainbase${'Graph'}HttpClient`),
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

function expressionText(node, constants, seen = new Set()) {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isIdentifier(node)) {
        if (seen.has(node.text)) return '';
        const initializer = constants.get(node.text);
        if (!initializer) return '';
        return expressionText(initializer, constants, new Set([...seen, node.text]));
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        return expressionText(node.left, constants, seen) + expressionText(node.right, constants, seen);
    }
    if (ts.isTemplateExpression(node)) {
        return node.head.text + node.templateSpans
            .map((span) => expressionText(span.expression, constants, seen) + span.literal.text)
            .join('');
    }
    return '';
}

function methodFromOptions(node, constants, seen = new Set()) {
    if (ts.isIdentifier(node)) {
        if (seen.has(node.text)) return null;
        const initializer = constants.get(node.text);
        if (!initializer) return null;
        return methodFromOptions(initializer, constants, new Set([...seen, node.text]));
    }
    if (!ts.isObjectLiteralExpression(node)) return null;

    let method = '';
    let unresolvedSpread = false;
    for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) {
            const spreadMethod = methodFromOptions(property.expression, constants, seen);
            if (spreadMethod === null) unresolvedSpread = true;
            else if (spreadMethod) method = spreadMethod;
            continue;
        }
        if (ts.isPropertyAssignment(property)) {
            const propertyName = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
                ? property.name.text
                : '';
            if (propertyName === 'method') {
                method = expressionText(property.initializer, constants).toUpperCase();
                unresolvedSpread = false;
            }
        }
    }
    if (unresolvedSpread) return null;
    return method;
}

function isHttpRequestCall(node) {
    return (ts.isIdentifier(node.expression) && node.expression.text === 'fetch')
        || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'request');
}

function directGraphHttpMutation(source, fileName) {
    const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const constants = new Map();

    function collectConstants(node) {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            constants.set(node.name.text, node.initializer);
        }
        ts.forEachChild(node, collectConstants);
    }
    collectConstants(sourceFile);

    let detected = false;
    function inspect(node) {
        if (ts.isCallExpression(node) && isHttpRequestCall(node) && node.arguments.length >= 2) {
            const target = expressionText(node.arguments[0], constants);
            const options = node.arguments[1];
            if (/\/api\/info\/graph\/(?:entities|edges)/.test(target)) {
                const method = methodFromOptions(options, constants);
                if (method === null || MUTATION_HTTP_METHODS.has(method)) detected = true;
            }
        }
        ts.forEachChild(node, inspect);
    }
    inspect(sourceFile);
    return detected;
}

const MUTATION_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function verifyWriterInventory({ rootDir = process.cwd() } = {}) {
    const inventory = JSON.parse(readFileSync(path.join(rootDir, 'config/ontology/writer-inventory.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(path.join(rootDir, 'config/ontology/releases/1.0.0.json'), 'utf8'));
    const detected = new Set();
    const graphHttpMutationOwners = new Set();
    const vocabularyByWriter = {};
    for (const scope of ['server', 'scripts']) {
        for (const file of walk(path.join(rootDir, scope))) {
            if (!EXTENSIONS.has(path.extname(file))) continue;
            const relative = path.relative(rootDir, file);
            if (relative === SELF) continue;
            const source = readFileSync(file, 'utf8');
            if (directGraphHttpMutation(source, relative)) {
                graphHttpMutationOwners.add(relative);
                vocabularyByWriter[relative] = graphVocabulary(source, manifest);
            }
            if (WRITE_PATTERNS.some((pattern) => pattern.test(source))) {
                detected.add(relative);
                vocabularyByWriter[relative] = graphVocabulary(source, manifest);
            }
        }
    }
    const classified = new Set(Object.keys(inventory.writers || {}));
    for (const file of graphHttpMutationOwners) detected.add(file);
    const unclassified = [...detected].filter((file) => !classified.has(file)).sort();
    const missing = [...classified].filter((file) => !detected.has(file)).sort();
    const vocabularyErrors = [];
    const allowedGraphHttpMutationOwners = new Set(inventory.graph_http_mutation_owners || []);
    const unauthorizedGraphHttpMutationOwners = [...graphHttpMutationOwners]
        .filter((file) => !allowedGraphHttpMutationOwners.has(file))
        .sort();
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
    if (unclassified.length || missing.length || vocabularyErrors.length || unauthorizedGraphHttpMutationOwners.length) {
        throw new Error(`Graph writer inventory mismatch: unclassified=[${unclassified.join(', ')}] missing=[${missing.join(', ')}] vocabulary=[${vocabularyErrors.join('; ')}] unauthorized Graph HTTP mutation owners=[${unauthorizedGraphHttpMutationOwners.join(', ')}]`);
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
