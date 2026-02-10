// Confirm modal module

const confirmModal = document.getElementById('confirm-modal');
const confirmTitle = document.getElementById('confirm-modal-title');
const confirmMessage = document.getElementById('confirm-modal-message');
const confirmOkBtn = document.getElementById('confirm-ok-btn');
const confirmCancelBtn = document.getElementById('confirm-cancel-btn');

const hasConfirmModal = Boolean(
    confirmModal
    && confirmTitle
    && confirmMessage
    && confirmOkBtn
    && confirmCancelBtn
);

let resolvePromise = null;

// Setup event listeners
if (hasConfirmModal) {
    const closeBtn = confirmModal.querySelector('.close-modal-btn');
    closeBtn?.addEventListener('click', () => closeConfirm(false));
    confirmCancelBtn.addEventListener('click', () => closeConfirm(false));
    confirmOkBtn.addEventListener('click', () => closeConfirm(true));
    confirmModal.addEventListener('click', (e) => {
        if (e.target === confirmModal) closeConfirm(false);
    });

    // Action button event listener (for 3-button pattern)
    const confirmActionBtn = document.getElementById('confirm-action-btn');
    if (confirmActionBtn) {
        confirmActionBtn.addEventListener('click', () => closeConfirm({ action: 'action' }));
    }
}

function closeConfirm(result) {
    if (!confirmModal) return;
    confirmModal.classList.remove('active');
    if (resolvePromise) {
        // If result is boolean (2-button pattern), resolve as-is
        // If result is object with action (3-button pattern), resolve as-is
        if (typeof result === 'boolean') {
            resolvePromise(result);
        } else if (result && result.action) {
            resolvePromise(result);
        } else {
            // fallback: treat as cancel
            resolvePromise(typeof result === 'object' ? { action: 'cancel' } : false);
        }
        resolvePromise = null;
    }
}

/**
 * Show a confirm dialog
 * @param {string} message - The message to display
 * @param {Object} options - Options
 * @param {string} options.title - Modal title (default: '確認')
 * @param {string} options.okText - OK button text (default: 'OK')
 * @param {string} options.cancelText - Cancel button text (default: 'キャンセル')
 * @param {boolean} options.danger - Use danger button style (default: true)
 * @returns {Promise<boolean>} - Resolves to true if confirmed, false otherwise
 */
export function showConfirm(message, options = {}) {
    if (!hasConfirmModal) {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
            return Promise.resolve(window.confirm(message));
        }
        console.warn('Confirm modal not found. Skipping confirmation dialog.');
        return Promise.resolve(false);
    }
    const {
        title = '確認',
        okText = 'OK',
        cancelText = 'キャンセル',
        danger = true
    } = options;

    // XSS対策: DOMメソッドで構築
    confirmTitle.innerHTML = '';
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'alert-circle');
    const titleText = document.createTextNode(' ' + title);
    confirmTitle.appendChild(icon);
    confirmTitle.appendChild(titleText);
    confirmMessage.textContent = message;
    confirmOkBtn.textContent = okText;
    confirmCancelBtn.textContent = cancelText;

    // Toggle danger style
    if (danger) {
        confirmOkBtn.className = 'btn-danger';
    } else {
        confirmOkBtn.className = 'btn-primary';
    }

    // Initialize lucide icon
    if (window.lucide) {
        window.lucide.createIcons();
    }

    confirmModal.classList.add('active');

    return new Promise((resolve) => {
        resolvePromise = resolve;
    });
}

/**
 * Show a confirm dialog with an action button (3-button pattern)
 * @param {string} message - The message to display
 * @param {Object} options - Options
 * @param {string} options.title - Modal title (default: '確認')
 * @param {string} options.okText - OK button text (default: 'OK')
 * @param {string} options.cancelText - Cancel button text (default: 'キャンセル')
 * @param {string} options.actionText - Action button text (default: 'アクション')
 * @param {boolean} options.danger - Use danger button style for OK (default: true)
 * @returns {Promise<{action: 'ok'|'cancel'|'action'}>} - Resolves to action type
 */
export function showConfirmWithAction(message, options = {}) {
    if (!hasConfirmModal) {
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
            const confirmed = window.confirm(message);
            return Promise.resolve({ action: confirmed ? 'ok' : 'cancel' });
        }
        console.warn('Confirm modal not found. Skipping confirmation dialog.');
        return Promise.resolve({ action: 'cancel' });
    }

    const {
        title = '確認',
        okText = 'OK',
        cancelText = 'キャンセル',
        actionText = 'アクション',
        danger = true
    } = options;

    // XSS対策: DOMメソッドで構築
    confirmTitle.innerHTML = '';
    const icon = document.createElement('i');
    icon.setAttribute('data-lucide', 'alert-circle');
    const titleText = document.createTextNode(' ' + title);
    confirmTitle.appendChild(icon);
    confirmTitle.appendChild(titleText);
    confirmMessage.textContent = message;
    confirmOkBtn.textContent = okText;
    confirmCancelBtn.textContent = cancelText;

    // 3つ目のボタンを表示
    const confirmActionBtn = document.getElementById('confirm-action-btn');
    if (confirmActionBtn) {
        confirmActionBtn.textContent = actionText;
        confirmActionBtn.style.display = 'inline-block';
    }

    // danger クラス制御
    if (danger) {
        confirmOkBtn.className = 'btn-danger';
    } else {
        confirmOkBtn.className = 'btn-primary';
    }

    // Initialize lucide icon
    if (window.lucide) {
        window.lucide.createIcons();
    }

    confirmModal.classList.add('active');

    return new Promise((resolve) => {
        resolvePromise = (result) => {
            // 次回のために action ボタンを非表示に戻す
            if (confirmActionBtn) {
                confirmActionBtn.style.display = 'none';
            }
            resolve(result);
        };
    });
}
