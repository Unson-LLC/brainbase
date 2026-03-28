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

        const startInput = /** @type {HTMLInputElement|null} */ (document.getElementById('add-schedule-start'));
        if (startInput) {
            setTimeout(() => startInput.focus(), 100);
        }
    }

    close() {
        super.close();
        this._clearForm();
    }

    _clearForm() {
        const startInput = /** @type {HTMLInputElement|null} */ (document.getElementById('add-schedule-start'));
        const endInput = /** @type {HTMLInputElement|null} */ (document.getElementById('add-schedule-end'));
        const titleInput = /** @type {HTMLInputElement|null} */ (document.getElementById('add-schedule-title'));

        if (startInput) startInput.value = '';
        if (endInput) endInput.value = '';
        if (titleInput) titleInput.value = '';

        this._hideError(ERROR_ID);
    }

    async save() {
        const startInput = /** @type {HTMLInputElement|null} */ (document.getElementById('add-schedule-start'));
        const endInput = /** @type {HTMLInputElement|null} */ (document.getElementById('add-schedule-end'));
        const titleInput = /** @type {HTMLInputElement|null} */ (document.getElementById('add-schedule-title'));

        const start = startInput?.value?.trim() || '';
        const end = endInput?.value?.trim() || '';
        const title = titleInput?.value?.trim() || '';

        if (!start) {
            this._showError(ERROR_ID, '開始時間は必須です');
            startInput?.focus();
            return;
        }

        if (!title) {
            this._showError(ERROR_ID, 'タイトルは必須です');
            titleInput?.focus();
            return;
        }

        if (end && end < start) {
            this._showError(ERROR_ID, '終了時間は開始時間より後にしてください');
            endInput?.focus();
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
