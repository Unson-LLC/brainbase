/**
 * GoalSeekView V2
 *
 * セッション・オートパイロットのメインビュー
 * - ゴール一覧（セッション別）
 * - ステータスインジケータ
 * - 問題検知パネル（赤バッジ/パルス）
 * - 進捗タイムライン
 * - エスカレーションパネル
 */
import { eventBus, EVENTS } from '../../core/event-bus.js';

export class GoalSeekView {
    constructor({ goalSeekService, modal }) {
        this.service = goalSeekService;
        this.modal = modal;
        this.container = null;
        this._unsubscribers = [];
        this._goals = [];
        this._selectedGoalId = null;
        this._problems = [];
        this._timeline = [];
    }

    mount(container) {
        this.container = container;
        this._setupEventListeners();
        this.render();
        this._loadGoals();
    }

    _setupEventListeners() {
        const unsub1 = eventBus.on(EVENTS.GOAL_CREATED, () => this._loadGoals());
        const unsub2 = eventBus.on(EVENTS.GOAL_UPDATED, () => this._loadGoals());
        const unsub3 = eventBus.on(EVENTS.GOAL_PROBLEM_DETECTED, (e) => this._handleProblemDetected(e.detail));
        const unsub4 = eventBus.on(EVENTS.GOAL_PROGRESS_UPDATE, () => this._loadGoals());
        const unsub5 = eventBus.on(EVENTS.GOAL_ESCALATION_REQUIRED, (e) => this._handleEscalation(e.detail));
        const unsub6 = eventBus.on(EVENTS.GOAL_MONITORING_STARTED, () => this._loadGoals());
        const unsub7 = eventBus.on(EVENTS.GOAL_MONITORING_STOPPED, () => this._loadGoals());
        this._unsubscribers.push(unsub1, unsub2, unsub3, unsub4, unsub5, unsub6, unsub7);
    }

    async _loadGoals() {
        try {
            this._goals = await this.service.getGoals();
            this._renderGoalList();

            if (this._selectedGoalId) {
                await this._loadGoalDetail(this._selectedGoalId);
            }
        } catch (err) {
            console.error('[GoalSeekView] Failed to load goals:', err.message);
        }
    }

