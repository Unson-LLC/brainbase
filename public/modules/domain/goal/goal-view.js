/**
 * GoalSeekView
 *
 * Goal Seek機能のUIコンポーネント。
 * セッション単位でゴール設定・進捗表示・介入モーダルを管理。
 *
 * 設計書参照: /Users/ksato/workspace/shared/_codex/projects/brainbase/goal-seek-story.md
 */

import { EVENTS } from '../../core/event-bus.js';

/**
 * GoalSeekView
 * セッション単位のゴール追求UI
 */
export class GoalSeekView {
    /**
     * @param {Object} options
     * @param {Object} options.service - GoalSeekService
     * @param {EventBus} options.eventBus - イベントバス
     * @param {string} options.containerSelector - コンテナセレクタ
     */
    constructor(options = {}) {
        this.service = options.service;
        this.eventBus = options.eventBus;
        this.containerSelector = options.containerSelector || '#goal-seek-container';
        this.container = document.querySelector(this.containerSelector);
        this.currentGoal = null;
        this.currentSessionId = null;
        this.eventSubscriptions = [];

        this._bindEvents();
    }

    /**
     * UI描画
     * @param {Object} options
     * @param {Object|null} options.goal - ゴールデータ
     * @param {string} options.sessionId - セッションID
     */
    render({ goal, sessionId }) {
        this.currentGoal = goal;
        this.currentSessionId = sessionId;

        if (!this.container) {
            this.container = document.querySelector(this.containerSelector);
        }

        if (!this.container) return;

        if (!goal) {
            this._renderSetupUI();
        } else if (goal.status === 'completed') {
            this._renderCompletedUI(goal);
        } else if (goal.status === 'failed') {
            this._renderFailedUI(goal);
        } else if (goal.status === 'cancelled') {
            this._renderCancelledUI(goal);
        } else {
            this._renderProgressUI(goal);
        }
    }

    /**
     * ゴール設定
     * @param {Object} goalData - ゴールデータ
     * @returns {Promise<Object>} 作成されたゴール
     */
    async setupGoal(goalData) {
        const goal = await this.service.createGoal(goalData);
        this.currentGoal = goal;

        this.eventBus.emit(EVENTS.GOAL_SEEK_STARTED, {
            goalId: goal.id,
            sessionId: goalData.sessionId,
            goal
        });

        this.render({ goal, sessionId: goalData.sessionId });

        return goal;
    }

    /**
     * 介入モーダル表示
     * @param {Object} intervention - 介入データ
     */
    showIntervention(intervention) {
        if (!this.container) return;

        const modal = this._createInterventionModal(intervention);
        this.container.appendChild(modal);
    }

    /**
     * 介入モーダルを閉じる
     */
    hideIntervention() {
        const modal = this.container?.querySelector('.intervention-modal');
        if (modal) {
            modal.remove();
        }
    }

    /**
     * 進捗更新
     * @param {Object} progress - 進捗データ
     */
    updateProgress(progress) {
        if (!this.currentGoal) return;

        this.currentGoal = {
            ...this.currentGoal,
            current: {
                ...this.currentGoal.current,
                value: progress.value
            }
        };

        this.render({ goal: this.currentGoal, sessionId: this.currentSessionId });
    }

    /**
     * ゴールキャンセル
     * @param {string} goalId - ゴールID
     */
    async cancelGoal(goalId) {
        await this.service.cancelGoal(goalId);

        this.eventBus.emit(EVENTS.GOAL_SEEK_CANCELLED, {
            goalId,
            sessionId: this.currentSessionId
        });

        this.currentGoal = null;
        this.render({ goal: null, sessionId: this.currentSessionId });
    }

    /**
     * UI非表示
     */
    hide() {
        if (this.container) {
            this.container.innerHTML = '';
        }
    }

    /**
     * 破棄
     */
    destroy() {
        // イベントリスナー削除
        this.eventSubscriptions.forEach(unsubscribe => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        });
        this.eventSubscriptions = [];

