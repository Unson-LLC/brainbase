import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initPerformanceMetrics } from '../../public/modules/performance-metrics.js';

describe('PerformanceMetrics', () => {
    let mockLocalStorage;
    let originalWindow;

    beforeEach(() => {
        // LocalStorageのモック
        mockLocalStorage = {
            data: {},
            getItem(key) {
                return this.data[key] || null;
            },
            setItem(key, value) {
                this.data[key] = value;
            },
            removeItem(key) {
                delete this.data[key];
            },
            clear() {
                this.data = {};
            }
        };

        // windowオブジェクトのモック
        originalWindow = global.window;
        global.window = {
            localStorage: mockLocalStorage
        };
    });

    afterEach(() => {
        global.window = originalWindow;
        mockLocalStorage.clear();
    });

    describe('initPerformanceMetrics', () => {
        it('シングルトンインスタンスを返す', () => {
            const api1 = initPerformanceMetrics({ attachToWindow: false });
            const api2 = initPerformanceMetrics({ attachToWindow: false });

            expect(api1).toBe(api2);

            api1.destroy();
        });

        it('APIメソッドを提供する', () => {
            const api = initPerformanceMetrics({ attachToWindow: false });

            expect(api).toHaveProperty('getSamples');
            expect(api).toHaveProperty('getSummary');
            expect(api).toHaveProperty('reset');
            expect(api).toHaveProperty('export');
            expect(api).toHaveProperty('destroy');

            api.destroy();
        });

        it('attachToWindow=trueの場合、window.brainbasePerfに登録される', () => {
            const api = initPerformanceMetrics({ attachToWindow: true });

            expect(window.brainbasePerf).toBe(api);

            api.destroy();
        });
    });

    describe('getSamples', () => {
        it('初期状態で空のサンプルを返す', () => {
            const api = initPerformanceMetrics({ attachToWindow: false });
            const samples = api.getSamples();

            expect(samples).toEqual({
                sessionSwitch: [],
                sessionRestore: [],
                mobileLoad: []
            });

            api.destroy();
        });
    });

    describe('getSummary', () => {
        it('初期状態でカウント0のサマリーを返す', () => {
            const api = initPerformanceMetrics({ attachToWindow: false });
            const summary = api.getSummary();

            expect(summary.sessionSwitch.count).toBe(0);
            expect(summary.sessionRestore.count).toBe(0);
            expect(summary.mobileLoad.count).toBe(0);
            expect(summary.generatedAt).toBeTruthy();

            api.destroy();
        });

        it('サマリーに必要な統計情報を含む', () => {
            const api = initPerformanceMetrics({ attachToWindow: false });
            const summary = api.getSummary();

            expect(summary.sessionSwitch).toHaveProperty('count');
            expect(summary.sessionSwitch).toHaveProperty('p50');
            expect(summary.sessionSwitch).toHaveProperty('p95');
            expect(summary.sessionSwitch).toHaveProperty('min');
            expect(summary.sessionSwitch).toHaveProperty('max');
            expect(summary.sessionSwitch).toHaveProperty('lastDurationMs');
            expect(summary.sessionSwitch).toHaveProperty('lastAt');

            api.destroy();
        });
    });

    describe('reset', () => {
        it('全てのサンプルをクリアする', () => {
            const api = initPerformanceMetrics({ attachToWindow: false });

            // LocalStorageに既存データを設定
            mockLocalStorage.setItem('bb_perf_samples_v1', JSON.stringify({
                sessionSwitch: [{ durationMs: 100, timestamp: '2026-01-01T00:00:00Z' }],
                sessionRestore: [],
                mobileLoad: []
            }));

            // リセット実行
            api.reset();

            const samples = api.getSamples();
            expect(samples.sessionSwitch).toEqual([]);
            expect(samples.sessionRestore).toEqual([]);
            expect(samples.mobileLoad).toEqual([]);

            api.destroy();
        });
    });

    describe('export', () => {
        it('JSON形式でデータをエクスポートする', () => {
            const api = initPerformanceMetrics({ attachToWindow: false });
            const exported = api.export();

            expect(() => JSON.parse(exported)).not.toThrow();

            const data = JSON.parse(exported);
            expect(data).toHaveProperty('generatedAt');
            expect(data).toHaveProperty('summary');
            expect(data).toHaveProperty('samples');

            api.destroy();
        });
    });

    describe('destroy', () => {
        it('シングルトンインスタンスをクリアする', () => {
            const api1 = initPerformanceMetrics({ attachToWindow: false });
            api1.destroy();

            const api2 = initPerformanceMetrics({ attachToWindow: false });
            expect(api1).not.toBe(api2);

            api2.destroy();
        });

        it('window.brainbasePerfを削除する', () => {
            const api = initPerformanceMetrics({ attachToWindow: true });
            expect(window.brainbasePerf).toBe(api);

            api.destroy();
            expect(window.brainbasePerf).toBeUndefined();
        });
    });

    describe('LocalStorage永続化', () => {
        it('resetでLocalStorageに保存される', () => {
            const api = initPerformanceMetrics({ attachToWindow: false });
            api.reset();

            const stored = mockLocalStorage.getItem('bb_perf_samples_v1');
            expect(stored).toBeTruthy();

            const parsed = JSON.parse(stored);
            expect(parsed).toHaveProperty('sessionSwitch');
            expect(parsed).toHaveProperty('sessionRestore');
            expect(parsed).toHaveProperty('mobileLoad');

            api.destroy();
        });
    });
});