    render() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="gs-view">
                <div class="gs-header">
                    <h3 class="gs-title">Goal Seek</h3>
                    <span class="gs-subtitle">Session Autopilot</span>
                    <button id="gs-new-goal-btn" class="btn-primary btn-sm">
                        <i data-lucide="plus"></i> New Goal
                    </button>
                </div>
                <div class="gs-content">
                    <div class="gs-goal-list" id="gs-goal-list">
                        <div class="gs-empty">Loading...</div>
                    </div>
                    <div class="gs-detail-panel hidden" id="gs-detail-panel">
                        <div class="gs-detail-header" id="gs-detail-header"></div>
                        <div class="gs-problems-panel" id="gs-problems-panel"></div>
                        <div class="gs-timeline-panel" id="gs-timeline-panel"></div>
                        <div class="gs-escalation-panel hidden" id="gs-escalation-panel"></div>
                    </div>
                </div>
            </div>
        `;

        const newBtn = this.container.querySelector('#gs-new-goal-btn');
        if (newBtn) {
            newBtn.addEventListener('click', () => this.modal.show());
        }

        if (window.lucide) window.lucide.createIcons();
    }

    _renderGoalList() {
        const listEl = this.container?.querySelector('#gs-goal-list');
        if (!listEl) return;

        if (this._goals.length === 0) {
            listEl.innerHTML = `
                <div class="gs-empty">
                    <p>No goals yet</p>
                    <p class="gs-empty-hint">Create a goal to start autonomous session monitoring</p>
                </div>
            `;
            return;
        }

        listEl.innerHTML = this._goals.map(goal => `
            <div class="gs-goal-row ${goal.id === this._selectedGoalId ? 'selected' : ''} gs-status-${goal.status}"
                 data-goal-id="${goal.id}">
                <div class="gs-goal-status-dot ${goal.status === 'problem' ? 'pulse' : ''}"></div>
                <div class="gs-goal-info">
                    <span class="gs-goal-title">${this._escapeHtml(goal.title)}</span>
                    <span class="gs-goal-session">Session: ${this._escapeHtml(goal.sessionId || 'N/A')}</span>
                </div>
                <span class="gs-goal-badge gs-badge-${goal.status}">${goal.status}</span>
            </div>
        `).join('');

        listEl.querySelectorAll('.gs-goal-row').forEach(row => {
            row.addEventListener('click', () => {
                const goalId = row.dataset.goalId;
                this._selectGoal(goalId);
            });
        });
    }

    async _selectGoal(goalId) {
        this._selectedGoalId = goalId;
        this._renderGoalList();

        const detailPanel = this.container?.querySelector('#gs-detail-panel');
        if (detailPanel) detailPanel.classList.remove('hidden');

        await this._loadGoalDetail(goalId);
    }

    async _loadGoalDetail(goalId) {
        try {
            const [goal, problems, timeline] = await Promise.all([
                this.service.getGoal(goalId),
                this.service.getProblems(goalId),
                this.service.getTimeline(goalId)
            ]);
            this._problems = problems;
            this._timeline = timeline;
            this._renderDetailHeader(goal);
            this._renderProblems(problems);
            this._renderTimeline(timeline);
        } catch (err) {
            console.error('[GoalSeekView] Failed to load goal detail:', err.message);
        }
    }

    _renderDetailHeader(goal) {
        const el = this.container?.querySelector('#gs-detail-header');
        if (!el) return;

        const isMonitoring = goal.status === 'monitoring';
        el.innerHTML = `
            <div class="gs-detail-title-row">
                <h4>${this._escapeHtml(goal.title)}</h4>
                <span class="gs-goal-badge gs-badge-${goal.status}">${goal.status}</span>
            </div>
            ${goal.description ? `<p class="gs-detail-desc">${this._escapeHtml(goal.description)}</p>` : ''}
            <div class="gs-detail-meta">
                <span>Session: ${this._escapeHtml(goal.sessionId || 'N/A')}</span>
                ${goal.managerConfig?.autoAnswerLevel ? `<span>Auto-answer: ${goal.managerConfig.autoAnswerLevel}</span>` : ''}
            </div>
            <div class="gs-detail-actions">
                ${isMonitoring
                    ? `<button class="btn-danger btn-sm gs-stop-btn" data-goal-id="${goal.id}">Stop Monitoring</button>`
                    : `<button class="btn-primary btn-sm gs-start-btn" data-goal-id="${goal.id}">Start Monitoring</button>`
                }
                <button class="btn-secondary btn-sm gs-delete-btn" data-goal-id="${goal.id}">Delete</button>
            </div>
        `;

        const startBtn = el.querySelector('.gs-start-btn');
        if (startBtn) {
            startBtn.addEventListener('click', async () => {
                await this.service.startMonitoring(goal.id);
            });
        }

        const stopBtn = el.querySelector('.gs-stop-btn');
        if (stopBtn) {
            stopBtn.addEventListener('click', async () => {
                await this.service.stopMonitoring(goal.id);
            });
        }

        const deleteBtn = el.querySelector('.gs-delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async () => {
                if (confirm('Delete this goal?')) {
                    await this.service.deleteGoal(goal.id);
                    this._selectedGoalId = null;
                    const detailPanel = this.container?.querySelector('#gs-detail-panel');
                    if (detailPanel) detailPanel.classList.add('hidden');
                    await this._loadGoals();
                }
            });
        }
    }

    _renderProblems(problems) {
        const el = this.container?.querySelector('#gs-problems-panel');
        if (!el) return;

        if (problems.length === 0) {
            el.innerHTML = '<div class="gs-problems-empty">No problems detected</div>';
            return;
        }

        el.innerHTML = `
            <h5 class="gs-section-title">Problems (${problems.length})</h5>
            ${problems.slice(0, 20).map(p => `
                <div class="gs-problem-card gs-severity-${p.severity}">
                    <div class="gs-problem-header">
                        <span class="gs-problem-type">${this._escapeHtml(p.type)}</span>
                        <span class="gs-problem-severity gs-sev-${p.severity}">${p.severity}</span>
                        <span class="gs-problem-time">${this._formatTime(p.timestamp)}</span>
                    </div>
                    <div class="gs-problem-title">${this._escapeHtml(p.title)}</div>
                    <div class="gs-problem-desc">${this._escapeHtml(p.description || '').slice(0, 200)}</div>
                    ${p.suggestedActions ? `
                        <div class="gs-problem-actions">
                            ${p.suggestedActions.map(a => `<span class="gs-action-chip">${this._escapeHtml(a)}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>
            `).join('')}
        `;
    }

    _renderTimeline(timeline) {
        const el = this.container?.querySelector('#gs-timeline-panel');
        if (!el) return;

        if (timeline.length === 0) {
            el.innerHTML = '<div class="gs-timeline-empty">No events yet</div>';
            return;
        }

        el.innerHTML = `
            <h5 class="gs-section-title">Timeline</h5>
            <div class="gs-timeline">
                ${timeline.slice(0, 30).map(entry => `
                    <div class="gs-timeline-entry gs-tl-${entry.type}">
                        <div class="gs-tl-dot"></div>
                        <div class="gs-tl-content">
                            <span class="gs-tl-time">${this._formatTime(entry.timestamp)}</span>
                            <span class="gs-tl-summary">${this._escapeHtml(entry.summary)}</span>
                            ${entry.details ? `<p class="gs-tl-details">${this._escapeHtml(entry.details).slice(0, 150)}</p>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    _handleProblemDetected(data) {
        if (data.goalId === this._selectedGoalId) {
            this._loadGoalDetail(this._selectedGoalId);
        }
        this._loadGoals();
    }

    _handleEscalation(data) {
        const panel = this.container?.querySelector('#gs-escalation-panel');
        if (!panel) return;

        panel.classList.remove('hidden');
        const esc = data.escalation;
        panel.innerHTML = `
            <div class="gs-escalation-card">
                <div class="gs-esc-header">
                    <i data-lucide="alert-triangle"></i>
                    <h5>Escalation Required</h5>
                </div>
                <p class="gs-esc-question">${this._escapeHtml(esc.question)}</p>
                ${esc.context ? `<p class="gs-esc-context">${this._escapeHtml(esc.context).slice(0, 300)}</p>` : ''}
                <div class="gs-esc-options">
                    ${(esc.options || []).map(opt => `
                        <button class="gs-esc-option-btn" data-esc-id="${esc.id}" data-choice="${opt.id}">
                            ${this._escapeHtml(opt.label)}
                            ${opt.description ? `<small>${this._escapeHtml(opt.description)}</small>` : ''}
                        </button>
                    `).join('')}
                </div>
                <div class="gs-esc-custom">
                    <input type="text" id="gs-esc-reason" placeholder="Additional reason (optional)" class="gs-input" />
                </div>
            </div>
        `;

        panel.querySelectorAll('.gs-esc-option-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const escId = btn.dataset.escId;
                const choice = btn.dataset.choice;
                const reason = panel.querySelector('#gs-esc-reason')?.value || '';
                try {
                    await this.service.respondToEscalation(escId, { choice, reason });
                    panel.classList.add('hidden');
                    await this._loadGoalDetail(this._selectedGoalId);
                } catch (err) {
                    console.error('[GoalSeekView] Escalation response failed:', err.message);
                }
            });
        });

        if (window.lucide) window.lucide.createIcons();
    }

    _formatTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    }

    _escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    unmount() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        if (this.container) {
            this.container.innerHTML = '';
            this.container = null;
        }
        this._goals = [];
        this._selectedGoalId = null;
    }
}
