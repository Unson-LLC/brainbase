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

        const idInput = /** @type {HTMLInputElement|null} */ (document.getElementById('edit-task-id'));
        const titleInput = /** @type {HTMLInputElement|null} */ (document.getElementById('edit-task-title'));
        const projectInput = /** @type {HTMLInputElement|null} */ (document.getElementById('edit-task-project'));
        const priorityInput = /** @type {HTMLInputElement|null} */ (document.getElementById('edit-task-priority'));
        const dueInput = /** @type {HTMLInputElement|null} */ (document.getElementById('edit-task-due'));
        const descriptionInput = /** @type {HTMLInputElement|null} */ (document.getElementById('edit-task-description'));

        const taskName = task.name || task.title || '';
        const taskDue = task.due || task.deadline || '';

        if (idInput) idInput.value = task.id || '';
        if (titleInput) titleInput.value = taskName;
        if (projectInput) projectInput.value = task.project || '';
        if (priorityInput) priorityInput.value = task.priority || 'medium';
        if (dueInput) dueInput.value = taskDue;
        if (descriptionInput) descriptionInput.value = task.description || '';

        this.modalElement.classList.add('active');
    }

    close() {
        super.close();
        this.currentTaskId = null;
    }

    async save() {
        if (!this.currentTaskId) return;

        const titleInput = /** @type {HTMLInputElement|null} */ (document.getElementById('edit-task-title'));
        const projectInput = /** @type {HTMLInputElement|null} */ (document.getElementById('edit-task-project'));
        const priorityInput = /** @type {HTMLInputElement|null} */ (document.getElementById('edit-task-priority'));
        const dueInput = /** @type {HTMLInputElement|null} */ (document.getElementById('edit-task-due'));
        const descriptionInput = /** @type {HTMLInputElement|null} */ (document.getElementById('edit-task-description'));

        const updates = {
            title: titleInput?.value || '',
            project: projectInput?.value || '',
            priority: priorityInput?.value || 'medium',
            deadline: dueInput?.value || null,
            description: descriptionInput?.value || ''
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
