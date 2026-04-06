// @ts-check
/**
 * Events Section — イベントタイムライン
 */

const TYPE_LABELS = {
    decision: 'Decision',
    ship: 'Ship',
    work: 'Work',
    learn: 'Learn',
    iteration: 'Sprint',
    revise_semantic: 'Revise',
    revise_editorial: 'Edit'
};

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
        const type = e.eventType || e.event_type || e.type || 'work';
        const date = e.occurredAt || e.occurred_at || e.shippedAt || e.decided_at || '';
        const dateStr = date ? new Date(date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) : '';
        const desc = _eventDescription(e, escapeHtml);
        const typeLabel = TYPE_LABELS[type] || type;

        return `
            <div class="portal-event-item" data-type="${type}">
                <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;color:var(--text-secondary);margin-right:6px">${typeLabel}</span>
                <span>${desc}</span>
                <span class="portal-event-date">${dateStr}</span>
            </div>
        `;
    }).join('');

    return `<div class="portal-events-timeline">${html}</div>`;
}

function _eventDescription(e, esc) {
    // PostgreSQL events have payload (JSON object)
    if (e.payload) {
        const p = typeof e.payload === 'string' ? _safeParse(e.payload) : e.payload;
        if (p) {
            // Try known fields in priority order
            const text = p.title || p.description || p.summary || p.name || p.message;
            if (text) return esc(text);
            // For RACI/role events, format nicely
            if (p.role_code) return esc(`${p.role_code} (${p.authority_scope || ''})`);
            // For other structured data, show first meaningful value
            const vals = Object.values(p).filter(v => typeof v === 'string' && v.length > 2 && v.length < 100);
            if (vals.length) return esc(vals[0]);
        }
    }
    // Fallback to top-level fields
    return esc(e.title || e.name || e.description || '(詳細なし)');
}

function _safeParse(str) {
    try { return JSON.parse(str); } catch { return null; }
}
