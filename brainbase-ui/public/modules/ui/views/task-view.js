import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * タスク表示のUIコンポーネント
 * app.jsから抽出したタスク表示機能を集約
 */
export class TaskView {
    constructor({ taskService }) {
        this.taskService = taskService;
        this.container = null;
        this._unsubscribers = [];
    }

    /**
     * DOMコンテナにマウント
     * @param {HTMLElement} container - マウント先のコンテナ
     */
    mount(container) {
        this.container = container;
        this._setupEventListeners();
        this.render();
    }

    /**
     * イベントリスナーの設定
     */
    _setupEventListeners() {
        // イベント購読
        const unsub1 = eventBus.on(EVENTS.TASK_LOADED, () => this.render());
        const unsub2 = eventBus.on(EVENTS.TASK_COMPLETED, () => this.render());
        const unsub3 = eventBus.on(EVENTS.TASK_FILTER_CHANGED, () => this.render());

        this._unsubscribers.push(unsub1, unsub2, unsub3);
    }

    /**
     * タスクリストをレンダリング
     */
    render() {
        if (!this.container) return;

        const tasks = this.taskService.getFilteredTasks();
        const focusTask = this.taskService.getFocusTask();

        if (tasks.length === 0) {
            this.container.innerHTML = '<div class="empty-state">タスクがありません</div>';
            return;
        }

        let html = '';

        // フォーカスタスク表示
        if (focusTask) {
            html += this._renderFocusTask(focusTask);
        }

        // タスクリスト表示
        html += '<div class="task-list">';
        tasks.forEach(task => {
            if (focusTask && task.id === focusTask.id) return; // フォーカスタスクは別表示
            html += this._renderTask(task);
        });
        html += '</div>';

        // フィルター入力欄
        const { taskFilter } = appStore.getState().filters;
        html += `
            <div class="filter-section">
                <input
                    type="text"
                    data-filter-input
                    value="${taskFilter || ''}"
                    placeholder="タスクをフィルター..."
                />
            </div>
        `;

        this.container.innerHTML = html;
        this._attachEventHandlers();
    }

    /**
     * フォーカスタスクのHTML生成
     */
    _renderFocusTask(task) {
        const isUrgent = task.due && new Date(task.due) <= new Date(Date.now() + 24 * 60 * 60 * 1000);
        const dueText = task.due ? this._formatDueDate(task.due) : '';

        return `
            <div class="focus-task" data-focus-task>
                <h3>🎯 Focus Task</h3>
                <div class="focus-card" data-task-id="${task.id}">
                    <div class="focus-card-title">${task.name || task.title}</div>
                    <div class="focus-card-meta">
                        <span class="project-tag">${task.project || 'general'}</span>
                        ${dueText ? `<span class="due-tag ${isUrgent ? 'urgent' : ''}">${dueText}</span>` : ''}
                    </div>
                    <div class="focus-card-actions">
                        <button class="focus-btn-start" data-id="${task.id}">開始</button>
                        <button class="focus-btn-complete" data-id="${task.id}">完了</button>
                        <button class="focus-btn-defer" data-id="${task.id}">後で</button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Due date formatting
     */
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

    /**
     * タスクのHTML生成
     */
    _renderTask(task) {
        return `
            <div class="task-item" data-task-id="${task.id}">
                <div class="task-content">
                    <h4>${task.title}</h4>
                    ${task.content ? `<p>${task.content}</p>` : ''}
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

    /**
     * DOMイベントハンドラーをアタッチ
     */
    _attachEventHandlers() {
        // Focus Task - Complete button
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

        // Focus Task - Defer button
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

        // Focus Task - Start button
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

        // 完了ボタン（通常タスク）
        this.container.querySelectorAll('[data-action="complete"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const taskItem = e.target.closest('[data-task-id]');
                const taskId = taskItem?.dataset.taskId;
                if (taskId) {
                    await this.taskService.completeTask(taskId);
                }
            });
        });

        // フィルター入力
        const filterInput = this.container.querySelector('[data-filter-input]');
        if (filterInput) {
            filterInput.addEventListener('input', (e) => {
                const { filters } = appStore.getState();
                appStore.setState({
                    filters: { ...filters, taskFilter: e.target.value }
                });
                eventBus.emit(EVENTS.TASK_FILTER_CHANGED, {});
            });
        }
    }

    /**
     * クリーンアップ
     */
    unmount() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        if (this.container) {
            this.container.innerHTML = '';
            this.container = null;
        }
    }
}
