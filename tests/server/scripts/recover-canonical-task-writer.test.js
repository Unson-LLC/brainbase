import { describe, expect, it } from 'vitest';

import { recoverCanonicalTaskWriter } from '../../../scripts/recover-canonical-task-writer.js';

describe('recoverCanonicalTaskWriter', () => {
    it('surface.writer.release-recover moves the writer and closes readiness atomically', async () => {
        const queries = [];
        const client = {
            query: async (sql) => {
                queries.push(sql);
                if (sql.includes('UPDATE canonical_task_writer')) return { rowCount: 1, rows: [{ writer_token: 'new' }] };
                return { rowCount: 1, rows: [] };
            },
            release: () => queries.push('RELEASE')
        };
        const pool = { connect: async () => client };

        await expect(recoverCanonicalTaskWriter({
            argv: ['--expected-token', 'old', '--expected-pid', '4242', '--new-token', 'new'],
            pool,
            isProcessAlive: () => false
        })).resolves.toEqual({
            recovered: true,
            writer_token: 'new',
            required_restart_environment: { BRAINBASE_SERVER_GENERATION: 'new' }
        });

        expect(queries[0]).toBe('BEGIN');
        expect(queries.some((sql) => sql.includes('UPDATE canonical_task_writer'))).toBe(true);
        expect(queries.some((sql) => sql.includes('canonical_task_readiness'))).toBe(true);
        expect(queries.at(-2)).toBe('COMMIT');
        expect(queries.at(-1)).toBe('RELEASE');
    });

    it('rolls back writer recovery when readiness cannot be closed', async () => {
        const queries = [];
        const client = {
            query: async (sql) => {
                queries.push(sql);
                if (sql.includes('UPDATE canonical_task_writer')) return { rowCount: 1, rows: [] };
                if (sql.includes('canonical_task_readiness')) throw new Error('readiness unavailable');
                return { rowCount: 1, rows: [] };
            },
            release: () => queries.push('RELEASE')
        };

        await expect(recoverCanonicalTaskWriter({
            argv: ['--expected-token', 'old', '--new-token', 'new'],
            pool: { connect: async () => client }
        })).rejects.toThrow('readiness unavailable');

        expect(queries).toContain('ROLLBACK');
        expect(queries).not.toContain('COMMIT');
    });
});
