import { refreshIcons } from './ui-helpers.js';

/**
 * session-indicators.js - Session status indicator management
 *
 * Real-time WebSocket push with polling reconciliation.
 * The single source of truth is sessionUi.byId[sessionId].hookStatus.
 */

import { httpClient } from './core/http-client.js';
import { eventBus, EVENTS } from './core/event-bus.js';
import {
    getSessionHookStatusMap,
    getSessionStatus as getStoreSessionStatus,
    mergeSessionUiEntry,
    replaceSessionHookStatuses
} from './session-ui-state.js';
import { showError, showInfo } from './toast.js';
import { SessionActivityWsClient } from './core/session-activity-ws-client.js';

// --- Error State Management ---
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;

// --- Suppress stale polling after markDoneAsRead ---
const _suppressUpdates = new Map(); // sessionId -> timestamp
const SUPPRESS_DURATION = 5000; // 5秒間サーバーポーリングの上書きを抑制

function didHookStatusChange(prev, next) {
    if (!prev) return true;
    if (!next) return true;
    const normalizedPrev = normalizeHookStatusForClient(prev);
    const normalizedNext = normalizeHookStatusForClient(next);
    const prevLiveActivity = normalizedPrev?.liveActivity || null;
    const nextLiveActivity = normalizedNext?.liveActivity || null;
    return normalizedPrev.isWorking !== normalizedNext.isWorking
        || normalizedPrev.isDone !== normalizedNext.isDone
        || normalizedPrev.state !== normalizedNext.state
        || normalizedPrev.confidence !== normalizedNext.confidence
        || normalizedPrev.lastWorkingAt !== normalizedNext.lastWorkingAt
        || normalizedPrev.lastDoneAt !== normalizedNext.lastDoneAt
        || normalizedPrev.lastActivityAt !== normalizedNext.lastActivityAt
        || normalizedPrev.lastEventType !== normalizedNext.lastEventType
        || normalizedPrev.activeTurnCount !== normalizedNext.activeTurnCount
        || prevLiveActivity?.activityKind !== nextLiveActivity?.activityKind
        || prevLiveActivity?.statusTone !== nextLiveActivity?.statusTone
        || prevLiveActivity?.updatedAt !== nextLiveActivity?.updatedAt
        || normalizedPrev.timestamp !== normalizedNext.timestamp;
}

function normalizeHookStatusForClient(hookStatus) {
    if (!hookStatus || typeof hookStatus !== 'object') return null;
    const state = typeof hookStatus.state === 'string' ? hookStatus.state : null;
    const derivedWorking = state === 'starting'
        || state === 'running'
        || state === 'waiting'
        || hookStatus.status === 'working';
    const derivedDone = state === 'done-unread' || hookStatus.status === 'done';
    const isWorking = hookStatus.isWorking ?? derivedWorking;
    const isDone = hookStatus.isDone ?? derivedDone;
    return {
        ...hookStatus,
        isWorking: Boolean(isWorking),
        isDone: Boolean(isDone)
    };
}

function isRenderableHookStatus(hookStatus) {
    if (!hookStatus) return false;
    return Boolean(
        hookStatus.isWorking
        || hookStatus.isDone
        || hookStatus.liveActivity
        || hookStatus.lastWorkingAt
        || hookStatus.lastDoneAt
        || hookStatus.lastActivityAt
        || hookStatus.activeTurnCount
        || hookStatus.timestamp
    );
}

function normalizeStatusMap(statusMap = {}) {
    const normalized = {};
    for (const [sessionId, hookStatus] of Object.entries(statusMap || {})) {
        const nextStatus = normalizeHookStatusForClient(hookStatus);
        if (isRenderableHookStatus(nextStatus)) {
            normalized[sessionId] = nextStatus;
        }
    }
    return normalized;
}

function pruneSuppressedUpdates(now = Date.now()) {
    for (const [id, ts] of _suppressUpdates) {
        if (now - ts > SUPPRESS_DURATION) _suppressUpdates.delete(id);
    }
}

