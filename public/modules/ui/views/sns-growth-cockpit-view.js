import { escapeHtml, refreshIcons } from '../../ui-helpers.js';
import { BaseView } from './base-view.js';

const NAV_GROUPS = [
    { label: '今日', items: [['home', 'Ohayo'], ['target', '今日の判断'], ['inbox', 'Inbox', '5']] },
    { label: '脳', items: [['network', 'Knowledge Graph'], ['brain', 'Personal KG'], ['users', 'People / Orgs'], ['lightbulb', 'Philosophy'], ['archive', 'Memories']] },
    { label: '作る', items: [['sparkles', 'SNS Growth', null, 'sns-growth'], ['pen-line', 'Content Studio'], ['search', 'Research Board'], ['file-text', 'Drafts']] },
    { label: '動かす', items: [['check-square', 'Tasks'], ['calendar-days', 'Calendar'], ['workflow', 'Automations'], ['plug', 'Integrations']] },
    { label: '学ぶ', items: [['message-circle', 'Feedback'], ['database', 'Learning Candidates'], ['bar-chart-3', 'Reports']] },
    { label: 'システム', items: [['settings', 'Settings'], ['user-round', 'Members']] }
];

const SUMMARY = [
    { status: 'review_needed', label: 'Review Needed', value: 3, note: '承認が必要な投稿', icon: 'file-warning' },
    { status: 'scheduled', label: 'Scheduled', value: 8, note: 'スケジュール済み', icon: 'calendar-days' },
    { status: 'posted', label: 'Posted', value: 12, note: '投稿済み', icon: 'circle-check' },
    { status: 'learning_ready', label: 'Learning Ready', value: 2, note: '学習準備完了', icon: 'graduation-cap' }
];

const DAYS = [
    { key: 'mon', label: '月 05/19' },
    { key: 'tue', label: '火 05/20' },
    { key: 'wed', label: '水 05/21' },
    { key: 'thu', label: '木 05/22', active: true },
    { key: 'fri', label: '金 05/23' },
    { key: 'sat', label: '土 05/24' },
    { key: 'sun', label: '日 05/25' }
];

const TIMES = ['09:00', '12:00', '15:00', '18:00', '21:00'];