        this.hide();
        this.container = null;
        this.currentGoal = null;
        this.currentSessionId = null;
    }

    // ===== Private Methods =====

    /**
     * イベントバインド
     * @private
     */
    _bindEvents() {
        if (!this.eventBus) return;

        // 進捗更新イベント
        const unsubProgress = this.eventBus.on(EVENTS.GOAL_SEEK_PROGRESS, (e) => {
            if (e.detail.goalId === this.currentGoal?.id) {
                this.updateProgress(e.detail.progress);
            }
        });
        this.eventSubscriptions.push(unsubProgress);

        // 介入要求イベント
        const unsubIntervention = this.eventBus.on(EVENTS.GOAL_SEEK_INTERVENTION_REQUIRED, (e) => {
            if (e.detail.goalId === this.currentGoal?.id) {
                this.showIntervention(e.detail.intervention);
            }
        });
        this.eventSubscriptions.push(unsubIntervention);

        // 完了イベント
        const unsubCompleted = this.eventBus.on(EVENTS.GOAL_SEEK_COMPLETED, (e) => {
            if (e.detail.goalId === this.currentGoal?.id) {
                this.render({
                    goal: { ...this.currentGoal, status: 'completed' },
                    sessionId: this.currentSessionId
                });
            }
        });
        this.eventSubscriptions.push(unsubCompleted);

        // 失敗イベント
        const unsubFailed = this.eventBus.on(EVENTS.GOAL_SEEK_FAILED, (e) => {
            if (e.detail.goalId === this.currentGoal?.id) {
                this.render({
                    goal: { ...this.currentGoal, status: 'failed' },
                    sessionId: this.currentSessionId
                });
            }
        });
        this.eventSubscriptions.push(unsubFailed);
    }

    /**
     * ゴール設定UI描画
     * @private
     */
    _renderSetupUI() {
        this.container.innerHTML = `
            <div class="goal-setup">
                <button class="goal-setup-button">
                    🎯 ゴール設定
                </button>
            </div>
        `;

        const button = this.container.querySelector('.goal-setup-button');
        button?.addEventListener('click', () => {
            this._showGoalSetupModal();
        });
    }

    /**
     * 進捗UI描画
     * @private
     */
    _renderProgressUI(goal) {
        const current = goal.current?.value || 0;
        const target = goal.target?.value || 100;
        const percentage = Math.min(100, Math.round((current / target) * 100));
        const unit = goal.target?.unit || '件';

        this.container.innerHTML = `
            <div class="goal-progress">
                <div class="progress-header">
                    <span class="progress-label">ゴール進捗</span>
                    <span class="progress-text">${current} / ${target} ${unit}</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar" style="width: ${percentage}%"></div>
                </div>
                <div class="progress-actions">
                    <button class="cancel-button">キャンセル</button>
                </div>
            </div>
        `;

        const cancelButton = this.container.querySelector('.cancel-button');
        cancelButton?.addEventListener('click', () => {
            this.cancelGoal(goal.id);
        });
    }

    /**
     * 完了UI描画
     * @private
     */
    _renderCompletedUI(goal) {
        this.container.innerHTML = `
            <div class="goal-completed">
                <span class="completed-icon">🎉</span>
                <span class="completed-message">ゴール達成！</span>
            </div>
        `;
    }

    /**
     * 失敗UI描画
     * @private
     */
    _renderFailedUI(goal) {
        this.container.innerHTML = `
            <div class="goal-failed">
                <span class="failed-icon">❌</span>
                <span class="failed-message">ゴール失敗</span>
            </div>
        `;
    }

    /**
     * キャンセルUI描画
     * @private
     */
    _renderCancelledUI(goal) {
        this.container.innerHTML = `
            <div class="goal-cancelled">
                <span class="cancelled-message">ゴールをキャンセルしました</span>
                <button class="goal-setup-button">新しいゴールを設定</button>
            </div>
        `;

        const button = this.container.querySelector('.goal-setup-button');
        button?.addEventListener('click', () => {
            this._showGoalSetupModal();
        });
    }

    /**
     * ゴール設定モーダル表示
     * @private
     */
    _showGoalSetupModal() {
        // モーダルHTML生成（実際の実装ではより詳細なフォーム）
        const modal = document.createElement('div');
        modal.className = 'goal-setup-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>ゴール設定</h3>
                <form class="goal-setup-form">
                    <div class="form-group">
                        <label>目標値</label>
                        <input type="number" name="targetValue" required />
                    </div>
                    <div class="form-group">
                        <label>単位</label>
                        <input type="text" name="unit" value="件" />
                    </div>
                    <div class="form-group">
                        <label>期限</label>
                        <input type="date" name="deadline" />
                    </div>
                    <div class="form-actions">
                        <button type="submit">設定</button>
                        <button type="button" class="cancel-modal">キャンセル</button>
                    </div>
                </form>
            </div>
        `;

        this.container.appendChild(modal);

        // フォーム送信ハンドラー
        const form = modal.querySelector('.goal-setup-form');
        form?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            await this.setupGoal({
                sessionId: this.currentSessionId,
                goalType: 'count',
                target: {
                    value: parseInt(formData.get('targetValue')),
                    unit: formData.get('unit')
                },
                deadline: formData.get('deadline') || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            });
            modal.remove();
        });

        // キャンセルボタン
        const cancelButton = modal.querySelector('.cancel-modal');
        cancelButton?.addEventListener('click', () => {
            modal.remove();
        });
    }

    /**
     * 介入モーダル作成
     * @private
     */
    _createInterventionModal(intervention) {
        const modal = document.createElement('div');
        modal.className = 'intervention-modal';

        const choicesHtml = intervention.choices.map(choice =>
            `<button class="intervention-choice" data-choice="${choice.value}">${choice.label}</button>`
        ).join('');

        modal.innerHTML = `
            <div class="modal-content">
                <h3>⚠️ 介入が必要です</h3>
                <p class="intervention-reason">${intervention.reason}</p>
                <div class="intervention-choices">
                    ${choicesHtml}
                </div>
            </div>
        `;

        // 選択ボタンのイベントハンドラー
        modal.querySelectorAll('.intervention-choice').forEach(button => {
            button.addEventListener('click', () => {
                const choice = button.dataset.choice;
                this._handleInterventionChoice(intervention, choice);
            });
        });

        return modal;
    }

    /**
     * 介入選択処理
     * @private
     */
    _handleInterventionChoice(intervention, choice) {
        this.eventBus.emit(EVENTS.GOAL_SEEK_INTERVENTION_RESPONDED, {
            interventionId: intervention.id,
            goalId: intervention.goalId,
            choice
        });

        this.hideIntervention();
    }
}

export default GoalSeekView;
