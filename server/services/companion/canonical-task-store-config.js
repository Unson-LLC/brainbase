import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REQUIRED_KEYS = ['schema_version', 'base_id', 'table_id', 'table_name', 'project', 'owner_person_id'];
const DEFAULT_MANIFEST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../config/canonical-task-store.json');
const EXPECTED_CANONICAL_IDENTITY = Object.freeze({
    base_id: 'pva7l2qlu6fdfip',
    table_id: 'm7iys8m7o1abr3f',
    table_name: 'タスク',
    project: 'brainbase'
});
const FORBIDDEN_IDENTITY_OVERRIDES = [
    'CANONICAL_TASK_BASE_ID',
    'CANONICAL_TASK_TABLE_ID',
    'CANONICAL_TASK_TABLE_NAME',
    'CANONICAL_TASK_PROJECT',
    'CANONICAL_TASK_OWNER_PERSON_ID',
    'CANONICAL_TASK_STORE_HASH'
];

function canonicalJson(manifest) {
    return JSON.stringify(Object.fromEntries(Object.keys(manifest).sort().map((key) => [key, manifest[key]])));
}

export function createCanonicalTaskStoreConfig({
    manifestPath = process.env.CANONICAL_TASK_STORE_MANIFEST || DEFAULT_MANIFEST
} = {}) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const key of REQUIRED_KEYS) {
        if (typeof manifest[key] !== 'string' || !manifest[key].trim()) {
            throw new Error(`Canonical Task store manifest requires ${key}`);
        }
    }
    for (const [key, expected] of Object.entries(EXPECTED_CANONICAL_IDENTITY)) {
        if (manifest[key] !== expected) {
            throw new Error(`Canonical Task manifest ${key} does not match the fixed canonical identity`);
        }
    }
    if (FORBIDDEN_IDENTITY_OVERRIDES.some((key) => process.env[key] !== undefined)) {
        throw new Error('Canonical Task identity overrides are forbidden; use the committed manifest');
    }
    return Object.freeze({
        schemaVersion: manifest.schema_version,
        baseId: manifest.base_id,
        tableId: manifest.table_id,
        tableName: manifest.table_name,
        project: manifest.project,
        ownerPersonId: manifest.owner_person_id,
        identityHash: crypto.createHash('sha256').update(canonicalJson(manifest)).digest('hex'),
        manifestPath: path.resolve(manifestPath)
    });
}

export function resolveCanonicalTaskBackend(value = process.env.CANONICAL_TASK_BACKEND) {
    const backend = value || 'nocodb';
    if (!['nocodb', 'postgres'].includes(backend)) {
        throw new Error('CANONICAL_TASK_BACKEND must be nocodb or postgres');
    }
    return backend;
}

export function canonicalTaskBackendIdentityHash(storeConfig, backend = resolveCanonicalTaskBackend()) {
    if (backend === 'nocodb') return storeConfig.identityHash;
    return crypto.createHash('sha256')
        .update(`${storeConfig.identityHash}:backend:${backend}`)
        .digest('hex');
}

export { canonicalJson as canonicalTaskStoreManifestJson };
