import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getTerminalViewerId } from '../../public/modules/core/terminal-viewer.js';

const VIEWER_ID_STORAGE_KEY = 'brainbase-terminal-viewer-id';

function createMemoryStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        _dump: () => new Map(map)
    };
}

describe('getTerminalViewerId', () => {
    const originalWindow = globalThis.window;

    afterEach(() => {
        globalThis.window = originalWindow;
        vi.restoreAllMocks();
    });

    it('windowが無い場合_viewer-serverを返す', () => {
        delete globalThis.window;
        expect(getTerminalViewerId()).toBe('viewer-server');
    });

    it('localStorageにviewerIdを永続化する', () => {
        const localStorage = createMemoryStorage();
        globalThis.window = { localStorage, sessionStorage: createMemoryStorage() };

        const id = getTerminalViewerId();

        expect(id).toBeTruthy();
        expect(localStorage.getItem(VIEWER_ID_STORAGE_KEY)).toBe(id);
    });

    it('同一localStorageから複数回呼ぶと同じviewerIdを返す', () => {
        const localStorage = createMemoryStorage();
        globalThis.window = { localStorage, sessionStorage: createMemoryStorage() };

        const first = getTerminalViewerId();
        const second = getTerminalViewerId();

        expect(second).toBe(first);
    });

    it('タブを閉じて開き直してもlocalStorageに残っていれば同じviewerIdに戻る', () => {
        const localStorage = createMemoryStorage();

        // タブ1: viewerIdを発行
        globalThis.window = { localStorage, sessionStorage: createMemoryStorage() };
        const first = getTerminalViewerId();

        // タブを閉じる = sessionStorageは消えるがlocalStorageは残る → 新しいタブで開き直す
        globalThis.window = { localStorage, sessionStorage: createMemoryStorage() };
        const afterReopen = getTerminalViewerId();

        // 同じownerに戻るので「別のviewerが使用中」で自己ブロックされない
        expect(afterReopen).toBe(first);
    });

    it('localStorageがブロックされている場合_sessionStorageにフォールバックする', () => {
        const sessionStorage = createMemoryStorage();
        globalThis.window = {
            get localStorage() {
                throw new Error('localStorage is disabled');
            },
            sessionStorage
        };

        const id = getTerminalViewerId();

        expect(id).toBeTruthy();
        expect(sessionStorage.getItem(VIEWER_ID_STORAGE_KEY)).toBe(id);
    });
});
