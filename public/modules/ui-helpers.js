// @ts-check
/**
 * ui-helpers.js - UI utility functions
 *
 * Pure functions for UI formatting and manipulation.
 * No state dependencies.
 */

/**
 * Format due date for display
 * @param {string} dateStr - Date string to format
 * @returns {string} Formatted date string (今日, 明日, 期限切れ, or M/D)
 */
export function formatDueDate(dateStr) {
    const due = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (due < today) return '期限切れ';
    if (due.toDateString() === today.toDateString()) return '今日';
    if (due.toDateString() === tomorrow.toDateString()) return '明日';
    return `${due.getMonth() + 1}/${due.getDate()}`;
}

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Replace an element's children with a sanitized subset of HTML.
 * Use this only for trusted templates or content already normalized by renderers.
 * Prefer textContent for plain user-provided strings.
 * @param {Element} element
 * @param {string} html
 */
export function setSanitizedHtml(element, html) {
    if (!element) return;
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html || ''), 'text/html');
    sanitizeHtmlTree(doc.body);
    element.replaceChildren(...Array.from(doc.body.childNodes));
}

function sanitizeHtmlTree(root) {
    const blockedTags = new Set(['script', 'iframe', 'object', 'embed', 'link', 'meta']);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    const removals = [];

    while (walker.nextNode()) {
        const el = /** @type {Element} */ (walker.currentNode);
        const tagName = el.tagName.toLowerCase();
        if (blockedTags.has(tagName)) {
            removals.push(el);
            continue;
        }

        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            const value = attr.value.trim().toLowerCase();
            if (name.startsWith('on') || value.startsWith('javascript:')) {
                el.removeAttribute(attr.name);
            }
        }
    }

    removals.forEach((node) => node.remove());
}

/**
 * Format time for display (HH:MM format)
 * @param {string|Date} time - Time to format
 * @returns {string} Formatted time string
 */
export function formatTime(time) {
    if (!time) return '';
    const date = new Date(time);
    if (isNaN(date.getTime())) return String(time);
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Create icon element using Lucide
 * @param {string} name - Icon name
 * @param {string} [className] - Additional CSS class
 * @returns {string} HTML string for icon
 */
export function iconHtml(name, className = '') {
    return `<i data-lucide="${name}" class="${className}"></i>`;
}

/**
 * Lucideアイコンを（再）初期化する
 * グローバルの lucide が読み込まれていない場合は何もしない
 * @param {Object} [opts] - lucide.createIcons に渡すオプション（root, nodes 等）
 */
export function refreshIcons(opts) {
    if (/** @type {any} */ (window).lucide) {
        /** @type {any} */ (window).lucide.createIcons(opts);
    }
}
