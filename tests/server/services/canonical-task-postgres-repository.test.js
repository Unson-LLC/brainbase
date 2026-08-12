import { describe, expect, it, vi } from 'vitest';

import { CanonicalTaskPostgresRepository } from '../../../server/services/companion/canonical-task-postgres-repository.js';

// VibePro traceability: story-canonical-task-bounded-search:ac:2, story-canonical-task-bounded-search:ac:3, story-canonical-task-bounded-search:ac:4, story-canonical-task-bounded-search:ac:5, story-canonical-task-bounded-search:ac:9.

const storeConfig = Object.freeze({
    schemaVersion: '1.0.0',
    baseId: 'base',
    tableId: 'table'
});

const persisted = Object.freeze({
    id: '9a92b7f8-a89e-41d0-b275-04cb11fb38e7',
    legacy_nocodb_id: null,
    title: 'PostgreSQL Task',
    description: null,
    status: 'pending',
    priority: 'medium',
    project_codes: ['mana', 'brainbase'],
    assignee_person_id: 'person-1',
    assignee_display_name: 'Owner',
    due_at: null,
    waiting_on: null,
    review_at: null,
    completed_at: null,
    source_refs: [],
    version: 1,
    idempotency_key: 'api:person-1:create',
    payload_fingerprint: 'payload',
    last_operation_key: null,
    last_operation_fingerprint: null,
    created_at: '2026-07-28T00:00:00Z',
    updated_at: '2026-07-28T00:00:00Z'
});

function repository(pool) {
    return new CanonicalTaskPostgresRepository({
        pool,
        storeConfig,
        idSecret: 'secret',
        webBaseUrl: 'https://bb.example.test'
    });
}

describe('CanonicalTaskPostgresRepository', () => {
    it('keeps migrated NocoDB opaque IDs stable and rejects another store', () => {
        const repo = repository({ query: vi.fn() });
        const legacyId = repo.encodeLegacyId('42');
        expect(repo.decodeId(legacyId)).toEqual({ column: 'legacy_nocodb_id', value: '42' });
        expect(repo.normalize({ ...persisted, legacy_nocodb_id: '42' }).id).toBe(legacyId);

        const foreign = repo.encodePayload({ v: '1.0.0', b: 'other', t: 'table', r: '42' });
        expect(() => repo.decodeId(foreign)).toThrow('Task not found');
    });

    it('applies filters, exact count, and cursor pagination in SQL', async () => {
        const pool = {
            query: vi.fn()
                .mockResolvedValueOnce({ rows: [{ count: 2 }] })
                .mockResolvedValueOnce({ rows: [persisted] })
        };
        const page = await repository(pool).list({
            statuses: ['pending'],
            priorities: ['medium'],
            projectCodes: ['mana', 'brainbase'],
            assigneePersonId: 'person-1',
            dueAfter: '2026-07-01T00:00:00Z',
            dueBefore: '2026-08-01T00:00:00Z',
            limit: 1
        });
        expect(page).toMatchObject({
            totalCount: 2,
            countStatus: 'exact',
            readStatus: 'complete',
            items: [{ title: 'PostgreSQL Task' }]
        });
        expect(page.nextCursor).toBeTruthy();
        expect(pool.query.mock.calls[0][0]).toContain('status = ANY($1::text[])');
        expect(pool.query.mock.calls[0][0]).toContain('project_codes && $3::text[]');
        expect(pool.query.mock.calls[1][0]).toContain('LIMIT $7 OFFSET $8');
    });

    it('searches title tokens with bounded keyset pagination and no count or offset scan', async () => {
        const second = {
            ...persisted,
            id: '6246fb20-9d7a-42af-9df0-5223e331bc83',
            title: '月次 締め作業',
            created_at: '2026-07-27T00:00:00Z'
        };
        const pool = { query: vi.fn().mockResolvedValue({ rows: [persisted, second] }) };
        const page = await repository(pool).search({
            tokens: ['月次', '締め'],
            statuses: ['pending'],
            projectCodes: ['back-office'],
            assigneePersonId: 'person-1',
            limit: 1
        });

        expect(page).toMatchObject({
            totalCount: null,
            countStatus: 'not_requested',
            readStatus: 'complete',
            hasMore: true,
            items: [{ title: 'PostgreSQL Task' }]
        });
        expect(page.nextCursor).toBeTruthy();
        expect(pool.query).toHaveBeenCalledTimes(1);
        const [sql, values] = pool.query.mock.calls[0];
        expect(sql).toContain("title ILIKE $1 ESCAPE E'\\\\'");
        expect(sql).toContain("title ILIKE $2 ESCAPE E'\\\\'");
        expect(sql).toContain('project_codes && $4::text[]');
        expect(sql).toContain('ORDER BY created_at DESC, id DESC');
        expect(sql).not.toContain('COUNT(');
        expect(sql).not.toContain('OFFSET');
        expect(values.at(-1)).toBe(2);
    });

    it('rejects an invalid bounded search cursor before querying PostgreSQL', async () => {
        const pool = { query: vi.fn() };

        await expect(repository(pool).search({
            tokens: ['月次'],
            cursor: 'not-a-valid-cursor'
        })).rejects.toMatchObject({
            code: 'validation_failed',
            status: 422,
            fieldErrors: { cursor: ['invalid_cursor'] }
        });
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('rejects a search cursor whose ID is not a valid UUID', async () => {
        const pool = { query: vi.fn() };
        const cursor = Buffer.from(JSON.stringify({
            v: 1,
            created_at: '2026-07-27T00:00:00Z',
            id: '------------------------------------'
        })).toString('base64url');

        await expect(repository(pool).search({ tokens: ['月次'], cursor })).rejects.toMatchObject({
            code: 'validation_failed',
            status: 422,
            fieldErrors: { cursor: ['invalid_cursor'] }
        });
        expect(pool.query).not.toHaveBeenCalled();
    });

    it('creates idempotently and preserves operation markers', async () => {
        const pool = { query: vi.fn().mockResolvedValue({ rows: [persisted] }) };
        const created = await repository(pool).create({
            title: persisted.title,
            status: 'pending',
            priority: 'medium',
            assignee_person_id: 'person-1',
            source_refs: [],
            version: 1,
            idempotency_key: persisted.idempotency_key,
            payload_fingerprint: 'payload'
        });
        expect(created).toMatchObject({ title: persisted.title, version: 1 });
        expect(created._payload_fingerprint).toBe('payload');
        expect(pool.query.mock.calls[0][0]).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
        expect(pool.query.mock.calls[0][0]).toContain('project_codes');
    });

    it('updates fields and version atomically using a legacy locator', async () => {
        const pool = { query: vi.fn().mockResolvedValue({ rows: [{ ...persisted, status: 'in_progress', version: 2 }] }) };
        const repo = repository(pool);
        const updated = await repo.update(repo.encodeLegacyId('42'), {
            status: 'in_progress',
            version: 2,
            last_operation_key: 'operation-1'
        });
        expect(updated).toMatchObject({ status: 'in_progress', version: 2 });
        expect(pool.query.mock.calls[0][0]).toContain('WHERE legacy_nocodb_id = $4');
        expect(pool.query.mock.calls[0][0]).toContain('updated_at = NOW()');
    });

    it('fails closed when PostgreSQL is unavailable', async () => {
        const repo = repository({ query: vi.fn().mockRejectedValue(new Error('connection refused')) });
        await expect(repo.list()).rejects.toMatchObject({
            code: 'task_store_unavailable',
            status: 503
        });
    });
});
