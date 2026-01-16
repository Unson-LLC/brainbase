import { EVENTS } from '../../core/event-bus.js';

/**
 * TimelineItemModal
 * タイムライン項目の追加・編集モーダル
 */
export class TimelineItemModal {
    constructor({ timelineService, eventBus }) {
        this.timelineService = timelineService;
        this.eventBus = eventBus;
        this.modalElement = null;
        this.isEditMode = false;
        this.currentItemId = null;
        this._unsubscribers = [];
    }

    /**
     * モーダルをマウント
     */
    mount() {
        this.modalElement = document.getElementById('timeline-item-modal');
        if (!this.modalElement) {
            console.warn('TimelineItemModal: #timeline-item-modal not found');
            return;
        }

        this._attachEventHandlers();
        this._setupEventBusListeners();
    }

    /**
     * 新規作成モードでモーダルを開く
     */
    openForCreate() {
        if (!this.modalElement) return;

        this.isEditMode = false;
        this.currentItemId = null;

        // フォームをクリア
        this._clearForm();

        // タイトル更新
        const titleEl = document.getElementById('timeline-modal-title');
        if (titleEl) {
            titleEl.textContent = 'タイムライン項目を追加';
        }

        // デフォルト値設定
        const typeInput = document.getElementById('timeline-item-type');
        if (typeInput) {
            typeInput.value = 'manual';
        }

        // 現在日時設定
        const timestampInput = document.getElementById('timeline-item-timestamp');
        if (timestampInput) {
            timestampInput.value = this._formatDateTimeLocal(new Date());
        }

        this.modalElement.classList.add('active');
    }

    /**
     * 編集モードでモーダルを開く
     * @param {Object} item - 編集する項目
     */
    openForEdit(item) {
        if (!this.modalElement || !item) return;

        this.isEditMode = true;
        this.currentItemId = item.id;

        // タイトル更新
        const titleEl = document.getElementById('timeline-modal-title');
        if (titleEl) {
            titleEl.textContent = 'タイムライン項目を編集';
        }

        // フォームに値を設定
        const idInput = document.getElementById('timeline-item-id');
        const titleInput = document.getElementById('timeline-item-title');
        const typeInput = document.getElementById('timeline-item-type');
        const contentInput = document.getElementById('timeline-item-content');
        const timestampInput = document.getElementById('timeline-item-timestamp');

        if (idInput) idInput.value = item.id || '';
        if (titleInput) titleInput.value = item.title || '';
        if (typeInput) typeInput.value = item.type || 'manual';
        if (contentInput) contentInput.value = item.content || '';
        if (timestampInput && item.timestamp) {
            timestampInput.value = this._formatDateTimeLocal(new Date(item.timestamp));
        }

        this.modalElement.classList.add('active');
    }

    /**
     * モーダルを閉じる
     */
    close() {
        if (!this.modalElement) return;

        this.modalElement.classList.remove('active');
        this.currentItemId = null;
        this._clearValidationErrors();
    }

    /**
     * 保存処理
     */
    async save() {
        // バリデーション
        if (!this._validate()) {
            return;
        }

        const titleInput = document.getElementById('timeline-item-title');
        const typeInput = document.getElementById('timeline-item-type');
        const contentInput = document.getElementById('timeline-item-content');
        const timestampInput = document.getElementById('timeline-item-timestamp');

        const data = {
            title: titleInput?.value?.trim() || '',
            type: typeInput?.value || 'manual',
            content: contentInput?.value?.trim() || '',
            timestamp: timestampInput?.value ? new Date(timestampInput.value).toISOString() : new Date().toISOString()
        };

        try {
            if (this.isEditMode && this.currentItemId) {
                await this.timelineService.updateItem(this.currentItemId, data);
            } else {
                await this.timelineService.createItem(data);
            }
            this.close();
        } catch (error) {
            console.error('Failed to save timeline item:', error);
        }
    }

    /**
     * フォームをクリア
     * @private
     */
    _clearForm() {
        const idInput = document.getElementById('timeline-item-id');
        const titleInput = document.getElementById('timeline-item-title');
        const typeInput = document.getElementById('timeline-item-type');
        const contentInput = document.getElementById('timeline-item-content');
        const timestampInput = document.getElementById('timeline-item-timestamp');

        if (idInput) idInput.value = '';
        if (titleInput) titleInput.value = '';
        if (typeInput) typeInput.value = 'manual';
        if (contentInput) contentInput.value = '';
        if (timestampInput) timestampInput.value = '';

        this._clearValidationErrors();
    }

    /**
     * バリデーション
     * @returns {boolean} バリデーション結果
     * @private
     */
    _validate() {
        this._clearValidationErrors();

        const titleInput = document.getElementById('timeline-item-title');
        const title = titleInput?.value?.trim() || '';

        if (!title) {
            if (titleInput) {
                titleInput.classList.add('error');
            }
            return false;
        }

        return true;
    }

    /**
     * バリデーションエラーをクリア
     * @private
     */
    _clearValidationErrors() {
        const titleInput = document.getElementById('timeline-item-title');
        if (titleInput) {
            titleInput.classList.remove('error');
        }
    }

    /**
     * 日時をdatetime-local形式にフォーマット
     * @param {Date} date - 日付
     * @returns {string} YYYY-MM-DDTHH:MM形式
     * @private
     */
    _formatDateTimeLocal(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    /**
     * DOMイベントハンドラーをアタッチ
     * @private
     */
    _attachEventHandlers() {
        // 閉じるボタン
        const closeBtns = this.modalElement.querySelectorAll('.close-modal-btn');
        closeBtns.forEach(btn => {
            btn.addEventListener('click', () => this.close());
        });

        // 保存ボタン
        const saveBtn = document.getElementById('save-timeline-item-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.save());
        }

        // バックドロップクリック
        this.modalElement.addEventListener('click', (e) => {
            if (e.target === this.modalElement) {
                this.close();
            }
        });
    }

    /**
     * EventBusリスナーを設定
     * @private
     */
    _setupEventBusListeners() {
        const unsub1 = this.eventBus.on(EVENTS.TIMELINE_ADD_ITEM, () => {
            this.openForCreate();
        });

        const unsub2 = this.eventBus.on(EVENTS.TIMELINE_EDIT_ITEM, (event) => {
            const { item } = event.detail;
            if (item) {
                this.openForEdit(item);
            }
        });

        this._unsubscribers.push(unsub1, unsub2);
    }

    /**
     * クリーンアップ
     */
    unmount() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        this.modalElement = null;
        this.currentItemId = null;
    }
}
