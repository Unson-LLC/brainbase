// @ts-check

export const SOURCE_CLASS_LABELS = Object.freeze({
    graph_ssot: 'Graph正本',
    candidate_store: '候補ストア',
    personal_kg: '個人KG',
    ai_context: 'AI参照文脈',
    runtime_config: '設定/実行環境'
});

export const JA_LABELS = Object.freeze({
    title: 'Brainbase 管理画面',
    subtitle: '正本、候補、個人KG、AI参照文脈、設定状態を分けて確認します。',
    overview: '概要',
    graph: 'Graph正本',
    candidates: '候補ストア',
    personalKg: '個人KG',
    context: 'AI文脈',
    flow: 'データフロー',
    health: '設定/ヘルス',
    refresh: '再読み込み',
    openApp: '通常画面',
    filter: '絞り込み',
    project: 'プロジェクト',
    type: '種別',
    query: '検索',
    status: '状態',
    redaction: '秘匿状態',
    layer: '記憶層',
    owner: '所有者',
    runPreview: '文脈を確認',
    noRecords: '表示できるレコードがありません',
    available: '接続済み',
    unavailable: '未接続',
    partial: '一部不足',
    configured: '設定あり',
    not_configured: '未設定',
    secretSafe: '値は表示しません'
});

const STATUS_LABELS = {
    available: JA_LABELS.available,
    unavailable: JA_LABELS.unavailable,
    partial: JA_LABELS.partial,
    configured: JA_LABELS.configured,
    not_configured: JA_LABELS.not_configured,
    connected: '接続済み',
    not_checked: '未確認',
    present: '存在',
    missing: '不足',
    candidate: '候補',
    pending_approval: '承認待ち',
    approved: '承認済み',
    rejected: '却下',
    expired: '期限切れ',
    promoted_to_graph: 'Graph反映済み',
    none: 'なし',
    needs_redaction: '秘匿要',
    redacted: '秘匿済み',
    not_found: '未検出',
    not_requested: '未指定'
};
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_PERSONAL_KG_LIMIT = 500;
const NAV = [
    ['overview', JA_LABELS.overview, 'layout-dashboard'],
    ['graph', JA_LABELS.graph, 'database'],
    ['candidates', JA_LABELS.candidates, 'inbox'],
    ['personal-kg', JA_LABELS.personalKg, 'network'],
    ['context', JA_LABELS.context, 'brain-circuit'],
    ['flow', JA_LABELS.flow, 'git-branch'],
    ['health', JA_LABELS.health, 'shield-check']
];

function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function badge(sourceClass) {
    const style = sourceClass === 'graph_ssot' ? 'graph' : sourceClass === 'candidate_store' ? 'candidate' : sourceClass === 'personal_kg' ? 'personal' : sourceClass === 'ai_context' ? 'context' : 'runtime';
    return `<span class="badge ${style}">${escapeHtml(SOURCE_CLASS_LABELS[sourceClass] || sourceClass)}</span>`;
}

export function formatStatusLabel(status) {
    return STATUS_LABELS[status] || status || 'unknown';
}

function status(statusCode) {
    return `<span class="status-${escapeHtml(statusCode)}">${escapeHtml(formatStatusLabel(statusCode))}</span>`;
}

function renderContextIncluded(items = []) {
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) return '<div class="context-detail"><strong>含まれた文脈</strong><span class="muted">なし</span></div>';
    return `<div class="context-detail"><strong>含まれた文脈</strong><div class="record-meta">${rows.map((item) => `<span>${escapeHtml(item.type || 'unknown')}: ${escapeHtml(item.count ?? 0)}</span>`).join('')}</div></div>`;
}

function renderDeniedReasons(memory = {}) {
    const entries = Object.entries(memory?.denied_reasons || {});
    if (!entries.length) return memory?.denied_count ? '<div class="context-detail"><strong>除外理由</strong><span class="muted">詳細なし</span></div>' : '';
    return `<div class="context-detail"><strong>除外理由</strong><div class="record-meta">${entries.map(([reason, count]) => `<span>${escapeHtml(reason)}: ${escapeHtml(count)}</span>`).join('')}</div></div>`;
}

function renderWarnings(warnings = []) {
    const rows = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
    return rows.length ? `<ul class="warning-list">${rows.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>` : '';
}

