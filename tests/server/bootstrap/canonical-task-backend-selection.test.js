import { afterEach, describe, expect, it } from 'vitest';

import { createCanonicalTaskRepository } from '../../../server/bootstrap/core-services.js';
import { CanonicalTaskNocoDBRepository } from '../../../server/services/companion/canonical-task-nocodb-repository.js';
import { CanonicalTaskPostgresRepository } from '../../../server/services/companion/canonical-task-postgres-repository.js';
import {
    canonicalTaskBackendIdentityHash,
    resolveCanonicalTaskBackend
} from '../../../server/services/companion/canonical-task-store-config.js';

const storeConfig = Object.freeze({
    schemaVersion: '1.0.0',
    baseId: 'base',
    tableId: 'table',
    identityHash: 'a'.repeat(64)
});

const previousCanonicalSecret = process.env.CANONICAL_TASK_ID_SECRET;

afterEach(() => {
    if (previousCanonicalSecret === undefined) delete process.env.CANONICAL_TASK_ID_SECRET;
    else process.env.CANONICAL_TASK_ID_SECRET = previousCanonicalSecret;
});

describe('Canonical Task backend selection', () => {
    it('keeps NocoDB as the default', () => {
        process.env.CANONICAL_TASK_ID_SECRET = 'secret';
        expect(createCanonicalTaskRepository({ storeConfig })).toBeInstanceOf(CanonicalTaskNocoDBRepository);
    });

    it('selects PostgreSQL only when explicitly requested', () => {
        process.env.CANONICAL_TASK_ID_SECRET = 'secret';
        expect(createCanonicalTaskRepository({
            backend: 'postgres',
            pool: { query() {} },
            storeConfig
        })).toBeInstanceOf(CanonicalTaskPostgresRepository);
    });

    it('rejects invalid values without fallback', () => {
        expect(() => createCanonicalTaskRepository({
            backend: 'typo',
            storeConfig
        })).toThrow('CANONICAL_TASK_BACKEND must be nocodb or postgres');
    });

    it('uses a distinct readiness identity for PostgreSQL without changing the NocoDB default', () => {
        expect(resolveCanonicalTaskBackend(undefined)).toBe('nocodb');
        expect(canonicalTaskBackendIdentityHash(storeConfig, 'nocodb')).toBe(storeConfig.identityHash);
        expect(canonicalTaskBackendIdentityHash(storeConfig, 'postgres')).not.toBe(storeConfig.identityHash);
    });
});
