import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { createCanonicalTaskStoreConfig } from '../../../server/services/companion/canonical-task-store-config.js';

const temporaryFiles = [];

afterEach(() => {
    for (const file of temporaryFiles.splice(0)) fs.rmSync(file, { force: true });
});

describe('canonical task store config', () => {
    it('loads, hashes, and deeply freezes the committed manifest', () => {
        const config = createCanonicalTaskStoreConfig();
        const canonical = JSON.stringify({
            base_id: config.baseId,
            owner_person_id: config.ownerPersonId,
            project: config.project,
            schema_version: config.schemaVersion,
            table_id: config.tableId,
            table_name: config.tableName
        });
        expect(config.identityHash).toBe(crypto.createHash('sha256').update(canonical).digest('hex'));
        expect(config.baseId).toBe('pva7l2qlu6fdfip');
        expect(Object.isFrozen(config)).toBe(true);
    });

    it('fails closed for malformed manifests', () => {
        const file = path.join(os.tmpdir(), `canonical-task-store-${crypto.randomUUID()}.json`);
        temporaryFiles.push(file);
        fs.writeFileSync(file, JSON.stringify({ schema_version: '1.0.0', base_id: 'only-base' }));
        expect(() => createCanonicalTaskStoreConfig({ manifestPath: file })).toThrowError(/table_id/);
    });

    it('fails closed when a valid manifest points to a different store identity', () => {
        const file = path.join(os.tmpdir(), `canonical-task-store-${crypto.randomUUID()}.json`);
        temporaryFiles.push(file);
        fs.writeFileSync(file, JSON.stringify({
            schema_version: '1.0.0',
            base_id: 'another-base',
            table_id: 'another-table',
            table_name: 'タスク',
            project: 'brainbase',
            owner_person_id: 'sato_keigo'
        }));

        expect(() => createCanonicalTaskStoreConfig({ manifestPath: file }))
            .toThrowError(/base_id does not match the fixed canonical identity/);
    });
});
