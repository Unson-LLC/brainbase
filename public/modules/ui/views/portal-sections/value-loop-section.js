// @ts-check
/**
 * Value Loop Section — Decision → Work → Ship → Learn 4カラムGrid
 * ポータルの核心セクション
 */

/**
 * @param {Object} valueLoop - { decision, work, ship, learn }
 * @param {Function} escapeHtml
 * @returns {string} HTML
 */
export function renderValueLoopSection(valueLoop, { escapeHtml }) {
    if (!valueLoop) {
        return '<div class="portal-vl-empty">Value Loopデータなし</div>';
    }

    const { decision = {}, work = {}, ship = {}, learn = {} } = valueLoop;

    return `
        <div class="portal-vl-grid">
            ${_renderColumn('decision', 'Decision', _renderDecisionItems(decision, escapeHtml))}
            ${_renderColumn('work', 'Work', _renderWorkItems(work, escapeHtml))}
            ${_renderColumn('ship', 'Ship', _renderShipItems(ship, escapeHtml))}
            ${_renderColumn('learn', 'Learn', _renderLearnItems(learn, escapeHtml))}
        </div>
    `;
}

function _renderColumn(phase, label, { count, html }) {
    return `
        <div class="portal-vl-column" data-phase="${phase}">
            <div class="portal-vl-column-header">
                <span>${label}</span>
                <span class="portal-vl-count">${count}</span>
            </div>
            <div class="portal-vl-items">${html}</div>
        </div>
    `;
}

function _renderDecisionItems(decision, esc) {
    const items = [];

    // Active milestones
    for (const m of (decision.milestones || [])) {
        items.push(_card(esc(m.name || m.title || ''), [
            ['milestone', m.status || ''],
            ['progress', `${m.progress || 0}%`]
        ]));
    }

    // High-impact issues
    for (const i of (decision.issues || [])) {
        const detail = [i.description, i.decisionLog].filter(Boolean).join(' / ');
        items.push(_card(esc(i.title || ''), [
            ['impact', i.impact || ''],
            ['assignee', i.assignee ? `@${esc(i.assignee)}` : '']
        ], detail ? esc(detail.substring(0, 300)) : null));
    }

    // Recent decisions
    for (const d of (decision.decisions || [])) {
        const detail = [d.chosen && `決定: ${d.chosen}`, d.reason && `理由: ${d.reason}`].filter(Boolean).join(' / ');
        items.push(_card(esc(d.title || ''), [
            ['decided', d.decidedAt ? new Date(d.decidedAt).toLocaleDateString('ja-JP') : '']
        ], detail ? esc(detail.substring(0, 300)) : null));
    }

    return {
        count: items.length,
        html: items.length ? items.join('') : '<div class="portal-vl-empty">判断待ちなし</div>'
    };
}

function _renderWorkItems(work, esc) {
    const items = [];

    // Current sprint
    if (work.currentSprint) {
        const s = work.currentSprint;
        items.push(`<div class="portal-vl-card" style="border-left:2px solid #38bdf8">
            <div class="portal-vl-card-title">${esc(s.period || 'Sprint')}</div>
            <div class="portal-vl-card-meta">${s.goals ? `<span>${esc(s.goals.substring(0, 100))}</span>` : ''}</div>
        </div>`);
    }

    // Tasks
    for (const t of (work.tasks || []).slice(0, 8)) {
        const dueStr = t.due ? new Date(t.due).toLocaleDateString('ja-JP') : '';
        const isOverdue = t.due && new Date(t.due) < new Date() && t.status !== '完了';
        const detail = t.description ? esc(t.description.substring(0, 200)) : null;
        items.push(_card(esc(t.title || ''), [
            ['status', t.status || ''],
            ['assignee', t.assignee ? `@${esc(t.assignee)}` : ''],
            ['due', isOverdue ? `<span style="color:#ef4444">${dueStr}</span>` : dueStr]
        ], detail));
    }

    return {
        count: (work.tasks || []).length,
        html: items.length ? items.join('') : '<div class="portal-vl-empty">実行中タスクなし</div>'
    };
}

function _renderShipItems(ship, esc) {
    const items = [];

    for (const s of (ship.items || []).slice(0, 8)) {
        const dateStr = s.shippedAt ? new Date(s.shippedAt).toLocaleDateString('ja-JP') : '';
        const details = [s.description, s.evidenceUrl && `証跡: ${s.evidenceUrl}`].filter(Boolean).join(' / ');
        items.push(_card(esc(s.title || ''), [
            ['type', s.type || ''],
            ['status', s.status || ''],
            ['date', dateStr]
        ], details ? esc(details.substring(0, 300)) : null));
    }

    return {
        count: (ship.items || []).length,
        html: items.length ? items.join('') : '<div class="portal-vl-empty">出荷準備なし</div>'
    };
}

function _renderLearnItems(learn, esc) {
    const items = [];

    for (const r of (learn.retrospectives || [])) {
        if (r.learnings) {
            items.push(`<div class="portal-vl-card">
                <div class="portal-vl-card-title">${esc(r.period || 'Sprint')}</div>
                <div class="portal-vl-card-meta"><span>${esc(r.learnings.substring(0, 150))}${r.learnings.length > 150 ? '...' : ''}</span></div>
            </div>`);
        }
    }

    return {
        count: items.length,
        html: items.length ? items.join('') : '<div class="portal-vl-empty">学び候補なし</div>'
    };
}

function _card(title, meta, details) {
    const metaHtml = meta
        .filter(([, v]) => v)
        .map(([k, v]) => `<span>${v}</span>`)
        .join('');

    if (details) {
        const id = `vl-${Math.random().toString(36).substr(2, 6)}`;
        return `<details class="portal-vl-card" id="${id}">
            <summary style="cursor:pointer;list-style:none">
                <div class="portal-vl-card-title">${title} <span style="font-size:9px;color:var(--text-tertiary,rgba(255,255,255,0.3))">▸</span></div>
                ${metaHtml ? `<div class="portal-vl-card-meta">${metaHtml}</div>` : ''}
            </summary>
            <div style="font-size:11px;color:var(--text-secondary);line-height:1.5;padding:6px 0 2px;border-top:1px solid rgba(255,255,255,0.04);margin-top:4px">${details}</div>
        </details>`;
    }

    return `<div class="portal-vl-card">
        <div class="portal-vl-card-title">${title}</div>
        ${metaHtml ? `<div class="portal-vl-card-meta">${metaHtml}</div>` : ''}
    </div>`;
}
