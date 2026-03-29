// @ts-check
import { BaseModal } from './base-modal.js';

const ERROR_ID = 'add-schedule-error';

/**
 * スケジュール追加モーダル
 */
export class ScheduleAddModal extends BaseModal {
    constructor({ scheduleService }) {
        super('add-schedule-modal');
        this.scheduleService = scheduleService;
    }

    open() {
        if (!this.modalElement) return;
        this._clearForm();
        this.modalElement.classList.add('active');
        setTimeout(() => this._focus('add-schedule-start'), 100);
    }

    close() {
        super.close();
        this._clearForm();
    }

    _clearForm() {
        this._setVal('add-schedule-start', '');
        this._setVal('add-schedule-end', '');
        this._setVal('add-schedule-title', '');
        this._hideError(ERROR_ID);
    }

    async save() {
        const start = this._val('add-schedule-start');
        const end = this._val('add-schedule-end');
        const title = this._val('add-schedule-title');

        if (!start) {
            this._showError(ERROR_ID, '開始時間は必須です');
            this._focus('add-schedule-start');
            return;
        }
        if (!title) {
            this._showError(ERROR_ID, 'タイトルは必須です');
            this._focus('add-schedule-title');
            return;
        }
        if (end && end < start) {
            this._showError(ERROR_ID, '終了時間は開始時間より後にしてください');
            this._focus('add-schedule-end');
            return;
        }

        try {
            await this.scheduleService.addEvent({ start, end: end || null, title });
            this.close();
        } catch (error) {
            console.error('Failed to add schedule event:', error);
            this._showError(ERROR_ID, '予定の追加に失敗しました');
        }
    }

    _attachEventHandlers() {
        const saveBtn = /** @type {HTMLInputElement|null} */ (document.getElementById('save-add-schedule-btn'));
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.save());
        }

        this._attachEnterKeyHandler('add-schedule-title', () => this.save());
        this._attachEscapeHandler();
    }
}
