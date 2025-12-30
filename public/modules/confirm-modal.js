// Confirm modal module

const confirmModal = document.getElementById('confirm-modal');
const confirmTitle = document.getElementById('confirm-modal-title');
const confirmMessage = document.getElementById('confirm-modal-message');
const confirmOkBtn = document.getElementById('confirm-ok-btn');
const confirmCancelBtn = document.getElementById('confirm-cancel-btn');

let resolvePromise = null;

// Setup event listeners
confirmModal.querySelector('.close-modal-btn').addEventListener('click', () => closeConfirm(false));
confirmCancelBtn.addEventListener('click', () => closeConfirm(false));
confirmOkBtn.addEventListener('click', () => closeConfirm(true));
confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) closeConfirm(false);
});

function closeConfirm(result) {
    confirmModal.classList.remove('active');
    if (resolvePromise) {
        resolvePromise(result);
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
    const {
        title = '確認',
        okText = 'OK',
        cancelText = 'キャンセル',
        danger = true
    } = options;

    confirmTitle.innerHTML = `<i data-lucide="alert-circle"></i> ${title}`;
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
