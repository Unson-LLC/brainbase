import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * Goal Seek表示のUIコンポーネント
 * Dashboard Section 7に表示
 *
 * 機能:
 * - パラメータ入力フォーム (target, period, current, unit)
 * - 計算開始ボタン
 * - 進捗表示プログレスバー
 * - 結果表示エリア
 * - 介入要求時のモーダル起動
 * - EventBus購読 (GOAL_SEEK_* イベント)
 */
export class GoalSeekView {
    constructor({ goalSeekService, modal }) {
        this.goalSeekService = goalSeekService;
        this.modal = modal;
        this.container = null;
        this._unsubscribers = [];
        this._selectedOptionId = null;
        this._currentGoalId = null;
        this._currentIntervention = null;
    }

    /**
     * DOMコンテナにマウント
     * @param {HTMLElement} container - マウント先のコンテナ
     */
    mount(container) {
        this.container = container;
        this._setupEventListeners();
        this.render();
    }

    /**
     * イベントリスナーの設定
     */
    _setupEventListeners() {
        // Goal Seek イベント購読
        const unsub1 = eventBus.on(EVENTS.GOAL_SEEK_PROGRESS, (event) => {
            this._handleProgress(event.detail);
        });

        const unsub2 = eventBus.on(EVENTS.GOAL_SEEK_INTERVENTION_REQUIRED, (event) => {
            this._handleInterventionRequired(event.detail);
        });

        const unsub3 = eventBus.on(EVENTS.GOAL_SEEK_COMPLETED, (event) => {
            this._handleCompleted(event.detail);
        });

        const unsub4 = eventBus.on(EVENTS.GOAL_SEEK_FAILED, (event) => {
            this._handleFailed(event.detail);
        });

        const unsub5 = eventBus.on(EVENTS.GOAL_SEEK_CANCELLED, () => {
            this._handleCancelled();
        });

        this._unsubscribers.push(unsub1, unsub2, unsub3, unsub4, unsub5);
    }

    /**
     * 初期状態をレンダリング
     */
    render() {
        if (!this.container) return;

        this.container.innerHTML = this._getTemplate();
        this._attachEventHandlers();

        // Lucideアイコンを初期化
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    /**
     * HTMLテンプレート取得
     */
    _getTemplate() {
        return `
            <div class="goal-seek-panel">
                <!-- 計算前（初期状態） -->
                <div id="goal-seek-empty" class="goal-seek-empty">
                    <p>目標達成に必要なアクションを逆算します</p>
                    <button id="goal-seek-calculate-btn" class="btn-primary">
                        <i data-lucide="target"></i>
                        計算を開始
                    </button>
                </div>

                <!-- 計算中（進捗表示） -->
                <div id="goal-seek-progress" class="goal-seek-progress hidden">
                    <div class="progress-bar">
                        <div id="goal-seek-progress-bar" class="progress-fill" style="width: 0%"></div>
                    </div>
                    <p id="goal-seek-progress-text">計算中...</p>
                    <button id="goal-seek-cancel-btn" class="btn-secondary">キャンセル</button>
                </div>

                <!-- 介入要求中 -->
                <div id="goal-seek-intervention" class="goal-seek-intervention hidden">
                    <div class="intervention-header">
                        <i data-lucide="alert-circle"></i>
                        <h4 id="intervention-title">選択が必要です</h4>
                    </div>
                    <p id="intervention-message">...</p>
                    <div id="intervention-options" class="intervention-options">
                        <!-- 動的に選択肢を追加 -->
                    </div>
                    <div class="intervention-actions">
                        <button id="intervention-submit-btn" class="btn-primary">送信</button>
                        <button id="intervention-cancel-btn" class="btn-secondary">キャンセル</button>
                    </div>
                </div>

                <!-- 結果表示 -->
                <div id="goal-seek-results" class="goal-seek-results hidden">
                    <div class="result-summary">
                        <div class="result-card">
                            <span class="result-label">必要アクション/日</span>
                            <span id="result-daily-actions" class="result-value">-</span>
                        </div>
                        <div class="result-card">
                            <span class="result-label">達成確率</span>
                            <span id="result-probability" class="result-value">-</span>
                        </div>
                        <div class="result-card">
                            <span class="result-label">差分</span>
                            <span id="result-gap" class="result-value">-</span>
                        </div>
                    </div>
                    <div id="goal-seek-chart" class="result-chart">
                        <!-- グラフ描画エリア（将来実装） -->
                    </div>
                    <button id="goal-seek-recalculate-btn" class="btn-secondary">再計算</button>
                </div>
            </div>
        `;
    }

    /**
     * DOMイベントハンドラーをアタッチ
     */
    _attachEventHandlers() {
        // 計算開始ボタン
        const calculateBtn = this.container.querySelector('#goal-seek-calculate-btn');
        if (calculateBtn) {
            calculateBtn.addEventListener('click', () => {
                this._handleCalculateClick();
            });
        }

        // キャンセルボタン（進捗中）
        const cancelBtn = this.container.querySelector('#goal-seek-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', async () => {
                await this._handleCancelClick();
            });
        }

        // 介入送信ボタン
        const submitBtn = this.container.querySelector('#intervention-submit-btn');
        if (submitBtn) {
            submitBtn.addEventListener('click', async () => {
                await this._handleInterventionSubmit();
            });
        }

        // 介入キャンセルボタン
        const interventionCancelBtn = this.container.querySelector('#intervention-cancel-btn');
        if (interventionCancelBtn) {
            interventionCancelBtn.addEventListener('click', async () => {
                await this._handleInterventionCancel();
            });
        }

        // 再計算ボタン
        const recalcBtn = this.container.querySelector('#goal-seek-recalculate-btn');
        if (recalcBtn) {
            recalcBtn.addEventListener('click', () => {
                this._handleRecalculateClick();
            });
        }
    }

