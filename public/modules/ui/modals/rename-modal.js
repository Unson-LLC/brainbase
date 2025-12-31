import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * セッション名変更モーダル
 */
export class RenameModal {
    constructor({ sessionService }) {
        this.sessionService = sessionService;
        this.modalElement = null;
        this.currentSessionId = null;
    }

    /**
     * モーダルをマウント
     */
    mount() {
        this.modalElement = document.getElementById('rename-session-modal');
        if (!this.modalElement) {
            console.warn('RenameModal: #rename-session-modal not found');
            return;
        }
        this._attachEventHandlers();
    }

    /**
     * モーダルを開く
     * @param {Object} session - リネームするセッション
     */
    open(session) {
        if (!this.modalElement) return;

        this.currentSessionId = session.id;

        const input = document.getElementById('rename-session-input');
        if (input) {
            input.value = session.name || '';
            // フォーカスして全選択
            setTimeout(() => {
                input.focus();
                input.select();
            }, 100);
        }

        this.modalElement.classList.add('active');
    }

    /**
     * モーダルを閉じる
     */
    close() {
        if (!this.modalElement) return;
        this.modalElement.classList.remove('active');
        this.currentSessionId = null;
    }

    /**
     * セッション名を保存
     */
    async save() {
        if (!this.currentSessionId) return;

        const input = document.getElementById('rename-session-input');
        const newName = input?.value?.trim();

        if (!newName) {
            alert('セッション名を入力してください');
            return;
        }

        try {
            await this.sessionService.updateSession(this.currentSessionId, { name: newName });
            this.close();
        } catch (error) {
            console.error('Failed to rename session:', error);
            alert('セッション名の変更に失敗しました');
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
        const saveBtn = document.getElementById('save-rename-btn');
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
        const input = document.getElementById('rename-session-input');
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.save();
                }
            });
        }
    }

    /**
     * クリーンアップ
     */
    unmount() {
        this.modalElement = null;
        this.currentSessionId = null;
    }
}
