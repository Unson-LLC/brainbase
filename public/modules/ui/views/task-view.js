import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { refreshIcons } from '../../ui-helpers.js';
import { BaseView } from './base-view.js';

/**
 * タスク表示のUIコンポーネント
 */
export class TaskView extends BaseView {
    constructor({ taskService }) {
        super();
        this.taskService = taskService;
    }

    _setupEventListeners() {
        this._addSubscriptions(
            eventBus.on(EVENTS.TASK_LOADED, () => this.render()),
            eventBus.on(EVENTS.TASK_COMPLETED, () => this.render()),
            eventBus.on(EVENTS.TASK_FILTER_CHANGED, () => this.render()),
            eventBus.on(EVENTS.TASK_UPDATED, () => this.render())
        );
    }

    render() {
        if (!this.container) return;

        const focusTask = this.taskService.getFocusTask();

        if (!focusTask) {
            this.container.innerHTML = `
                <div class="focus-empty">
                    <i data-lucide="check-circle-2"></i>
                    <div>タスクなし</div>
                </div>
            `;
            return;
        }

        this.container.innerHTML = this._renderFocusTask(focusTask);
        refreshIcons();
        this._attachEventHandlers();
    }

    _renderFocusTask(task) {
        const isUrgent = task.due && new Date(task.due) <= new Date(Date.now() + 24 * 60 * 60 * 1000);
        const dueText = task.due ? this._formatDueDate(task.due) : '';
        const isInProgress = task.status === 'in-progress' || task.status === 'in_progress' || task.status === 'doing';

        const startOrRestoreButton = isInProgress
            ? `<button class="focus-btn-restore" data-id="${task.id}">
                   <i data-lucide="undo-2"></i> 戻す
               </button>`
            : `<button class="focus-btn-start" data-id="${task.id}">
                   <i data-lucide="terminal-square"></i> 開始
               </button>`;

        return `
            <div class="focus-card ${isInProgress ? 'in-progress' : ''}" data-task-id="${task.id}">
                <div class="focus-card-title">${task.name || task.title}</div>
                <div class="focus-card-meta">
                    <span class="project-tag">${task.project || 'general'}</span>
                    ${isInProgress ? '<span class="status-tag in-progress">進行中</span>' : ''}
                    ${dueText ? `<span class="due-tag ${isUrgent ? 'urgent' : ''}"><i data-lucide="clock"></i>${dueText}</span>` : ''}
                </div>
                <div class="focus-card-actions">
                    ${startOrRestoreButton}
                    <button class="focus-btn-complete" data-id="${task.id}">
                        <i data-lucide="check"></i> 完了
                    </button>
                    <button class="focus-btn-defer" data-id="${task.id}">
                        <i data-lucide="arrow-right"></i> 後で
                    </button>
                </div>
            </div>
        `;
    }

    _formatDueDate(dueStr) {
        const due = new Date(dueStr);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const dueDate = new Date(due);
        dueDate.setHours(0, 0, 0, 0);

        if (dueDate.getTime() === today.getTime()) return '今日';
        if (dueDate.getTime() === tomorrow.getTime()) return '明日';

        const month = due.getMonth() + 1;
        const day = due.getDate();
        return `${month}/${day}`;
    }

    _renderTask(task) {
        return `
            <div class="task-item" data-task-id="${task.id}">
                <div class="task-content">
                    <h4>${task.name || task.title}</h4>
                    ${task.description ? `<p>${task.description}</p>` : ''}
                </div>
                <button
                    class="complete-btn"
                    data-action="complete"
                >
                    完了
                </button>
            </div>
        `;
    }

    _attachEventHandlers() {
        const focusCompleteBtn = this.container.querySelector('.focus-btn-complete');
        if (focusCompleteBtn) {
            focusCompleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const taskId = focusCompleteBtn.dataset.id;
                if (taskId) {
                    await this.taskService.completeTask(taskId);
                }
            });
        }

        const focusDeferBtn = this.container.querySelector('.focus-btn-defer');
        if (focusDeferBtn) {
            focusDeferBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const taskId = focusDeferBtn.dataset.id;
                if (taskId && this.taskService.deferTask) {
                    await this.taskService.deferTask(taskId);
                }
            });
        }

        const focusStartBtn = this.container.querySelector('.focus-btn-start');
        if (focusStartBtn) {
            focusStartBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const taskId = focusStartBtn.dataset.id;
                const task = this.taskService.getFocusTask();
                if (task && task.id === taskId) {
                    eventBus.emit(EVENTS.START_TASK, { task });
                }
            });
        }

        const focusRestoreBtn = this.container.querySelector('.focus-btn-restore');
        if (focusRestoreBtn) {
            focusRestoreBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const taskId = focusRestoreBtn.dataset.id;
                if (taskId) {
                    await this.taskService.updateTask(taskId, { status: 'todo' });
                }
            });
        }

        this.container.querySelectorAll('[data-action="complete"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const taskItem = e.target.closest('[data-task-id]');
                const taskId = taskItem?.dataset.taskId;
                if (taskId) {
                    await this.taskService.completeTask(taskId);
                }
            });
        });
    }
}
