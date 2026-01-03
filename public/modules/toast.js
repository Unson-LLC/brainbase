// Toast notification module

const toastContainer = document.getElementById('toast-container');

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

    // Initialize lucide icon
    if (window.lucide) {
        window.lucide.createIcons({ icons: { [ICONS[type]]: true }, nameAttr: 'data-lucide' });
    }

    // Auto remove
    setTimeout(() => {
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

/**
 * Show success toast
 */
export function showSuccess(message, duration = 3000) {
    showToast(message, 'success', duration);
}

/**
 * Show error toast
 */
export function showError(message, duration = 4000) {
    showToast(message, 'error', duration);
}

/**
 * Show info toast
 */
export function showInfo(message, duration = 3000) {
    showToast(message, 'info', duration);
}
