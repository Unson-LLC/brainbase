import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    REQUIRED_CANONICAL_TASK_COLUMNS,
    checkCanonicalTaskColumns,
    migrateCanonicalTaskColumns,
    runCanonicalTaskColumnMigration
} from '../../../scripts/migrate-canonical-task-columns.js';

const temporaryDirectories = [];

afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('Canonical Task NocoDB column migration', () => {
    it('reports missing columns and a non-unique idempotency key', () => {
        expect(() => checkCanonicalTaskColumns({ columns: [
            { title: '冪等キー', uidt: 'SingleLineText', unique: false }
        ] })).toThrow('missing columns');
    });

    it('rejects a required column with the wrong NocoDB type', () => {
        const columns = REQUIRED_CANONICAL_TASK_COLUMNS.map(column => ({ ...column }));
        columns.find(column => column.title === '期限').uidt = 'SingleLineText';
        expect(() => checkCanonicalTaskColumns({ columns })).toThrow(/期限.*DateTime/);
    });

    it('migrates the legacy Date deadline to DateTime without widening other type changes', async () => {
        let columns = REQUIRED_CANONICAL_TASK_COLUMNS.map((column, index) => ({ id: `c-${index}`, ...column }));
        columns.find(column => column.title === '期限').uidt = 'Date';
        const fetchImpl = vi.fn(async (url, options = {}) => {
            if (!options.method || options.method === 'GET') {
                return { ok: true, json: async () => ({ columns }) };
            }
            const columnId = url.split('/').at(-1);
            const body = JSON.parse(options.body);
            columns = columns.map(column => column.id === columnId ? { ...column, ...body } : column);
            return { ok: true, json: async () => columns.find(column => column.id === columnId) };
        });

        const result = await migrateCanonicalTaskColumns({
            apply: true,
            fetchImpl,
            baseUrl: 'https://noco.example',
            apiToken: 'secret',
            tableId: 'table-1'
        });

        expect(result.ok).toBe(true);
        expect(columns.find(column => column.title === '期限')).toMatchObject({ uidt: 'DateTime' });
        expect(fetchImpl).toHaveBeenCalledWith(
            expect.stringContaining('/api/v2/meta/columns/'),
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({ title: '期限', uidt: 'DateTime' })
            })
        );
    });

    it('creates missing columns and verifies the unique idempotency key', async () => {
        let columns = [];
        const fetchImpl = vi.fn(async (_url, options = {}) => {
            if (!options.method || options.method === 'GET') {
                return { ok: true, json: async () => ({ columns }) };
            }
            const body = JSON.parse(options.body);
            columns.push({ id: `c-${columns.length}`, ...body });
            return { ok: true, json: async () => columns.at(-1) };
        });

        const result = await migrateCanonicalTaskColumns({
            apply: true,
            fetchImpl,
            baseUrl: 'https://noco.example',
            apiToken: 'secret',
            tableId: 'table-1'
        });

        expect(result.ok).toBe(true);
        expect(columns).toHaveLength(REQUIRED_CANONICAL_TASK_COLUMNS.length);
        expect(columns.find(column => column.title === '冪等キー')).toMatchObject({ unique: true });
    });

    it('rejects a valid manifest that points migration at a non-canonical Task table', async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'canonical-task-migration-'));
        temporaryDirectories.push(directory);
        const manifestPath = path.join(directory, 'canonical-task-store.json');
        await writeFile(manifestPath, JSON.stringify({
            schema_version: '1.0.0',
            base_id: 'pva7l2qlu6fdfip',
            table_id: 'wrong-but-valid-table-id',
            table_name: 'タスク',
            project: 'brainbase',
            owner_person_id: 'sato_keigo'
        }));
        vi.stubEnv('CANONICAL_TASK_STORE_MANIFEST', manifestPath);

        await expect(runCanonicalTaskColumnMigration(['--check'])).rejects.toThrow(
            'Canonical Task manifest table_id does not match the fixed canonical identity'
        );
    });
});
