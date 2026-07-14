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
    it('maps waiting and urgent without lifecycle loss', async () => {
        const fetchImpl = vi.fn(async () => response({ list: [{
            Id: 7, 'タイトル': '返事待ち', 'ステータス': '待ち', '優先度': '緊急',
            '担当者PersonID': 'owner', '担当者': 'Owner', '待ち理由': '先方確認',
            'バージョン': 4, 'ソース参照': '[]', CreatedAt: '2026-07-14T00:00:00Z', UpdatedAt: '2026-07-14T01:00:00Z'
        }] }));
        const repository = new CanonicalTaskNocoDBRepository({ storeConfig, fetchImpl, apiToken: 'token', idSecret: 'secret' });
        const page = await repository.list({ statuses: ['waiting'], priorities: ['urgent'], limit: 50 });
        expect(page.items[0]).toMatchObject({ status: 'waiting', priority: 'urgent', waiting_on: '先方確認', version: 4 });
        expect(await repository.get(page.items[0].id)).toMatchObject({ title: '返事待ち' });
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
