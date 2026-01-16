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
        const descriptionInput = document.getElementById('edit-task-description');

        const taskName = task.name || task.title || '';
        const taskDue = task.due || task.deadline || '';

        if (idInput) idInput.value = task.id || '';
        if (titleInput) titleInput.value = taskName;
        if (projectInput) projectInput.value = task.project || '';
        if (priorityInput) priorityInput.value = task.priority || 'medium';
        if (dueInput) dueInput.value = taskDue;
        if (descriptionInput) descriptionInput.value = task.description || '';

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
        console.log('[TaskEditModal] save() called, taskId:', this.currentTaskId);
        if (!this.currentTaskId) {
            console.warn('[TaskEditModal] No currentTaskId, returning');
            return;
        }

        const titleInput = document.getElementById('edit-task-title');
        const projectInput = document.getElementById('edit-task-project');
        const priorityInput = document.getElementById('edit-task-priority');
        const dueInput = document.getElementById('edit-task-due');
        const descriptionInput = document.getElementById('edit-task-description');

        // サーバー側の許可フィールドに合わせたキー名で送信
        const updates = {
            title: titleInput?.value || '',
            project: projectInput?.value || '',
            priority: priorityInput?.value || 'medium',
            deadline: dueInput?.value || null,
            description: descriptionInput?.value || ''
        };

        console.log('[TaskEditModal] updates:', updates);

        try {
            const result = await this.taskService.updateTask(this.currentTaskId, updates);
            console.log('[TaskEditModal] updateTask result:', result);
            this.close();
        } catch (error) {
            console.error('[TaskEditModal] Failed to update task:', error);
        }
    }

    /**
     * イベントハンドラーをアタッチ
     */
    _attachEventHandlers() {
        console.log('[TaskEditModal] _attachEventHandlers called');

        // 閉じるボタン
        const closeBtns = this.modalElement.querySelectorAll('.close-modal-btn');
        closeBtns.forEach(btn => {
            btn.addEventListener('click', () => this.close());
        });

        // 保存ボタン
        const saveBtn = document.getElementById('save-task-btn');
        console.log('[TaskEditModal] saveBtn found:', !!saveBtn);
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                console.log('[TaskEditModal] Save button clicked');
                this.save();
            });
        } else {
            console.error('[TaskEditModal] #save-task-btn not found!');
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