function sourceUnavailableReason(sourceClass, data = {}) {
    const text = String(data.reason || data.message || '');
    if (sourceClass === 'graph_ssot' && /InfoSSOTService is not configured/i.test(text)) {
        return 'Graph正本サービスが未設定です';
    }
    if (sourceClass === 'candidate_store' && /candidateRepository is not configured/i.test(text)) {
        return '候補ストアリポジトリが未設定です';
    }
    if (text) return text;
    return `${SOURCE_CLASS_LABELS[sourceClass] || sourceClass}に接続できません`;
}

function renderUnavailableSource(sourceClass, data = {}) {
    return `<div class="empty-state"><strong>${status(data.status || 'unavailable')}</strong><p>${escapeHtml(sourceUnavailableReason(sourceClass, data))}</p></div>`;
}

function personalKgReason(data = {}) {
    const text = String(data.reason || data.message || '');
    if (!text) return '個人KGソースに接続できません';
    if (/candidate repository unavailable|candidateRepository is not configured/i.test(text)) {
        return '候補ストアリポジトリが未設定のため個人KGを取得できません';
    }
    return text;
}

export function getAuthHeaders(storage = globalThis.localStorage) {
    const token = storage?.getItem?.('brainbase.auth.token');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function friendlyHttpError(statusCode, text) {
    let payload = null;
    try { payload = JSON.parse(text); } catch { payload = null; }
    const raw = payload?.error || payload?.message || text || '';
    if (statusCode === 401 || /Authorization token required|unauthorized|auth/i.test(raw)) {
        return '認証が必要です。通常画面でログインしてから再読み込みしてください。';
    }
    if (statusCode === 403) return 'この管理情報を表示する権限がありません。';
    return raw ? `読み込みに失敗しました: ${raw}` : `読み込みに失敗しました: HTTP ${statusCode}`;
}

export class AdminPage {
    constructor({ root, fetchImpl = globalThis.fetch, storage = globalThis.localStorage }) {
        this.root = root;
        this.fetchImpl = fetchImpl;
        this.storage = storage;
        this.active = 'overview';
        this.state = {};
        this.csrfToken = null;
        this.personalKgLimit = 50;
        this.personalKgRequestSeq = 0;
    }

    fetch(path, options = {}) {
        return this.fetchImpl.call(globalThis, path, { cache: 'no-store', ...options });
    }

    async csrfHeaders(method) {
        if (!MUTATING_METHODS.has(String(method || 'GET').toUpperCase())) return {};
        if (!this.csrfToken) {
            const response = await this.fetch('/api/csrf-token', { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', ...getAuthHeaders(this.storage) } });
            if (!response.ok) throw new Error(`CSRF token fetch failed: ${response.status}`);
            const payload = await response.json();
            this.csrfToken = payload.token || null;
        }
        return this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {};
    }

    async request(path, options = {}) {
        const method = options.method || 'GET';
        const headers = { Accept: 'application/json', 'Cache-Control': 'no-cache', ...getAuthHeaders(this.storage), ...await this.csrfHeaders(method) };
        if (options.body) headers['Content-Type'] = 'application/json';
        const response = await this.fetch(path, { ...options, method, headers, body: options.body ? JSON.stringify(options.body) : null });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw Object.assign(new Error(friendlyHttpError(response.status, text)), { status: response.status });
        }
        return response.json();
    }

    mount() {
        this.root.innerHTML = this.shell();
        this.root.querySelectorAll('[data-nav]').forEach((button) => button.addEventListener('click', () => {
            this.active = button.getAttribute('data-nav') || 'overview';
            this.sync();
            this.load();
        }));
        this.root.querySelector('[data-refresh]')?.addEventListener('click', () => this.load(true));
        this.root.querySelector('[data-load-graph]')?.addEventListener('click', () => this.loadGraph());
        this.root.querySelector('[data-load-candidates]')?.addEventListener('click', () => this.loadCandidates());
        this.root.querySelector('[data-load-personal-kg]')?.addEventListener('click', () => this.loadPersonalKgFromControl({ resetLimit: true }));
        this.root.querySelector('[data-run-context]')?.addEventListener('click', () => this.loadContext());
        this.root.querySelector('[data-load-flow]')?.addEventListener('click', () => this.loadFlow());
        this.load();
        this.icons();
    }

    shell() {
        return `<div class="admin-shell"><aside class="admin-sidebar"><div class="brand"><img src="favicon.png" alt=""><div><strong>Brainbase</strong><span>管理画面</span></div></div><nav class="admin-nav">${NAV.map(([id, label, icon]) => `<button type="button" class="${id === this.active ? 'active' : ''}" data-nav="${id}"><i data-lucide="${icon}"></i><span>${label}</span></button>`).join('')}</nav></aside><main class="admin-main"><header class="admin-topbar"><div class="admin-title"><h1>${JA_LABELS.title}</h1><p>${JA_LABELS.subtitle}</p></div><div class="admin-actions"><a class="secondary-button" href="/">${JA_LABELS.openApp}</a><button class="primary-button" type="button" data-refresh>${JA_LABELS.refresh}</button></div></header>${this.sections()}</main></div><div class="admin-toast" data-toast></div>`;
    }

    sections() {
        return `<section class="admin-section active" data-section="overview"><div data-overview class="empty-state">概要を読み込みます</div></section><section class="admin-section" data-section="graph">${this.graphPanel()}</section><section class="admin-section" data-section="candidates">${this.candidatePanel()}</section><section class="admin-section" data-section="personal-kg">${this.personalKgPanel()}</section><section class="admin-section" data-section="context">${this.contextPanel()}</section><section class="admin-section" data-section="flow">${this.flowPanel()}</section><section class="admin-section" data-section="health"><div data-health class="empty-state">ヘルスを読み込みます</div></section>`;
    }

    sync() {
        this.root.querySelectorAll('[data-nav]').forEach((button) => button.classList.toggle('active', button.getAttribute('data-nav') === this.active));
        this.root.querySelectorAll('[data-section]').forEach((section) => section.classList.toggle('active', section.getAttribute('data-section') === this.active));
        this.icons();
    }

    async load(force = false) {
        try {
            if (this.active === 'overview' && (!this.state.overview || force)) await this.loadOverview();
            if (this.active === 'graph' && (!this.state.graph || force)) await this.loadGraph();
            if (this.active === 'candidates' && (!this.state.candidates || force)) await this.loadCandidates();
            if (this.active === 'personal-kg' && (!this.state.personalKg || force)) await this.loadPersonalKg();
            if (this.active === 'context' && (this.state.context || force)) await this.loadContext();
            if (this.active === 'flow' && (!this.state.flow || force)) await this.loadFlow();
            if (this.active === 'health' && (!this.state.health || force)) await this.loadHealth();
        } catch (error) {
            this.handleLoadError(error);
        }
    }

    handleLoadError(error) {
        this.renderLoadError(error);
        this.toast(error.message || '読み込みに失敗しました');
    }

    renderLoadError(error) {
        const message = error?.message || '読み込みに失敗しました';
        const html = `<div class="empty-state"><strong>表示できません</strong><p>${escapeHtml(message)}</p></div>`;
        const targets = {
            overview: '[data-overview]',
            graph: '[data-graph-list]',
            candidates: '[data-candidate-list]',
            'personal-kg': '[data-personal-kg-list]',
            context: '[data-context-result]',
            flow: '[data-flow-list]',
            health: '[data-health]'
        };
        const target = this.root.querySelector(targets[this.active]);
        if (target) target.innerHTML = html;
    }

    async loadOverview() {
        this.state.overview = await this.request('/api/admin/overview');
        const overview = this.state.overview;
        const kg = overview.personal_kg?.summary || {};
        const warningHtml = renderWarnings(overview.candidates?.warnings);
        this.root.querySelector('[data-overview]').innerHTML = `<div class="overview-grid">${(overview.sources || []).map((s) => `<article class="source-card"><div class="record-title"><h3>${escapeHtml(s.label)}</h3>${badge(s.source_class)}</div><p>${status(s.status)}</p></article>`).join('')}</div>${warningHtml}<div class="metric-row"><div class="metric"><strong>${overview.graph?.total ?? 0}</strong><span>Graph正本</span></div><div class="metric"><strong>${overview.candidates?.total ?? 0}</strong><span>候補</span></div><div class="metric"><strong>${overview.personal_kg?.total ?? 0}</strong><span>個人KG</span></div><div class="metric"><strong>${kg.sns_ready_count ?? 0}</strong><span>SNS利用可</span></div><div class="metric"><strong>${kg.review_count ?? 0}</strong><span>要レビュー</span></div></div>`;
    }

    filters(scope) {
        const params = new URLSearchParams();
        this.root.querySelectorAll(`[data-${scope}]`).forEach((input) => { if (input.value) params.set(input.getAttribute(`data-${scope}`), input.value); });
        const value = params.toString();
        return value ? `?${value}` : '';
    }

    graphPanel() {
        return `<section class="panel"><div class="panel-header"><h2>${JA_LABELS.graph}</h2>${badge('graph_ssot')}</div><div class="filter-bar"><label>${JA_LABELS.project}<input data-graph-filter="project" placeholder="brainbase"></label><label>${JA_LABELS.type}<input data-graph-filter="type" placeholder="project"></label><label>${JA_LABELS.query}<input data-graph-filter="q" placeholder="名前・ID"></label><button class="secondary-button" type="button" data-load-graph>${JA_LABELS.filter}</button></div><div data-graph-list class="empty-state">Graph正本を読み込みます</div></section>`;
    }

    async loadGraph() {
        this.state.graph = await this.request(`/api/admin/graph/entities${this.filters('graph-filter')}`);
        if (this.state.graph.status && this.state.graph.status !== 'available') {
            this.root.querySelector('[data-graph-list]').innerHTML = renderUnavailableSource('graph_ssot', this.state.graph);
            return;
        }
        const records = this.state.graph.records || [];
        this.root.querySelector('[data-graph-list]').innerHTML = records.length ? records.map((r) => `<article class="record-row"><div class="record-title"><strong>${escapeHtml(r.label || r.id)}</strong>${badge(r.source_class)}</div><div class="record-meta"><span>ID: ${escapeHtml(r.id)}</span><span>種別: ${escapeHtml(r.entity_type)}</span><span>project: ${escapeHtml(r.project_code || '-')}</span><span>sensitivity: ${escapeHtml(r.sensitivity || '-')}</span><span>role_min: ${escapeHtml(r.role_min || '-')}</span><span>updated_at: ${escapeHtml(r.updated_at || '-')}</span></div><p class="preview-text">${escapeHtml(r.payload_preview || '')}</p></article>`).join('') : `<div class="empty-state">${JA_LABELS.noRecords}</div>`;
    }

    candidatePanel() {
        return `<section class="panel"><div class="panel-header"><h2>${JA_LABELS.candidates}</h2>${badge('candidate_store')}</div><div class="filter-bar"><label>${JA_LABELS.project}<input data-candidate-filter="project" placeholder="brainbase"></label><label>${JA_LABELS.status}<input data-candidate-filter="status" placeholder="candidate"></label><label>${JA_LABELS.type}<input data-candidate-filter="type" placeholder="preference"></label><label>${JA_LABELS.redaction}<input data-candidate-filter="redaction" placeholder="none"></label><button class="secondary-button" type="button" data-load-candidates>${JA_LABELS.filter}</button></div><div data-candidate-list class="empty-state">候補ストアを読み込みます</div></section>`;
    }

    async loadCandidates() {
        this.state.candidates = await this.request(`/api/admin/candidates${this.filters('candidate-filter')}`);
        const warningHtml = renderWarnings(this.state.candidates.warnings);
        if (this.state.candidates.status && this.state.candidates.status !== 'available') {
            this.root.querySelector('[data-candidate-list]').innerHTML = `${warningHtml}${renderUnavailableSource('candidate_store', this.state.candidates)}`;
            return;
        }
        const records = this.state.candidates.records || [];
        const recordsHtml = records.length ? records.map((r) => `<article class="record-row"><div class="record-title"><strong>${escapeHtml(r.id)}</strong>${badge(r.source_class)}</div><div class="record-meta"><span>promotion: ${escapeHtml(formatStatusLabel(r.promotion_status))}</span><span>redaction: ${escapeHtml(formatStatusLabel(r.redaction_status))}</span><span>cognitive: ${escapeHtml(r.cognitive_type || '-')}</span><span>visibility: ${escapeHtml(r.visibility || '-')}</span><span>sensitivity: ${escapeHtml(r.sensitivity || '-')}</span><span>role_min: ${escapeHtml(r.role_min || '-')}</span><span>created_at: ${escapeHtml(r.created_at || '-')}</span></div><p class="preview-text">${escapeHtml(r.body_preview || '')}</p></article>`).join('') : `<div class="empty-state">${JA_LABELS.noRecords}</div>`;
        this.root.querySelector('[data-candidate-list]').innerHTML = `${warningHtml}${recordsHtml}`;
    }

    personalKgPanel() {
        return `<section class="panel"><div class="panel-header"><h2>${JA_LABELS.personalKg}</h2>${badge('personal_kg')}</div><div class="filter-bar"><label>${JA_LABELS.owner}<input data-personal-kg-filter="owner" placeholder="現在のログイン主体"></label><label>${JA_LABELS.layer}<input data-personal-kg-filter="layer" placeholder="personal_kg_core"></label><label>${JA_LABELS.status}<input data-personal-kg-filter="status" placeholder="candidate"></label><label>${JA_LABELS.type}<input data-personal-kg-filter="type" placeholder="insight"></label><label>${JA_LABELS.redaction}<input data-personal-kg-filter="redaction" placeholder="none"></label><button class="secondary-button" type="button" data-load-personal-kg>${JA_LABELS.filter}</button></div><div data-personal-kg-list class="empty-state">個人KGを読み込みます</div></section>`;
    }

    personalKgFiltersWithLimit() {
        const params = new URLSearchParams(this.filters('personal-kg-filter').replace(/^\?/, ''));
        params.set('limit', String(this.personalKgLimit));
        return `?${params.toString()}`;
    }

    async loadPersonalKg({ resetLimit = false } = {}) {
        if (resetLimit) this.personalKgLimit = 50;
        const requestSeq = this.personalKgRequestSeq + 1;
        this.personalKgRequestSeq = requestSeq;
        let data;
        try {
            data = await this.request(`/api/admin/personal-kg${this.personalKgFiltersWithLimit()}`);
        } catch (error) {
            if (requestSeq !== this.personalKgRequestSeq) return { stale: true };
            throw error;
        }
        if (requestSeq !== this.personalKgRequestSeq) return { stale: true };
        this.state.personalKg = data;
        const warningHtml = renderWarnings(data.warnings);
        if (data.status && data.status !== 'available') {
            const reason = personalKgReason(data);
            this.root.querySelector('[data-personal-kg-list]').innerHTML = `${warningHtml}<div class="empty-state"><strong>${status(data.status)}</strong><p>${escapeHtml(reason)}</p></div>`;
            return;
        }
        if (data.requested_owner_person_id && !data.owner_person_id) {
            this.root.querySelector('[data-personal-kg-list]').innerHTML = `${warningHtml}<div class="empty-state"><strong>表示対象外</strong><p>指定された所有者は現在の権限では表示できません。</p></div>`;
            return;
        }
        const records = data.records || [];
        const summary = data.summary || {};
        const summaryHtml = `<div class="metric-row"><div class="metric"><strong>${escapeHtml(summary.total ?? 0)}</strong><span>個人KG候補</span></div><div class="metric"><strong>${escapeHtml(summary.active_count ?? 0)}</strong><span>有効</span></div><div class="metric"><strong>${escapeHtml(summary.sns_ready_count ?? 0)}</strong><span>SNS利用可</span></div><div class="metric"><strong>${escapeHtml(summary.review_count ?? 0)}</strong><span>要レビュー</span></div><div class="metric"><strong>${escapeHtml(summary.needs_redaction_count ?? 0)}</strong><span>秘匿要</span></div><div class="metric"><strong>${escapeHtml(summary.agency_none_count ?? 0)}</strong><span>AI利用不可</span></div></div><div class="record-meta"><span>所有者: ${escapeHtml(data.owner_person_id || '-')}</span><span>表示: ${escapeHtml(summary.returned_count ?? records.length)} / ${escapeHtml(summary.total ?? records.length)}</span><span>${summary.truncated ? '上限で省略あり' : '全件表示'}</span><span>最新: ${escapeHtml(summary.latest_seen_at || '-')}</span></div>`;
        const returnedCount = Number(summary.returned_count ?? records.length) || 0;
        const effectiveLimit = Number(summary.limit ?? this.personalKgLimit) || this.personalKgLimit;
        const reachedLimit = summary.truncated && effectiveLimit >= MAX_PERSONAL_KG_LIMIT;
        const continuationHtml = summary.truncated
            ? reachedLimit
                ? `<div class="continuation-row"><span>最新${escapeHtml(returnedCount)}件の上限に達しました。所有者、記憶層、状態で絞り込んでください。</span></div>`
                : `<div class="continuation-row"><span>現在は最新${escapeHtml(returnedCount)}件を表示しています。</span><button class="secondary-button" type="button" data-load-more-personal-kg>さらに表示</button></div>`
            : '';
        const recordsHtml = records.length ? records.map((r) => `<article class="record-row"><div class="record-title"><strong>${escapeHtml(r.id)}</strong>${badge(r.source_class)}</div><div class="record-meta"><span>記憶層: ${escapeHtml(r.memory_layer || '-')}</span><span>SNS利用可: ${r.sns_ready ? 'はい' : 'いいえ'}</span><span>反映状態: ${escapeHtml(formatStatusLabel(r.promotion_status))}</span><span>秘匿状態: ${escapeHtml(formatStatusLabel(r.redaction_status))}</span><span>レビュー: ${r.requires_approval ? '要' : '不要'}</span><span>認知タイプ: ${escapeHtml(r.cognitive_type || '-')}</span><span>AI利用: ${escapeHtml(r.agency_level || '-')}</span><span>入力元: ${escapeHtml(r.source_system || '-')}</span><span>作成日時: ${escapeHtml(r.created_at || '-')}</span></div><p class="preview-text">${escapeHtml(r.body_preview || '')}</p></article>`).join('') : `<div class="empty-state">${JA_LABELS.noRecords}</div>`;
        this.root.querySelector('[data-personal-kg-list]').innerHTML = `${warningHtml}${summaryHtml}${continuationHtml}${recordsHtml}`;
        this.root.querySelector('[data-load-more-personal-kg]')?.addEventListener('click', () => {
            this.loadPersonalKgFromControl({ nextLimit: Math.min(this.personalKgLimit * 2, MAX_PERSONAL_KG_LIMIT) });
        });
    }

    async loadPersonalKgFromControl({ resetLimit = false, nextLimit = null } = {}) {
        const previousLimit = this.personalKgLimit;
        try {
            if (nextLimit !== null) this.personalKgLimit = nextLimit;
            await this.loadPersonalKg({ resetLimit });
        } catch (error) {
            this.personalKgLimit = previousLimit;
            this.handleLoadError(error);
        }
    }

    contextPanel() {
        return `<div class="context-grid"><section class="panel"><div class="panel-header"><h2>${JA_LABELS.context}</h2>${badge('ai_context')}</div><div class="context-form" data-context-form><label>${JA_LABELS.project}<input name="project" value="brainbase"></label><label>Entity種別<input name="entityTypes" value="project,person,org,decision,raci_assignment"></label><label>Graph哲学scope<input name="scope" value="graph"></label><label>対象object<input name="objectType" value="project"></label><label>操作<input name="operation" value="read"></label><label class="inline-check"><input name="includeEdges" type="checkbox" checked> edgeを含める</label><label class="inline-check"><input name="includeMemory" type="checkbox"> memory条件を評価</label><label class="inline-check"><input name="includePhilosophy" type="checkbox" checked> Graph哲学文脈を含める</label><button class="primary-button" type="button" data-run-context>${JA_LABELS.runPreview}</button></div></section><section class="panel"><div class="panel-header"><h2>プレビュー</h2>${badge('ai_context')}</div><div class="context-result empty-state" data-context-result>条件を指定して文脈を確認してください</div></section></div>`;
    }

    async loadContext() {
        const form = this.root.querySelector('[data-context-form]');
        this.state.context = await this.request('/api/admin/context-preview', {
            method: 'POST',
            body: {
                project: form.querySelector('[name="project"]').value,
                entityTypes: form.querySelector('[name="entityTypes"]').value,
                scope: form.querySelector('[name="scope"]').value,
                objectType: form.querySelector('[name="objectType"]').value,
                operation: form.querySelector('[name="operation"]').value,
                includeEdges: form.querySelector('[name="includeEdges"]').checked,
                includeMemory: form.querySelector('[name="includeMemory"]').checked,
                includePhilosophy: form.querySelector('[name="includePhilosophy"]').checked
            }
        });
        const data = this.state.context;
        const warningHtml = renderWarnings(data.warnings);
        this.root.querySelector('[data-context-result]').innerHTML = data.status === 'available'
            ? `<div class="record-meta"><span>project: ${escapeHtml(data.preview.project_code)}</span><span>entities: ${escapeHtml(data.preview.entity_count)}</span><span>edges: ${escapeHtml(data.preview.edge_count)}</span><span>memory included: ${escapeHtml(data.preview.memory?.included_count ?? 0)}</span><span>memory denied: ${escapeHtml(data.preview.memory?.denied_count ?? 0)}</span><span>philosophy: ${data.preview.philosophy_context?.included_in_agent_context ? '含む' : '含まない'}</span></div>${warningHtml}${renderContextIncluded(data.preview.included)}${renderDeniedReasons(data.preview.memory)}<p class="preview-text">${escapeHtml(data.preview.report_preview || '')}</p>`
            : `<div class="empty-state">${warningHtml || escapeHtml((data.warnings || []).join(' / ') || '文脈を取得できません')}</div>`;
    }

    flowPanel() {
        return `<section class="panel"><div class="panel-header"><h2>${JA_LABELS.flow}</h2>${badge('ai_context')}</div><div class="filter-bar"><label>${JA_LABELS.project}<input data-flow-filter="project" placeholder="brainbase"></label><label>候補ID<input data-flow-filter="candidate" placeholder="cand_..."></label><label>正本ID<input data-flow-filter="entity" placeholder="project_..."></label><button class="secondary-button" type="button" data-load-flow>${JA_LABELS.filter}</button></div><div data-flow-list class="flow-list"></div></section>`;
    }

    async loadFlow() {
        this.state.flow = await this.request(`/api/admin/data-flow${this.filters('flow-filter')}`);
        this.root.querySelector('[data-flow-list]').innerHTML = (this.state.flow.steps || []).map((s) => `<div class="health-row"><div class="record-title"><strong>${escapeHtml(s.label)}</strong>${badge(s.source_class)}</div><div class="record-meta">${status(s.status)}<span>${escapeHtml(s.reason || '')}</span></div></div>`).join('');
    }

    async loadHealth() {
        this.state.health = await this.request('/api/admin/health');
        const db = this.state.health.runtime_config?.database;
        const dbReason = db?.reason ? `<span>${escapeHtml(db.reason)}</span>` : '';
        const dbHtml = db ? `<div class="health-row"><div class="record-title"><strong>${escapeHtml(db.label)}</strong>${badge(db.source_class)}</div><div class="record-meta">${status(db.status)}<span>接続: ${escapeHtml(formatStatusLabel(db.connection_status || db.status))}</span><span>keys: ${escapeHtml((db.keys || []).join(', '))}</span><span>値: 非表示</span>${dbReason}</div></div>` : '';
        const checkHtml = (this.state.health.runtime_config?.checks || []).map((check) => `<div class="health-row"><div class="record-title"><strong>${escapeHtml(check.label)}</strong>${badge(check.source_class)}</div><div class="record-meta">${status(check.status)}${check.reason ? `<span>${escapeHtml(check.reason)}</span>` : ''}</div></div>`).join('');
        this.root.querySelector('[data-health]').innerHTML = `<div class="health-grid"><section class="panel"><div class="panel-header"><h2>データソース状態</h2></div>${(this.state.health.sources || []).map((s) => `<div class="health-row"><div class="record-title"><strong>${escapeHtml(s.label)}</strong>${badge(s.source_class)}</div><div class="record-meta">${status(s.status)}${s.reason ? `<span>${escapeHtml(s.reason)}</span>` : ''}</div></div>`).join('')}</section><section class="panel"><div class="panel-header"><h2>${JA_LABELS.health}</h2><span class="muted">${JA_LABELS.secretSafe}</span></div>${dbHtml}${checkHtml}${(this.state.health.runtime_config?.keys || []).map((k) => `<div class="health-row"><div class="record-title"><strong>${escapeHtml(k.key)}</strong>${badge(k.source_class)}</div><div class="record-meta">${status(k.status)}<span>値: 非表示</span></div></div>`).join('')}</section></div>`;
    }

    toast(message) {
        const toast = this.root.querySelector('[data-toast]');
        toast.textContent = message;
        toast.classList.add('visible');
        setTimeout(() => toast.classList.remove('visible'), 4200);
    }

    icons() {
        globalThis.lucide?.createIcons?.();
    }
}

export function createAdminVisualizationPage({ root = document.querySelector('[data-admin-root]'), fetchImpl = globalThis.fetch, storage = globalThis.localStorage } = {}) {
    if (!root) throw new Error('Admin root is missing');
    return new AdminPage({ root, fetchImpl, storage });
}

export function initAdminVisualizationPage() {
    const page = createAdminVisualizationPage();
    page.mount();
    return page;
}

if (typeof document !== 'undefined' && document.querySelector('[data-admin-root]')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAdminVisualizationPage, { once: true });
    else initAdminVisualizationPage();
}
