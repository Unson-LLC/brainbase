import { describe, expect, it } from 'vitest';

import { recoverCanonicalTaskWriter } from '../../../scripts/recover-canonical-task-writer.js';

describe('recoverCanonicalTaskWriter', () => {
    it('surface.writer.release-recover moves the writer and closes readiness atomically', async () => {
        const queries = [];
        const client = {
            query: async (sql, params) => {
                queries.push({ sql, params });
                if (sql.includes('SELECT writer_token, process_identity')) {
                    return { rowCount: 1, rows: [{ writer_token: 'old', process_identity: { pid: 4242 } }] };
                }
                if (sql.includes('UPDATE canonical_task_writer')) return { rowCount: 1, rows: [{ writer_token: 'new' }] };
                return { rowCount: 1, rows: [] };
            },
            release: () => queries.push({ sql: 'RELEASE' })
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

        expect(queries[0].sql).toBe('BEGIN');
        expect(queries.some(({ sql }) => sql.includes('FOR UPDATE'))).toBe(true);
        expect(queries.some(({ sql }) => sql.includes('UPDATE canonical_task_writer'))).toBe(true);
        expect(queries.some(({ sql }) => sql.includes('canonical_task_readiness'))).toBe(true);
        expect(queries.at(-2).sql).toBe('COMMIT');
        expect(queries.at(-1).sql).toBe('RELEASE');
    });

    it('rejects recovery while the stored writer process is still running', async () => {
        const queries = [];
        const client = {
            query: async (sql) => {
                queries.push(sql);
                if (sql.includes('SELECT writer_token, process_identity')) {
                    return { rowCount: 1, rows: [{ writer_token: 'old', process_identity: { pid: 4242 } }] };
                }
                return { rowCount: 1, rows: [] };
            },
            release: () => queries.push('RELEASE')
        };

        await expect(recoverCanonicalTaskWriter({
            argv: ['--expected-token', 'old', '--expected-pid', '4242', '--new-token', 'new'],
            pool: { connect: async () => client },
            isProcessAlive: () => true
        })).rejects.toThrow('still running');

        expect(queries).toContain('ROLLBACK');
        expect(queries.some((sql) => sql.includes?.('UPDATE canonical_task_writer'))).toBe(false);
    });

    it('rejects recovery when the operator PID does not match the stored writer identity', async () => {
        const queries = [];
        const client = {
            query: async (sql) => {
                queries.push(sql);
                if (sql.includes('SELECT writer_token, process_identity')) {
                    return { rowCount: 1, rows: [{ writer_token: 'old', process_identity: { pid: 4242 } }] };
                }
                return { rowCount: 1, rows: [] };
            },
            release: () => queries.push('RELEASE')
        };

        await expect(recoverCanonicalTaskWriter({
            argv: ['--expected-token', 'old', '--expected-pid', '4343', '--new-token', 'new'],
            pool: { connect: async () => client },
            isProcessAlive: () => false
        })).rejects.toThrow('PID did not match');

        expect(queries).toContain('ROLLBACK');
        expect(queries.some((sql) => sql.includes?.('UPDATE canonical_task_writer'))).toBe(false);
    });

    it('rolls back writer recovery when readiness cannot be closed', async () => {
        const queries = [];
        const client = {
            query: async (sql) => {
                queries.push(sql);
                if (sql.includes('SELECT writer_token, process_identity')) {
                    return { rowCount: 1, rows: [{ writer_token: 'old', process_identity: { pid: 4242 } }] };
                }
                if (sql.includes('UPDATE canonical_task_writer')) return { rowCount: 1, rows: [] };
                if (sql.includes('canonical_task_readiness')) throw new Error('readiness unavailable');
                return { rowCount: 1, rows: [] };
            },
            release: () => queries.push('RELEASE')
        };

        await expect(recoverCanonicalTaskWriter({
            argv: ['--expected-token', 'old', '--expected-pid', '4242', '--new-token', 'new'],
            pool: { connect: async () => client },
            isProcessAlive: () => false
        })).rejects.toThrow('readiness unavailable');

        expect(queries).toContain('ROLLBACK');
        expect(queries).not.toContain('COMMIT');
    });
});
