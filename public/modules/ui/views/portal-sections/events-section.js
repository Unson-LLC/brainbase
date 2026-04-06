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

        const detail = _eventDetail(e, escapeHtml);
        const id = `ev-${Math.random().toString(36).substr(2, 6)}`;

        if (detail) {
            return `
                <details class="portal-event-item" data-type="${type}" id="${id}">
                    <summary style="cursor:pointer;list-style:none">
                        <span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;color:var(--text-secondary);margin-right:6px">${typeLabel}</span>
                        <span>${desc}</span>
                        <span class="portal-event-date">${dateStr}</span>
                        <span style="font-size:9px;color:var(--text-tertiary,rgba(255,255,255,0.3));margin-left:4px">▸</span>
                    </summary>
                    <div style="font-size:11px;color:var(--text-secondary);line-height:1.5;padding:4px 0 2px;margin-top:4px;border-top:1px solid rgba(255,255,255,0.04)">${detail}</div>
                </details>
            `;
        }

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

function _eventDetail(e, esc) {
    if (!e.payload) return null;
    const p = typeof e.payload === 'string' ? _safeParse(e.payload) : e.payload;
    if (!p || typeof p !== 'object') return null;
    // Format key-value pairs nicely, skip already-shown fields
    const shown = new Set(['title', 'description', 'summary', 'name', 'message']);
    const pairs = Object.entries(p)
        .filter(([k, v]) => !shown.has(k) && v != null && v !== '' && typeof v !== 'object')
        .map(([k, v]) => `<span style="color:var(--text-tertiary,rgba(255,255,255,0.4))">${esc(k)}:</span> ${esc(String(v))}`)
        .slice(0, 6);
    return pairs.length ? pairs.join('<br>') : null;
}

function _safeParse(str) {
    try { return JSON.parse(str); } catch { return null; }
}
