/**
 * スケジュール編集モーダル
 */
export class ScheduleEditModal {
    constructor({ scheduleService }) {
        this.scheduleService = scheduleService;
        this.modalElement = null;
        this.currentEventId = null;
    }

    /**
     * モーダルをマウント
     */
    mount() {
        this.modalElement = document.getElementById('edit-schedule-modal');
        if (!this.modalElement) {
            console.warn('ScheduleEditModal: #edit-schedule-modal not found');
            return;
        }

        this._attachEventHandlers();
    }

    /**
     * モーダルを開く
     * @param {string} eventId - 編集するイベントのID
     */
    open(eventId) {
        if (!this.modalElement) return;

        const event = this.scheduleService.findEventById(eventId);
        if (!event) {
            console.error('ScheduleEditModal: Event not found:', eventId);
            return;
        }

        this.currentEventId = eventId;

        // フォームに値を設定
        const startInput = document.getElementById('edit-schedule-start');
        const endInput = document.getElementById('edit-schedule-end');
        const titleInput = document.getElementById('edit-schedule-title');

        if (startInput) startInput.value = event.start || '';
        if (endInput) endInput.value = event.end || '';
        if (titleInput) titleInput.value = event.title || '';

        this._hideError();

        // モーダルを表示
        this.modalElement.classList.add('active');

        // タイトル入力にフォーカス
        if (titleInput) {
            setTimeout(() => titleInput.focus(), 100);
        }
    }

    /**
     * モーダルを閉じる
     */
    close() {
        if (!this.modalElement) return;

        this.modalElement.classList.remove('active');
        this.currentEventId = null;
    }

    /**
     * イベントを保存
     */
    async save() {
        if (!this.currentEventId) return;

        const startInput = document.getElementById('edit-schedule-start');
        const endInput = document.getElementById('edit-schedule-end');
        const titleInput = document.getElementById('edit-schedule-title');

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

        if (end && end < start) {
            this._showError('終了時間は開始時間より後にしてください');
            endInput?.focus();
            return;
        }

        const updates = {
            start,
            end: end || null,
            title
        };

        try {
            await this.scheduleService.updateEvent(this.currentEventId, updates);
            this.close();
        } catch (error) {
            console.error('Failed to update schedule event:', error);
            this._showError('予定の更新に失敗しました');
        }
    }

    /**
     * イベントを削除
     */
    async delete() {
        if (!this.currentEventId) return;

        // 確認ダイアログ
        const confirmed = window.confirm('この予定を削除しますか？');
        if (!confirmed) return;

        try {
            await this.scheduleService.deleteEvent(this.currentEventId);
            this.close();
        } catch (error) {
            console.error('Failed to delete schedule event:', error);
            this._showError('予定の削除に失敗しました');
        }
    }

    /**
     * エラーを表示
     * @param {string} message
     */
    _showError(message) {
        const errorElement = document.getElementById('edit-schedule-error');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
    }

    /**
     * エラーを非表示
     */
    _hideError() {
        const errorElement = document.getElementById('edit-schedule-error');
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
        const saveBtn = document.getElementById('save-edit-schedule-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.save());
        }

        // 削除ボタン
        const deleteBtn = document.getElementById('delete-schedule-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => this.delete());
        }

        // バックドロップクリック
        this.modalElement.addEventListener('click', (e) => {
            if (e.target === this.modalElement) {
                this.close();
            }
        });

        // Enterキーで保存
        // IME変換中（isComposing）はスキップ
        const titleInput = document.getElementById('edit-schedule-title');
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
        this.currentEventId = null;
    }
}
