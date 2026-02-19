/**
 * EventBusデバッグツール
 * 開発時のイベントチェーン可視化・トラブルシューティング用
 *
 * 使い方:
 *   import { enableEventBusDebug, traceCorrelation } from './event-bus-debug.js';
 *   enableEventBusDebug();
 *
 *   // イベント発火後にコンソールで確認
 *   traceCorrelation('corr_abc12345');
 */

import { eventBus } from './event-bus.js';

// イベント履歴の最大保持数
const MAX_HISTORY_SIZE = 1000;
const HISTORY_MISSING_WARNING = '[EventBus Debug] No event history available';

function getDebugWindow() {
    return typeof window === 'undefined' ? null : window;
}

function getEventHistory({ warnIfMissing = false } = {}) {
    const win = getDebugWindow();
    if (!win || !win.__EVENTBUS_HISTORY__) {
        if (warnIfMissing) {
            console.warn(HISTORY_MISSING_WARNING);
        }
        return null;
    }
    return win.__EVENTBUS_HISTORY__;
}

/**
 * EventBusデバッグモードを有効化
 * - コンソールにイベントログを出力
 * - イベント履歴を記録
 */
export function enableEventBusDebug() {
    const win = getDebugWindow();
    if (!win) {
        console.warn('[EventBus Debug] window is not available');
        return;
    }

    win.__EVENTBUS_DEBUG__ = true;
    win.__EVENTBUS_HISTORY__ = [];

    console.log('[EventBus Debug] Debug mode enabled. Use traceCorrelation(id) to trace event chains.');
}

/**
 * EventBusデバッグモードを無効化
 */
export function disableEventBusDebug() {
    const win = getDebugWindow();
    if (!win) return;

    win.__EVENTBUS_DEBUG__ = false;
}

/**
 * イベント履歴をクリア
 */
export function clearEventHistory() {
    const history = getEventHistory({ warnIfMissing: true });
    if (!history) return;

    history.length = 0;
    console.log('[EventBus Debug] Event history cleared');
}

/**
 * イベントを履歴に記録（emit後に自動呼び出し用）
 * @param {string} eventName - イベント名
 * @param {Object} detail - イベント詳細（_meta含む）
 */
export function recordEvent(eventName, detail) {
    const history = getEventHistory();
    if (!history) return;
    const record = {
        eventName,
        detail,
        timestamp: Date.now()
    };

    history.push(record);

    // 最大サイズを超えたら古いものを削除
    if (history.length > MAX_HISTORY_SIZE) {
        history.shift();
    }
}

/**
 * correlationIdでイベントチェーンを追跡
 * @param {string} correlationId - 追跡するcorrelationId
 * @returns {Array} イベントチェーン（時系列順）
 */
export function traceCorrelation(correlationId) {
    const history = getEventHistory({ warnIfMissing: true });
    if (!history) return [];

    const chain = history
        .filter(e => e.detail?._meta?.correlationId === correlationId)
        .sort((a, b) => a.timestamp - b.timestamp)
        .map(e => ({
            eventName: e.eventName,
            eventId: e.detail._meta.eventId,
            causationId: e.detail._meta.causationId,
            timestamp: new Date(e.timestamp).toISOString()
        }));

    // コンソールに見やすく出力
    if (chain.length > 0) {
        console.group(`[EventBus] Correlation: ${correlationId}`);
        chain.forEach((e, i) => {
            const arrow = i === 0 ? '🔵' : '  └→';
            console.log(`${arrow} ${e.eventName} (${e.eventId})`);
        });
        console.groupEnd();
    } else {
        console.log(`[EventBus] No events found for correlation: ${correlationId}`);
    }

    return chain;
}

/**
 * causationIdで因果関係を逆追跡
 * @param {string} eventId - 追跡開始するイベントID
 * @returns {Array} 因果関係チェーン（原因→結果の順）
 */
export function traceCausation(eventId) {
    const history = getEventHistory({ warnIfMissing: true });
    if (!history) return [];
    const chain = [];
    let currentId = eventId;

    // 因果関係を遡る
    while (currentId) {
        const event = history.find(e => e.detail?._meta?.eventId === currentId);
        if (!event) break;

        chain.unshift({
            eventName: event.eventName,
            eventId: event.detail._meta.eventId,
            causationId: event.detail._meta.causationId,
            timestamp: new Date(event.timestamp).toISOString()
        });

        currentId = event.detail._meta.causationId;
    }

    // コンソールに見やすく出力
    if (chain.length > 0) {
        console.group(`[EventBus] Causation trace for: ${eventId}`);
        chain.forEach((e, i) => {
            const indent = '  '.repeat(i);
            console.log(`${indent}${e.eventName} (${e.eventId})`);
        });
        console.groupEnd();
    }

    return chain;
}

/**
 * 直近のイベント履歴を表示
 * @param {number} count - 表示件数（デフォルト: 10）
 */
export function showRecentEvents(count = 10) {
    const history = getEventHistory({ warnIfMissing: true });
    if (!history) return [];

    const recent = history
        .slice(-count)
        .map(e => ({
            eventName: e.eventName,
            eventId: e.detail?._meta?.eventId,
            correlationId: e.detail?._meta?.correlationId,
            timestamp: new Date(e.timestamp).toISOString()
        }));

    console.table(recent);
    return recent;
}

/**
 * イベント統計を表示
 */
export function showEventStats() {
    const history = getEventHistory({ warnIfMissing: true });
    if (!history) return {};

    const stats = {};
    history.forEach(e => {
        const name = e.eventName;
        stats[name] = (stats[name] || 0) + 1;
    });

    // ソートして表示
    const sorted = Object.entries(stats)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ eventName: name, count }));

    console.table(sorted);
    return stats;
}

// グローバルにデバッグ関数を公開（開発時の利便性のため）
if (typeof window !== 'undefined') {
    window.eventBusDebug = {
        enable: enableEventBusDebug,
        disable: disableEventBusDebug,
        clear: clearEventHistory,
        trace: traceCorrelation,
        traceCausation,
        recent: showRecentEvents,
        stats: showEventStats
    };
}
