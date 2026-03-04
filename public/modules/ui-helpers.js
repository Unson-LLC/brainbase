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
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Format time for display (HH:MM format)
 * @param {string|Date} time - Time to format
 * @returns {string} Formatted time string
 */
export function formatTime(time) {
    if (!time) return '';
    const date = new Date(time);
    if (isNaN(date.getTime())) return time;
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