const POSTS = [
    {
        id: 'bb_x_20250522_0900',
        day: 'thu',
        time: '09:00',
        title: '生産性を最大化する情報の流れ設計',
        status: 'review_needed',
        sourceIcon: 'x',
        account: 'X (Twitter) @brainbase_inc',
        author: '田中 啓介',
        createdAt: '2025/05/21 14:32',
        body: 'チームの生産性を最大化するために、最も重要なのは「情報の流れ」を整えること。\n\nBrainbaseは、知識の構造化と共有を通じて、意思決定のスピードと質を高めます。',
        sourceUrl: 'https://brainbase.io/blog/information-flow',
        readerAffect: '実務に置き換えやすい'
    },
    { id: 'bb_x_20250519_0900', day: 'mon', time: '09:00', title: '情報の流れを整えることから始める', status: 'review_needed', sourceIcon: 'x' },
    { id: 'bb_x_20250519_1200', day: 'mon', time: '12:00', title: '会議の質を上げる3つのポイント', status: 'posted', sourceIcon: 'linkedin' },
    { id: 'bb_x_20250519_1500', day: 'mon', time: '15:00', title: 'タスク管理の落とし穴', status: 'review_needed', sourceIcon: 'x' },
    { id: 'bb_x_20250519_1800', day: 'mon', time: '18:00', title: '今日の気づき', status: 'posted', sourceIcon: 'x' },
    { id: 'bb_x_20250519_2100', day: 'mon', time: '21:00', title: 'プロダクトと組織の関係性', status: 'learning_ready', sourceIcon: 'doc' },
    { id: 'bb_x_20250520_0900', day: 'tue', time: '09:00', title: 'チームの学習を加速する仕組み', status: 'scheduled', sourceIcon: 'linkedin' },
    { id: 'bb_x_20250520_1200', day: 'tue', time: '12:00', title: '情報のサイロ化を防ぐには', status: 'scheduled', sourceIcon: 'x' },
    { id: 'bb_x_20250520_1800', day: 'tue', time: '18:00', title: 'プロジェクトの立ち上げ方', status: 'scheduled', sourceIcon: 'linkedin' },
    { id: 'bb_x_20250520_2100', day: 'tue', time: '21:00', title: '思考の整理法', status: 'scheduled', sourceIcon: 'x' },
    { id: 'bb_x_20250521_0900', day: 'wed', time: '09:00', title: 'ナレッジ共有の本質とは', status: 'posted', sourceIcon: 'x' },
    {
        id: 'bb_x_20250521_1200',
        day: 'wed',
        time: '12:00',
        title: 'Personal KGの活用事例',
        status: 'scheduled',
        sourceIcon: 'doc',
        account: 'X (Twitter) @brainbase_inc',
        author: '田中 啓介',
        createdAt: '2025/05/20 18:04',
        body: 'Personal KGの活用事例は、単なる情報整理ではなく、次の判断を速くするための文脈づくりにある。',
        sourceUrl: 'https://brainbase.io/blog/personal-kg',
        readerAffect: '自分の業務に接続しやすい'
    },
    { id: 'bb_x_20250521_1500', day: 'wed', time: '15:00', title: 'リサーチ結果の共有', status: 'scheduled', sourceIcon: 'doc' },
    { id: 'bb_x_20250521_1800', day: 'wed', time: '18:00', title: 'チームの心理的安全性', status: 'review_needed', sourceIcon: 'x' },
    { id: 'bb_x_20250522_1500', day: 'thu', time: '15:00', title: 'プロジェクトの成功率を上げる', status: 'review_needed', sourceIcon: 'x' },
    { id: 'bb_x_20250522_1800', day: 'thu', time: '18:00', title: '良い情報設計とは', status: 'scheduled', sourceIcon: 'x' },
    { id: 'bb_x_20250522_2100', day: 'thu', time: '21:00', title: '明日の準備', status: 'scheduled', sourceIcon: 'x' },
    { id: 'bb_x_20250523_0900', day: 'fri', time: '09:00', title: '意思決定のスピードを上げる仕組み', status: 'scheduled', sourceIcon: 'x' },
    { id: 'bb_x_20250523_1200', day: 'fri', time: '12:00', title: 'ナレッジが資産になる組織', status: 'scheduled', sourceIcon: 'linkedin' },
    { id: 'bb_x_20250523_1500', day: 'fri', time: '15:00', title: '良い仮説とは', status: 'scheduled', sourceIcon: 'x' },
    { id: 'bb_x_20250523_1800', day: 'fri', time: '18:00', title: '今週のインサイト', status: 'posted', sourceIcon: 'doc' },
    { id: 'bb_x_20250524_1500', day: 'sat', time: '15:00', title: '週末の振り返り', status: 'learning_ready', sourceIcon: 'doc' },
    { id: 'bb_x_20250525_0900', day: 'sun', time: '09:00', title: '今週の学びまとめ', status: 'learning_ready', sourceIcon: 'doc' }
];

const STATUS_LABELS = {
    review_needed: 'review_needed',
    scheduled: 'scheduled',
    posted: 'posted',
    learning_ready: 'learning_ready'
};

const STATUS_CLASSES = {
    review_needed: 'status-review-needed',
    scheduled: 'status-scheduled',
    posted: 'status-posted',
    learning_ready: 'status-learning-ready'
};

export class SnsGrowthCockpitView extends BaseView {
    constructor({ posts = POSTS } = {}) {
        super();
        this.posts = posts;
        this.selectedPostId = posts[0]?.id || null;
        this._clickHandler = null;
    }

    _setupEventListeners() {
        this._clickHandler = (event) => {
            const postButton = event.target.closest?.('[data-post-id]');
            if (!postButton) return;
            this.selectedPostId = postButton.getAttribute('data-post-id');
            this.render();
        };
    }

    render() {
        if (!this.container) return;
        const selectedPost = this._selectedPost();
        this.container.innerHTML = `
            <section class="sns-growth-app" aria-label="SNS Growth Cockpit">
                ${this._renderSidebar()}
                <div class="sns-growth-main">
                    ${this._renderTopbar()}
                    <div class="sns-growth-content">
                        <div class="sns-growth-calendar-pane">
                            ${this._renderHeader()}
                            ${this._renderSummary()}
                            ${this._renderInsight()}
                            ${this._renderCalendar()}
                        </div>
                        ${this._renderDetail(selectedPost)}
                    </div>
                </div>
            </section>
        `;
        this.container.removeEventListener('click', this._clickHandler);
        this.container.addEventListener('click', this._clickHandler);
        refreshIcons({ root: this.container });
    }

    unmount() {
        if (this.container && this._clickHandler) {
            this.container.removeEventListener('click', this._clickHandler);
        }
        super.unmount();
    }

    _selectedPost() {
        return this.posts.find(post => post.id === this.selectedPostId) || this.posts[0];
    }

