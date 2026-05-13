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

const STATUS_LABELS = {
    review_needed: 'review_needed',
    approved: 'approved',
    scheduled: 'scheduled',
    posted: 'posted',
    skipped: 'skipped',
    learning_ready: 'learning_ready'
};

const STATUS_CLASSES = {
    review_needed: 'status-review-needed',
    approved: 'status-approved',
    scheduled: 'status-scheduled',
    posted: 'status-posted',
    skipped: 'status-muted',
    learning_ready: 'status-learning-ready'
};

const SUMMARY_ITEMS = [
    { status: 'review_needed', label: 'Review Needed', note: '承認が必要な投稿', icon: 'file-warning' },
    { status: 'scheduled', label: 'Scheduled', note: 'スケジュール済み', icon: 'calendar-days' },
    { status: 'posted', label: 'Posted', note: '投稿済み', icon: 'circle-check' },
    { status: 'learning_ready', label: 'Learning Ready', note: '学習準備完了', icon: 'graduation-cap' }
];

const TIMES = ['09:00', '12:00', '15:00', '18:00', '21:00'];

function pad2(value) {
    return String(value).padStart(2, '0');
}

function todayJst() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDays(date, offset) {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
}

function weekStart(date) {
    const d = new Date(`${date}T00:00:00.000Z`);
    const day = d.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + mondayOffset);
    return d.toISOString().slice(0, 10);
}

function formatDisplayDate(date) {
    const d = new Date(`${date}T00:00:00.000Z`);
    return `${d.getUTCFullYear()}/${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}`;
}

function weekdayLabel(date) {
    const d = new Date(`${date}T00:00:00.000Z`);
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    return `${weekdays[d.getUTCDay()]} ${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}`;
}

function titleFromBody(body) {
    const firstLine = String(body || '').split('\n').find((line) => line.trim()) || 'SNS draft';
    return firstLine.length > 32 ? `${firstLine.slice(0, 31)}…` : firstLine;
}

function normalizePosts(posts) {
    return (Array.isArray(posts) ? posts : []).map((post) => ({
        id: post.id,
        date: post.date,
        time: post.time || (post.scheduled_at ? post.scheduled_at.slice(11, 16) : '09:00'),
        title: post.title || titleFromBody(post.body),
        status: post.status || 'review_needed',
        account_handle: post.account_handle || '@AIBizNavigator',
        platform: post.platform || 'x',
        body: post.body || '',
        source: post.source || {},
        evidence: post.evidence || {},
        scheduled_at: post.scheduled_at || null,
        posted_url: post.posted_url || null,
        memo: post.memo || '',
        revisions: Array.isArray(post.revisions) ? post.revisions : [],
        metrics_snapshots: Array.isArray(post.metrics_snapshots) ? post.metrics_snapshots : [],
        lane: post.lane || null,
        format: post.format || null
    })).filter((post) => post.id && post.date);
}

function summarize(posts) {
    const byStatus = {
        review_needed: 0,
        approved: 0,
        scheduled: 0,
        posted: 0,
        skipped: 0,
        learning_ready: 0
    };
    for (const post of posts) {
        byStatus[post.status] = (byStatus[post.status] || 0) + 1;
    }
    return byStatus;
}

