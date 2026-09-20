import { afterEach, describe, expect, it } from 'vitest';

import { createCanonicalTaskRepository } from '../../../server/bootstrap/core-services.js';
import { CanonicalTaskNocoDBRepository } from '../../../server/services/companion/canonical-task-nocodb-repository.js';
import { CanonicalTaskPostgresRepository } from '../../../server/services/companion/canonical-task-postgres-repository.js';
import { CanonicalTaskUnavailableRepository } from '../../../server/services/companion/canonical-task-unavailable-repository.js';
import { CanonicalTaskService } from '../../../server/services/companion/canonical-task-service.js';
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
    it('fails closed without selecting NocoDB when the backend is omitted', async () => {
        process.env.CANONICAL_TASK_ID_SECRET = 'secret';
        const repository = createCanonicalTaskRepository({ storeConfig });
        expect(repository).toBeInstanceOf(CanonicalTaskUnavailableRepository);
        expect(() => repository.list()).toThrow(expect.objectContaining({
            code: 'canonical_task_backend_not_configured',
            status: 503
        }));
        const service = new CanonicalTaskService({ repository, ownerPersonId: 'per_owner' });
        await expect(service.listTasks({}, {
            principal: { type: 'person', id: 'per_owner' },
            access: { projectCodes: ['brainbase'], clearance: ['internal'] }
        })).rejects.toMatchObject({
            code: 'canonical_task_backend_not_configured',
            status: 503
        });
    });

    it('selects NocoDB only when explicitly requested', () => {
        process.env.CANONICAL_TASK_ID_SECRET = 'secret';
        expect(createCanonicalTaskRepository({ backend: 'nocodb', storeConfig }))
            .toBeInstanceOf(CanonicalTaskNocoDBRepository);
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
        })).toThrow('CANONICAL_TASK_BACKEND must be disabled, nocodb, or postgres');
    });

    it('uses distinct readiness identities for disabled and PostgreSQL backends', () => {
        expect(resolveCanonicalTaskBackend(undefined)).toBe('disabled');
        expect(canonicalTaskBackendIdentityHash(storeConfig, 'nocodb')).toBe(storeConfig.identityHash);
        expect(canonicalTaskBackendIdentityHash(storeConfig, 'disabled')).not.toBe(storeConfig.identityHash);
        expect(canonicalTaskBackendIdentityHash(storeConfig, 'postgres')).not.toBe(storeConfig.identityHash);
    });
});