function shouldSuppressHookStatus(hookStatus) {
    const normalized = normalizeHookStatusForClient(hookStatus);
    if (!normalized) return true;
    const liveActivity = normalized.liveActivity || null;
    const isLiveWorking = liveActivity?.statusTone === 'working'
        || liveActivity?.statusTone === 'waiting'
        || liveActivity?.activityKind === 'waiting_input';
    return !normalized.isWorking && !isLiveWorking;
}

function filterSuppressedStatusMap(statusMap = {}, previousStatusMap = {}) {
    pruneSuppressedUpdates();
    const filteredStatus = normalizeStatusMap(statusMap);
    for (const id of _suppressUpdates.keys()) {
        if (!Object.prototype.hasOwnProperty.call(filteredStatus, id)) continue;
        if (shouldSuppressHookStatus(filteredStatus[id])) {
            if (previousStatusMap[id]) {
                filteredStatus[id] = previousStatusMap[id];
            } else {
                delete filteredStatus[id];
            }
        }
    }
    return filteredStatus;
}

function isUpdateSuppressed(sessionId, hookStatus) {
    pruneSuppressedUpdates();
    return _suppressUpdates.has(sessionId) && shouldSuppressHookStatus(hookStatus);
}

function getChangedSessionIds(previousStatuses, nextStatusMap = {}) {
    const changedSessionIds = new Set();
    const incomingSessionIds = new Set(Object.keys(nextStatusMap));

    for (const [sessionId, newStatus] of Object.entries(nextStatusMap)) {
        const prev = previousStatuses.get(sessionId);
        if (didHookStatusChange(prev, newStatus)) {
            changedSessionIds.add(sessionId);
        }
    }

    for (const sessionId of previousStatuses.keys()) {
        if (!incomingSessionIds.has(sessionId)) {
            changedSessionIds.add(sessionId);
        }
    }

    return changedSessionIds;
}

// Clear done status when session is opened
export function clearDone(sessionId) {
    const status = getStoreSessionStatus(sessionId);
    if (status) {
        mergeSessionUiEntry(sessionId, {
            hookStatus: {
                ...status,
                isDone: false
            }
        });
    }
}

// Clear working status when session is switched
export function clearWorking(sessionId) {
    const status = getStoreSessionStatus(sessionId);
    if (status) {
        mergeSessionUiEntry(sessionId, {
            hookStatus: {
                ...status,
                isWorking: false
            }
        });
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

    // Suppress polling overwrites for this session until server catches up
    _suppressUpdates.set(sessionId, Date.now());

    clearDone(sessionId);
    await eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, { sessionIds: [sessionId], currentSessionId });

    try {
        await httpClient.post(`/api/sessions/${encodeURIComponent(sessionId)}/clear-done`, {});
    } catch (error) {
        console.warn(`[Session Indicators] Failed to persist done-read for ${sessionId}:`, error);
    }
}

export function __resetSessionIndicatorStateForTests() {
    consecutiveErrors = 0;
    _lastConnectionStatus = null;
    _suppressUpdates.clear();
}

// --- Connection Status ---

let _lastConnectionStatus = null;

/**
 * Update connection status indicator in sidebar
 * @param {boolean} isConnected - Whether server is connected
 */
export function updateConnectionStatus(isConnected) {
    // Skip DOM update if status hasn't changed
    if (_lastConnectionStatus === isConnected) return;
    _lastConnectionStatus = isConnected;

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

    refreshIcons();
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
        const previousStatusMap = getSessionHookStatusMap();
        const previousStatuses = new Map(Object.entries(previousStatusMap));
        const filteredStatus = filterSuppressedStatusMap(status, previousStatusMap);
        const changedSessionIds = getChangedSessionIds(previousStatuses, filteredStatus);
        const hasStatusChange = changedSessionIds.size > 0;

        // Debug log: 取得した状態を可視化
        const workingSessions = Object.entries(status).filter(([, s]) => s.isWorking);
        const doneSessions = Object.entries(status).filter(([, s]) => s.isDone && !s.isWorking);
        if (workingSessions.length > 0 || doneSessions.length > 0) {
            console.log('[Session Indicators] Status update:', {
                working: workingSessions.map(([id]) => id),
                done: doneSessions.map(([id]) => id)
            });
        }

        if (hasStatusChange) {
            replaceSessionHookStatuses(filteredStatus);
            if (typeof onStatusChange === 'function') {
                await onStatusChange(status);
            }
            await eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, {
                sessionIds: Array.from(changedSessionIds)
            });
        }

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
 * Start polling with jittered setTimeout to avoid thundering herd across tabs
 * @param {function} getCurrentSessionId - Function to get current session ID
 * @param {number} intervalMs - Base polling interval in milliseconds
 * @returns {function} Cleanup function to stop polling
 */
