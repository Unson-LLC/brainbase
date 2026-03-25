import { eventBus, EVENTS } from '../../core/event-bus.js';
import { escapeHtml, refreshIcons } from '../../ui-helpers.js';
import { BaseModal } from './base-modal.js';

/**
 * 完了タスク一覧モーダル
 */
export class CompletedTasksModal extends BaseModal {
    constructor({ taskService }) {
        super('completed-tasks-modal');
        this.taskService = taskService;
        this.dateFilter = null;  // null = 全期間, 7, 30, 90
    }

    async open() {
        if (!this.modalElement) return;

        this.dateFilter = null;
        const filterSelect = document.getElementById('completed-date-filter');
        if (filterSelect) {
            filterSelect.value = '';
        }

        this.modalElement.classList.add('active');
        await this._renderList();
    }

    async restoreTask(taskId) {
        try {
            await this.taskService.restoreTask(taskId);
            await this._renderList();
        } catch (error) {
            console.error('Failed to restore task:', error);
        }
    }

    async _renderList() {
        const listElement = document.getElementById('completed-tasks-list');
        const emptyElement = document.getElementById('completed-tasks-empty');

        if (!listElement) return;

        const completedTasks = await this.taskService.getCompletedTasks(this.dateFilter);

        if (completedTasks.length === 0) {
            listElement.innerHTML = '';
            if (emptyElement) emptyElement.style.display = 'block';
            return;
        }

        if (emptyElement) emptyElement.style.display = 'none';

        const grouped = this._groupByDate(completedTasks);

        let html = '';
        for (const [date, tasks] of Object.entries(grouped)) {
            html += `<div class="completed-date-group">`;
            html += `<div class="completed-date-header">${date}</div>`;
            for (const task of tasks) {
                const taskName = task.name || task.title || '(無題)';
                const project = task.project || '';
                const priority = task.priority || '';

                html += `
                    <div class="completed-task-item" data-task-id="${task.id}">
                        <div class="completed-task-info">
                            <div class="completed-task-name">${escapeHtml(taskName)}</div>
                            <div class="completed-task-meta">
                                ${project ? `<span class="task-project">${escapeHtml(project)}</span>` : ''}
                                ${priority ? `<span class="task-priority priority-${priority}">${this._getPriorityLabel(priority)}</span>` : ''}
                            </div>
                        </div>
                        <button class="restore-task-btn btn-icon" title="復活">
                            <i data-lucide="rotate-ccw"></i>
                        </button>
                    </div>
                `;
            }
            html += `</div>`;
        }

        listElement.innerHTML = html;

        refreshIcons();

        listElement.querySelectorAll('.restore-task-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const taskItem = e.target.closest('.completed-task-item');
                const taskId = taskItem?.dataset.taskId;
                if (taskId) {
                    this.restoreTask(taskId);
                }
            });
        });
    }

    _groupByDate(tasks) {
        const grouped = {};
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

        for (const task of tasks) {
            const dateStr = task.updated || task.created || '';
            const date = dateStr ? dateStr.split('T')[0] : '不明';

            let label = date;
            if (date === today) {
                label = '今日';
            } else if (date === yesterday) {
                label = '昨日';
            }

            if (!grouped[label]) {
                grouped[label] = [];
            }
            grouped[label].push(task);
        }

        return grouped;
    }

    _getPriorityLabel(priority) {
        const labels = { high: '高', medium: '中', low: '低' };
        return labels[priority] || priority;
    }


    _attachEventHandlers() {
        const filterSelect = document.getElementById('completed-date-filter');
        if (filterSelect) {
            filterSelect.addEventListener('change', async (e) => {
                const value = e.target.value;
                this.dateFilter = value ? parseInt(value, 10) : null;
                await this._renderList();
            });
        }

        const unsub = eventBus.on(EVENTS.TASK_COMPLETED, async () => {
            if (this.modalElement?.classList.contains('active')) {
                await this._renderList();
            }
        });
        this._addSubscription(unsub);
    }
}
