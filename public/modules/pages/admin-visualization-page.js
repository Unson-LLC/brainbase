// @ts-check

import { AuthManager } from '../auth/auth-manager.js';

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
    secretSafe: '値は表示しません',
    login: 'ログイン',
    loginWithSlack: 'Slackでログイン'
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

// status code -> chip tone (consistent color semantics across every panel)
const STATUS_TONE = {
    available: 'green', configured: 'green', approved: 'green', connected: 'green', present: 'green', redacted: 'green',
    promoted_to_graph: 'blue',
    pending_approval: 'amber', partial: 'amber', not_checked: 'amber', not_configured: 'amber',
    needs_redaction: 'red', unavailable: 'red', missing: 'red', rejected: 'red', expired: 'red', not_found: 'red',
    candidate: 'slate', none: 'slate', not_requested: 'slate'
};

const TONE_COLORS = {
    green: ['#2f7a45', '#e7f2ea'], blue: ['#355d99', '#e8eff8'], amber: ['#8a6012', '#f8eed5'],
    red: ['#b23a2e', '#fbe7e3'], slate: ['#5b6470', '#edeef1'], violet: ['#6b46b8', '#f0eafa'], teal: ['#1f8579', '#e2f3f0']
};
const SENSITIVITY_TONE = { public: 'green', internal: 'slate', confidential: 'red', secret: 'red' };
const AGENCY = { none: ['AI利用不可', 'amber'], assist: ['AI補助', 'blue'], full: ['AI全面', 'green'], synthesize: ['AI合成', 'blue'], 'read-only': ['AI参照のみ', 'slate'] };

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_PERSONAL_KG_LIMIT = 500;
const NAV = [
    ['overview', JA_LABELS.overview, 'layout-dashboard'],
    ['graph', JA_LABELS.graph, 'database'],
    ['candidates', JA_LABELS.candidates, 'inbox'],
    ['personal-kg', JA_LABELS.personalKg, 'network'],
    ['context', JA_LABELS.context, 'cpu'],
    ['flow', JA_LABELS.flow, 'git-branch'],
    ['health', JA_LABELS.health, 'shield-check']
];

function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sourceClassKey(sourceClass) {
    return sourceClass === 'graph_ssot' ? 'graph'
        : sourceClass === 'candidate_store' ? 'candidate'
        : sourceClass === 'personal_kg' ? 'personal'
        : sourceClass === 'ai_context' ? 'context'
        : 'runtime';
}

function badge(sourceClass) {
    const key = sourceClassKey(sourceClass);
    return `<span class="src-badge badge ${key}"><span class="src-dot"></span>${escapeHtml(SOURCE_CLASS_LABELS[sourceClass] || sourceClass)}</span>`;
}

export function formatStatusLabel(status) {
    return STATUS_LABELS[status] || status || 'unknown';
}

function statusChip(statusCode) {
    const tone = STATUS_TONE[statusCode] || 'slate';
    return `<span class="chip ${tone}">${escapeHtml(formatStatusLabel(statusCode))}</span>`;
}

function plainChip(label, tone) {
    return `<span class="chip ${tone}">${escapeHtml(label)}</span>`;
}

function sensitivityChip(value) {
    if (!value) return '';
    return plainChip(value, SENSITIVITY_TONE[value] || 'slate');
}

function agencyChip(level) {
    const v = AGENCY[level] || [level || '-', 'slate'];
    return plainChip(v[0], v[1]);
}

