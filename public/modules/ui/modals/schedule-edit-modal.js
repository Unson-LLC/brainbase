// @ts-check
import { BaseModal } from './base-modal.js';

const ERROR_ID = 'edit-schedule-error';

/**
 * スケジュール編集モーダル
 */
export class ScheduleEditModal extends BaseModal {
    constructor({ scheduleService }) {
        super('edit-schedule-modal');
        this.scheduleService = scheduleService;
        this.currentEventId = null;
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
        this._setVal('edit-schedule-start', event.start || '');
        this._setVal('edit-schedule-end', event.end || '');
        this._setVal('edit-schedule-title', event.title || '');
        this._hideError(ERROR_ID);
        this.modalElement.classList.add('active');
        setTimeout(() => this._focus('edit-schedule-title'), 100);
    }

    close() {
        super.close();
        this.currentEventId = null;
    }

    async save() {
        if (!this.currentEventId) return;

        const start = this._val('edit-schedule-start');
        const end = this._val('edit-schedule-end');
        const title = this._val('edit-schedule-title');

        if (!start) {
            this._showError(ERROR_ID, '開始時間は必須です');
            this._focus('edit-schedule-start');
            return;
        }
        if (!title) {
            this._showError(ERROR_ID, 'タイトルは必須です');
            this._focus('edit-schedule-title');
            return;
        }
        if (end && end < start) {
            this._showError(ERROR_ID, '終了時間は開始時間より後にしてください');
            this._focus('edit-schedule-end');
            return;
        }

        try {
            await this.scheduleService.updateEvent(this.currentEventId, {
                start, end: end || null, title
            });
            this.close();
        } catch (error) {
            console.error('Failed to update schedule event:', error);
            this._showError(ERROR_ID, '予定の更新に失敗しました');
        }
    }

    async delete() {
        if (!this.currentEventId) return;

        const confirmed = window.confirm('この予定を削除しますか？');
        if (!confirmed) return;

        try {
            await this.scheduleService.deleteEvent(this.currentEventId);
            this.close();
        } catch (error) {
            console.error('Failed to delete schedule event:', error);
            this._showError(ERROR_ID, '予定の削除に失敗しました');
        }
    }

    _attachEventHandlers() {
        const saveBtn = /** @type {HTMLInputElement|null} */ (document.getElementById('save-edit-schedule-btn'));
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.save());
        }

        const deleteBtn = /** @type {HTMLInputElement|null} */ (document.getElementById('delete-schedule-btn'));
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => this.delete());
        }

        this._attachEnterKeyHandler('edit-schedule-title', () => this.save());
        this._attachEscapeHandler();
    }

    unmount() {
        super.unmount();
        this.currentEventId = null;
    }
}