function createDefaultApiClient() {
    return {
        async listPosts({ startDate, endDate }) {
            const params = new URLSearchParams({ startDate, endDate });
            const response = await fetch(`/api/sns-growth/posts?${params.toString()}`);
            if (!response.ok) throw new Error(`SNS posts request failed: ${response.status}`);
            return response.json();
        },
        async updatePost(id, patch) {
            const response = await fetch(`/api/sns-growth/posts/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch)
            });
            if (!response.ok) throw new Error(`SNS post update failed: ${response.status}`);
            return response.json();
        }
    };
}

export class SnsGrowthCockpitView extends BaseView {
    constructor({ posts = null, apiClient = null, today = todayJst(), startDate = null, endDate = null } = {}) {
        super();
        this.today = today;
        this.startDate = startDate || weekStart(today);
        this.endDate = endDate || addDays(this.startDate, 6);
        this.posts = normalizePosts(posts || []);
        this.selectedPostId = this.posts[0]?.id || null;
        this.apiClient = apiClient || createDefaultApiClient();
        this._autoLoad = posts == null;
        this._clickHandler = null;
        this._changeHandler = null;
        this.isLoading = false;
        this.errorMessage = '';
    }

    mount(container) {
        super.mount(container);
        if (this._autoLoad) {
            this.loadPosts();
        }
    }

    async loadPosts() {
        if (!this.apiClient?.listPosts) return;
        this.isLoading = true;
        this.errorMessage = '';
        this.render();
        try {
            const result = await this.apiClient.listPosts({ startDate: this.startDate, endDate: this.endDate });
            this.posts = normalizePosts(result.posts || []);
            this.selectedPostId = this._selectedPost()?.id || null;
        } catch (error) {
            this.errorMessage = error?.message || 'SNS posting ledgerを読み込めません';
        } finally {
            this.isLoading = false;
            this.render();
        }
    }

    _setupEventListeners() {
        this._clickHandler = (event) => {
            const postButton = event.target.closest?.('[data-post-id]');
            if (postButton) {
                const shouldRevealMobileDetail = postButton.classList.contains('sns-mobile-decision-card')
                    && window.matchMedia?.('(max-width: 768px)').matches;
                this.selectedPostId = postButton.getAttribute('data-post-id');
                this.render();
                if (shouldRevealMobileDetail) {
                    this.container?.querySelector('.sns-growth-detail')?.scrollIntoView({ block: 'start' });
                }
                return;
            }

            const actionButton = event.target.closest?.('[data-sns-action]');
            if (actionButton) {
                this._handleAction(actionButton.getAttribute('data-sns-action'));
            }
        };
    }

    async _handleAction(action) {
        if (action === 'reload') {
            await this.loadPosts();
            return;
        }
        const post = this._selectedPost();
        if (!post || !action) return;
        const body = this.container?.querySelector('[data-detail-field="body"]')?.value;
        const memo = this.container?.querySelector('[data-detail-field="memo"]')?.value;
        const patch = {
            body,
            memo
        };
        if (action === 'approve') patch.status = 'approved';
        if (action === 'schedule') patch.status = 'scheduled';
        if (action === 'posted') patch.status = 'posted';
        if (action === 'skip') patch.status = 'skipped';
        try {
            const result = await this.apiClient.updatePost(post.id, patch);
            const updated = normalizePosts([result.post])[0];
            this.posts = this.posts.map((item) => item.id === updated.id ? updated : item);
            this.selectedPostId = updated.id;
            this.errorMessage = '';
            this.render();
        } catch (error) {
            this.errorMessage = error?.message || 'SNS post update failed';
            this.render();
        }
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
                            ${this._renderMobileDecisionInbox()}
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
        return this.posts.find(post => post.id === this.selectedPostId) || this.posts[0] || null;
    }

    _days() {
        return Array.from({ length: 7 }, (_, index) => {
            const date = addDays(this.startDate, index);
            return { key: date, date, label: weekdayLabel(date), active: date === this.today };
        });
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
                        <span class="sns-growth-avatar">佐</span>
                        <div><strong>佐藤 圭吾</strong><small>Founder</small></div>
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
                    <span>${escapeHtml(formatDisplayDate(this.startDate))} - ${escapeHtml(formatDisplayDate(this.endDate))}</span>
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
        const summary = summarize(this.posts);
        return `
            <section class="sns-growth-summary" aria-label="status summary">
                ${SUMMARY_ITEMS.map(item => `
                    <article class="sns-growth-summary-card" data-summary-status="${escapeHtml(item.status)}">
                        <span class="sns-summary-icon ${this._statusClass(item.status)}"><i data-lucide="${escapeHtml(item.icon)}"></i></span>
                        <div>
                            <strong>${escapeHtml(item.label)}</strong>
                            <b>${summary[item.status] || 0}</b>
                            <small>${escapeHtml(item.note)}</small>
                        </div>
                        <i data-lucide="chevron-right"></i>
                    </article>
                `).join('')}
            </section>
        `;
    }

    _renderInsight() {
        if (this.isLoading) {
            return `
                <section class="sns-growth-insight" role="status">
                    <i data-lucide="loader"></i>
                    <span>SNS Posting Ledgerを読み込み中。</span>
                </section>
            `;
        }
        if (this.errorMessage) {
            return `
                <section class="sns-growth-insight error" role="alert">
                    <i data-lucide="triangle-alert"></i>
                    <span>${escapeHtml(this.errorMessage)}</span>
                    <button type="button" data-sns-action="reload">再読み込み</button>
                </section>
            `;
        }
        if (this.posts.length === 0) {
            return `
                <section class="sns-growth-insight" role="status">
                    <i data-lucide="sparkles"></i>
                    <span>まだLedgerに投稿がありません。/ohayo のreview packを保存するとここに出ます。</span>
                </section>
            `;
        }
        return `
            <section class="sns-growth-insight" role="status">
                <i data-lucide="sparkles"></i>
                <span>SNS Posting Ledgerから${this.posts.length}件を表示中。レビュー、予約、投稿済み、学習準備をここで更新できます。</span>
            </section>
        `;
    }

    _renderMobileDecisionInbox() {
        const todayPosts = this.posts.filter(post => post.date === this.today);
        const activePosts = todayPosts.length > 0 ? todayPosts : this.posts.filter(post => post.status === 'review_needed').slice(0, 4);
        const statusCounts = summarize(activePosts);

        return `
            <section class="sns-mobile-review-flow" aria-label="今日のSNS判断Inbox">
                <header class="sns-mobile-review-header">
                    <div>
                        <span class="sns-mobile-kicker">Today</span>
                        <h1>今日のSNS判断</h1>
                        <p>止まっている投稿だけを確認して、承認・修正指示・スキップまで流す。</p>
                    </div>
                    <button class="sns-mobile-filter-btn" type="button" aria-label="フィルター">
                        <i data-lucide="sliders-horizontal"></i>
                    </button>
                </header>
                <div class="sns-mobile-status-strip" aria-label="today status summary">
                    <span><b>${statusCounts.review_needed || 0}</b>レビュー</span>
                    <span><b>${statusCounts.scheduled || 0}</b>予約済み</span>
                    <span><b>${statusCounts.posted || 0}</b>投稿済み</span>
                </div>
                <div class="sns-mobile-decision-list">
                    ${activePosts.length > 0
                        ? activePosts.map(post => this._renderMobileDecisionCard(post)).join('')
                        : '<p class="sns-mobile-empty">今日レビューする投稿はまだありません</p>'}
                </div>
                <div class="sns-mobile-calendar-entry">
                    <span>カレンダーは補助ビュー</span>
                    <button type="button">今週を見る <i data-lucide="chevron-right"></i></button>
                </div>
            </section>
        `;
    }

    _renderMobileDecisionCard(post) {
        const selected = post.id === this.selectedPostId;
        const sourceType = this._sourceLabel(post);
        const rationale = this._defaultRationale(post);
        return `
            <button class="sns-mobile-decision-card ${selected ? 'selected' : ''}" data-post-id="${escapeHtml(post.id)}" type="button">
                <span class="sns-mobile-decision-topline">
                    <strong>${escapeHtml(post.time)}</strong>
                    ${this._renderStatus(post.status)}
                </span>
                <span class="sns-mobile-decision-title">${escapeHtml(post.title)}</span>
                <span class="sns-mobile-decision-rationale">${escapeHtml(rationale)}</span>
                <span class="sns-mobile-decision-meta">
                    <em>${escapeHtml(sourceType)}</em>
                    <em>Persona OK</em>
                    <em>Graph OK</em>
                </span>
            </button>
        `;
    }

    _sourceLabel(post) {
        return post.source?.type || 'Source';
    }

    _defaultRationale(post) {
        if (post.status === 'review_needed') return '読者の気持ちに合うかだけ確認する';
        if (post.status === 'approved') return '承認済み。予約時刻だけ決める';
        if (post.status === 'scheduled') return '予約済み。文脈だけ最終確認する';
        if (post.status === 'posted') return '投稿済み。学習候補にするか見る';
        if (post.status === 'skipped') return '今回は使わない判断';
        return '今日の運用判断に接続する';
    }

    _renderCalendar() {
        const days = this._days();
        return `
            <section class="sns-growth-calendar-grid" aria-label="Ship Calendar">
                <div class="sns-calendar-corner"></div>
                ${days.map(day => `<div class="sns-calendar-day ${day.active ? 'active' : ''}">${escapeHtml(day.label)}</div>`).join('')}
                ${TIMES.map(time => `
                    <div class="sns-calendar-time">${escapeHtml(time)}</div>
                    ${days.map(day => `
                        <div class="sns-calendar-cell ${day.active ? 'active-column' : ''}">
                            ${this._postsFor(day.date, time).map(post => this._renderPost(post)).join('')}
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
                    <span class="sns-source-icon">${escapeHtml(this._sourceGlyph(post))}</span>
                </span>
            </button>
        `;
    }

    _renderDetail(post) {
        if (!post) {
            return `
                <aside class="sns-growth-detail" aria-label="ポストの詳細">
                    <header><h2>ポストの詳細</h2></header>
                    <p class="sns-detail-empty">Ledgerに投稿がありません。</p>
                </aside>
            `;
        }
        return `
            <aside class="sns-growth-detail" aria-label="ポストの詳細">
                <header>
                    <h2>ポストの詳細</h2>
                    <button type="button" aria-label="閉じる"><i data-lucide="x"></i></button>
                </header>
                <div class="sns-detail-account">
                    <span class="sns-detail-x">X</span>
                    <strong>X ${escapeHtml(post.account_handle)}</strong>
                </div>
                <dl class="sns-detail-meta">
                    <div><dt>ステータス</dt><dd><button type="button" class="sns-status-select">${this._renderStatus(post.status)} <i data-lucide="chevron-down"></i></button></dd></div>
                    <div><dt>ポストID</dt><dd>${escapeHtml(post.id)}</dd></div>
                    <div><dt>作成日</dt><dd>${escapeHtml(formatDisplayDate(post.date))}</dd></div>
                    <div><dt>レーン</dt><dd>${escapeHtml(post.lane || '-')}</dd></div>
                </dl>
                <label class="sns-detail-label">
                    <span>ポスト本文</span>
                    <textarea data-detail-field="body">${escapeHtml(post.body || post.title)}</textarea>
                </label>
                <label class="sns-detail-label">
                    <span>ソースURL</span>
                    ${post.source?.url
                        ? `<a href="${escapeHtml(post.source.url)}" target="_blank" rel="noreferrer">${escapeHtml(post.source.url)}<i data-lucide="external-link"></i></a>`
                        : '<em>ソースURLなし</em>'}
                </label>
                <div class="sns-detail-schedule">
                    <span>スケジュール日時</span>
                    <button type="button"><i data-lucide="calendar"></i> ${escapeHtml(formatDisplayDate(post.date))}</button>
                    <button type="button"><i data-lucide="clock"></i> ${escapeHtml(post.time)}</button>
                    <button type="button">JST <i data-lucide="chevron-down"></i></button>
                </div>
                <label class="sns-detail-label">
                    <span>メモ</span>
                    <input data-detail-field="memo" type="text" placeholder="メモを入力（任意）" value="${escapeHtml(post.memo)}" />
                </label>
                <div class="sns-detail-actions">
                    <button type="button" class="primary" data-sns-action="approve">承認する</button>
                    <button type="button" data-sns-action="schedule">スケジュール</button>
                    <button type="button" class="success" data-sns-action="posted">投稿済みにする</button>
                    <button type="button" data-sns-action="skip">スキップする</button>
                </div>
                <div class="sns-evidence-list">
                    ${this._renderEvidence('Persona Brain', post.evidence?.persona_brain?.target_person || '未設定')}
                    ${this._renderEvidence('Graph Check', post.evidence?.graph_check?.status || post.evidence?.graph_check?.decision || '未確認')}
                    ${this._renderEvidence('Quality Gate', post.evidence?.quality_gate?.status || post.evidence?.quality_gate?.decision || '未確認')}
                    ${this._renderEvidence('Reader affect', post.evidence?.reader_affect || '未設定')}
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

    _postsFor(date, time) {
        return this.posts.filter(post => post.date === date && post.time === time);
    }

    _renderStatus(status) {
        return `<span class="sns-status-chip ${this._statusClass(status)}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
    }

    _statusClass(status) {
        return STATUS_CLASSES[status] || 'status-muted';
    }

    _sourceGlyph(post) {
        const sourceType = post.source?.type || '';
        if (sourceType === 'Peer Circle') return 'X';
        if (sourceType === 'News') return 'N';
        if (sourceType === 'Personal KG') return '□';
        return 'X';
    }
}
