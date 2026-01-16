/**
 * スケジュール追加モーダル
 */
export class ScheduleAddModal {
    constructor({ scheduleService }) {
        this.scheduleService = scheduleService;
        this.modalElement = null;
    }

    /**
     * モーダルをマウント
     */
    mount() {
        this.modalElement = document.getElementById('add-schedule-modal');
        if (!this.modalElement) {
            console.warn('ScheduleAddModal: #add-schedule-modal not found');
            return;
        }

        this._attachEventHandlers();
    }

    /**
     * モーダルを開く
     */
    open() {
        if (!this.modalElement) return;

        // フォームをクリア
        this._clearForm();

        // モーダルを表示
        this.modalElement.classList.add('active');

        // 開始時間入力にフォーカス
        const startInput = document.getElementById('add-schedule-start');
        if (startInput) {
            setTimeout(() => startInput.focus(), 100);
        }
    }

    /**
     * モーダルを閉じる
     */
    close() {
        if (!this.modalElement) return;

        this.modalElement.classList.remove('active');
        this._clearForm();
    }

    /**
     * フォームをクリア
     */
    _clearForm() {
        const startInput = document.getElementById('add-schedule-start');
        const endInput = document.getElementById('add-schedule-end');
        const titleInput = document.getElementById('add-schedule-title');

        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';
        if (titleInput) titleInput.value = '';

        this._hideError();
    }

    /**
     * スケジュールを保存
     */
    async save() {
        const startInput = document.getElementById('add-schedule-start');
        const endInput = document.getElementById('add-schedule-end');
        const titleInput = document.getElementById('add-schedule-title');

        const start = startInput?.value?.trim() || '';
        const end = endInput?.value?.trim() || '';
        const title = titleInput?.value?.trim() || '';

        // バリデーション
        if (!start) {
            this._showError('開始時間は必須です');
            startInput?.focus();
            return;
        }

        if (!title) {
            this._showError('タイトルは必須です');
            titleInput?.focus();
            return;
        }

        // 終了時間が開始時間より前でないかチェック
        if (end && end < start) {
            this._showError('終了時間は開始時間より後にしてください');
            endInput?.focus();
            return;
        }

        const eventData = {
            start,
            end: end || null,
            title
        };

        try {
            await this.scheduleService.addEvent(eventData);
            this.close();
        } catch (error) {
            console.error('Failed to add schedule event:', error);
            this._showError('予定の追加に失敗しました');
        }
    }

    /**
     * エラーを表示
     * @param {string} message
     */
    _showError(message) {
        const errorElement = document.getElementById('add-schedule-error');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
    }

    /**
     * エラーを非表示
     */
    _hideError() {
        const errorElement = document.getElementById('add-schedule-error');
        if (errorElement) {
            errorElement.textContent = '';
            errorElement.style.display = 'none';
        }
    }

    /**
     * イベントハンドラーをアタッチ
     */
    _attachEventHandlers() {
        // 閉じるボタン
        const closeBtns = this.modalElement.querySelectorAll('.close-modal-btn');
        closeBtns.forEach(btn => {
            btn.addEventListener('click', () => this.close());
        });

        // 保存ボタン
        const saveBtn = document.getElementById('save-add-schedule-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.save());
        }

        // バックドロップクリック
        this.modalElement.addEventListener('click', (e) => {
            if (e.target === this.modalElement) {
                this.close();
            }
        });

        // Enterキーで保存
        // IME変換中（isComposing）はスキップ
        const titleInput = document.getElementById('add-schedule-title');
        if (titleInput) {
            titleInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    this.save();
                }
            });
        }

        // Escapeキーで閉じる
        this.modalElement.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.close();
            }
        });
    }

    /**
     * クリーンアップ
     */
    unmount() {
        this.modalElement = null;
    }
}
