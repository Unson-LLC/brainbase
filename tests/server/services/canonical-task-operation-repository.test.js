import { describe, expect, it, vi } from 'vitest';

import { CanonicalTaskOperationRepository } from '../../../server/services/companion/canonical-task-operation-repository.js';

describe('CanonicalTaskOperationRepository', () => {
    it('rebinds matching verified readiness to the writer claimed after restart', async () => {
        const queries = [];
        const client = {
            query: vi.fn(async (sql, params) => {
                queries.push({ sql, params });
                if (sql.includes('FROM canonical_task_writer')) {
                    return { rowCount: 1, rows: [{ writer_token: 'writer-2' }] };
                }
                if (sql.includes('FROM canonical_task_readiness')) {
                    return { rowCount: 1, rows: [{
                        ready: true,
                        writer_token: 'writer-1',
                        manifest_hash: 'manifest-1',
                        schema_version: '1.0.0',
                        source_head: 'head-1',
                        evidence_hash: 'evidence-1'
                    }] };
                }
                if (sql.includes('UPDATE canonical_task_readiness')) {
                    return { rowCount: 1, rows: [{ writer_token: 'writer-2' }] };
                }
                return { rowCount: 0, rows: [] };
            }),
            release: vi.fn()
        };
        const repository = new CanonicalTaskOperationRepository({
            pool: { connect: async () => client },
            writerToken: 'writer-2'
        });

        await expect(repository.reconcileReadiness({
            manifestHash: 'manifest-1',
            schemaVersion: '1.0.0',
            sourceHead: 'head-1',
            allowWriterRebind: true
        })).resolves.toMatchObject({ writer_token: 'writer-2' });

        expect(queries.some(({ sql }) => sql.includes('UPDATE canonical_task_readiness'))).toBe(true);
        expect(queries.some(({ sql }) => sql === 'COMMIT')).toBe(true);
    });

    it('does not rebind readiness when verified release authorities differ', async () => {
        const client = {
            query: vi.fn(async (sql) => {
                if (sql.includes('FROM canonical_task_writer')) return { rowCount: 1, rows: [{ writer_token: 'writer-2' }] };
                if (sql.includes('FROM canonical_task_readiness')) {
                    return { rowCount: 1, rows: [{
                        ready: true,
                        writer_token: 'writer-1',
                        manifest_hash: 'manifest-old',
                        schema_version: '1.0.0',
                        source_head: 'head-1',
                        evidence_hash: 'evidence-1'
                    }] };
                }
                return { rowCount: 0, rows: [] };
            }),
            release: vi.fn()
        };
        const repository = new CanonicalTaskOperationRepository({
            pool: { connect: async () => client },
            writerToken: 'writer-2'
        });

        await repository.reconcileReadiness({
            manifestHash: 'manifest-1', schemaVersion: '1.0.0', sourceHead: 'head-1', allowWriterRebind: true
        });

        expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE canonical_task_readiness'), expect.anything());
    });

    it('fails closed instead of executing mutations without Postgres coordination', async () => {
        const repository = new CanonicalTaskOperationRepository({ writerToken: 'writer-1' });
        let executed = false;

        await expect(repository.execute({
            scope: 'task-create',
            operationKey: 'api:test',
            fingerprint: 'fingerprint',
            run: async () => { executed = true; }
        })).rejects.toMatchObject({ code: 'canonical_task_coordination_unavailable', status: 503 });
        expect(executed).toBe(false);
    });

    it('does not release a writer that was never claimed by this process', async () => {
        const repository = new CanonicalTaskOperationRepository({
            pool: { query: async () => { throw new Error('must not query'); } },
            writerToken: 'writer-1'
        });

        await expect(repository.releaseWriter()).resolves.toBe(false);
    });

    it('reclaims a failed operation for the current writer and completes it', async () => {
        const queries = [];
        const client = {
            query: async (sql) => {
                queries.push(sql);
                if (sql.includes('SELECT 1 FROM canonical_task_writer')) return { rowCount: 1, rows: [{ '?column?': 1 }] };
                if (sql.includes('INSERT INTO canonical_task_operations')) return { rowCount: 0, rows: [] };
                if (sql.includes('SELECT fingerprint, state')) {
                    return { rowCount: 1, rows: [{ fingerprint: 'fingerprint', state: 'failed', result_json: null }] };
                }
                return { rowCount: 1, rows: [] };
            },
            release: () => {}
        };
        const pool = {
            connect: async () => client,
            query: client.query
        };
        const repository = new CanonicalTaskOperationRepository({ pool, writerToken: 'writer-1' });

        await expect(repository.execute({
            scope: 'task-create',
            operationKey: 'api:test',
            fingerprint: 'fingerprint',
            run: async () => ({ id: 'task-1' })
        })).resolves.toEqual({ id: 'task-1' });

        expect(queries.some((sql) => sql.includes("SET state = 'running'"))).toBe(true);
        expect(queries.some((sql) => sql.includes("SET state = 'completed'"))).toBe(true);
    });

    it('fails closed when a matching concurrent operation does not settle in time', async () => {
        const client = {
            query: async (sql) => {
                if (sql.includes('SELECT 1 FROM canonical_task_writer')) return { rowCount: 1, rows: [] };
                if (sql.includes('INSERT INTO canonical_task_operations')) return { rowCount: 0, rows: [] };
                if (sql.includes('SELECT fingerprint, state')) {
                    return { rowCount: 1, rows: [{ fingerprint: 'fingerprint', state: 'running', result_json: null }] };
                }
                return { rowCount: 1, rows: [] };
            },
            release: () => {}
        };
        const repository = new CanonicalTaskOperationRepository({
            pool: { connect: async () => client, query: client.query },
            writerToken: 'writer-1',
            operationWaitTimeoutMs: 0,
            operationPollIntervalMs: 0
        });

        await expect(repository.execute({
            scope: 'task-create', operationKey: 'api:test', fingerprint: 'fingerprint', run: async () => null
        })).rejects.toMatchObject({ code: 'canonical_task_operation_timeout', status: 503 });
    });

    it('replays the completed result for a matching concurrent operation', async () => {
        let polls = 0;
        const client = {
            query: async (sql) => {
                if (sql.includes('SELECT 1 FROM canonical_task_writer')) return { rowCount: 1, rows: [{}] };
                if (sql.includes('INSERT INTO canonical_task_operations')) return { rowCount: 0, rows: [] };
                if (sql.includes('SELECT fingerprint, state') && sql.includes('FOR UPDATE')) {
                    return { rowCount: 1, rows: [{
                        fingerprint: 'fingerprint', state: 'running', result_json: null, writer_token: 'writer-1'
                    }] };
                }
                if (sql.includes('SELECT fingerprint, state')) {
                    polls += 1;
                    return { rowCount: 1, rows: [{
                        fingerprint: 'fingerprint',
                        state: polls === 1 ? 'running' : 'completed',
                        result_json: polls === 1 ? null : { id: 'task-1' },
                        writer_token: 'writer-1'
                    }] };
                }
                return { rowCount: 1, rows: [] };
            },
            release: () => {}
        };
        const repository = new CanonicalTaskOperationRepository({
            pool: { connect: async () => client, query: client.query },
            writerToken: 'writer-1',
            operationWaitTimeoutMs: 100,
            operationPollIntervalMs: 0
        });
        const run = vi.fn();

        await expect(repository.execute({
            scope: 'task-create', operationKey: 'api:test', fingerprint: 'fingerprint', run
        })).resolves.toEqual({ id: 'task-1' });

        expect(run).not.toHaveBeenCalled();
        expect(polls).toBe(2);
    });

    it('reclaims a matching operation left running by a previous writer and persists the recovered result', async () => {
        const queries = [];
        const client = {
            query: vi.fn(async (sql) => {
                queries.push(sql);
                if (sql.includes('SELECT 1 FROM canonical_task_writer')) return { rowCount: 1, rows: [{}] };
                if (sql.includes('INSERT INTO canonical_task_operations')) return { rowCount: 0, rows: [] };
                if (sql.includes('SELECT fingerprint, state')) {
                    return {
                        rowCount: 1,
                        rows: [{
                            fingerprint: 'fingerprint',
                            state: 'running',
                            result_json: null,
                            writer_token: 'writer-before-restart'
                        }]
                    };
                }
                return { rowCount: 1, rows: [] };
            }),
            release: vi.fn()
        };
        const repository = new CanonicalTaskOperationRepository({
            pool: { connect: async () => client, query: client.query },
            writerToken: 'writer-after-restart'
        });
        const run = vi.fn();

        await expect(repository.execute({
            scope: 'task-version',
            operationKey: 'task-version:task_1:1',
            fingerprint: 'fingerprint',
            recover: async () => ({ recovered: true, result: { id: 'task_1', version: 2 } }),
            run
        })).resolves.toEqual({ id: 'task_1', version: 2 });

        expect(run).not.toHaveBeenCalled();
        expect(queries.some((sql) => sql.includes('SET writer_token = $3'))).toBe(true);
        expect(queries.some((sql) => sql.includes("SET state = 'completed'"))).toBe(true);
    });

    it('finishes a prepared delete after the Task has already disappeared', async () => {
        const result = { task_id: 'task_1', deleted: true, version: 2 };
        const queries = [];
        const query = async (sql) => {
            queries.push(sql);
            if (sql.includes('SELECT 1 FROM canonical_task_writer')) return { rowCount: 1, rows: [{}] };
            if (sql.includes("WHERE scope = 'task-delete'") && sql.includes('SELECT fingerprint')) {
                return { rowCount: 1, rows: [{ fingerprint: 'delete-fp', state: 'prepared', result_json: result, authorization_snapshot: { principal_namespace: 'person-a' } }] };
            }
            if (sql.includes("SET state = 'completed'") && sql.includes("scope = 'task-delete'")) return { rowCount: 1, rows: [] };
            return { rowCount: 1, rows: [] };
        };
        const client = { query, release: () => {} };
        const repository = new CanonicalTaskOperationRepository({
            pool: { query, connect: async () => client }, writerToken: 'writer-1'
        });
        const removeTask = vi.fn();

        await expect(repository.executePreparedDelete({
            operationKey: 'delete:person-a:key-1',
            versionClaimKey: 'task-version:task_1:1',
            fingerprint: 'delete-fp',
            versionFingerprint: 'version-fp',
            principalNamespace: 'person-a',
            prepare: vi.fn(),
            findTask: async () => null,
            removeTask
        })).resolves.toEqual(result);

        expect(removeTask).not.toHaveBeenCalled();
        expect(queries.some((sql) => sql.includes("scope = 'task-version'") && sql.includes("SET state = 'completed'"))).toBe(true);
    });

    it('persists the version claim and delete intent before removing the Task', async () => {
        const events = [];
        const poolQuery = async (sql) => {
            if (sql.includes('SELECT 1 FROM canonical_task_writer')) return { rowCount: 1, rows: [{}] };
            if (sql.includes("scope = 'task-delete'") || sql.includes("scope = 'task-version'")) {
                return { rowCount: 0, rows: [] };
            }
            return { rowCount: 1, rows: [] };
        };
        const client = {
            query: async (sql) => {
                if (sql.includes('SELECT 1 FROM canonical_task_writer')) return { rowCount: 1, rows: [{}] };
                if (sql.includes("VALUES ('task-version'")) {
                    events.push('version-claim');
                    return { rowCount: 1, rows: [{ id: 1 }] };
                }
                if (sql.includes("VALUES ('task-delete'")) {
                    events.push('delete-intent');
                    return { rowCount: 1, rows: [{ id: 2 }] };
                }
                if (sql.includes("SET state = 'completed'") && sql.includes("scope = 'task-delete'")) {
                    events.push('delete-completed');
                    return { rowCount: 1, rows: [] };
                }
                return { rowCount: 1, rows: [] };
            },
            release: () => {}
        };
        const repository = new CanonicalTaskOperationRepository({
            pool: { query: poolQuery, connect: async () => client }, writerToken: 'writer-1'
        });

        await repository.executePreparedDelete({
            operationKey: 'delete:person-a:key-1',
            versionClaimKey: 'task-version:task_1:1',
            fingerprint: 'delete-fp',
            versionFingerprint: 'version-fp',
            principalNamespace: 'person-a',
            prepare: async () => ({
                authorizationSnapshot: { task_id: 'task_1', task_version: 1 },
                result: { task_id: 'task_1', deleted: true, version: 2 }
            }),
            findTask: async () => ({ id: 'task_1', version: 1 }),
            removeTask: async () => { events.push('task-removed'); }
        });

        expect(events).toEqual(['version-claim', 'delete-intent', 'task-removed', 'delete-completed']);
    });

    it('rejects changed input for an existing actor-scoped delete key', async () => {
        const query = async (sql) => {
            if (sql.includes('SELECT 1 FROM canonical_task_writer')) return { rowCount: 1, rows: [{}] };
            if (sql.includes("WHERE scope = 'task-delete'")) {
                return { rowCount: 1, rows: [{ fingerprint: 'original-fp', state: 'prepared', result_json: null }] };
            }
            return { rowCount: 0, rows: [] };
        };
        const repository = new CanonicalTaskOperationRepository({
            pool: { query }, writerToken: 'writer-1'
        });

        await expect(repository.executePreparedDelete({
            operationKey: 'delete:person-a:key-1', versionClaimKey: 'task-version:task_1:1',
            fingerprint: 'changed-fp', versionFingerprint: 'version-fp', principalNamespace: 'person-a'
        })).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
    });

    it('rejects another delete key from the same actor after the version was claimed', async () => {
        const query = async (sql) => {
            if (sql.includes('SELECT 1 FROM canonical_task_writer')) return { rowCount: 1, rows: [{}] };
            if (sql.includes("scope = 'task-delete'")) return { rowCount: 0, rows: [] };
            if (sql.includes("scope = 'task-version'")) {
                return { rowCount: 1, rows: [{ authorization_snapshot: { principal_namespace: 'person-a' } }] };
            }
            return { rowCount: 0, rows: [] };
        };
        const repository = new CanonicalTaskOperationRepository({ pool: { query }, writerToken: 'writer-1' });

        await expect(repository.executePreparedDelete({
            operationKey: 'delete:person-a:key-2', versionClaimKey: 'task-version:task_1:1',
            fingerprint: 'delete-fp-2', versionFingerprint: 'version-fp', principalNamespace: 'person-a',
            prepare: vi.fn()
        })).rejects.toMatchObject({ code: 'version_conflict', status: 409 });
    });

    it('does not disclose another actor delete result after the Task disappeared', async () => {
        const query = async (sql) => {
            if (sql.includes('SELECT 1 FROM canonical_task_writer')) return { rowCount: 1, rows: [{}] };
            if (sql.includes("scope = 'task-delete'")) return { rowCount: 0, rows: [] };
            if (sql.includes("scope = 'task-version'")) {
                return { rowCount: 1, rows: [{ authorization_snapshot: { principal_namespace: 'person-a' } }] };
            }
            return { rowCount: 0, rows: [] };
        };
        const repository = new CanonicalTaskOperationRepository({ pool: { query }, writerToken: 'writer-1' });
        const notFound = Object.assign(new Error('Task not found'), { code: 'task_not_found', status: 404 });

        await expect(repository.executePreparedDelete({
            operationKey: 'delete:person-b:key-1', versionClaimKey: 'task-version:task_1:1',
            fingerprint: 'delete-fp-b', versionFingerprint: 'version-fp', principalNamespace: 'person-b',
            prepare: async () => { throw notFound; }
        })).rejects.toMatchObject({ code: 'task_not_found', status: 404 });
    });
});