    /**
     * 状態切替（セクション表示/非表示）
     * @param {string} state - 'empty' | 'progress' | 'intervention' | 'results'
     */
    _setState(state) {
        const sections = ['empty', 'progress', 'intervention', 'results'];

        sections.forEach(s => {
            const el = this.container.querySelector(`#goal-seek-${s}`);
            if (el) {
                if (s === state) {
                    el.classList.remove('hidden');
                } else {
                    el.classList.add('hidden');
                }
            }
        });
    }

    // ============================================================
    // イベントハンドラー
    // ============================================================

    /**
     * 計算開始ボタンクリック
     */
    _handleCalculateClick() {
        this.modal.show();
    }

    /**
     * 進捗イベント処理
     */
    _handleProgress(data) {
        this._setState('progress');

        const progressBar = this.container.querySelector('#goal-seek-progress-bar');
        const progressText = this.container.querySelector('#goal-seek-progress-text');

        if (progressBar) {
            progressBar.style.width = `${data.progress}%`;
        }
        if (progressText && data.message) {
            progressText.textContent = data.message;
        }
    }

    /**
     * 介入要求イベント処理
     */
    _handleInterventionRequired(intervention) {
        this._currentIntervention = intervention;
        this._currentGoalId = intervention.goalId;
        this._selectedOptionId = null;

        this._setState('intervention');

        // タイトル更新
        const title = this.container.querySelector('#intervention-title');
        if (title) {
            title.textContent = intervention.title || '選択が必要です';
        }

        // メッセージ更新
        const message = this.container.querySelector('#intervention-message');
        if (message) {
            message.textContent = intervention.message || '';
        }

        // 選択肢レンダリング
        const optionsContainer = this.container.querySelector('#intervention-options');
        if (optionsContainer && intervention.options) {
            optionsContainer.innerHTML = intervention.options.map(opt => `
                <button
                    class="intervention-option"
                    data-option-id="${opt.id}"
                    type="button"
                >
                    <span class="option-label">${opt.label}</span>
                    ${opt.description ? `<span class="option-description">${opt.description}</span>` : ''}
                </button>
            `).join('');

            // 選択肢クリックイベント
            optionsContainer.querySelectorAll('.intervention-option').forEach(btn => {
                btn.addEventListener('click', () => {
                    this._handleOptionSelect(btn.dataset.optionId);
                });
            });
        }

        // Lucideアイコン再初期化
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    /**
     * 選択肢選択処理
     */
    _handleOptionSelect(optionId) {
        // 全選択肢の選択解除
        this.container.querySelectorAll('.intervention-option').forEach(btn => {
            btn.classList.remove('selected');
        });

        // 選択されたオプションをマーク
        const selectedBtn = this.container.querySelector(`[data-option-id="${optionId}"]`);
        if (selectedBtn) {
            selectedBtn.classList.add('selected');
        }

        this._selectedOptionId = optionId;
    }

    /**
     * 完了イベント処理
     */
    _handleCompleted(data) {
        this._setState('results');

        const result = data.result || data;

        // 必要アクション数
        const dailyActions = this.container.querySelector('#result-daily-actions');
        if (dailyActions) {
            dailyActions.textContent = result.requiredDailyActions ?? '-';
        }

        // 達成確率
        const probability = this.container.querySelector('#result-probability');
        if (probability) {
            if (result.achievableProbability != null) {
                probability.textContent = `${Math.round(result.achievableProbability * 100)}%`;
            } else {
                probability.textContent = '-';
            }
        }

        // 差分
        const gap = this.container.querySelector('#result-gap');
        if (gap) {
            if (result.gap != null) {
                gap.textContent = this._formatGap(result.gap);
            } else {
                gap.textContent = '-';
            }
        }

        // クリーンアップ
        this._currentIntervention = null;
        this._currentGoalId = null;
        this._selectedOptionId = null;
    }

    /**
     * 失敗イベント処理
     */
    _handleFailed(data) {
        // 初期状態に戻す
        this._setState('empty');

        // エラーメッセージ表示（必要に応じてトースト等で実装）
        console.error('Goal Seek failed:', data);

        // クリーンアップ
        this._currentIntervention = null;
        this._currentGoalId = null;
        this._selectedOptionId = null;
    }

    /**
     * キャンセルイベント処理
     */
    _handleCancelled() {
        this._setState('empty');

        // クリーンアップ
        this._currentIntervention = null;
        this._currentGoalId = null;
        this._selectedOptionId = null;
    }

    /**
     * キャンセルボタンクリック
     */
    async _handleCancelClick() {
        if (this.goalSeekService) {
            await this.goalSeekService.cancel();
        }
        this._setState('empty');
    }

    /**
     * 介入送信ボタンクリック
     */
    async _handleInterventionSubmit() {
        if (!this._selectedOptionId) {
            console.warn('No option selected');
            return;
        }

        if (this.goalSeekService && this._currentGoalId) {
            await this.goalSeekService.respondToIntervention(this._currentGoalId, {
                selectedOptionId: this._selectedOptionId
            });
        }
    }

    /**
     * 介入キャンセルボタンクリック
     */
    async _handleInterventionCancel() {
        if (this.goalSeekService) {
            await this.goalSeekService.cancel();
        }
        this._setState('empty');

        // クリーンアップ
        this._currentIntervention = null;
        this._currentGoalId = null;
        this._selectedOptionId = null;
    }

    /**
     * 再計算ボタンクリック
     */
    _handleRecalculateClick() {
        this.modal.show();
    }

    // ============================================================
    // ユーティリティ
    // ============================================================

    /**
     * 差分のフォーマット
     */
    _formatGap(gap) {
        const absGap = Math.abs(gap);
        const sign = gap >= 0 ? '' : '-';

        if (absGap >= 100000000) {
            return `${sign}${(absGap / 100000000).toFixed(1)}億円`;
        } else if (absGap >= 10000) {
            return `${sign}${(absGap / 10000).toFixed(0)}万円`;
        } else {
            return `${sign}${absGap.toLocaleString()}円`;
        }
    }

    /**
     * クリーンアップ
     */
    unmount() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        if (this.container) {
            this.container.innerHTML = '';
            this.container = null;
        }

        // 状態リセット
        this._selectedOptionId = null;
        this._currentGoalId = null;
        this._currentIntervention = null;
    }
}
