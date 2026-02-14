import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * Goal Seek モーダル
 * 介入要求表示、選択肢ボタン、計算結果詳細、タイムアウト表示を担当
 */
export class GoalSeekModal {
    /**
     * @param {Object} options
     * @param {Object} [options.eventBus] - EventBusインスタンス
     * @param {Function} [options.onCalculate] - 計算開始時のコールバック
     * @param {Object} [options.goalSeekService] - GoalSeekServiceインスタンス
     * @param {Object} [options.browserNotificationService] - BrowserNotificationServiceインスタンス
     */
    constructor({ eventBus: bus = eventBus, onCalculate, goalSeekService, browserNotificationService } = {}) {
        this.eventBus = bus;
        this.onCalculate = onCalculate;
        this.goalSeekService = goalSeekService;
        this.browserNotificationService = browserNotificationService;
        this.modalElement = null;
        this._unsubscribers = [];
        this._timeoutInterval = null;
        this._currentIntervention = null;
    }

    /**
     * モーダルをマウント
     */
    mount() {
        this.modalElement = document.getElementById('goal-seek-modal');
        if (!this.modalElement) {
            console.warn('GoalSeekModal: #goal-seek-modal not found');
            return;
        }

        this._attachEventHandlers();
    }

    /**
     * モーダルを表示
     */
    show() {
        if (!this.modalElement) return;

        this.modalElement.classList.remove('hidden');
        this.eventBus.emit(EVENTS.MODAL_OPENED, { modalId: 'goal-seek-modal' });
    }

    /**
     * モーダルを非表示
     */
    hide() {
        if (!this.modalElement) return;

        this.modalElement.classList.add('hidden');
        this._clearTimeoutInterval();
        this.eventBus.emit(EVENTS.MODAL_CLOSED, { modalId: 'goal-seek-modal' });
    }

    /**
     * フォームパラメータを取得
     * @returns {Object} パラメータオブジェクト
     */
    getParams() {
        const targetInput = document.getElementById('goal-target');
        const currentInput = document.getElementById('goal-current');
        const unitInput = document.getElementById('goal-unit');
        const periodInput = document.getElementById('goal-period');
        const variableInput = document.getElementById('goal-variable');

        return {
            target: targetInput ? parseFloat(targetInput.value) || 0 : 0,
            current: currentInput ? parseFloat(currentInput.value) || 0 : 0,
            unit: unitInput ? unitInput.value : 'yen',
            period: periodInput ? parseInt(periodInput.value, 10) || 0 : 0,
            variable: variableInput ? variableInput.value : 'daily_actions'
        };
    }

