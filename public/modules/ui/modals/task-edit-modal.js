import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * タスク編集モーダル
 */
export class TaskEditModal {
    constructor({ taskService }) {
        this.taskService = taskService;
        this.modalElement = null;
        this.currentTaskId = null;
        this._unsubscribers = [];
    }

    /**
     * モーダルをマウント
     */
    mount() {
        this.modalElement = document.getElementById('edit-task-modal');
        if (!this.modalElement) {
            console.warn('TaskEditModal: #edit-task-modal not found');
            return;
        }

        this._attachEventHandlers();
    }

    /**
     * モーダルを開く
     * @param {Object} task - 編集するタスク
     */
    open(task) {
        if (!this.modalElement) return;

        this.currentTaskId = task.id;

        // フォームに値を設定
        const idInput = document.getElementById('edit-task-id');
        const titleInput = document.getElementById('edit-task-title');
        const projectInput = document.getElementById('edit-task-project');
        const priorityInput = document.getElementById('edit-task-priority');
        const dueInput = document.getElementById('edit-task-due');

        if (idInput) idInput.value = task.id || '';
        if (titleInput) titleInput.value = task.name || '';
        if (projectInput) projectInput.value = task.project || '';
        if (priorityInput) priorityInput.value = task.priority || '';
        if (dueInput) dueInput.value = task.due || '';

        // モーダルを表示
        this.modalElement.classList.add('active');
    }

    /**
     * モーダルを閉じる
     */
    close() {
        if (!this.modalElement) return;

        this.modalElement.classList.remove('active');
        this.currentTaskId = null;
    }

    /**
     * タスクを保存
     */
    async save() {
        if (!this.currentTaskId) return;

        const titleInput = document.getElementById('edit-task-title');
        const projectInput = document.getElementById('edit-task-project');
        const priorityInput = document.getElementById('edit-task-priority');
        const dueInput = document.getElementById('edit-task-due');

        const updates = {
            name: titleInput?.value || '',
            project: projectInput?.value || '',
            priority: priorityInput?.value || '',
            due: dueInput?.value || null
        };

        try {
            await this.taskService.updateTask(this.currentTaskId, updates);
            this.close();
        } catch (error) {
            console.error('Failed to update task:', error);
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
        const saveBtn = document.getElementById('save-task-btn');
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
     * クリーンアップ
     */
    unmount() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        this.modalElement = null;
        this.currentTaskId = null;
    }
}
