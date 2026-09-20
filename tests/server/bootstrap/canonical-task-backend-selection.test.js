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
    it('uses PostgreSQL as the default runtime backend', () => {
        process.env.CANONICAL_TASK_ID_SECRET = 'secret';
        expect(createCanonicalTaskRepository({
            pool: { query() {} },
            storeConfig
        })).toBeInstanceOf(CanonicalTaskPostgresRepository);
    });

    it('keeps NocoDB available only when explicitly requested', () => {
        process.env.CANONICAL_TASK_ID_SECRET = 'secret';
        expect(createCanonicalTaskRepository({
            backend: 'nocodb',
            storeConfig
        })).toBeInstanceOf(CanonicalTaskNocoDBRepository);
    });

    it('rejects invalid values without fallback', () => {
        expect(() => createCanonicalTaskRepository({
            backend: 'typo',
            storeConfig
        })).toThrow('CANONICAL_TASK_BACKEND must be nocodb or postgres');
    });

    it('uses a distinct readiness identity for PostgreSQL while preserving explicit NocoDB compatibility', () => {
        expect(resolveCanonicalTaskBackend(undefined)).toBe('postgres');
        expect(canonicalTaskBackendIdentityHash(storeConfig, 'nocodb')).toBe(storeConfig.identityHash);
        expect(canonicalTaskBackendIdentityHash(storeConfig, 'postgres')).not.toBe(storeConfig.identityHash);
    });
});
