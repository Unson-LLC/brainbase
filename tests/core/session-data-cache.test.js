import { describe, it, expect, beforeEach } from 'vitest';
import { SessionDataCache } from '../../public/modules/core/session-data-cache.js';

describe('SessionDataCache', () => {
    let cache;

    beforeEach(() => {
        cache = new SessionDataCache();
    });

    describe('get/set', () => {
        it('get呼び出し時_キャッシュ未登録_nullが返される', () => {
            const result = cache.get('tasks', 'session-1');
            expect(result).toBeNull();
        });

        it('set→get呼び出し時_キャッシュヒット_値が返される', () => {
            const tasks = [{ id: '1', name: 'Task 1' }];
            cache.set('tasks', 'session-1', tasks);

            const result = cache.get('tasks', 'session-1');
            expect(result).toEqual(tasks);
        });

        it('異なるセッションID_独立したキャッシュが保持される', () => {
            cache.set('tasks', 'session-1', [{ id: '1' }]);
            cache.set('tasks', 'session-2', [{ id: '2' }]);

            expect(cache.get('tasks', 'session-1')).toEqual([{ id: '1' }]);
            expect(cache.get('tasks', 'session-2')).toEqual([{ id: '2' }]);
        });
    });

    describe('TTL', () => {
        it('TTL超過時_キャッシュが無効化される', async () => {
            cache._ttls.tasks = 100; // 100ms TTL
            cache.set('tasks', 'session-1', [{ id: '1' }]);

            // TTL経過前: キャッシュヒット
            expect(cache.get('tasks', 'session-1')).toEqual([{ id: '1' }]);

            // TTL経過後: キャッシュミス
            await new Promise(r => setTimeout(r, 150));
            const result = cache.get('tasks', 'session-1');
            expect(result).toBeNull();
        });

        it('tasks TTL_5分が設定されている', () => {
            expect(cache._ttls.tasks).toBe(5 * 60 * 1000);
        });

        it('schedule TTL_1時間が設定されている', () => {
            expect(cache._ttls.schedule).toBe(60 * 60 * 1000);
        });
    });

    describe('invalidate', () => {
        it('invalidate呼び出し時_対象セッションのキャッシュが削除される', () => {
            cache.set('tasks', 'session-1', [{ id: '1' }]);
            cache.set('schedule', 'session-1', { items: [] });
            cache.set('tasks', 'session-2', [{ id: '2' }]);

            cache.invalidate('session-1');

            expect(cache.get('tasks', 'session-1')).toBeNull();
            expect(cache.get('schedule', 'session-1')).toBeNull();
            expect(cache.get('tasks', 'session-2')).not.toBeNull();
        });

        it('invalidate呼び出し時_削除されたキャッシュ数が返される', () => {
            cache.set('tasks', 'session-1', [{ id: '1' }]);
            cache.set('schedule', 'session-1', { items: [] });

            cache.invalidate('session-1');

            // getStatsで確認
            const stats = cache.getStats();
            expect(stats.size).toBe(0);
        });
    });

    describe('clear', () => {
        it('clear呼び出し時_全キャッシュが削除される', () => {
            cache.set('tasks', 'session-1', [{ id: '1' }]);
            cache.set('schedule', 'session-2', { items: [] });

            cache.clear();

            expect(cache.get('tasks', 'session-1')).toBeNull();
            expect(cache.get('schedule', 'session-2')).toBeNull();
        });
    });

    describe('getStats', () => {
        it('getStats呼び出し時_キャッシュ統計が返される', () => {
            cache.set('tasks', 'session-1', [{ id: '1' }]);
            cache.set('schedule', 'session-1', { items: [] });

            const stats = cache.getStats();
            expect(stats.size).toBe(2);
            expect(stats.keys).toContain('session-1:tasks');
            expect(stats.keys).toContain('session-1:schedule');
        });
    });

    describe('debug mode', () => {
        it('setDebugMode(true)_デバッグログが有効化される', () => {
            const logs = [];
            const originalLog = console.log;
            console.log = (...args) => logs.push(args.join(' '));

            cache.setDebugMode(true);
            cache.set('tasks', 'session-1', [{ id: '1' }]);
            cache.get('tasks', 'session-1');

            console.log = originalLog;

            expect(logs.some(log => log.includes('[SessionDataCache]'))).toBe(true);
        });
    });
});
