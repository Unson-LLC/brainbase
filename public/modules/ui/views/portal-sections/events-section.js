// @ts-check
/**
 * Events Section — イベントタイムライン
 */

/**
 * @param {Object} events - { items: [], stats: { thisWeek } }
 * @param {Function} escapeHtml
 * @returns {string} HTML
 */
export function renderEventsSection(events, { escapeHtml }) {
    const items = events?.items || [];

    if (!items.length) {
        return '<div class="portal-events-empty">直近のイベントなし</div>';
    }

    const html = items.slice(0, 15).map(e => {
        const type = e.event_type || e.type || 'work';
        const date = e.occurred_at || e.shippedAt || e.decided_at || '';
        const dateStr = date ? new Date(date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) : '';
        const desc = _eventDescription(e, escapeHtml);

        return `
            <div class="portal-event-item" data-type="${type}">
                <span>${desc}</span>
                <span class="portal-event-date">${dateStr}</span>
            </div>
        `;
    }).join('');

    return `<div class="portal-events-timeline">${html}</div>`;
}

function _eventDescription(e, esc) {
    // PostgreSQL events have payload
    if (e.payload) {
        const p = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload;
        return esc(p.title || p.description || p.summary || JSON.stringify(p).substring(0, 80));
    }
    // NocoDB ship/decision items
    return esc(e.title || e.name || '(no description)');
}
