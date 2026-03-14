import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AdaptivePoller } from '../../public/modules/core/adaptive-poller.js';

/**
 * アダプティブポーリングテスト（CommandMate移植）
 * セッション状態に応じてポーリング間隔を動的に変更
 */
describe('AdaptivePoller', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('デフォルト間隔（idle=5秒）でポーリングを開始する', () => {
        const pollFn = vi.fn();
        const poller = new AdaptivePoller(pollFn);
        poller.start();

        expect(pollFn).toHaveBeenCalledTimes(1); // initial call

        vi.advanceTimersByTime(5000);
        expect(pollFn).toHaveBeenCalledTimes(2);

        poller.stop();
    });

    it('setActive(true)_アクティブ間隔に切り替える', () => {
        const pollFn = vi.fn();
        const poller = new AdaptivePoller(pollFn, {
            activeIntervalMs: 2000,
            idleIntervalMs: 5000
        });
        poller.start();
        pollFn.mockClear();

        poller.setActive(true);

        vi.advanceTimersByTime(2000);
        expect(pollFn).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(2000);
        expect(pollFn).toHaveBeenCalledTimes(2);

        poller.stop();
    });

    it('setActive(false)_アイドル間隔に切り替える', () => {
        const pollFn = vi.fn();
        const poller = new AdaptivePoller(pollFn, {
            activeIntervalMs: 2000,
            idleIntervalMs: 5000
        });
        poller.start();
        poller.setActive(true);
        pollFn.mockClear();

        poller.setActive(false);

        vi.advanceTimersByTime(2000);
        expect(pollFn).toHaveBeenCalledTimes(0); // not yet

        vi.advanceTimersByTime(3000); // total 5000
        expect(pollFn).toHaveBeenCalledTimes(1);

        poller.stop();
    });

    it('stop()_ポーリングを停止する', () => {
        const pollFn = vi.fn();
        const poller = new AdaptivePoller(pollFn);
        poller.start();
        pollFn.mockClear();

        poller.stop();

        vi.advanceTimersByTime(10000);
        expect(pollFn).toHaveBeenCalledTimes(0);
    });

    it('getCurrentInterval()_現在の間隔を返す', () => {
        const poller = new AdaptivePoller(() => {}, {
            activeIntervalMs: 2000,
            idleIntervalMs: 5000
        });

        expect(poller.getCurrentInterval()).toBe(5000); // default idle

        poller.setActive(true);
        expect(poller.getCurrentInterval()).toBe(2000);

        poller.setActive(false);
        expect(poller.getCurrentInterval()).toBe(5000);
    });

    it('同じ状態への二重切り替え_タイマーリセットしない', () => {
        const pollFn = vi.fn();
        const poller = new AdaptivePoller(pollFn, {
            activeIntervalMs: 2000,
            idleIntervalMs: 5000
        });
        poller.start();
        poller.setActive(true);
        pollFn.mockClear();

        // 同じ状態に再度設定 - タイマーは変わらない
        const intervalBefore = poller._timer;
        poller.setActive(true);
        expect(poller._timer).toBe(intervalBefore);

        poller.stop();
    });
});
