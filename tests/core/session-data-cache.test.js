import { describe, expect, it } from 'vitest';
import { SessionDataCache } from '../../public/modules/core/session-data-cache.js';

describe('SessionDataCache', () => {
    it('invalidate() は scope invalidate の後方互換として動く', () => {
        const cache = new SessionDataCache();
        cache.set('tasks', 'session-1', [{ id: 1 }]);
        cache.set('schedule', 'session-1', { ok: true });

        cache.invalidate('session-1');

        expect(cache.get('tasks', 'session-1')).toBeNull();
        expect(cache.get('schedule', 'session-1')).toBeNull();
    });
});
