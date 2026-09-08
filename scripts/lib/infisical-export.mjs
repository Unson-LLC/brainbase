import { chmodSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SIGNING_KEYS = new Set([
    'ONTOLOGY_PUBLICATION_SIGNING_PUBLIC_KEY',
    'ONTOLOGY_PUBLICATION_SIGNING_PRIVATE_KEY',
    'ONTOLOGY_PUBLICATION_SIGNING_KEY_ID',
]);

function assertPlainObject(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('invalid Infisical export top-level value');
    }
}

export function normalizeInfisicalExport(input) {
    if (!Array.isArray(input)) {
        assertPlainObject(input);
        const normalized = Object.create(null);
        for (const [key, value] of Object.entries(input)) normalized[key] = value;
        return normalized;
    }

    const normalized = Object.create(null);
    for (const row of input) {
        assertPlainObject(row);
        if (typeof row.key !== 'string' || row.key.trim() === '' || !Object.hasOwn(row, 'value')) {
            throw new Error('invalid Infisical export row');
        }
        if (Object.hasOwn(normalized, row.key)) {
            throw new Error('duplicate Infisical export key');
        }
        if (SIGNING_KEYS.has(row.key)) {
            if (row.type !== 'shared' || row.secretPath !== '/') {
                throw new Error('signing key came from an unexpected Infisical scope');
            }
        }
        normalized[row.key] = row.value;
    }
    return normalized;
}

export function hasNonEmptySecret(values, key) {
    return Object.hasOwn(values, key) && typeof values[key] === 'string' && values[key].trim() !== '';
}

export function writePrivateJsonAtomically(targetPath, value, fileOperations = {}) {
    const operations = { chmodSync, renameSync, unlinkSync, writeFileSync, ...fileOperations };
    const temporaryPath = fileOperations.temporaryPath
        ?? join(dirname(targetPath), `.${process.pid}-${Date.now()}.infisical-normalized.tmp`);
    let renamed = false;

    try {
        operations.writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
        operations.chmodSync(temporaryPath, 0o600);
        operations.renameSync(temporaryPath, targetPath);
        renamed = true;
        operations.chmodSync(targetPath, 0o600);
    } catch (error) {
        if (!renamed) {
            try {
                operations.unlinkSync(temporaryPath);
            } catch (cleanupError) {
                if (cleanupError?.code !== 'ENOENT') {
                    throw new AggregateError([error, cleanupError], 'Infisical normalization and temporary-file cleanup failed');
                }
            }
        }
        throw error;
    }
}
