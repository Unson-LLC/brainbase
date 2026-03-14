import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InputDraftStore } from '../../public/modules/core/input-draft-store.js';

/**
 * 汎用入力ドラフト保存テスト（CommandMate移植）
 * セッションごとにlocalStorageにドラフトを保存・復元
 */
describe('InputDraftStore', () => {
    let store;
    let mockStorage;

    beforeEach(() => {
        mockStorage = {};
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(key => mockStorage[key] || null),
            setItem: vi.fn((key, value) => { mockStorage[key] = value; }),
            removeItem: vi.fn(key => { delete mockStorage[key]; }),
        });
        store = new InputDraftStore();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('save()', () => {
        it('セッションIDでドラフトを保存する', () => {
            store.save('session-1', 'Hello World');

            expect(localStorage.setItem).toHaveBeenCalled();
            const savedKey = localStorage.setItem.mock.calls[0][0];
            expect(savedKey).toContain('session-1');
        });

        it('空文字列も保存できる', () => {
            store.save('session-1', '');

            const draft = store.load('session-1');
            expect(draft).toBe('');
        });
    });

    describe('load()', () => {
        it('保存済みドラフトを復元する', () => {
            store.save('session-1', 'Draft text');
            const draft = store.load('session-1');

            expect(draft).toBe('Draft text');
        });

        it('未保存セッション_nullを返す', () => {
            const draft = store.load('nonexistent');
            expect(draft).toBeNull();
        });

        it('壊れたJSON_nullを返す', () => {
            mockStorage['bb:draft:session-1'] = 'not json';
            const draft = store.load('session-1');
            expect(draft).toBeNull();
        });
    });

    describe('remove()', () => {
        it('ドラフトを削除する', () => {
            store.save('session-1', 'text');
            store.remove('session-1');

            expect(store.load('session-1')).toBeNull();
        });
    });

    describe('has()', () => {
        it('ドラフトあり_trueを返す', () => {
            store.save('session-1', 'text');
            expect(store.has('session-1')).toBe(true);
        });

        it('ドラフトなし_falseを返す', () => {
            expect(store.has('session-1')).toBe(false);
        });

        it('空文字列ドラフト_falseを返す', () => {
            store.save('session-1', '');
            expect(store.has('session-1')).toBe(false);
        });
    });
});
