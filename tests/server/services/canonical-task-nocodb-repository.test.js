import { describe, expect, it, vi } from 'vitest';

import { CanonicalTaskNocoDBRepository } from '../../../server/services/companion/canonical-task-nocodb-repository.js';

const storeConfig = Object.freeze({
    schemaVersion: '1.0.0', baseId: 'base', tableId: 'table', tableName: 'タスク',
    project: 'brainbase', ownerPersonId: 'owner', identityHash: 'a'.repeat(64)
});

function response(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('CanonicalTaskNocoDBRepository', () => {
    it.each([
        ['invalid JSON', '{not-json', 'invalid_source_refs_json'],
        ['non-array JSON', '{"type":"meeting_note"}', 'invalid_source_refs_shape']
    ])('reports %s instead of silently discarding source references', (_label, sourceRefs, warningCode) => {
        const repository = new CanonicalTaskNocoDBRepository({
            storeConfig,
            fetchImpl: vi.fn(),
            apiToken: 'token',
            idSecret: 'secret'
        });
        const normalized = repository.normalize({
            Id: 99,
            タイトル: '出典を確認する',
            ステータス: '未着手',
            優先度: '中',
            ソース参照: sourceRefs
        });

        expect(normalized.source_refs).toEqual([]);
        expect(normalized.normalization_warnings).toContainEqual(expect.objectContaining({ code: warningCode }));
    });
    it('maps waiting and urgent without lifecycle loss', async () => {
        const fetchImpl = vi.fn(async () => response({ list: [{
            Id: 7, 'タイトル': '返事待ち', 'ステータス': '保留', '優先度': '緊急',
            '担当者PersonID': 'owner', '担当者': 'Owner', '待ち理由': '先方確認',
            'バージョン': 4, 'ソース参照': '[]', CreatedAt: '2026-07-14T00:00:00Z', UpdatedAt: '2026-07-14T01:00:00Z'
        }] }));
        const repository = new CanonicalTaskNocoDBRepository({ storeConfig, fetchImpl, apiToken: 'token', idSecret: 'secret' });
        const page = await repository.list({ statuses: ['waiting'], priorities: ['urgent'], limit: 50 });
        expect(page.items[0]).toMatchObject({ status: 'waiting', priority: 'urgent', waiting_on: '先方確認', version: 4 });
        expect(await repository.get(page.items[0].id)).toMatchObject({ title: '返事待ち' });
    });

    it('keeps the former waiting projection readable during migration', () => {
        const repository = new CanonicalTaskNocoDBRepository({ storeConfig, fetchImpl: vi.fn(), apiToken: 'token', idSecret: 'secret' });
        expect(repository.normalize({ Id: 70, 'タイトル': '旧待ち', 'ステータス': '待ち', '優先度': '中' }))
            .toMatchObject({ status: 'waiting' });
    });

    it('does not guess a legacy free-text assignee', () => {
        const repository = new CanonicalTaskNocoDBRepository({ storeConfig, fetchImpl: vi.fn(), apiToken: 'token', idSecret: 'secret' });
        const normalized = repository.normalize({ Id: 8, 'タイトル': '旧Task', 'ステータス': '未着手', '優先度': '中', '担当者': '佐藤さん' });
        expect(normalized.assignee_person_id).toBeNull();
        expect(normalized.normalization_warnings).toContainEqual(expect.objectContaining({ code: 'assignee_unresolved' }));
    });

    it('normalizes workflow and Mana source refs to the Mac wire contract', () => {
        const repository = new CanonicalTaskNocoDBRepository({ storeConfig, fetchImpl: vi.fn(), apiToken: 'token', idSecret: 'secret' });
        const normalized = repository.normalize({
            Id: 9,
            'タイトル': '生成Task',
            'ステータス': '未着手',
            '優先度': '中',
            'ソース参照': JSON.stringify([
                { type: 'workflow_output', output_id: 'out-1', candidate_id: 'candidate-1' },
                { type: 'mana_capture', capture_id: 'capture-1', content: '確認する' }
            ])
        });

        expect(normalized.source_refs).toEqual([
            { type: 'workflow_output', id: 'out-1', url: null },
            { type: 'mana_capture', id: 'capture-1', url: null }
        ]);
        expect(normalized).toHaveProperty('completed_at', null);
        expect(() => new URL(normalized.web_url)).not.toThrow();
    });

    it('pages beyond 1001 rows and finds an idempotency key on the final page', async () => {
        const records = Array.from({ length: 1002 }, (_, index) => ({
            Id: index + 1,
            'タイトル': `Task ${index + 1}`,
            'ステータス': '未着手',
            '優先度': '中',
            '担当者PersonID': 'owner',
            '冪等キー': index === 1001 ? 'api:owner:final-key' : null
        }));
        const fetchImpl = vi.fn(async (url) => {
            const offset = Number(new URL(url).searchParams.get('offset') || 0);
            const list = records.slice(offset, offset + 1000);
            return response({
                list,
                pageInfo: {
                    totalRows: records.length,
                    isLastPage: offset + list.length >= records.length
                }
            });
        });
        const repository = new CanonicalTaskNocoDBRepository({
            storeConfig,
            fetchImpl,
            apiToken: 'token',
            idSecret: 'secret'
        });

        await expect(repository.list({ limit: 50 })).resolves.toMatchObject({
            totalCount: 1002,
            countStatus: 'exact',
            readStatus: 'complete'
        });
        await expect(repository.findByIdempotencyKey('api:owner:final-key'))
            .resolves.toMatchObject({ title: 'Task 1002' });
        expect(fetchImpl).toHaveBeenCalledTimes(4);
        expect(fetchImpl.mock.calls.some(([url]) => new URL(url).searchParams.get('offset') === '1000')).toBe(true);
    });

    it('reads the authoritative row after NocoDB returns only the created record id', async () => {
        const persisted = {
            Id: 10,
            'タイトル': '作成後に読み直す',
            'ステータス': '未着手',
            '優先度': '高',
            '担当者PersonID': 'owner',
            'バージョン': 1,
            'ソース参照': '[]'
        };
        const fetchImpl = vi.fn(async (_url, options) => {
            if (options.method === 'POST') return response({ Id: 10 });
            return response({ list: [persisted], pageInfo: { totalRows: 1, isLastPage: true } });
        });
        const repository = new CanonicalTaskNocoDBRepository({ storeConfig, fetchImpl, apiToken: 'token', idSecret: 'secret' });

        await expect(repository.create({
            title: persisted['タイトル'],
            status: 'pending',
            priority: 'high',
            assignee_person_id: 'owner',
            version: 1,
            source_refs: [],
            idempotency_key: 'api:owner:create-readback'
        })).resolves.toMatchObject({
            title: persisted['タイトル'],
            status: 'pending',
            priority: 'high',
            assignee_person_id: 'owner'
        });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('reads the authoritative row after NocoDB returns only the updated record id', async () => {
        const persisted = {
            Id: 11,
            'タイトル': '更新後に読み直す',
            'ステータス': '進行中',
            '優先度': '中',
            '担当者PersonID': 'owner',
            'バージョン': 2,
            'ソース参照': '[]'
        };
        const fetchImpl = vi.fn(async (_url, options) => {
            if (options.method === 'PATCH') return response({ Id: 11 });
            return response({ list: [persisted], pageInfo: { totalRows: 1, isLastPage: true } });
        });
        const repository = new CanonicalTaskNocoDBRepository({ storeConfig, fetchImpl, apiToken: 'token', idSecret: 'secret' });
        const taskId = repository.encodeId('11');

        await expect(repository.update(taskId, { status: 'in_progress', version: 2 }))
            .resolves.toMatchObject({ title: persisted['タイトル'], status: 'in_progress', version: 2 });
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('retries only the authoritative read when PATCH committed before a transient read failure', async () => {
        const persisted = {
            Id: 12,
            'タイトル': '更新結果を再読込する',
            'ステータス': '進行中',
            '優先度': '中',
            '担当者PersonID': 'owner',
            'バージョン': 2,
            'ソース参照': '[]'
        };
        let readAttempts = 0;
        const fetchImpl = vi.fn(async (_url, options) => {
            if (options.method === 'PATCH') return response({ Id: 12 });
            readAttempts += 1;
            if (readAttempts === 1) return response({ message: 'temporary' }, 503);
            return response({ list: [persisted], pageInfo: { totalRows: 1, isLastPage: true } });
        });
        const repository = new CanonicalTaskNocoDBRepository({
            storeConfig,
            fetchImpl,
            apiToken: 'token',
            idSecret: 'secret',
            readAfterWriteDelaysMs: [0]
        });

        await expect(repository.update(repository.encodeId('12'), { status: 'in_progress', version: 2 }))
            .resolves.toMatchObject({ status: 'in_progress', version: 2 });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(fetchImpl.mock.calls.filter(([, options]) => options.method === 'PATCH')).toHaveLength(1);
    });

    it('rejects opaque ids from another store or with a forged signature', () => {
        const repository = new CanonicalTaskNocoDBRepository({ storeConfig, fetchImpl: vi.fn(), apiToken: 'token', idSecret: 'secret' });
        const id = repository.encodeId('7');
        expect(repository.decodeId(id)).toBe('7');
        expect(() => repository.decodeId(`${id}x`)).toThrowError(/not found/i);
    });

    it('keeps NocoDB failures explicit', async () => {
        const repository = new CanonicalTaskNocoDBRepository({
            storeConfig, apiToken: 'token', idSecret: 'secret',
            fetchImpl: vi.fn(async () => response({ message: 'down' }, 503))
        });
        await expect(repository.list()).rejects.toMatchObject({ code: 'task_store_unavailable', status: 503 });
    });
});
