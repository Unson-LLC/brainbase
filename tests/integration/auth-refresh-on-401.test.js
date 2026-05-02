import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient } from '../../public/modules/core/http-client.js';
import { AuthManager } from '../../public/modules/auth/auth-manager.js';

/**
 * Integration: NocoDB課題#6「ログインがすぐ切れる」
 *
 * AuthManager constructor で http-client.setUnauthorizedHandler() に
 * refreshSession を紐付け、 401受信時に自動 refresh + retry が走る。
 */

function makeUrlBasedFetchMock({ onUsers, refreshResponse }) {
    let usersCallCount = 0;
    let refreshCount = 0;
    const calls = [];
    const fetchMock = vi.fn(async (url, opts) => {
        const u = String(url);
        calls.push({ url: u, method: opts?.method ?? 'GET' });

        if (u.includes('/api/csrf-token')) {
            return { ok: true, json: async () => ({ token: 'csrf-tok' }), headers: new Headers(), redirected: false, url: u };
        }
        if (u.includes('/api/auth/refresh')) {
            refreshCount += 1;
            return refreshResponse({ refreshCount });
        }
        // /users path
        usersCallCount += 1;
        return onUsers({ usersCallCount });
    });
    return { fetchMock, calls, getUsersCallCount: () => usersCallCount, getRefreshCount: () => refreshCount };
}

describe('auth refresh-on-401 integration', () => {
    let client;
    let authManager;
    let originalLocalStorage;

    beforeEach(() => {
        originalLocalStorage = global.localStorage;
        const store = new Map();
        global.localStorage = {
            getItem: (k) => store.get(k) ?? null,
            setItem: (k, v) => store.set(k, v),
            removeItem: (k) => store.delete(k)
        };
        if (typeof globalThis.window === 'undefined') {
            globalThis.window = { localStorage: global.localStorage, location: { origin: 'http://localhost' } };
        } else {
            globalThis.window.localStorage = global.localStorage;
        }

        client = new HttpClient({ baseURL: 'http://localhost' });
        authManager = new AuthManager({ httpClient: client });
        authManager.refreshToken = 'refresh-tok-1';
        authManager.token = 'access-tok-old';
        client.setAuthToken('access-tok-old');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        global.localStorage = originalLocalStorage;
    });

    it('401受信時_AuthManagerのrefreshSessionが呼ばれて新tokenでretry成功', async () => {
        const { fetchMock, getUsersCallCount, getRefreshCount } = makeUrlBasedFetchMock({
            onUsers: ({ usersCallCount }) => {
                if (usersCallCount === 1) {
                    return { ok: false, status: 401, statusText: 'Unauthorized', headers: new Headers(), redirected: false, url: 'http://localhost/users' };
                }
                return { ok: true, json: async () => ({ data: 'success' }), headers: new Headers(), redirected: false, url: 'http://localhost/users' };
            },
            refreshResponse: () => ({
                ok: true,
                json: async () => ({ token: 'access-tok-new', refresh_token: 'refresh-tok-2', access: { user: 'u1' } }),
                headers: new Headers(),
                redirected: false
            })
        });
        global.fetch = fetchMock;

        const result = await client.get('/users');

        expect(getUsersCallCount()).toBe(2);  // 元 + retry
        expect(getRefreshCount()).toBe(1);     // refresh 1回
        expect(authManager.token).toBe('access-tok-new');
        expect(result).toEqual({ data: 'success' });
    });

    it('refreshTokenが無い時_handlerはfalseを返してretryしない', async () => {
        authManager.refreshToken = null;
        const { fetchMock, getUsersCallCount, getRefreshCount } = makeUrlBasedFetchMock({
            onUsers: () => ({ ok: false, status: 401, statusText: 'Unauthorized', headers: new Headers(), redirected: false, url: 'http://localhost/users', json: async () => ({ error: 'unauthorized' }) }),
            refreshResponse: () => ({ ok: true, json: async () => ({ token: 'never' }) })
        });
        global.fetch = fetchMock;

        await expect(client.get('/users')).rejects.toThrow();
        expect(getUsersCallCount()).toBe(1);
        expect(getRefreshCount()).toBe(0);
    });

    it('複数の同時401_refreshは1回しか走らない', async () => {
        const { fetchMock, getRefreshCount } = makeUrlBasedFetchMock({
            onUsers: () => ({ ok: true, json: async () => ({ data: 'ok' }), headers: new Headers(), redirected: false }),
            refreshResponse: () => ({ ok: true, json: async () => ({ token: 'new-tok', refresh_token: 'r2' }), headers: new Headers(), redirected: false })
        });
        // 元 a/b 両方を 401 で返すようcustom
        let aCalls = 0;
        let bCalls = 0;
        global.fetch = vi.fn(async (url, opts) => {
            const u = String(url);
            if (u.includes('/api/csrf-token')) return { ok: true, json: async () => ({ token: 'csrf' }), headers: new Headers() };
            if (u.includes('/api/auth/refresh')) {
                return { ok: true, json: async () => ({ token: 'new-tok', refresh_token: 'r2' }), headers: new Headers() };
            }
            if (u.endsWith('/a')) {
                aCalls += 1;
                if (aCalls === 1) return { ok: false, status: 401, statusText: 'Unauthorized', headers: new Headers(), redirected: false, url: u };
                return { ok: true, json: async () => ({ a: 1 }), headers: new Headers() };
            }
            if (u.endsWith('/b')) {
                bCalls += 1;
                if (bCalls === 1) return { ok: false, status: 401, statusText: 'Unauthorized', headers: new Headers(), redirected: false, url: u };
                return { ok: true, json: async () => ({ b: 2 }), headers: new Headers() };
            }
            return { ok: false, status: 500 };
        });

        const [resA, resB] = await Promise.all([client.get('/a'), client.get('/b')]);

        const calls = global.fetch.mock.calls.filter((args) => String(args[0]).includes('/api/auth/refresh'));
        expect(calls.length).toBe(1);  // 同時401で refresh は1回しか走らない
        expect(resA).toEqual({ a: 1 });
        expect(resB).toEqual({ b: 2 });
    });
});
