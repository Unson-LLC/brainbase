const ANIMATION_STYLE_ID = 'transient-notification-animation';
const NOTIFICATION_CLASS = 'transient-notification';
const DEFAULT_DURATION = 2000;

function ensureAnimationStyles() {
    if (document.getElementById(ANIMATION_STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = ANIMATION_STYLE_ID;
    style.textContent = `
        @keyframes transientFadeInOut {
            0% { opacity: 0; transform: translateY(10px); }
            10% { opacity: 1; transform: translateY(0); }
            90% { opacity: 1; transform: translateY(0); }
            100% { opacity: 0; transform: translateY(-10px); }
        }
        .${NOTIFICATION_CLASS} {
            position: fixed;
            bottom: 20px;
            right: 20px;
            color: white;
            padding: 12px 20px;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            z-index: 10000;
            animation: transientFadeInOut 2s ease-in-out;
        }
    `;
    document.head.appendChild(style);
}

function getBackgroundColor(type) {
    switch (type) {
        case 'error':
            return '#f44336';
        case 'info':
            return '#2196f3';
        default:
            return '#4caf50';
    }
}

/**
 * Display a lightweight notification near the bottom-right of the viewport.
 * Mirrors the legacy inline style used across modules to avoid visual regressions.
 *
 * @param {string} message
 * @param {{type?: 'success'|'error'|'info', duration?: number}} [options]
 */
export function showTransientNotification(message, options = {}) {
    if (typeof document === 'undefined') return;

    ensureAnimationStyles();

    const { type = 'success', duration = DEFAULT_DURATION } = options;
    const notification = document.createElement('div');
    notification.className = NOTIFICATION_CLASS;
    notification.textContent = message;
    notification.style.background = getBackgroundColor(type);

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, duration);
}