function renderContextIncluded(items = []) {
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) return '<div class="muted">含まれた文脈はありません</div>';
    const max = Math.max(1, ...rows.map((item) => Number(item.count) || 0));
    return rows.map((item) => {
        const pct = Math.round(((Number(item.count) || 0) / max) * 100);
        return `<div class="bar-row"><div class="bar-label"><span class="t">${escapeHtml(item.type || 'unknown')}: ${escapeHtml(item.count ?? 0)}</span><span class="c">${escapeHtml(item.count ?? 0)}</span></div><div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
    }).join('');
}

function renderDeniedReasons(memory = {}) {
    const entries = Object.entries(memory?.denied_reasons || {});
    const deniedCount = Number(memory?.denied_count) || 0;
    if (!entries.length && deniedCount > 0) {
        return `<div class="denied-row"><span>理由未取得: ${escapeHtml(deniedCount)}</span><strong>${escapeHtml(deniedCount)}</strong></div>`;
    }
    if (!entries.length) return '<div class="muted">除外された記憶はありません</div>';
    return entries.map(([reason, count]) => `<div class="denied-row"><span>${escapeHtml(reason)}: ${escapeHtml(count)}</span><strong>${escapeHtml(count)}</strong></div>`).join('');
}

function renderReportPreview(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    let jsonSummary = null;
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
            const keys = Array.isArray(parsed) ? [`配列 ${parsed.length}件`] : Object.keys(parsed).slice(0, 6);
            jsonSummary = keys.length ? keys.join(', ') : '空のJSON';
        }
    } catch {
        jsonSummary = null;
    }
    if (!jsonSummary && /^[\[{]/.test(text)) {
        jsonSummary = 'JSON形式のプレビュー';
    }
    if (!jsonSummary) {
        return `<div class="report-block"><div class="cap">report_preview</div><p>${escapeHtml(text)}</p></div>`;
    }
    return `<details class="report-block"><summary><span class="cap">report_preview</span><span>JSONを取得済み: ${escapeHtml(jsonSummary)}</span></summary><pre>${escapeHtml(text)}</pre></details>`;
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
    return `<div class="empty-state"><strong>${statusChip(data.status || 'unavailable')}</strong><p>${escapeHtml(sourceUnavailableReason(sourceClass, data))}</p></div>`;
}

function personalKgReason(data = {}) {
    const text = String(data.reason || data.message || '');
    if (!text) return '個人KGソースに接続できません';
    if (/candidate repository unavailable|candidateRepository is not configured/i.test(text)) {
        return '候補ストアリポジトリが未設定のため個人KGを取得できません';
    }
    return text;
}

export function getAuthHeaders(storage = globalThis.localStorage, authManager = null) {
    const token = authManager?.getToken?.() || authManager?.token || storage?.getItem?.('brainbase.auth.token');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

function friendlyHttpError(statusCode, text) {
    let payload = null;
    try { payload = JSON.parse(text); } catch { payload = null; }
    const raw = payload?.error || payload?.message || text || '';
    if (statusCode === 401 || /Authorization token required|unauthorized|auth/i.test(raw)) {
        return '認証が必要です。管理画面でログインしてから再読み込みしてください。';
    }
    if (statusCode === 403) return 'この管理情報を表示する権限がありません。';
    return raw ? `読み込みに失敗しました: ${raw}` : `読み込みに失敗しました: HTTP ${statusCode}`;
}

export class AdminPage {
    constructor({ root, fetchImpl = globalThis.fetch, storage = globalThis.localStorage, authManager = null } = {}) {
        this.root = root;
        this.fetchImpl = fetchImpl;
        this.storage = storage;
        this.authManager = authManager || new AuthManager({
            eventBus: {
                emit: (eventName) => {
                    if (eventName === 'auth:changed' && !this.suppressAuthChangedReload && this.authManager?.getStatus?.() === 'authenticated') {
                        void this.load(true);
                    }
                }
            }
        });
        this.active = 'overview';
        this.state = {};
        this.csrfToken = null;
        this.personalKgLimit = 50;
        this.personalKgRequestSeq = 0;
        this.authRefreshRetry = null;
        this.suppressAuthChangedReload = false;
    }

    fetch(path, options = {}) {
        return this.fetchImpl.call(globalThis, path, { cache: 'no-store', ...options });
    }

    async csrfHeaders(method) {
        if (!MUTATING_METHODS.has(String(method || 'GET').toUpperCase())) return {};
        if (!this.csrfToken) {
            const response = await this.fetch('/api/csrf-token', { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache', ...getAuthHeaders(this.storage, this.authManager) } });
            if (!response.ok) throw new Error(`CSRF token fetch failed: ${response.status}`);
            const payload = await response.json();
            this.csrfToken = payload.token || null;
        }
        return this.csrfToken ? { 'X-CSRF-Token': this.csrfToken } : {};
    }

    async refreshAuthForRetry() {
        if (!this.authManager?.refreshSession) return false;
        if (this.authManager?.canRefreshSession && !this.authManager.canRefreshSession()) return false;
        if (this.authRefreshRetry) return await this.authRefreshRetry;
        this.authRefreshRetry = (async () => {
            this.suppressAuthChangedReload = true;
            try {
                return await this.authManager.refreshSession();
            } catch {
                return false;
            } finally {
                this.suppressAuthChangedReload = false;
                this.authRefreshRetry = null;
            }
        })();
        return await this.authRefreshRetry;
    }

    async requestOnce(path, options = {}) {
        const method = options.method || 'GET';
        const headers = { Accept: 'application/json', 'Cache-Control': 'no-cache', ...getAuthHeaders(this.storage, this.authManager), ...await this.csrfHeaders(method) };
        if (options.body) headers['Content-Type'] = 'application/json';
        return this.fetch(path, { ...options, method, headers, body: options.body ? JSON.stringify(options.body) : null });
    }

    async request(path, options = {}) {
        let response = await this.requestOnce(path, options);
        if (response.status === 401 && await this.refreshAuthForRetry()) {
            response = await this.requestOnce(path, options);
        }
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw Object.assign(new Error(friendlyHttpError(response.status, text)), { status: response.status });
        }
        return response.json();
    }

    mount() {
        this.root.innerHTML = this.shell();
        this.root.addEventListener('click', (event) => {
            const button = event.target?.closest?.('button');
            if (!button || !this.root.contains(button)) return;
            const nav = button.getAttribute('data-nav');
            if (nav) {
                this.active = nav || 'overview';
                this.sync();
                void this.load();
                return;
            }
            if (button.hasAttribute('data-refresh')) void this.load(true);
            if (button.hasAttribute('data-login')) this.startLogin();
            if (button.hasAttribute('data-load-graph')) void this.loadGraph().catch((error) => this.handleLoadError(error));
            if (button.hasAttribute('data-load-candidates')) void this.loadCandidates().catch((error) => this.handleLoadError(error));
            if (button.hasAttribute('data-load-personal-kg')) void this.loadPersonalKgFromControl({ resetLimit: true });
            if (button.hasAttribute('data-run-context')) void this.loadContext().catch((error) => this.handleLoadError(error));
            if (button.hasAttribute('data-load-flow')) void this.loadFlow().catch((error) => this.handleLoadError(error));
        });
        void this.initAuthAndLoad();
        this.icons();
    }

    async initAuthAndLoad() {
        this.suppressAuthChangedReload = true;
        try {
            await this.authManager?.initFromStorage?.();
        } finally {
            this.suppressAuthChangedReload = false;
        }
        if (this.authManager?.getStatus?.() === 'anonymous') {
            this.renderLoadError(Object.assign(
                new Error('認証が必要です。管理画面でログインしてから再読み込みしてください。'),
                { status: 401 }
            ));
            return;
        }
        await this.load();
    }

    startLogin() {
        const redirectPath = typeof window !== 'undefined'
            ? new URL('/admin.html', window.location.origin).toString()
            : '/admin.html';
        this.authManager?.startSlackLogin?.({ redirectPath });
        this.toast('ログイン画面を開きました。完了後に管理画面を再読み込みします。');
    }

    shell() {
        return `<div class="admin-shell">`
            + `<aside class="admin-sidebar">`
            + `<div class="brand"><span class="brand-mark">B</span><div><strong>Brainbase</strong><span>管理コンソール</span></div></div>`
            + `<nav class="admin-nav">${NAV.map(([id, label, icon]) => `<button type="button" class="${id === this.active ? 'active' : ''}" data-nav="${id}"><i data-lucide="${icon}"></i><span>${label}</span></button>`).join('')}</nav>`
            + `<div class="sidebar-foot"><span class="dot-live"></span>実API接続状態を表示</div>`
            + `</aside>`
            + `<main class="admin-main">`
            + `<header class="admin-topbar"><div class="admin-title"><h1>${JA_LABELS.title}</h1><p>${JA_LABELS.subtitle}</p></div>`
            + `<div class="admin-actions"><button class="secondary-button" type="button" data-login><i data-lucide="log-in"></i>${JA_LABELS.login}</button><button class="primary-button" type="button" data-refresh><i data-lucide="refresh-cw"></i>${JA_LABELS.refresh}</button></div></header>`
            + this.sections()
            + `</main></div><div class="admin-toast" data-toast></div>`;
    }

    sections() {
        return `<section class="admin-section active" data-section="overview"><div data-overview class="empty-state">概要を読み込みます</div></section>`
            + `<section class="admin-section" data-section="graph">${this.graphPanel()}</section>`
            + `<section class="admin-section" data-section="candidates">${this.candidatePanel()}</section>`
            + `<section class="admin-section" data-section="personal-kg">${this.personalKgPanel()}</section>`
            + `<section class="admin-section" data-section="context">${this.contextPanel()}</section>`
            + `<section class="admin-section" data-section="flow">${this.flowPanel()}</section>`
            + `<section class="admin-section" data-section="health"><div data-health class="empty-state">ヘルスを読み込みます</div></section>`;
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
        const loginAction = error?.status === 401
            ? `<div class="empty-actions"><button class="primary-button" type="button" data-login><i data-lucide="log-in"></i>${JA_LABELS.loginWithSlack}</button><button class="secondary-button" type="button" data-refresh><i data-lucide="refresh-cw"></i>${JA_LABELS.refresh}</button></div>`
            : '';
        const html = `<div class="empty-state"><strong>表示できません</strong><p>${escapeHtml(message)}</p>${loginAction}</div>`;
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
        this.icons();
    }

    async loadOverview() {
        this.state.overview = await this.request('/api/admin/overview');
        const overview = this.state.overview;
        const kg = overview.personal_kg?.summary || {};
        const candTotal = overview.candidates?.total ?? 0;
        const graphTotal = overview.graph?.total ?? 0;
        const pkgTotal = overview.personal_kg?.total ?? 0;
        const review = kg.review_count ?? 0;
        const snsReady = kg.sns_ready_count ?? 0;

        const pipeline = `<section class="pipeline">`
            + `<div class="pipe-head"><h2>記憶パイプライン</h2><span class="pipe-sub">入力元 → 候補 →（秘匿・承認）→ 正本・個人KG → AI文脈</span></div>`
            + `<div class="pipe-row">`
            + `<div class="pipe-stage"><div class="pipe-cap"><span class="src-dot runtime"></span>入力元</div><div class="pipe-srcs">slack · meeting<br>cli · web</div><div class="pipe-hint">外部ソース取り込み</div></div>`
            + `<div class="pipe-arrow">→</div>`
            + `<div class="pipe-stage"><div class="pipe-cap"><span class="src-dot candidate"></span>候補ストア</div><div class="pipe-num">${escapeHtml(candTotal)}</div>${review ? `<div class="pipe-chips"><span class="mini amber">要レビュー ${escapeHtml(review)}</span></div>` : ''}</div>`
            + `<div class="pipe-gate">秘匿<br>承認</div>`
            + `<div class="pipe-split"><div class="pipe-stage"><div class="pipe-cap"><span class="src-dot graph"></span>Graph正本</div><div class="pipe-num sm">${escapeHtml(graphTotal)}</div></div>`
            + `<div class="pipe-stage"><div class="pipe-cap"><span class="src-dot personal"></span>個人KG</div><div class="pipe-num sm">${escapeHtml(pkgTotal)}</div></div></div>`
            + `<div class="pipe-arrow">→</div>`
            + `<div class="pipe-stage ctx"><div class="pipe-cap"><span class="src-dot context"></span>AI参照文脈</div>${snsReady ? `<div class="pipe-chips"><span class="mini green">SNS可 ${escapeHtml(snsReady)}</span></div>` : ''}<div class="pipe-hint">AI文脈タブで内訳を確認</div></div>`
            + `</div></section>`;

        const metrics = `<div class="metric-row">`
            + `<div class="metric graph"><strong>${escapeHtml(graphTotal)}</strong><span>Graph正本</span></div>`
            + `<div class="metric cand"><strong>${escapeHtml(candTotal)}</strong><span>候補</span></div>`
            + `<div class="metric pkg"><strong>${escapeHtml(pkgTotal)}</strong><span>個人KG</span></div>`
            + `<div class="metric green"><strong>${escapeHtml(snsReady)}</strong><span>SNS利用可</span></div>`
            + `<div class="metric amber"><strong>${escapeHtml(review)}</strong><span>要レビュー</span></div>`
            + `</div>`;

        const sources = `<div class="overview-grid">${(overview.sources || []).map((s) => `<article class="source-card"><div class="record-title"><h3>${escapeHtml(s.label)}</h3>${badge(s.source_class)}</div><p>${statusChip(s.status)}</p></article>`).join('')}</div>`;

        this.root.querySelector('[data-overview]').innerHTML = pipeline + renderWarnings(overview.candidates?.warnings) + metrics + sources;
        this.icons();
    }

    filters(scope) {
        const params = new URLSearchParams();
        this.root.querySelectorAll(`[data-${scope}]`).forEach((input) => { if (input.value) params.set(input.getAttribute(`data-${scope}`), input.value); });
        const value = params.toString();
        return value ? `?${value}` : '';
    }

    graphPanel() {
        return `<div class="filter-bar"><label>${JA_LABELS.project}<input data-graph-filter="project" placeholder="brainbase"></label><label>${JA_LABELS.type}<input data-graph-filter="type" placeholder="project"></label><label>${JA_LABELS.query}<input data-graph-filter="q" placeholder="名前・ID"></label><button class="secondary-button" type="button" data-load-graph>${JA_LABELS.filter}</button></div>`
            + `<div class="panel"><div class="panel-header"><h2>${JA_LABELS.graph}</h2>${badge('graph_ssot')}</div><div data-graph-list class="empty-state">Graph正本を読み込みます</div></div>`;
    }

    async loadGraph() {
        this.state.graph = await this.request(`/api/admin/graph/entities${this.filters('graph-filter')}`);
        if (this.state.graph.status && this.state.graph.status !== 'available') {
            this.root.querySelector('[data-graph-list]').innerHTML = renderUnavailableSource('graph_ssot', this.state.graph);
            return;
        }
        const records = this.state.graph.records || [];
        this.root.querySelector('[data-graph-list]').innerHTML = records.length ? records.map((r) => `<article class="record-row"><div class="record-head"><div class="record-title"><strong>${escapeHtml(r.label || r.id)}</strong>${sensitivityChip(r.sensitivity)}</div>${badge(r.source_class)}</div><div class="record-meta"><span>種別: <b>${escapeHtml(r.entity_type)}</b></span><span>project: <b>${escapeHtml(r.project_code || '-')}</b></span><span>sensitivity: <b>${escapeHtml(r.sensitivity || '-')}</b></span><span>role_min: <b>${escapeHtml(r.role_min || '-')}</b></span><span>id: <b>${escapeHtml(r.id)}</b></span><span>updated_at: <b>${escapeHtml(r.updated_at || '-')}</b></span></div><p class="preview-text">${escapeHtml(r.payload_preview || '')}</p></article>`).join('') : `<div class="empty-state">${JA_LABELS.noRecords}</div>`;
    }

    candidatePanel() {
        return `<div class="filter-bar"><label>${JA_LABELS.project}<input data-candidate-filter="project" placeholder="brainbase"></label><label>${JA_LABELS.status}<input data-candidate-filter="status" placeholder="pending_approval"></label><label>${JA_LABELS.type}<input data-candidate-filter="type" placeholder="preference"></label><label>${JA_LABELS.redaction}<input data-candidate-filter="redaction" placeholder="needs_redaction"></label><button class="secondary-button" type="button" data-load-candidates>${JA_LABELS.filter}</button></div>`
            + `<div class="panel"><div class="panel-header"><h2>${JA_LABELS.candidates}</h2>${badge('candidate_store')}</div><div data-candidate-list class="empty-state">候補ストアを読み込みます</div></div>`;
    }

    async loadCandidates() {
        this.state.candidates = await this.request(`/api/admin/candidates${this.filters('candidate-filter')}`);
        const warningHtml = renderWarnings(this.state.candidates.warnings);
        if (this.state.candidates.status && this.state.candidates.status !== 'available') {
            this.root.querySelector('[data-candidate-list]').innerHTML = `${warningHtml}${renderUnavailableSource('candidate_store', this.state.candidates)}`;
            return;
        }
        const records = this.state.candidates.records || [];
        const recordsHtml = records.length ? records.map((r) => `<article class="record-row"><div class="record-title"><span class="record-id">${escapeHtml(r.id)}</span>${statusChip(r.promotion_status)}${statusChip(r.redaction_status)}${sensitivityChip(r.sensitivity)}</div><p class="preview-text">${escapeHtml(r.body_preview || '')}</p><div class="record-meta"><span>promotion: <b>${escapeHtml(formatStatusLabel(r.promotion_status))}</b></span><span>redaction: <b>${escapeHtml(formatStatusLabel(r.redaction_status))}</b></span><span>cognitive: <b>${escapeHtml(r.cognitive_type || '-')}</b></span><span>visibility: <b>${escapeHtml(r.visibility || '-')}</b></span><span>sensitivity: <b>${escapeHtml(r.sensitivity || '-')}</b></span><span>role_min: <b>${escapeHtml(r.role_min || '-')}</b></span><span>created_at: <b>${escapeHtml(r.created_at || '-')}</b></span></div></article>`).join('') : `<div class="empty-state">${JA_LABELS.noRecords}</div>`;
        this.root.querySelector('[data-candidate-list]').innerHTML = `${warningHtml}${recordsHtml}`;
    }

    personalKgPanel() {
        return `<div class="filter-bar"><label>${JA_LABELS.owner}<input data-personal-kg-filter="owner" placeholder="現在のログイン主体"></label><label>${JA_LABELS.layer}<input data-personal-kg-filter="layer" placeholder="personal_kg_core"></label><label>${JA_LABELS.status}<input data-personal-kg-filter="status" placeholder="candidate"></label><label>${JA_LABELS.type}<input data-personal-kg-filter="type" placeholder="insight"></label><label>${JA_LABELS.redaction}<input data-personal-kg-filter="redaction" placeholder="none"></label><button class="secondary-button" type="button" data-load-personal-kg>${JA_LABELS.filter}</button></div>`
            + `<div class="panel"><div class="panel-header"><h2>${JA_LABELS.personalKg}</h2>${badge('personal_kg')}</div><div data-personal-kg-list class="empty-state">個人KGを読み込みます</div></div>`;
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
            this.root.querySelector('[data-personal-kg-list]').innerHTML = `${warningHtml}<div class="empty-state"><strong>${statusChip(data.status)}</strong><p>${escapeHtml(reason)}</p></div>`;
            return;
        }
        if (data.requested_owner_person_id && !data.owner_person_id) {
            this.root.querySelector('[data-personal-kg-list]').innerHTML = `${warningHtml}<div class="empty-state"><strong>表示対象外</strong><p>指定された所有者は現在の権限では表示できません。</p></div>`;
            return;
        }
        const records = data.records || [];
        const summary = data.summary || {};
        const metric = (value, label, tone) => `<div class="metric ${tone || ''}"><strong>${escapeHtml(value ?? 0)}</strong><span>${label}</span></div>`;
        const summaryHtml = `<div class="metric-row">${metric(summary.total, '個人KG候補', 'pkg')}${metric(summary.active_count, '有効')}${metric(summary.sns_ready_count, 'SNS利用可', 'green')}${metric(summary.review_count, '要レビュー', 'amber')}${metric(summary.needs_redaction_count, '秘匿要', 'red')}${metric(summary.agency_none_count, 'AI利用不可')}</div>`
            + `<div class="record-meta" style="margin-top:14px"><span>所有者: <b>${escapeHtml(data.owner_person_id || '-')}</b></span><span>表示: <b>${escapeHtml(summary.returned_count ?? records.length)} / ${escapeHtml(summary.total ?? records.length)}</b></span><span>${summary.truncated ? '上限で省略あり' : '全件表示'}</span><span>最新: <b>${escapeHtml(summary.latest_seen_at || '-')}</b></span></div>`;
        const returnedCount = Number(summary.returned_count ?? records.length) || 0;
        const effectiveLimit = Number(summary.limit ?? this.personalKgLimit) || this.personalKgLimit;
        const reachedLimit = summary.truncated && effectiveLimit >= MAX_PERSONAL_KG_LIMIT;
        const continuationHtml = summary.truncated
            ? reachedLimit
                ? `<div class="continuation-row"><span>最新${escapeHtml(returnedCount)}件の上限に達しました。所有者、記憶層、状態で絞り込んでください。</span></div>`
                : `<div class="continuation-row"><span>現在は最新${escapeHtml(returnedCount)}件を表示しています。</span><button class="secondary-button" type="button" data-load-more-personal-kg>さらに表示</button></div>`
            : '';
        const recordsHtml = records.length ? `<div class="panel" style="margin-top:14px">${records.map((r) => `<article class="record-row"><div class="record-title"><span class="record-id">${escapeHtml(r.id)}</span>${statusChip(r.promotion_status)}${statusChip(r.redaction_status)}${plainChip(r.sns_ready ? 'SNS利用可' : 'SNS不可', r.sns_ready ? 'green' : 'slate')}${agencyChip(r.agency_level)}</div><p class="preview-text">${escapeHtml(r.body_preview || '')}</p><div class="record-meta"><span>記憶層: <b>${escapeHtml(r.memory_layer || '-')}</b></span><span>SNS利用可: <b>${r.sns_ready ? 'はい' : 'いいえ'}</b></span><span>反映状態: <b>${escapeHtml(formatStatusLabel(r.promotion_status))}</b></span><span>秘匿状態: <b>${escapeHtml(formatStatusLabel(r.redaction_status))}</b></span><span>レビュー: <b>${r.requires_approval ? '要' : '不要'}</b></span><span>認知タイプ: <b>${escapeHtml(r.cognitive_type || '-')}</b></span><span>AI利用: <b>${escapeHtml(r.agency_level || '-')}</b></span><span>入力元: <b>${escapeHtml(r.source_system || '-')}</b></span><span>作成日時: <b>${escapeHtml(r.created_at || '-')}</b></span></div></article>`).join('')}</div>` : `<div class="empty-state">${JA_LABELS.noRecords}</div>`;
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
        return `<div class="context-grid">`
            + `<section class="section-card"><h2>クエリ条件</h2><p class="muted" style="margin:-8px 0 14px;font-size:12px;line-height:1.5">AIエージェントが受け取る文脈を再現します。</p>`
            + `<div class="context-form" data-context-form>`
            + `<label>${JA_LABELS.project}<input name="project" value="brainbase"></label>`
            + `<label class="mono">Entity種別<input name="entityTypes" value="project,person,org,decision,raci_assignment"></label>`
            + `<div class="two"><label>Graph哲学scope<input name="scope" value="graph"></label><label>対象object<input name="objectType" value="project"></label></div>`
            + `<label>操作<input name="operation" value="read"></label>`
            + `<div class="checks"><label><input name="includeEdges" type="checkbox" checked> edgeを含める</label><label><input name="includeMemory" type="checkbox"> memory条件を評価</label><label><input name="includePhilosophy" type="checkbox" checked> Graph哲学文脈を含める</label></div>`
            + `<button class="primary-button" type="button" data-run-context>${JA_LABELS.runPreview}</button>`
            + `</div></section>`
            + `<section class="ctx-result"><h2>プレビュー</h2><div class="ctx-idle" data-context-result>条件を指定して「${JA_LABELS.runPreview}」を押してください</div></section>`
            + `</div>`;
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
        const target = this.root.querySelector('[data-context-result]');
        target.classList.remove('ctx-idle');
        if (data.status !== 'available') {
            target.innerHTML = `<div class="empty-state">${renderWarnings(data.warnings) || escapeHtml((data.warnings || []).join(' / ') || '文脈を取得できません')}</div>`;
            return;
        }
        const p = data.preview || {};
        const mem = p.memory || {};
        const phil = p.philosophy_context?.included_in_agent_context ? '含む' : '含まない';
        const memoryIncludedCount = mem.included_count ?? 0;
        const memoryDeniedCount = mem.denied_count ?? 0;
        const contextMeta = `<div class="record-meta"><span>project: <b>${escapeHtml(p.project_code || '-')}</b></span></div>`;
        const stats = `<div class="ctx-stats">`
            + `<div class="ctx-stat"><strong>${escapeHtml(p.entity_count ?? 0)}</strong><span>entities</span></div>`
            + `<div class="ctx-stat"><strong>${escapeHtml(p.edge_count ?? 0)}</strong><span>edges</span></div>`
            + `<div class="ctx-stat green"><strong>${escapeHtml(memoryIncludedCount)}</strong><span>memory included: ${escapeHtml(memoryIncludedCount)}</span></div>`
            + `<div class="ctx-stat red"><strong>${escapeHtml(memoryDeniedCount)}</strong><span>memory denied: ${escapeHtml(memoryDeniedCount)}</span></div>`
            + `</div>`;
        const cols = `<div class="ctx-cols">`
            + `<div class="ctx-panel"><div class="ctx-panel-head"><span class="ico" style="background:#2f7a45"></span><h3>含まれた文脈</h3></div>${renderContextIncluded(p.included)}</div>`
            + `<div class="ctx-panel"><div class="ctx-panel-head"><span class="ico" style="background:#b23a2e"></span><h3>除外理由</h3></div>${renderDeniedReasons(mem)}<div class="phil-row"><span class="src-dot context"></span>philosophy: <b>${phil}</b></div></div>`
            + `</div>`;
        const report = renderReportPreview(p.report_preview);
        target.innerHTML = renderWarnings(data.warnings) + contextMeta + stats + cols + report;
    }

    flowPanel() {
        return `<div class="flow-wrap"><div class="filter-bar"><label>${JA_LABELS.project}<input data-flow-filter="project" placeholder="brainbase"></label><label>候補ID<input data-flow-filter="candidate" placeholder="cand_..."></label><label>正本ID<input data-flow-filter="entity" placeholder="project_..."></label><button class="secondary-button" type="button" data-load-flow>${JA_LABELS.filter}</button></div><div class="flow-list" data-flow-list><div class="empty-state">候補IDまたは正本IDを指定して来歴を表示します</div></div></div>`;
    }

    async loadFlow() {
        this.state.flow = await this.request(`/api/admin/data-flow${this.filters('flow-filter')}`);
        const steps = this.state.flow.steps || [];
        this.root.querySelector('[data-flow-list]').innerHTML = steps.length ? steps.map((s, i) => {
            const tone = STATUS_TONE[s.status] || 'slate';
            const [solid, ring] = TONE_COLORS[tone] || TONE_COLORS.slate;
            return `<div class="flow-step health-row"><div class="flow-rail"><span class="flow-dot" style="background:${solid};box-shadow:0 0 0 3px ${ring}"></span>${i < steps.length - 1 ? '<span class="flow-line"></span>' : ''}</div><div class="flow-body"><div class="flow-title"><strong>${escapeHtml(s.label)}</strong>${statusChip(s.status)}${badge(s.source_class)}</div>${s.reason ? `<div class="flow-reason">${escapeHtml(s.reason)}</div>` : ''}</div></div>`;
        }).join('') : `<div class="empty-state">${JA_LABELS.noRecords}</div>`;
        this.icons();
    }

    async loadHealth() {
        this.state.health = await this.request('/api/admin/health');
        const sources = this.state.health.sources || [];
        const rt = this.state.health.runtime_config || {};
        const db = rt.database;
        const checks = rt.checks || [];
        const keys = rt.keys || [];

        const okTones = new Set(['available', 'configured', 'connected', 'present']);
        const allStatuses = [...sources.map((s) => s.status), ...checks.map((c) => c.status), db?.status, db?.connection_status].filter(Boolean);
        const hasIssue = allStatuses.some((s) => !okTones.has(s));
        const posture = hasIssue
            ? `<div class="posture warn"><span class="posture-ico"><svg viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="1.8"><path d="M8 5v4M8 11h.01"/><path d="M8 1.8 13 3.6v4.1c0 3-2.1 5.2-5 6.5-2.9-1.3-5-3.5-5-6.5V3.6L8 1.8Z"/></svg></span><div><h2>設定確認が必要です</h2><p>未設定・確認が必要な項目を確認してください。値は表示しません。</p></div></div>`
            : `<div class="posture ok"><span class="posture-ico"><svg viewBox="0 0 16 16" fill="none" stroke="#fff" stroke-width="1.8"><path d="M3.5 8.2 6.4 11l6-6.4"/></svg></span><div><h2>全データソース接続済み・設定良好</h2><p>${JA_LABELS.secretSafe}。</p></div></div>`;

        const sourcesHtml = `<div class="panel"><div class="panel-header"><h2>データソース状態</h2></div>${sources.map((s) => {
            const reason = s.reason || s.message;
            return `<div class="health-row"><div class="name"><span class="src-dot ${sourceClassKey(s.source_class)}"></span><div><strong>${escapeHtml(s.label)}</strong>${reason ? `<div class="reason">${escapeHtml(reason)}</div>` : ''}</div></div>${statusChip(s.status)}</div>`;
        }).join('')}</div>`;

        const dbHtml = db ? `<div class="health-row"><div class="name"><div><strong>${escapeHtml(db.label)}</strong><div class="reason">接続: ${escapeHtml(formatStatusLabel(db.connection_status || db.status))} / keys: ${escapeHtml((db.keys || []).join(', '))} / 値: 非表示${db.reason ? ' / ' + escapeHtml(db.reason) : ''}</div></div></div>${statusChip(db.status)}</div>` : '';
        const checksHtml = checks.map((c) => `<div class="health-row"><div class="name"><div><strong>${escapeHtml(c.label)}</strong>${c.reason ? `<div class="reason">${escapeHtml(c.reason)}</div>` : ''}</div></div>${statusChip(c.status)}</div>`).join('');
        const keysHtml = keys.map((k) => `<div class="health-row"><span class="key">${escapeHtml(k.key)}</span>${statusChip(k.status)}</div>`).join('');
        const configHtml = `<div class="panel"><div class="panel-header"><h2>${JA_LABELS.health}</h2><span class="panel-note">${JA_LABELS.secretSafe}</span></div>${dbHtml}${checksHtml}${keysHtml}</div>`;

        this.root.querySelector('[data-health]').innerHTML = `${posture}<div class="health-grid">${sourcesHtml}${configHtml}</div>`;
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
