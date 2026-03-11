import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionDataCache } from '../../public/modules/core/session-data-cache.js';

describe('SessionDataCache', () => {
    let cache;

    beforeEach(() => {
        cache = new SessionDataCache();
        vi.useRealTimers();
    });

    it('global scopeでset/getできる', () => {
        const tasks = [{ id: '1', title: 'Task 1' }];

        cache.set('tasks', 'global', tasks);

        expect(cache.get('tasks')).toEqual(tasks);
    });

    it('invalidateType呼び出し時_指定typeだけ削除される', () => {
        cache.set('tasks', 'global', [{ id: '1' }]);
        cache.set('schedule', 'global', { items: [{ id: 'a' }] });

        cache.invalidateType('tasks');

        expect(cache.get('tasks')).toBeNull();
        expect(cache.get('schedule')).toEqual({ items: [{ id: 'a' }] });
    });

    it('invalidateScope呼び出し時_対象scopeのキャッシュが削除される', () => {
        cache.set('tasks', 'global', [{ id: '1' }]);
        cache.set('schedule', 'global', { items: [{ id: 'a' }] });
        cache.set('tasks', 'session-x', [{ id: '2' }]);

        cache.invalidateScope('global');

        expect(cache.get('tasks')).toBeNull();
        expect(cache.get('schedule')).toBeNull();
        expect(cache.get('tasks', 'session-x')).toEqual([{ id: '2' }]);
    });

    it('TTL切れ時_nullを返す', () => {
        vi.useFakeTimers();
        cache.set('tasks', 'global', [{ id: '1' }]);

        vi.advanceTimersByTime(5 * 60 * 1000 + 1);

        expect(cache.get('tasks')).toBeNull();
    });
});