    /**
     * フォームバリデーション
     * @returns {{valid: boolean, errors: string[]}}
     */
    validate() {
        const errors = [];

        const targetInput = document.getElementById('goal-target');
        const currentInput = document.getElementById('goal-current');
        const periodInput = document.getElementById('goal-period');

        // 空文字チェック（入力フィールドの値を直接確認）
        const targetValue = targetInput?.value;
        const currentValue = currentInput?.value;
        const periodValue = periodInput?.value;

        // target: 空文字または未定義の場合エラー
        if (targetValue === '' || targetValue === undefined || targetValue === null) {
            errors.push('target is required');
        }

        // current: 空文字または未定義の場合エラー
        if (currentValue === '' || currentValue === undefined || currentValue === null) {
            errors.push('current is required');
        }

        // period: 範囲チェック
        const period = parseInt(periodValue, 10);
        if (isNaN(period) || period < 1 || period > 365) {
            errors.push('period must be between 1 and 365');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * 介入要求を表示
     * @param {Object} intervention - 介入データ
     * @param {string} intervention.title - タイトル
     * @param {string} intervention.message - メッセージ
     * @param {Array} [intervention.options] - 選択肢配列
     * @param {string} [intervention.expiresAt] - 有効期限ISO文字列
     */
    showIntervention(intervention) {
        this._currentIntervention = intervention;

        // XSS対策: textContentを使用
        const titleEl = document.getElementById('intervention-title');
        const messageEl = document.getElementById('intervention-message');

        if (titleEl) {
            titleEl.textContent = intervention.title || '';
        }

        if (messageEl) {
            messageEl.textContent = intervention.message || '';
        }

        // 選択肢ボタンを生成
        this._renderOptions(intervention.options || []);

        // タイムアウト表示開始
        if (intervention.expiresAt) {
            this._startTimeoutDisplay(intervention.expiresAt);
        }

        this.show();
    }

    /**
     * 計算結果詳細を表示
     * @param {Object} calculation - 計算結果
     * @param {number} calculation.gap - ギャップ
     * @param {number} calculation.period - 期間
     * @param {number} calculation.requiredDaily - 1日あたりの必要値
     */
    showCalculationDetails(calculation) {
        const gapEl = document.getElementById('detail-gap');
        const periodEl = document.getElementById('detail-period');
        const dailyEl = document.getElementById('detail-daily');

        if (gapEl) {
            gapEl.textContent = this._formatNumber(calculation.gap);
        }

        if (periodEl) {
            periodEl.textContent = String(calculation.period);
        }

        if (dailyEl) {
            dailyEl.textContent = this._formatNumber(calculation.requiredDaily);
        }
    }

    /**
     * 選択肢ボタンをレンダリング
     * @param {Array} options - 選択肢配列
     * @private
     */
    _renderOptions(options) {
        const container = document.getElementById('intervention-options');
        if (!container) return;

        // 既存のボタンをクリア
        container.innerHTML = '';

        options.forEach(option => {
            const button = document.createElement('button');
            button.className = 'intervention-option-btn btn-secondary';
            button.textContent = option.label; // XSS対策: textContent
            button.dataset.optionId = option.id;

            button.addEventListener('click', () => {
                this._handleOptionSelect(option.id);
            });

            container.appendChild(button);
        });
    }

    /**
     * 選択肢選択ハンドラー
     * @param {string} optionId - 選択されたオプションID
     * @private
     */
    _handleOptionSelect(optionId) {
        this.eventBus.emit(EVENTS.GOAL_SEEK_INTERVENTION_RESPONSE, {
            action: 'option_selected',
            optionId,
            intervention: this._currentIntervention
        });
    }

    /**
     * タイムアウト表示を開始
     * @param {string} expiresAtISO - 有効期限ISO文字列
     * @private
     */
    _startTimeoutDisplay(expiresAtISO) {
        this._clearTimeoutInterval();

        const updateTimeout = () => {
            const now = Date.now();
            const expires = new Date(expiresAtISO).getTime();
            const remaining = Math.max(0, expires - now);

            const timeoutEl = document.getElementById('timeout-value');
            if (timeoutEl) {
                const seconds = Math.ceil(remaining / 1000);
                timeoutEl.textContent = `${seconds}s`;
            }

            if (remaining <= 0) {
                this._clearTimeoutInterval();
                this.eventBus.emit(EVENTS.GOAL_SEEK_INTERVENTION_EXPIRED, {
                    intervention: this._currentIntervention
                });
            }
        };

        updateTimeout();
        this._timeoutInterval = setInterval(updateTimeout, 1000);
    }

    /**
     * タイムアウト表示をクリア
     * @private
     */
    _clearTimeoutInterval() {
        if (this._timeoutInterval) {
            clearInterval(this._timeoutInterval);
            this._timeoutInterval = null;
        }
    }

    /**
     * 数値をフォーマット
     * @param {number} value - 数値
     * @returns {string} フォーマット済み文字列
     * @private
     */
    _formatNumber(value) {
        return new Intl.NumberFormat('en-US').format(value);
    }

    /**
     * イベントハンドラーをアタッチ
     * @private
     */
    _attachEventHandlers() {
        // 閉じるボタン
        const closeBtn = document.getElementById('goal-seek-modal-close');
        if (closeBtn) {
            const handler = () => this.hide();
            closeBtn.addEventListener('click', handler);
            this._unsubscribers.push(() => closeBtn.removeEventListener('click', handler));
        }

        // Submitボタン
        const submitBtn = document.getElementById('goal-seek-modal-submit');
        if (submitBtn) {
            const handler = () => this._handleSubmit();
            submitBtn.addEventListener('click', handler);
            this._unsubscribers.push(() => submitBtn.removeEventListener('click', handler));
        }

        // Proceed ボタン
        const proceedBtn = document.getElementById('intervention-proceed-btn');
        if (proceedBtn) {
            const handler = () => this._handleAction('proceed');
            proceedBtn.addEventListener('click', handler);
            this._unsubscribers.push(() => proceedBtn.removeEventListener('click', handler));
        }

        // Abort ボタン
        const abortBtn = document.getElementById('intervention-abort-btn');
        if (abortBtn) {
            const handler = () => this._handleAction('abort');
            abortBtn.addEventListener('click', handler);
            this._unsubscribers.push(() => abortBtn.removeEventListener('click', handler));
        }

        // Modify ボタン
        const modifyBtn = document.getElementById('intervention-modify-btn');
        if (modifyBtn) {
            const handler = () => this._handleAction('modify');
            modifyBtn.addEventListener('click', handler);
            this._unsubscribers.push(() => modifyBtn.removeEventListener('click', handler));
        }

        // バックドロップクリック
        const backdropHandler = (e) => {
            if (e.target === this.modalElement) {
                this.hide();
            }
        };
        this.modalElement.addEventListener('click', backdropHandler);
        this._unsubscribers.push(() => this.modalElement.removeEventListener('click', backdropHandler));
    }

    /**
     * Submit処理
     * @private
     */
    _handleSubmit() {
        const validation = this.validate();

        if (!validation.valid) {
            console.warn('GoalSeekModal: Validation failed', validation.errors);
            return;
        }

        if (this.onCalculate) {
            const params = this.getParams();
            this.onCalculate(params);
        }

        this.hide();
    }

    /**
     * アクションボタン処理
     * @param {string} action - アクション種別 (proceed, abort, modify)
     * @private
     */
    _handleAction(action) {
        this.eventBus.emit(EVENTS.GOAL_SEEK_INTERVENTION_RESPONSE, {
            action,
            intervention: this._currentIntervention
        });

        this.hide();
    }

    /**
     * クリーンアップ
     */
    unmount() {
        this._clearTimeoutInterval();
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        this.modalElement = null;
        this._currentIntervention = null;
    }
}