export function startPolling(getCurrentSessionId, intervalMs = 3000, onStatusChange) {
    let timerId = null;
    let stopped = false;

    function scheduleNext() {
        if (stopped) return;
        // Add ±500ms jitter to prevent thundering herd across tabs
        const jitter = Math.floor(Math.random() * 1000) - 500;
        const delay = Math.max(1000, intervalMs + jitter);
        timerId = setTimeout(async () => {
            await pollSessionStatus(getCurrentSessionId(), onStatusChange);
            scheduleNext();
        }, delay);
    }

    // Initial poll
    pollSessionStatus(getCurrentSessionId(), onStatusChange);
    scheduleNext();

    // Return cleanup function
    return function stopPolling() {
        stopped = true;
        if (timerId !== null) {
            clearTimeout(timerId);
            timerId = null;
        }
    };
}

export function updateSessionIndicators(_currentSessionId) {
    // no-op: indicators are now driven by session-ui-state events
}

/**
 * Start WebSocket-based activity status updates.
 * Polling stays active as reconciliation even while WebSocket is connected so
 * cold-load state and missed startup messages do not leave indicators stale.
 * @param {function} getCurrentSessionId
 * @param {number} pollingIntervalMs - Fallback polling interval
 * @param {function} onStatusChange
 * @returns {function} Cleanup function
 */
export function startActivityWs(getCurrentSessionId, pollingIntervalMs = 3000, onStatusChange) {
    let pollingCleanup = startPolling(getCurrentSessionId, pollingIntervalMs, onStatusChange);

    function applyFullStatus(statusMap) {
        const previousStatusMap = getSessionHookStatusMap();
        const previousStatuses = new Map(Object.entries(previousStatusMap));
        const filtered = filterSuppressedStatusMap(statusMap, previousStatusMap);
        const changedSessionIds = Array.from(getChangedSessionIds(previousStatuses, filtered));
        replaceSessionHookStatuses(filtered);
        if (changedSessionIds.length > 0) {
            eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, {
                sessionIds: changedSessionIds
            });
            if (typeof onStatusChange === 'function') {
                onStatusChange(filtered);
            }
        }
    }

    function applyUpdate(sessionId, hookStatus) {
        if (isUpdateSuppressed(sessionId, hookStatus)) return;
        const current = getSessionHookStatusMap();
        const updated = { ...current };
        const nextStatus = normalizeHookStatusForClient(hookStatus);
        if (isRenderableHookStatus(nextStatus)) {
            updated[sessionId] = nextStatus;
        } else {
            delete updated[sessionId];
        }
        replaceSessionHookStatuses(updated);
        eventBus.emit(EVENTS.SESSION_UI_STATE_CHANGED, {
            sessionIds: [sessionId]
        });
        if (typeof onStatusChange === 'function') {
            onStatusChange(updated);
        }
    }

    const client = new SessionActivityWsClient({
        onStatusFull: (statusMap) => {
            applyFullStatus(statusMap);
        },
        onStatusUpdate: (sessionId, hookStatus) => {
            applyUpdate(sessionId, hookStatus);
        },
        onConnectionChange: (connected) => {
            updateConnectionStatus(connected);
        }
    });

    client.connect();

    return function cleanup() {
        client.close();
        if (pollingCleanup) {
            pollingCleanup();
            pollingCleanup = null;
        }
    };
}
