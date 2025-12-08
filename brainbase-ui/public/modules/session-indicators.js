/**
 * session-indicators.js - Session status indicator management
 *
 * Handles polling session status and updating visual indicators.
 */

// --- Module State ---
const sessionStatusMap = new Map(); // sessionId -> { isRunning, isWorking }
const sessionUnreadMap = new Map(); // sessionId -> boolean (true if finished working but not viewed)

// --- State Accessors ---
export function getSessionStatus(sessionId) {
    return sessionStatusMap.get(sessionId);
}

export function isSessionUnread(sessionId) {
    return sessionUnreadMap.get(sessionId);
}

export function clearUnread(sessionId) {
    sessionUnreadMap.set(sessionId, false);
}

// --- Core Functions ---

/**
 * Poll session status from API
 * @param {string|null} currentSessionId - Currently active session ID
 */
export async function pollSessionStatus(currentSessionId) {
    try {
        const res = await fetch('/api/sessions/status');
        const status = await res.json();

        // Debug Log
        console.log('Poll Status Result:', status);

        // Update map and handle transitions
        for (const [sessionId, newStatus] of Object.entries(status)) {
            const oldStatus = sessionStatusMap.get(sessionId);

            // Transition: Working -> Idle (Done)
            // Only if NOT the current session
            if (oldStatus?.isWorking && !newStatus.isWorking && currentSessionId !== sessionId) {
                sessionUnreadMap.set(sessionId, true);
            }

            // If currently working, it's not unread (it's active)
            if (newStatus.isWorking) {
                sessionUnreadMap.set(sessionId, false);
            }

            sessionStatusMap.set(sessionId, newStatus);
        }

        updateSessionIndicators(currentSessionId);
    } catch (error) {
        console.error('Failed to poll session status:', error);
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
        const isUnread = sessionUnreadMap.get(sessionId);

        console.log(`Updating indicator for ${sessionId}: current=${currentSessionId}, isWorking=${status?.isWorking}, isUnread=${isUnread}`);

        // Remove existing indicator
        const existingIndicator = item.querySelector('.session-activity-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }

        // Determine if we should show indicator
        // 1. Working: Always show (Green Pulse) - EVEN IF CURRENT SESSION
        // 2. Unread: Show (Green Static) - ONLY IF NOT CURRENT SESSION

        if (currentSessionId === sessionId) {
            // If looking at it, clear unread
            if (sessionUnreadMap.get(sessionId)) {
                sessionUnreadMap.set(sessionId, false);
                // No return here, proceed to check isWorking
            }
        }

        if (status?.isWorking) {
            const indicator = document.createElement('div');
            indicator.className = 'session-activity-indicator working';
            item.appendChild(indicator);
            console.log(`Added WORKING indicator to ${sessionId}`);
        } else if (currentSessionId !== sessionId && (status?.isDone || isUnread)) {
            const indicator = document.createElement('div');
            indicator.className = 'session-activity-indicator done';
            item.appendChild(indicator);
            console.log(`Added DONE indicator to ${sessionId}`);
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
