// @ts-check
import { BaseModal } from './base-modal.js';

/**
 * タスク編集モーダル
 */
export class TaskEditModal extends BaseModal {
    constructor({ taskService }) {
        super('edit-task-modal');
        this.taskService = taskService;
        this.currentTaskId = null;
    }

    /**
     * モーダルを開く
     * @param {Object} task - 編集するタスク
     */
    open(task) {
        if (!this.modalElement) return;

        this.currentTaskId = task.id;
        this._setVal('edit-task-id', task.id || '');
        this._setVal('edit-task-title', task.name || task.title || '');
        this._setVal('edit-task-project', task.project || '');
        this._setVal('edit-task-priority', task.priority || 'medium');
        this._setVal('edit-task-due', task.due || task.deadline || '');
        this._setVal('edit-task-description', task.description || '');

        this.modalElement.classList.add('active');
    }

    close() {
        super.close();
        this.currentTaskId = null;
    }

    async save() {
        if (!this.currentTaskId) return;

        const updates = {
            title: this._val('edit-task-title'),
            project: this._val('edit-task-project'),
            priority: this._val('edit-task-priority') || 'medium',
            deadline: this._val('edit-task-due') || null,
            description: this._val('edit-task-description')
        };

        try {
            await this.taskService.updateTask(this.currentTaskId, updates);
            this.close();
        } catch (error) {
            console.error('Failed to update task:', error);
        }
    }

    _attachEventHandlers() {
        const saveBtn = /** @type {HTMLInputElement|null} */ (document.getElementById('save-task-btn'));
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.save());
        }
    }

    unmount() {
        super.unmount();
        this.currentTaskId = null;
    }
}
