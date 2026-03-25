/**
 * BaseModal - モーダルコンポーネントの共通基底クラス
 *
 * 共通パターンを抽出:
 * - mount/unmount ライフサイクル
 * - 閉じるボタン・バックドロップクリック
 * - エラー表示/非表示
 * - Enterキー・Escapeキーハンドラー
 * - EventBus購読管理
 */
export class BaseModal {
    /**
     * @param {string} modalId - モーダル要素のDOM ID
     */
    constructor(modalId) {
        this._modalId = modalId;
        this.modalElement = null;
        this._unsubscribers = [];
    }

    /**
     * モーダルをマウント（サブクラスでoverrideする場合はsuper.mount()を呼ぶこと）
     */
    mount() {
        this.modalElement = document.getElementById(this._modalId);
        if (!this.modalElement) {
            console.warn(`${this.constructor.name}: #${this._modalId} not found`);
            return;
        }

        this._attachBaseHandlers();
        this._attachEventHandlers();
    }

    /**
     * モーダルを閉じる（サブクラスで追加処理がある場合はoverrideしてsuper.close()を呼ぶ）
     */
    close() {
        if (!this.modalElement) return;
        this.modalElement.classList.remove('active');
    }

    /**
     * クリーンアップ（サブクラスで追加処理がある場合はoverrideしてsuper.unmount()を呼ぶ）
     */
    unmount() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        this.modalElement = null;
    }

    /**
     * エラーを表示
     * @param {string} errorElementId - エラー表示要素のDOM ID
     * @param {string} message - エラーメッセージ
     */
    _showError(errorElementId, message) {
        const el = document.getElementById(errorElementId);
        if (el) {
            el.textContent = message;
            el.style.display = 'block';
        }
    }

    /**
     * エラーを非表示
     * @param {string} errorElementId - エラー表示要素のDOM ID
     */
    _hideError(errorElementId) {
        const el = document.getElementById(errorElementId);
        if (el) {
            el.textContent = '';
            el.style.display = 'none';
        }
    }

    /**
     * 閉じるボタン・バックドロップクリックをアタッチ
     * @private
     */
    _attachBaseHandlers() {
        const closeBtns = this.modalElement.querySelectorAll('.close-modal-btn');
        closeBtns.forEach(btn => {
            btn.addEventListener('click', () => this.close());
        });

        this.modalElement.addEventListener('click', (e) => {
            if (e.target === this.modalElement) {
                this.close();
            }
        });
    }

    /**
     * Enterキーで保存（IME変換中はスキップ）
     * @param {string} inputId - 入力要素のDOM ID
     * @param {Function} callback - Enter時に呼ばれるコールバック
     */
    _attachEnterKeyHandler(inputId, callback) {
        const input = document.getElementById(inputId);
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    callback();
                }
            });
        }
    }

    /**
     * Escapeキーでモーダルを閉じる
     */
    _attachEscapeHandler() {
        this.modalElement.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.close();
            }
        });
    }

    /**
     * EventBus購読を登録（unmount時に自動解除）
     * @param {Function} unsubscriber - 購読解除関数
     */
    _addSubscription(unsubscriber) {
        this._unsubscribers.push(unsubscriber);
    }

    /**
     * サブクラスで実装するイベントハンドラーアタッチ（保存ボタン等）
     * @abstract
     */
    _attachEventHandlers() {
        // サブクラスでoverrideする
    }
}