    _renderSidebar() {
        return `
            <aside class="sns-growth-sidebar">
                <a class="sns-growth-brand" href="/" aria-label="Brainbaseに戻る">
                    <span class="sns-growth-brand-mark">B</span>
                    <strong>Brainbase</strong>
                </a>
                <nav class="sns-growth-nav" aria-label="Brainbase loop">
                    ${NAV_GROUPS.map(group => `
                        <section class="sns-growth-nav-group">
                            <h2>${escapeHtml(group.label)}</h2>
                            ${group.items.map(([icon, label, badge, id]) => `
                                <button class="sns-growth-nav-item ${id === 'sns-growth' ? 'active' : ''}" ${id ? `data-nav-item="${escapeHtml(id)}"` : ''} type="button">
                                    <i data-lucide="${escapeHtml(icon)}"></i>
                                    <span>${escapeHtml(label)}</span>
                                    ${badge ? `<em>${escapeHtml(badge)}</em>` : ''}
                                </button>
                            `).join('')}
                        </section>
                    `).join('')}
                </nav>
                <button class="sns-growth-collapse" type="button">
                    <i data-lucide="chevron-left"></i>
                    <span>メニューを閉じる</span>
                </button>
            </aside>
        `;
    }

    _renderTopbar() {
        return `
            <header class="sns-growth-topbar">
                <div class="sns-growth-topbar-title">
                    <button type="button" class="sns-growth-icon-btn" aria-label="メニュー">
                        <i data-lucide="menu"></i>
                    </button>
                    <strong>SNS Growth Cockpit</strong>
                </div>
                <div class="sns-growth-topbar-actions">
                    <button type="button" class="sns-growth-icon-btn" aria-label="検索"><i data-lucide="search"></i></button>
                    <button type="button" class="sns-growth-icon-btn has-badge" aria-label="通知"><i data-lucide="bell"></i><span>12</span></button>
                    <button type="button" class="sns-growth-icon-btn" aria-label="ヘルプ"><i data-lucide="circle-help"></i></button>
                    <div class="sns-growth-user">
                        <span class="sns-growth-avatar">田</span>
                        <div><strong>田中 啓介</strong><small>Founder</small></div>
                        <i data-lucide="chevron-down"></i>
                    </div>
                </div>
            </header>
        `;
    }

    _renderHeader() {
        return `
            <section class="sns-growth-page-header">
                <div>
                    <h1>SNS Growth Cockpit</h1>
                    <p>今日の判断から、投稿・学習までを一つの流れで管理</p>
                </div>
                <div class="sns-growth-date-controls" aria-label="date controls">
                    <button type="button"><i data-lucide="chevron-left"></i></button>
                    <span>2025/05/19 - 2025/05/25</span>
                    <button type="button"><i data-lucide="chevron-right"></i></button>
                    <button type="button">今週</button>
                </div>
            </section>
            <section class="sns-growth-toolbar">
                <div class="sns-growth-tabs">
                    <button class="active" type="button">カレンダー</button>
                    <button type="button">リサーチ</button>
                    <button type="button">レビュー</button>
                    <button type="button">ラーニング</button>
                </div>
                <div class="sns-growth-filters">
                    <button type="button">すべてのアカウント <i data-lucide="chevron-down"></i></button>
                    <button type="button"><i data-lucide="list-filter"></i> フィルター</button>
                    <button type="button" aria-label="設定"><i data-lucide="settings"></i></button>
                </div>
            </section>
        `;
    }

    _renderSummary() {
        return `
            <section class="sns-growth-summary" aria-label="status summary">
                ${SUMMARY.map(item => `
                    <article class="sns-growth-summary-card" data-summary-status="${escapeHtml(item.status)}">
                        <span class="sns-summary-icon ${this._statusClass(item.status)}"><i data-lucide="${escapeHtml(item.icon)}"></i></span>
                        <div>
                            <strong>${escapeHtml(item.label)}</strong>
                            <b>${item.value}</b>
                            <small>${escapeHtml(item.note)}</small>
                        </div>
                        <i data-lucide="chevron-right"></i>
                    </article>
                `).join('')}
            </section>
        `;
    }

    _renderInsight() {
        return `
            <section class="sns-growth-insight" role="status">
                <i data-lucide="sparkles"></i>
                <span>今週はX運用の話に寄りすぎ。Personal KG由来の投稿を1件追加候補。</span>
                <button type="button">詳細を確認</button>
            </section>
        `;
    }

