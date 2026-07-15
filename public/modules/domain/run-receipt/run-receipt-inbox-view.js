// @ts-check

const SOURCE_LABELS = {
    mana: 'Mana',
    codex_automations: 'Codex Automations',
    github_actions: 'GitHub Actions',
    salestailor: 'SalesTailor'
};

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function selected(actual, expected) {
    return actual === expected ? ' selected' : '';
}

function sourceLabel(type) {
    return SOURCE_LABELS[type] || type || 'unknown';
}

function statusClass(status) {
    if (['failed', 'blocked'].includes(status)) return 'bad';
    if (status === 'waiting_human') return 'warn';
    if (status === 'success') return 'good';
    return '';
}

function evidenceClass(state) {
    if (state === 'confirmed') return 'good';
    if (state === 'unconfirmed' || state === 'no_data') return 'warn';
    return '';
}

function formatMetrics(metrics) {
    return Object.entries(metrics || {})
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(' · ');
}

function renderReceipt(item) {
    const source = item.source || {};
    const refs = Array.isArray(item.evidence_refs) ? item.evidence_refs : [];
    const metrics = formatMetrics(item.metrics);
    const action = item.source_action || item.action_required || 'none';
    const observationKind = item.observation_kind || 'source_run';
    const isConnectorObservation = observationKind === 'connector_observation';
    const title = isConnectorObservation
        ? 'Connector observation'
        : source.name || source.workflow_id || item.id;
    return `
        <article class="run-receipt-card" data-run-receipt-id="${escapeHtml(item.id)}" data-observation-kind="${escapeHtml(observationKind)}">
            <div class="run-receipt-card-head">
                <div>
                    <strong>${escapeHtml(title)}</strong>
                    <div class="sub">${escapeHtml(item.project_id || '-')} · ${escapeHtml(sourceLabel(source.type))} · ${escapeHtml(source.runtime_target || '-')}</div>
                </div>
                <div class="chips" aria-label="Run and evidence states">
                    ${isConnectorObservation ? '<span class="badge warn">observation: Connector observation</span>' : ''}
                    <span class="badge ${statusClass(item.source_status)}">status: ${escapeHtml(item.source_status)}</span>
                    <span class="badge ${evidenceClass(item.evidence_state)}">evidence: ${escapeHtml(item.evidence_state)}</span>
                </div>
            </div>
            ${item.summary ? `<p class="run-receipt-summary">${escapeHtml(item.summary)}</p>` : ''}
            <dl class="run-receipt-facts">
                <div><dt>Action</dt><dd>${escapeHtml(action)}</dd></div>
                <div><dt>Blocker</dt><dd>${escapeHtml(item.blocker_reason || 'none')}</dd></div>
                <div><dt>Run ID</dt><dd>${escapeHtml(item.id)}</dd></div>
                <div><dt>Observed</dt><dd>${escapeHtml(item.effective_at || item.created_at || '-')}</dd></div>
            </dl>
            <div class="run-receipt-detail"><strong>Evidence refs</strong>${refs.length
                ? `<ul>${refs.map((ref) => `<li><code>${escapeHtml(ref.kind || 'ref')}: ${escapeHtml(ref.ref || '')}</code></li>`).join('')}</ul>`
                : '<span class="sub"> none</span>'}</div>
            ${metrics ? `<div class="run-receipt-detail"><strong>Metrics</strong> <span>${escapeHtml(metrics)}</span></div>` : ''}
        </article>
    `;
}

function renderStatus(inbox) {
    if (inbox.status === 'unavailable') {
        const suffix = inbox.items?.length ? ' 前回確認済みのsnapshotを表示しています。' : ' 確認済みsnapshotはありません。';
        return `<div class="run-receipt-notice bad">取得不能: ${escapeHtml(inbox.error || 'unknown error')}。${suffix}</div>`;
    }
    if (inbox.status === 'loading') {
        return `<div class="run-receipt-notice">更新中。${inbox.items?.length ? '前回確認済みのsnapshotを維持しています。' : '取得完了まで件数は未確認です。'}</div>`;
    }
    if (inbox.status === 'idle') return '<div class="run-receipt-notice">Run Receiptはまだ未確認です。</div>';
    return `<div class="run-receipt-notice">${escapeHtml(inbox.count)}件を確認済み${inbox.has_more ? `（${escapeHtml(inbox.omitted_count)}件は上限外）` : ''}</div>`;
}

export function renderRunReceiptInbox(inbox = {}, { projects = [] } = {}) {
    const filters = inbox.filters || {};
    const projectOptions = Array.from(new Set([filters.project_id, ...projects].filter(Boolean)));
    const items = Array.isArray(inbox.items) ? inbox.items : [];
    const canDeclareEmpty = inbox.status === 'ready' && items.length === 0;
    return `
        <section id="agent-run-inbox" class="agent-run-inbox" aria-labelledby="agent-run-inbox-heading">
            <div class="section-title">
                <div><h2 id="agent-run-inbox-heading">Agent Run Inbox</h2><span class="sub">4 runtimeの実行結果・証拠・次アクション</span></div>
                <span class="badge">run_receipt.v1</span>
            </div>
            <form id="agent-run-inbox-filters" class="run-receipt-filters">
                <label for="run-receipt-project">Project
                    <select id="run-receipt-project" name="project_id"><option value="">All projects</option>${projectOptions.map((value) => `<option value="${escapeHtml(value)}"${selected(filters.project_id, value)}>${escapeHtml(value)}</option>`).join('')}</select>
                </label>
                <label for="run-receipt-source">Source
                    <select id="run-receipt-source" name="source_type"><option value="">All sources</option>${Object.entries(SOURCE_LABELS).map(([value, label]) => `<option value="${value}"${selected(filters.source_type, value)}>${label}</option>`).join('')}</select>
                </label>
                <label for="run-receipt-status">Status
                    <select id="run-receipt-status" name="run_status"><option value="">All statuses</option>${['success', 'failed', 'blocked', 'waiting_human', 'cancelled'].map((value) => `<option value="${value}"${selected(filters.run_status, value)}>${value}</option>`).join('')}</select>
                </label>
                <label for="run-receipt-evidence">Evidence
                    <select id="run-receipt-evidence" name="evidence_state"><option value="">All evidence</option>${['confirmed', 'unconfirmed', 'no_data'].map((value) => `<option value="${value}"${selected(filters.evidence_state, value)}>${value}</option>`).join('')}</select>
                </label>
                <div class="run-receipt-filter-actions"><button class="btn primary" type="submit">Apply</button><button class="btn soft" type="button" data-action="reset-run-receipt-filters">Reset</button></div>
            </form>
            <div id="agent-run-inbox-status" role="status" aria-live="polite">${renderStatus({ ...inbox, items })}</div>
            <div class="run-receipt-list">${items.map(renderReceipt).join('') || (canDeclareEmpty ? '<div class="empty">該当するRun Receiptはありません</div>' : '')}</div>
        </section>
    `;
}
