// @ts-check
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { refreshIcons } from '../../ui-helpers.js';
import { BaseModal } from './base-modal.js';

/**
 * フォーカスエンジン選択モーダル
 */
export class FocusEngineModal extends BaseModal {
    constructor() {
        super('focus-engine-modal');
        this.pendingTask = null;
    }

    /**
     * モーダルを開く
     * @param {Object} task - 実行するタスク
     */
    open(task) {
        if (!this.modalElement) return;

        this.pendingTask = task;
        this.modalElement.classList.add('active');

        refreshIcons();
    }

    close() {
        super.close();
        this.pendingTask = null;
    }

    /**
     * エンジン選択処理
     * @param {string} engine - 選択されたエンジン ('claude' or 'codex')
     */
    _selectEngine(engine) {
        if (!this.pendingTask) return;

        eventBus.emit(EVENTS.START_TASK, {
            task: this.pendingTask,
            engine: engine
        });

        this.close();
    }

    _attachEventHandlers() {
        const startBtn = this.modalElement.querySelector('#focus-engine-start-btn');
        if (startBtn) {
            startBtn.addEventListener('click', () => {
                const selected = /** @type {HTMLInputElement|null} */ (this.modalElement.querySelector('input[name="focus-engine"]:checked'));
                const engine = selected?.value || 'claude';
                this._selectEngine(engine);
            });
        }
    }

    unmount() {
        super.unmount();
        this.pendingTask = null;
    }
}
