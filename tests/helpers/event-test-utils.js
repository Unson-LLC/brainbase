import { vi } from 'vitest';

/**
 * EventBusイベントをリッスンするヘルパー
 * @param {Object} eventBus - EventBusインスタンス
 * @param {string} eventName - リッスンするイベント名
 * @returns {{ listener: Function, getDetail: Function }}
 */
export function listenForEvent(eventBus, eventName) {
    const listener = vi.fn();
    eventBus.on(eventName, listener);

    return {
        listener,
        getDetail: () => listener.mock.calls[0]?.[0]?.detail,
        getDetailAt: (n) => listener.mock.calls[n]?.[0]?.detail,
    };
}
