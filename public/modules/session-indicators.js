/**
 * session-indicators.js - Session status indicator management
 *
 * Simple logic:
 * - Orange (working): Hook reports 'working' (AI started)
 * - Green (done): Hook reports 'done' (AI stopped)
 * - Hidden: no hook status
 */

import { httpClient } from './core/http-client.js';
import { eventBus, EVENTS } from './core/event-bus.js';
import { replaceSessionHookStatuses, getSessionStatus as getStoreSessionStatus } from './session-ui-state.js';
import { showError, showInfo } from './toast.js';

// --- Module State ---
const sessionStatusMap = new Map(); // sessionId -> { isWorking, isDone }

// --- Error State Management ---
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;

// --- State Accessors ---
export function getSessionStatus(sessionId) {
    return getStoreSessionStatus(sessionId) || sessionStatusMap.get(sessionId);
}

// Clear done status when session is opened
export function clearDone(sessionId) {
    const status = sessionStatusMap.get(sessionId);
    if (status) {
        status.isDone = false;
        sessionStatusMap.set(sessionId, status);
        replaceSessionHookStatuses(Object.fromEntries(sessionStatusMap));
    }
}

// Clear working status when session is switched
export function clearWorking(sessionId) {
    const status = sessionStatusMap.get(sessionId);
    if (status) {
        status.isWorking = false;
        sessionStatusMap.set(sessionId, status);
        replaceSessionHookStatuses(Object.fromEntries(sessionStatusMap));
    }
}

/**
 * Mark done indicator as read for a session.
 * Local state is updated first for immediate UI response, then server sync is attempted.
 * @param {string} sessionId - Session to clear done status for
 * @param {string|null} currentSessionId - Current active session id for indicator rendering
 */
export async function markDoneAsRead(sessionId, currentSessionId = null) {
    if (!sessionId) return;

    clearDone(sessionId);
    updateSessionIndicators(currentSessionId);
    await eventBus.emit(EVENTS.SESSION_UPDATED, { sessionId, updates: { doneRead: true } });

    try {
        await httpClient.post(`/api/sessions/${encodeURIComponent(sessionId)}/clear-done`, {});
    } catch (error) {
        console.warn(`[Session Indicators] Failed to persist done-read for ${sessionId}:`, error);
    }
}

// --- Connection Status ---

/**
 * Update connection status indicator in sidebar
 * @param {boolean} isConnected - Whether server is connected
 */
export function updateConnectionStatus(isConnected) {
    const statusEl = document.getElementById('connection-status');
    if (!statusEl) return;

    const icon = statusEl.querySelector('.connection-icon');
    const text = statusEl.querySelector('.connection-text');

    if (isConnected) {
        statusEl.classList.remove('disconnected');
        icon?.setAttribute('data-lucide', 'wifi');
        if (text) text.textContent = '接続中';
    } else {
        statusEl.classList.add('disconnected');
        icon?.setAttribute('data-lucide', 'wifi-off');
        if (text) text.textContent = 'サーバー未接続';
    }

    // Lucideアイコン再描画
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

// --- Core Functions ---

/**
 * Poll session status from API
 * @param {string|null} currentSessionId - Currently active session ID
 */
export async function pollSessionStatus(currentSessionId, onStatusChange) {
    try {
        const res = await fetch('/api/sessions/status');

        // HTTPステータスチェック
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const status = await res.json();
        const previousStatuses = new Map(sessionStatusMap);
        let hasStatusChange = false;
        const incomingSessionIds = new Set(Object.keys(status));

        // Debug log: 取得した状態を可視化
        const workingSessions = Object.entries(status).filter(([, s]) => s.isWorking);
        const doneSessions = Object.entries(status).filter(([, s]) => s.isDone && !s.isWorking);
        if (workingSessions.length > 0 || doneSessions.length > 0) {
            console.log('[Session Indicators] Status update:', {
                working: workingSessions.map(([id]) => id),
                done: doneSessions.map(([id]) => id)
            });
        }

        // Update map
        for (const [sessionId, newStatus] of Object.entries(status)) {
            const prev = previousStatuses.get(sessionId);
            if (!prev ||
                prev.isWorking !== newStatus.isWorking ||
                prev.isDone !== newStatus.isDone ||
                prev.lastWorkingAt !== newStatus.lastWorkingAt ||
                prev.lastDoneAt !== newStatus.lastDoneAt ||
                prev.goalSeek?.active !== newStatus.goalSeek?.active ||
                prev.goalSeek?.iteration !== newStatus.goalSeek?.iteration ||
                prev.goalSeek?.maxIterations !== newStatus.goalSeek?.maxIterations
            ) {
                hasStatusChange = true;
            }
            sessionStatusMap.set(sessionId, newStatus);
        }

        for (const sessionId of previousStatuses.keys()) {
            if (!incomingSessionIds.has(sessionId)) {
                hasStatusChange = true;
                sessionStatusMap.delete(sessionId);
            }
        }

        if (hasStatusChange) {
            replaceSessionHookStatuses(status);
            if (typeof onStatusChange === 'function') {
                await onStatusChange(status);
            }
            await eventBus.emit(EVENTS.SESSION_UPDATED, { sessionId: null, updates: { hookStatus: status } });
            await eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, {
                sessionIds: Object.keys(status)
            });
        }

        updateSessionIndicators(currentSessionId);

        // 接続状態を更新（正常）
        updateConnectionStatus(true);

        // 復旧検知: エラー状態から正常に戻った場合
        if (consecutiveErrors > 0) {
            console.log('Session status polling recovered');
            showInfo('サーバー接続が復旧しました');
            consecutiveErrors = 0;
        }
    } catch (error) {
        consecutiveErrors++;
        console.error('Failed to poll session status:', error);

        // 即座にエラー表示（初回エラー時）
        if (consecutiveErrors === 1) {
            showError('サーバーとの接続エラー（リトライ中）');
            updateConnectionStatus(false);
        }

        // 連続エラー時の追加通知（3回目）
        if (consecutiveErrors === MAX_CONSECUTIVE_ERRORS) {
            showError('サーバーとの接続が不安定です（自動リトライ継続中）');
        }
    }
}

/**
 * Update visual indicators on session list items
 * @param {string|null} currentSessionId - Currently active session ID
 */
export function updateSessionIndicators(currentSessionId) {
    return currentSessionId;
}

/**
 * Start polling at regular interval
 * @param {function} getCurrentSessionId - Function to get current session ID
 * @param {number} intervalMs - Polling interval in milliseconds
 * @returns {number} Interval ID for clearing
 */
export function startPolling(getCurrentSessionId, intervalMs = 3000, onStatusChange) {
    // Initial poll
    pollSessionStatus(getCurrentSessionId(), onStatusChange);

    // Set up interval
    return setInterval(() => {
        pollSessionStatus(getCurrentSessionId(), onStatusChange);
    }, intervalMs);
}
