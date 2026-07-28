import { describe, expect, it, vi } from 'vitest';

import {
    checkCanonicalTaskPostgresSchema,
    parseCanonicalTaskPostgresMigrationArgs,
    runCanonicalTaskPostgresMigration
} from '../../../scripts/migrate-canonical-task-postgres-store.js';

const columns = [
    'id', 'legacy_nocodb_id', 'title', 'description', 'status', 'priority',
    'assignee_person_id', 'assignee_display_name', 'due_at', 'waiting_on',
    'review_at', 'completed_at', 'source_refs', 'version', 'idempotency_key',
    'payload_fingerprint', 'last_operation_key', 'last_operation_fingerprint',
    'created_at', 'updated_at'
];

function sourceRepository(records) {
    return {
        allRecords: vi.fn().mockResolvedValue(records),
        normalize: vi.fn((record) => ({
            title: record['タイトル'],
            description: null,
            status: 'pending',
            priority: 'medium',
            assignee_person_id: 'person-1',
            assignee_display_name: 'Owner',
            due_at: null,
            waiting_on: null,
            review_at: null,
            completed_at: null,
            source_refs: [],
            version: 1,
            created_at: '2026-07-28T00:00:00.000Z',
            updated_at: '2026-07-28T00:00:00.000Z',
            _payload_fingerprint: 'fingerprint',
            _last_operation_key: null,
            _last_operation_fingerprint: null
        }))
    };
}

function checkingPool({ conflicts = 0, targetCount = 0 } = {}) {
    return {
        query: vi.fn(async (sql) => {
            if (sql.includes('information_schema.tables')) return { rows: [{ table_name: 'canonical_tasks' }] };
            if (sql.includes('information_schema.columns')) return { rows: columns.map((column_name) => ({ column_name })) };
            if (sql.includes('pg_indexes')) {
                return { rows: [
                    { indexname: 'canonical_tasks_status_priority_idx' },
                    { indexname: 'canonical_tasks_assignee_due_idx' }
                ] };
            }
            if (sql.includes('legacy_nocodb_id = ANY')) return { rows: [{ count: conflicts }] };
            if (sql.includes('SELECT COUNT(*)::integer AS count FROM canonical_tasks')) {
                return { rows: [{ count: targetCount }] };
            }
            throw new Error(`Unexpected query: ${sql}`);
        })
    };
}

describe('Canonical Task PostgreSQL migration', () => {
    it('requires exactly one non-destructive or apply mode', () => {
        expect(parseCanonicalTaskPostgresMigrationArgs(['--dry-run'])).toEqual({ mode: 'dry-run' });
        expect(() => parseCanonicalTaskPostgresMigrationArgs([])).toThrow('Specify exactly one');
        expect(() => parseCanonicalTaskPostgresMigrationArgs(['--check', '--apply'])).toThrow('Specify exactly one');
    });

    it('checks the schema contract', async () => {
        await expect(checkCanonicalTaskPostgresSchema(checkingPool())).resolves.toMatchObject({
            ok: true,
            table: 'canonical_tasks',
            columns: columns.length
        });
    });

    it('dry-runs without writing Task content or schema', async () => {
        const pool = checkingPool();
        const result = await runCanonicalTaskPostgresMigration({
            argv: ['--dry-run'],
            pool,
            sourceRepository: sourceRepository([{ Id: 42, 'タイトル': '秘密の本文', '冪等キー': 'key-42' }])
        });
        expect(result).toEqual({
            ok: true,
            mode: 'dry-run',
            source_count: 1,
            target_count: 0,
            inserted_count: 0,
            conflict_count: 0
        });
        expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO canonical_tasks'))).toBe(false);
    });

    it('stops before apply when legacy IDs or idempotency keys conflict', async () => {
        const pool = checkingPool({ conflicts: 1 });
        await expect(runCanonicalTaskPostgresMigration({
            argv: ['--check'],
            pool,
            sourceRepository: sourceRepository([{ Id: 42, 'タイトル': 'Task', '冪等キー': 'key-42' }])
        })).rejects.toThrow('Canonical Task migration conflict');
    });
});
