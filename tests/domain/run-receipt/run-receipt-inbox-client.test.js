import { describe, expect, it, vi } from 'vitest';

import { RunReceiptInboxClient } from '../../../public/modules/domain/run-receipt/run-receipt-inbox-client.js';

function response(body, { ok = true, status = 200 } = {}) {
    return {
        ok,
        status,
        json: vi.fn().mockResolvedValue(body)
    };
}

describe('RunReceiptInboxClient', () => {
    it('list呼び出し時_指定filterだけをAPI queryへ符号化する', async () => {
        const apiFetch = vi.fn().mockResolvedValue(response({
            items: [], count: 0, has_more: false, omitted_count: 0
        }));
        const client = new RunReceiptInboxClient({ apiFetch });

        await client.list({
            project_id: 'brainbase / ops',
            source_type: 'github_actions',
            run_status: '',
            evidence_state: 'unconfirmed',
            limit: 50
        });

        expect(apiFetch).toHaveBeenCalledWith(
            '/api/run-receipts/inbox?project_id=brainbase+%2F+ops&source_type=github_actions&evidence_state=unconfirmed&limit=50'
        );
    });

    it('list呼び出し時_正しい一覧responseをそのまま返す', async () => {
        const payload = {
            items: [{ id: 'run-1', source: { type: 'mana', workflow_id: 'daily' } }],
            count: 1,
            has_more: false,
            omitted_count: 0
        };
        const client = new RunReceiptInboxClient({
            apiFetch: vi.fn().mockResolvedValue(response(payload))
        });

        await expect(client.list()).resolves.toEqual(payload);
    });

    it('list呼び出し時_HTTP失敗を空配列へ変換しない', async () => {
        const client = new RunReceiptInboxClient({
            apiFetch: vi.fn().mockResolvedValue(response({}, { ok: false, status: 503 }))
        });

        await expect(client.list()).rejects.toThrow('Run Receipt Inbox HTTP 503');
    });

    it.each([
        [{ items: null, count: 0, has_more: false, omitted_count: 0 }, 'items'],
        [{ items: [], count: -1, has_more: false, omitted_count: 0 }, 'count'],
        [{ items: [], count: 0, has_more: 'no', omitted_count: 0 }, 'has_more'],
        [{ items: [], count: 0, has_more: false, omitted_count: -1 }, 'omitted_count']
    ])('list呼び出し時_不正response %jを未確認として例外にする', async (payload, field) => {
        const client = new RunReceiptInboxClient({
            apiFetch: vi.fn().mockResolvedValue(response(payload))
        });

        await expect(client.list()).rejects.toThrow(`invalid Run Receipt Inbox response: ${field}`);
    });
});
