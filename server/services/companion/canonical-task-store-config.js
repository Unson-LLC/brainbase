import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const REQUIRED_KEYS = ['schema_version', 'base_id', 'table_id', 'table_name', 'project', 'owner_person_id'];
const DEFAULT_MANIFEST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../config/canonical-task-store.json');

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
    const forbiddenOverrides = ['CANONICAL_TASK_BASE_ID', 'CANONICAL_TASK_TABLE_ID'];
    if (forbiddenOverrides.some((key) => process.env[key])) {
        throw new Error('Canonical Task base/table overrides are forbidden; use the committed manifest');
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

export { canonicalJson as canonicalTaskStoreManifestJson };
