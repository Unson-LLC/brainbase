import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
    hasExplicitSearchIndexApproval,
    runCanonicalTaskSearchIndexWorkflow
} from '../../../scripts/run-canonical-task-search-index-workflow.js';

const columns = [
    'id', 'legacy_nocodb_id', 'title', 'description', 'status', 'priority',
    'assignee_person_id', 'assignee_display_name', 'due_at', 'waiting_on',
    'review_at', 'completed_at', 'source_refs', 'project_codes', 'version', 'idempotency_key',
    'payload_fingerprint', 'last_operation_key', 'last_operation_fingerprint',
    'created_at', 'updated_at'
];

function workflowPool() {
    let schemaChecks = 0;
    return {
        query: vi.fn(async (sql) => {
            if (sql.includes('information_schema.tables')) return { rows: [{ table_name: 'canonical_tasks' }] };
            if (sql.includes('information_schema.columns')) return { rows: columns.map((column_name) => ({ column_name })) };
            if (sql.includes('pg_index AS index_state')) {
                schemaChecks += 1;
                const rows = [
                    { indexname: 'canonical_tasks_status_priority_idx', indisvalid: true, indisready: true },
                    { indexname: 'canonical_tasks_assignee_due_idx', indisvalid: true, indisready: true },
                    { indexname: 'canonical_tasks_project_codes_idx', indisvalid: true, indisready: true }
                ];
                if (schemaChecks > 1) rows.push(
                    { indexname: 'canonical_tasks_title_trgm_idx', indisvalid: true, indisready: true },
                    { indexname: 'canonical_tasks_search_cursor_idx', indisvalid: true, indisready: true }
                );
                return { rows };
            }
            if (sql.startsWith('CREATE ')) return { rows: [] };
            throw new Error(`Unexpected query: ${sql}`);
        })
    };
}

describe('Canonical Task search index workflow', () => {
    it('story-canonical-task-search-index-rollout:ac:1 requires an exact explicit apply approval', async () => {
        expect(hasExplicitSearchIndexApproval(['--approve-apply'])).toBe(true);
        expect(hasExplicitSearchIndexApproval([])).toBe(false);
        expect(hasExplicitSearchIndexApproval(['--approve-apply', '--force'])).toBe(false);

        await expect(runCanonicalTaskSearchIndexWorkflow({
            argv: [],
            pool: workflowPool()
        })).rejects.toThrow('requires explicit operator approval');
    });

    it('story-canonical-task-search-index-rollout:ac:2 checks the base schema, applies only concurrent search indexes, and verifies valid-ready state', async () => {
        const pool = workflowPool();

        await expect(runCanonicalTaskSearchIndexWorkflow({
            argv: ['--approve-apply'],
            pool
        })).resolves.toEqual({
            ok: true,
            workflow: 'base-schema-check -> concurrent-index-apply -> valid-ready-check',
            final_check_passed: true
        });

        const sql = pool.query.mock.calls.map(([statement]) => statement);
        expect(sql.some((statement) => statement.includes('legacy_nocodb_id, idempotency_key'))).toBe(false);
        expect(sql.some((statement) => statement.includes('INSERT INTO canonical_tasks'))).toBe(false);
        expect(sql.filter((statement) => statement.startsWith('CREATE '))).toHaveLength(3);
        expect(sql.filter((statement) => statement.includes('pg_index AS index_state'))).toHaveLength(2);
    });

    it('story-canonical-task-search-index-rollout:ac:3 distinguishes initial migration from post-cutover index rollout', async () => {
        const runbook = await readFile(
            path.resolve(process.cwd(), 'docs/runbooks/canonical-task-cutover.md'),
            'utf8'
        );

        expect(runbook).toContain('Postgres正本への切替後に検索索引だけを追加する場合は');
        expect(runbook).toContain('migrate:canonical-task-search-indexes');
        expect(runbook).toContain('migrate:canonical-task-postgres-workflow');
    });
});
