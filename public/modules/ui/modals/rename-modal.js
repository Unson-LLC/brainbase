// @ts-check
import { BaseModal } from './base-modal.js';

/**
 * セッション名変更モーダル
 */
export class RenameModal extends BaseModal {
    constructor({ sessionService }) {
        super('rename-session-modal');
        this.sessionService = sessionService;
        this.currentSessionId = null;
        this.isSaving = false;
    }

    /**
     * モーダルを開く
     * @param {Object} session - リネームするセッション
     */
    open(session) {
        if (!this.modalElement) return;

        this.isSaving = false;
        this.currentSessionId = session.id;

        const input = /** @type {HTMLInputElement|null} */ (document.getElementById('rename-session-input'));
        if (input) {
            input.value = session.name || '';
            setTimeout(() => {
                input.focus();
                input.select();
            }, 100);
        }

        this.modalElement.classList.add('active');
    }

    close() {
        super.close();
        this.currentSessionId = null;
    }

    /**
     * セッション名を保存
     */
    async save() {
        if (!this.currentSessionId || this.isSaving) return;

        const input = /** @type {HTMLInputElement|null} */ (document.getElementById('rename-session-input'));
        const newName = input?.value?.trim();

        if (!newName) {
            alert('セッション名を入力してください');
            return;
        }

        this.isSaving = true;
        const sessionId = this.currentSessionId;
        this.close();

        try {
            await this.sessionService.updateSession(sessionId, { name: newName });
        } catch (error) {
            console.error('Failed to rename session:', error);
            alert('セッション名の変更に失敗しました');
        } finally {
            this.isSaving = false;
        }
    }

    _attachEventHandlers() {
        const saveBtn = /** @type {HTMLInputElement|null} */ (document.getElementById('save-rename-btn'));
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.save());
        }

        this._attachEnterKeyHandler('rename-session-input', () => this.save());
    }

    unmount() {
        super.unmount();
        this.currentSessionId = null;
        this.isSaving = false;
    }
}
