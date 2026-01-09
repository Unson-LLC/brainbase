/**
 * session-indicators.js - Session status indicator management
 *
 * Simple logic:
 * - Orange (working): Hook reports 'working' (AI started)
 * - Green (done): Hook reports 'done' (AI stopped) AND not current session
 * - Hidden: Current session OR no hook status
 */

import { showError, showInfo } from './toast.js';

// --- Module State ---
const sessionStatusMap = new Map(); // sessionId -> { isWorking, isDone }

// --- Error State Management ---
let consecutiveErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;

// --- State Accessors ---
export function getSessionStatus(sessionId) {
    return sessionStatusMap.get(sessionId);
}

// Clear done status when session is opened
export function clearDone(sessionId) {
    const status = sessionStatusMap.get(sessionId);
    if (status) {
        status.isDone = false;
        sessionStatusMap.set(sessionId, status);
    }
}

// --- Core Functions ---

/**
 * Poll session status from API
 * @param {string|null} currentSessionId - Currently active session ID
 */
export async function pollSessionStatus(currentSessionId) {
    try {
        const res = await fetch('/api/sessions/status');

        // HTTPステータスチェック
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const status = await res.json();

        // Update map
        for (const [sessionId, newStatus] of Object.entries(status)) {
            sessionStatusMap.set(sessionId, newStatus);
        }

        updateSessionIndicators(currentSessionId);

        // 復旧検知: エラー状態から正常に戻った場合
        if (consecutiveErrors > 0) {
            console.log('Session status polling recovered');
            showInfo('サーバー接続が復旧しました');
            consecutiveErrors = 0;
        }
    } catch (error) {
        consecutiveErrors++;
        console.error('Failed to poll session status:', error);

        // 連続エラー時のユーザー通知（初回のみ）
        if (consecutiveErrors === MAX_CONSECUTIVE_ERRORS) {
            showError('サーバーとの接続が不安定です');
        }
    }
}

/**
 * Update visual indicators on session list items
 * @param {string|null} currentSessionId - Currently active session ID
 */
export function updateSessionIndicators(currentSessionId) {
    const sessionItems = document.querySelectorAll('.session-child-row');
    sessionItems.forEach(item => {
        const sessionId = item.dataset.id;
        const status = sessionStatusMap.get(sessionId);

        // Remove existing indicator
        const existingIndicator = item.querySelector('.session-activity-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }

        // Simple logic:
        // 1. Orange: isWorking (AI running)
        // 2. Green: isDone AND not current session
        // 3. Hidden: current session OR no status

        if (status?.isWorking) {
            const indicator = document.createElement('div');
            indicator.className = 'session-activity-indicator working';
            // drag-handleの後に挿入（左側に配置）
            const dragHandle = item.querySelector('.drag-handle');
            if (dragHandle && dragHandle.nextSibling) {
                item.insertBefore(indicator, dragHandle.nextSibling);
            } else {
                item.appendChild(indicator);
            }
        } else if (status?.isDone && currentSessionId !== sessionId) {
            const indicator = document.createElement('div');
            indicator.className = 'session-activity-indicator done';
            // drag-handleの後に挿入（左側に配置）
            const dragHandle = item.querySelector('.drag-handle');
            if (dragHandle && dragHandle.nextSibling) {
                item.insertBefore(indicator, dragHandle.nextSibling);
            } else {
                item.appendChild(indicator);
            }
        }
    });
}

/**
 * Start polling at regular interval
 * @param {function} getCurrentSessionId - Function to get current session ID
 * @param {number} intervalMs - Polling interval in milliseconds
 * @returns {number} Interval ID for clearing
 */
export function startPolling(getCurrentSessionId, intervalMs = 3000) {
    // Initial poll
    pollSessionStatus(getCurrentSessionId());

    // Set up interval
    return setInterval(() => {
        pollSessionStatus(getCurrentSessionId());
    }, intervalMs);
}
