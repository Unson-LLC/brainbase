import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * フォーカスエンジン選択モーダル
 */
export class FocusEngineModal {
    constructor() {
        this.modalElement = null;
        this.pendingTask = null;
        this._unsubscribers = [];
    }

    /**
     * モーダルをマウント
     */
    mount() {
        this.modalElement = document.getElementById('focus-engine-modal');
        if (!this.modalElement) {
            console.warn('FocusEngineModal: #focus-engine-modal not found');
            return;
        }

        this._attachEventHandlers();
    }

    /**
     * モーダルを開く
     * @param {Object} task - 実行するタスク
     */
    open(task) {
        if (!this.modalElement) return;

        this.pendingTask = task;
        this.modalElement.classList.add('active');

        // Lucide icons初期化
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    /**
     * モーダルを閉じる
     */
    close() {
        if (!this.modalElement) return;

        this.modalElement.classList.remove('active');
        this.pendingTask = null;
    }

    /**
     * エンジン選択処理
     * @param {string} engine - 選択されたエンジン ('claude' or 'codex')
     */
    _selectEngine(engine) {
        if (!this.pendingTask) return;

        // START_TASKイベントを発行
        eventBus.emit(EVENTS.START_TASK, {
            task: this.pendingTask,
            engine: engine
        });

        // モーダルを閉じる
        this.close();
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

        // バックドロップクリック
        this.modalElement.addEventListener('click', (e) => {
            if (e.target === this.modalElement) {
                this.close();
            }
        });

        // 開始ボタン（ラジオ選択に基づく）
        const startBtn = this.modalElement.querySelector('#focus-engine-start-btn');
        if (startBtn) {
            startBtn.addEventListener('click', () => {
                const selected = this.modalElement.querySelector('input[name="focus-engine"]:checked');
                const engine = selected?.value || 'claude';
                this._selectEngine(engine);
            });
        }

        // 旧UI互換ボタンは廃止（DOM整合チェックで検知されるため）
    }

    /**
     * クリーンアップ
     */
    unmount() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        this.modalElement = null;
        this.pendingTask = null;
    }
}
