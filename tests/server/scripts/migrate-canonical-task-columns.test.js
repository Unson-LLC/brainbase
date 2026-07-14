import { describe, expect, it, vi } from 'vitest';

import {
    REQUIRED_CANONICAL_TASK_COLUMNS,
    checkCanonicalTaskColumns,
    migrateCanonicalTaskColumns
} from '../../../scripts/migrate-canonical-task-columns.js';

describe('Canonical Task NocoDB column migration', () => {
    it('reports missing columns and a non-unique idempotency key', () => {
        expect(() => checkCanonicalTaskColumns({ columns: [
            { title: '冪等キー', uidt: 'SingleLineText', unique: false }
        ] })).toThrow('missing columns');
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
});
