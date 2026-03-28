// @ts-check
import { EVENTS } from '../../core/event-bus.js';
import { BaseModal } from './base-modal.js';

/**
 * TimelineItemModal
 * タイムライン項目の追加・編集モーダル
 */
export class TimelineItemModal extends BaseModal {
    constructor({ timelineService, eventBus }) {
        super('timeline-item-modal');
        this.timelineService = timelineService;
        this.eventBus = eventBus;
        this.isEditMode = false;
        this.currentItemId = null;
    }

    mount() {
        super.mount();
        if (!this.modalElement) return;
        this._setupEventBusListeners();
    }

    openForCreate() {
        if (!this.modalElement) return;

        this.isEditMode = false;
        this.currentItemId = null;
        this._clearForm();

        const titleEl = /** @type {HTMLInputElement|null} */ (document.getElementById('timeline-modal-title'));
        if (titleEl) {
            titleEl.textContent = 'タイムライン項目を追加';
        }

        const typeInput = /** @type {HTMLInputElement|null} */ (document.getElementById('timeline-item-type'));
        if (typeInput) {
            typeInput.value = 'manual';
        }

        const timestampInput = /** @type {HTMLInputElement|null} */ (document.getElementById('timeline-item-timestamp'));
        if (timestampInput) {
            timestampInput.value = this._formatDateTimeLocal(new Date());
        }

        this.modalElement.classList.add('active');
    }

    openForEdit(item) {
        if (!this.modalElement || !item) return;

        this.isEditMode = true;
        this.currentItemId = item.id;

        const titleEl = /** @type {HTMLInputElement|null} */ (document.getElementById('timeline-modal-title'));
        if (titleEl) {
            titleEl.textContent = 'タイムライン項目を編集';
        }

        const idInput = /** @type {HTMLInputElement|null} */ (document.getElementById('timeline-item-id'));
        const titleInput = /** @type {HTMLInputElement|null} */ (document.getElementById('timeline-item-title'));
        const typeInput = /** @type {HTMLInputElement|null} */ (document.getElementById('timeline-item-type'));
        const contentInput = /** @type {HTMLInputElement|null} */ (document.getElementById('timeline-item-content'));
        const timestampInput = /** @type {HTMLInputElement|null} */ (document.getElementById('timeline-item-timestamp'));

        if (idInput) idInput.value = item.id || '';
        if (titleInput) titleInput.value = item.title || '';
        if (typeInput) typeInput.value = item.type || 'manual';
        if (contentInput) contentInput.value = item.content || '';
        if (timestampInput && item.timestamp) {
            timestampInput.value = this._formatDateTimeLocal(new Date(item.timestamp));
        }

        this.modalElement.classList.add('active');
    }

    close() {
        super.close();
        this.currentItemId = null;
        this._clearValidationErrors();
    }

    async save() {
        if (!this._validate()) return;

        const titleInput = /** @type {HTMLInputElement|null} */ (document.getElementById('timeline-item-title'));
        const typeInput = /** @type {HTMLInputElement|null} */ (document.getElementById('timeline-item-type'));
        const contentInput = /** @type {HTMLInputElement|null} */ (document.getElementById('timeline-item-content'));
        const timestampInput = /** @type {HTMLInputElement|null} */ (document.getElementById('timeline-item-timestamp'));

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

    _clearForm() {
        const ids = ['timeline-item-id', 'timeline-item-title', 'timeline-item-content', 'timeline-item-timestamp'];
        ids.forEach(id => {
            const el = /** @type {HTMLInputElement|null} */ (document.getElementById(id));
            if (el) el.value = '';
        });

        const typeInput = /** @type {HTMLInputElement|null} */ (document.getElementById('timeline-item-type'));
        if (typeInput) typeInput.value = 'manual';

        this._clearValidationErrors();
    }

    _validate() {
        this._clearValidationErrors();

        const titleInput = /** @type {HTMLInputElement|null} */ (document.getElementById('timeline-item-title'));
        const title = titleInput?.value?.trim() || '';

        if (!title) {
            if (titleInput) titleInput.classList.add('error');
            return false;
        }

        return true;
    }

    _clearValidationErrors() {
        const titleInput = /** @type {HTMLInputElement|null} */ (document.getElementById('timeline-item-title'));
        if (titleInput) titleInput.classList.remove('error');
    }

    _formatDateTimeLocal(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    _attachEventHandlers() {
        const saveBtn = /** @type {HTMLInputElement|null} */ (document.getElementById('save-timeline-item-btn'));
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.save());
        }
    }

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

        this._addSubscription(unsub1);
        this._addSubscription(unsub2);
    }

    unmount() {
        super.unmount();
        this.currentItemId = null;
    }
}
