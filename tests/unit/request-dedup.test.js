import { describe, it, expect, vi } from 'vitest';
import { RequestDeduplicator } from '../../public/modules/core/request-dedup.js';

/**
 * リクエスト重複排除テスト（CommandMate移植）
 * 同一キーの同時リクエストを1つにまとめる
 */
describe('RequestDeduplicator', () => {
    it('同一キーの同時リクエスト_1回だけ実行される', async () => {
        const fetchFn = vi.fn().mockResolvedValue({ data: 'result' });
        const dedup = new RequestDeduplicator();

        const [r1, r2, r3] = await Promise.all([
            dedup.dedupe('key1', fetchFn),
            dedup.dedupe('key1', fetchFn),
            dedup.dedupe('key1', fetchFn),
        ]);

        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(r1).toEqual({ data: 'result' });
        expect(r2).toEqual({ data: 'result' });
        expect(r3).toEqual({ data: 'result' });
    });

    it('異なるキー_それぞれ実行される', async () => {
        const fetchFn = vi.fn().mockResolvedValue('ok');
        const dedup = new RequestDeduplicator();

        await Promise.all([
            dedup.dedupe('key1', fetchFn),
            dedup.dedupe('key2', fetchFn),
        ]);

        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('前のリクエスト完了後_新しいリクエストが実行される', async () => {
        let callCount = 0;
        const fetchFn = vi.fn().mockImplementation(() => {
            callCount++;
            return Promise.resolve(`result-${callCount}`);
        });
        const dedup = new RequestDeduplicator();

        const r1 = await dedup.dedupe('key1', fetchFn);
        expect(r1).toBe('result-1');

        const r2 = await dedup.dedupe('key1', fetchFn);
        expect(r2).toBe('result-2');
        expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('リクエスト失敗_全待機者にエラーが伝播する', async () => {
        const fetchFn = vi.fn().mockRejectedValue(new Error('fetch failed'));
        const dedup = new RequestDeduplicator();

        const results = await Promise.allSettled([
            dedup.dedupe('key1', fetchFn),
            dedup.dedupe('key1', fetchFn),
        ]);

        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(results[0].status).toBe('rejected');
        expect(results[1].status).toBe('rejected');
        expect(results[0].reason.message).toBe('fetch failed');
    });

    it('失敗後_再実行可能になる', async () => {
        const fetchFn = vi.fn()
            .mockRejectedValueOnce(new Error('fail'))
            .mockResolvedValue('success');
        const dedup = new RequestDeduplicator();

        await expect(dedup.dedupe('key1', fetchFn)).rejects.toThrow('fail');

        const r2 = await dedup.dedupe('key1', fetchFn);
        expect(r2).toBe('success');
    });

    it('hasPending()_進行中リクエストの有無を返す', async () => {
        let resolvePromise;
        const fetchFn = vi.fn().mockImplementation(() =>
            new Promise(resolve => { resolvePromise = resolve; })
        );
        const dedup = new RequestDeduplicator();

        expect(dedup.hasPending('key1')).toBe(false);

        const promise = dedup.dedupe('key1', fetchFn);
        expect(dedup.hasPending('key1')).toBe(true);

        resolvePromise('done');
        await promise;
        expect(dedup.hasPending('key1')).toBe(false);
    });
});