    _renderCalendar() {
        return `
            <section class="sns-growth-calendar-grid" aria-label="Ship Calendar">
                <div class="sns-calendar-corner"></div>
                ${DAYS.map(day => `<div class="sns-calendar-day ${day.active ? 'active' : ''}">${escapeHtml(day.label)}</div>`).join('')}
                ${TIMES.map(time => `
                    <div class="sns-calendar-time">${escapeHtml(time)}</div>
                    ${DAYS.map(day => `
                        <div class="sns-calendar-cell ${day.active ? 'active-column' : ''}">
                            ${this._postsFor(day.key, time).map(post => this._renderPost(post)).join('')}
                        </div>
                    `).join('')}
                `).join('')}
            </section>
        `;
    }

    _renderPost(post) {
        const selected = post.id === this.selectedPostId;
        return `
            <button class="sns-calendar-post ${selected ? 'selected' : ''}" data-post-id="${escapeHtml(post.id)}" type="button">
                <span class="sns-post-time">${escapeHtml(post.time)}</span>
                <strong>${escapeHtml(post.title)}</strong>
                <span class="sns-post-meta">
                    ${this._renderStatus(post.status)}
                    <span class="sns-source-icon">${escapeHtml(this._sourceGlyph(post.sourceIcon))}</span>
                </span>
            </button>
        `;
    }

    _renderDetail(post) {
        return `
            <aside class="sns-growth-detail" aria-label="ポストの詳細">
                <header>
                    <h2>ポストの詳細</h2>
                    <button type="button" aria-label="閉じる"><i data-lucide="x"></i></button>
                </header>
                <div class="sns-detail-account">
                    <span class="sns-detail-x">X</span>
                    <strong>${escapeHtml(post.account || 'X (Twitter) @brainbase_inc')}</strong>
                </div>
                <dl class="sns-detail-meta">
                    <div><dt>ステータス</dt><dd><button type="button" class="sns-status-select">${this._renderStatus(post.status)} <i data-lucide="chevron-down"></i></button></dd></div>
                    <div><dt>ポストID</dt><dd>${escapeHtml(post.id)}</dd></div>
                    <div><dt>作成日</dt><dd>${escapeHtml(post.createdAt || '2025/05/21 14:32')}</dd></div>
                    <div><dt>作成者</dt><dd>${escapeHtml(post.author || '田中 啓介')}</dd></div>
                </dl>
                <label class="sns-detail-label">
                    <span>ポスト本文</span>
                    <textarea data-detail-field="body" readonly>${escapeHtml(post.body || post.title)}</textarea>
                </label>
                <label class="sns-detail-label">
                    <span>ソースURL</span>
                    <a href="${escapeHtml(post.sourceUrl || 'https://brainbase.io/blog/information-flow')}" target="_blank" rel="noreferrer">
                        ${escapeHtml(post.sourceUrl || 'https://brainbase.io/blog/information-flow')}
                        <i data-lucide="external-link"></i>
                    </a>
                </label>
                <div class="sns-detail-schedule">
                    <span>スケジュール日時</span>
                    <button type="button"><i data-lucide="calendar"></i> 2025/05/22</button>
                    <button type="button"><i data-lucide="clock"></i> 09:00</button>
                    <button type="button">JST <i data-lucide="chevron-down"></i></button>
                </div>
                <label class="sns-detail-label">
                    <span>メモ</span>
                    <input type="text" placeholder="メモを入力（任意）" />
                </label>
                <div class="sns-detail-actions">
                    <button type="button" class="primary">承認する</button>
                    <button type="button">スケジュール</button>
                    <button type="button" class="success">投稿済みにする</button>
                    <button type="button">スキップする</button>
                </div>
                <div class="sns-evidence-list">
                    ${this._renderEvidence('Persona Brain', '一致')}
                    ${this._renderEvidence('Graph Check', '異常なし')}
                    ${this._renderEvidence('Quality Gate', '合格')}
                    ${this._renderEvidence('Reader affect', post.readerAffect || '実務に置き換えやすい')}
                </div>
            </aside>
        `;
    }

    _renderEvidence(label, value) {
        return `
            <button class="sns-evidence-row" type="button">
                <span><i data-lucide="chevron-right"></i>${escapeHtml(label)}</span>
                <em>${escapeHtml(value)}</em>
                <i data-lucide="chevron-down"></i>
            </button>
        `;
    }

    _postsFor(day, time) {
        return this.posts.filter(post => post.day === day && post.time === time);
    }

    _renderStatus(status) {
        return `<span class="sns-status-chip ${this._statusClass(status)}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
    }

    _statusClass(status) {
        return STATUS_CLASSES[status] || 'status-muted';
    }

    _sourceGlyph(sourceIcon) {
        if (sourceIcon === 'linkedin') return 'in';
        if (sourceIcon === 'doc') return '□';
        return 'X';
    }
}
