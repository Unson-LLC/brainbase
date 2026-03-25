import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { refreshIcons } from '../../ui-helpers.js';
import { isTaskInProgress } from '../../utils/task-filters.js';
import { BaseView } from './base-view.js';

/**
 * Next Tasks表示のUIコンポーネント
 */
export class NextTasksView extends BaseView {
    constructor({ taskService }) {
        super();
        this.taskService = taskService;
        this.showAll = false;
    }

    _setupEventListeners() {
        this._addSubscriptions(
            eventBus.on(EVENTS.TASK_LOADED, () => this.render()),
            eventBus.on(EVENTS.TASK_COMPLETED, () => this.render()),
            eventBus.on(EVENTS.TASK_DELETED, () => this.render()),
            eventBus.on(EVENTS.TASK_FILTER_CHANGED, () => this.render()),
            eventBus.on(EVENTS.TASK_UPDATED, () => this.render())
        );
    }

    render() {
        if (!this.container) return;

        const result = this.taskService.getNextTasks({ showAll: this.showAll });
        const { tasks, remainingCount } = result;

        if (tasks.length === 0) {
            this.container.innerHTML = '<div class="timeline-empty">他のタスクなし</div>';
            this._hideRemainingToggle();
            return;
        }

        let html = '';
        tasks.forEach(task => {
            html += this._renderNextTaskItem(task);
        });

        this.container.innerHTML = html;
        refreshIcons();
        this._updateRemainingToggle(remainingCount);
        this._attachEventHandlers();
    }

    _updateRemainingToggle(remainingCount) {
        const toggleEl = document.getElementById('remaining-tasks-toggle');
        const countEl = document.getElementById('remaining-count');

        if (remainingCount > 0 && !this.showAll) {
            if (toggleEl) toggleEl.style.display = 'block';
            if (countEl) countEl.textContent = remainingCount;
        } else {
            if (toggleEl) toggleEl.style.display = 'none';
        }
    }

    _hideRemainingToggle() {
        const toggleEl = document.getElementById('remaining-tasks-toggle');
        if (toggleEl) toggleEl.style.display = 'none';
    }

    _renderNextTaskItem(task) {
        const priorityBadge = task.priority
            ? `<span class="next-task-priority ${task.priority}">${task.priority}</span>`
            : '';

        const deadlineHtml = this._formatDeadline(task.deadline || task.due);
        const isOverdue = this._isOverdue(task.deadline || task.due);
        const isInProgress = isTaskInProgress(task);

        const statusBadge = isInProgress
            ? '<span class="next-task-status in-progress">進行中</span>'
            : '';

        const classList = ['next-task-item'];
        if (isOverdue) classList.push('overdue');
        if (isInProgress) classList.push('in-progress');

        return `
            <div class="${classList.join(' ')}" data-task-id="${task.id}">
                <div class="next-task-checkbox" data-id="${task.id}">
                    <i data-lucide="check"></i>
                </div>
                <div class="next-task-content">
                    <div class="next-task-title">${task.name || task.title}</div>
                    <div class="next-task-meta">
                        <span class="next-task-project">${task.project || 'general'}</span>
                        ${statusBadge}
                        ${priorityBadge}
                        ${deadlineHtml}
                    </div>
                </div>
                <div class="next-task-actions">
                    ${isInProgress
                        ? `<button class="next-task-action restore-task-btn" data-id="${task.id}" title="Todoに戻す">
                            <i data-lucide="undo-2"></i>
                           </button>`
                        : ''}
                    <button class="next-task-action start-task-btn" data-id="${task.id}" title="Start Session">
                        <i data-lucide="terminal-square"></i>
                    </button>
                    <button class="next-task-action edit-task-btn" data-id="${task.id}" title="Edit">
                        <i data-lucide="edit-2"></i>
                    </button>
                    <button class="next-task-action delete-task-btn" data-id="${task.id}" title="Delete">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
        `;
    }

    _formatDeadline(deadline) {
        if (!deadline) return '';

        const due = new Date(deadline);
        due.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        let text;
        let cssClass = 'next-task-deadline';

        if (due < today) {
            text = '期限切れ';
            cssClass += ' overdue';
        } else if (due.getTime() === today.getTime()) {
            text = '今日';
            cssClass += ' urgent';
        } else if (due.getTime() === tomorrow.getTime()) {
            text = '明日';
        } else {
            text = `${due.getMonth() + 1}/${due.getDate()}`;
        }

        return `<span class="${cssClass}"><i data-lucide="calendar"></i> ${text}</span>`;
    }

    _isOverdue(deadline) {
        if (!deadline) return false;
        const due = new Date(deadline);
        due.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return due < today;
    }

    _attachEventHandlers() {
        this.container.querySelectorAll('.next-task-checkbox').forEach(checkbox => {
            checkbox.addEventListener('click', async () => {
                const taskId = checkbox.dataset.id;
                if (taskId) {
                    await this.taskService.completeTask(taskId);
                }
            });
        });

        this.container.querySelectorAll('.start-task-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const taskId = btn.dataset.id;
                if (taskId) {
                    eventBus.emit(EVENTS.START_TASK, { taskId });
                }
            });
        });

        this.container.querySelectorAll('.edit-task-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const taskId = btn.dataset.id;
                if (taskId) {
                    const { tasks } = appStore.getState();
                    const task = tasks.find(t => t.id === taskId);
                    if (task) {
                        eventBus.emit(EVENTS.EDIT_TASK, { task });
                    }
                }
            });
        });

        this.container.querySelectorAll('.delete-task-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const taskId = btn.dataset.id;
                if (taskId && confirm('このタスクを削除しますか？')) {
                    await this.taskService.deleteTask(taskId);
                }
            });
        });

        this.container.querySelectorAll('.restore-task-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const taskId = btn.dataset.id;
                if (taskId) {
                    await this.taskService.updateTask(taskId, { status: 'todo' });
                }
            });
        });

        const showMoreBtn = document.getElementById('show-more-tasks');
        if (showMoreBtn) {
            showMoreBtn.addEventListener('click', () => {
                this.showAll = true;
                this.render();
            });
        }
    }
}
