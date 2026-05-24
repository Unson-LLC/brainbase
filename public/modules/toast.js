import { refreshIcons } from './ui-helpers.js';

// Toast notification module

let toastContainer = document.getElementById('toast-container');
const toastTimers = new WeakMap();

const ICONS = {
    success: 'check-circle',
    error: 'alert-circle',
    info: 'info'
};

/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {'success'|'error'|'info'} type - The type of toast
 * @param {number} duration - Duration in ms (default 3000)
 */
export function showToast(message, type = 'info', duration = 3000) {
    if (!toastContainer || !toastContainer.isConnected) {
        toastContainer = document.getElementById('toast-container');
    }
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        document.body.appendChild(toastContainer);
    }
    toastContainer.setAttribute('role', 'status');
    toastContainer.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    toastContainer.setAttribute('aria-atomic', 'true');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    // XSS対策: DOMメソッドで構築
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', ICONS[type]);
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    toast.appendChild(icon);
    toast.appendChild(messageSpan);

    toastContainer.appendChild(toast);

    refreshIcons({ icons: { [ICONS[type]]: true }, nameAttr: 'data-lucide' });

    // Auto remove
    const timer = setTimeout(() => {
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 300);
    }, duration);
    toastTimers.set(toast, timer);
    return toast;
}

export function dismissToast(toast) {
    if (!toast) return;
    const timer = toastTimers.get(toast);
    if (timer) {
        clearTimeout(timer);
        toastTimers.delete(toast);
    }
    toast.remove();
}

/**
 * Show success toast
 */
export function showSuccess(message, duration = 3000) {
    return showToast(message, 'success', duration);
}

/**
 * Show error toast
 */
export function showError(message, duration = 4000) {
    return showToast(message, 'error', duration);
}

/**
 * Show info toast
 */
export function showInfo(message, duration = 3000) {
    return showToast(message, 'info', duration);
}
