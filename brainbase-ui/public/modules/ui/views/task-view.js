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

        const focusTask = this.taskService.getFocusTask();

        // 現行版と同じ構造: focus-cardのみを直接レンダリング
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

        // Lucideアイコンを初期化
        if (window.lucide) {
            window.lucide.createIcons();
        }

        this._attachEventHandlers();
    }

    /**
     * フォーカスタスクのHTML生成
     */
    _renderFocusTask(task) {
        const isUrgent = task.due && new Date(task.due) <= new Date(Date.now() + 24 * 60 * 60 * 1000);
        const dueText = task.due ? this._formatDueDate(task.due) : '';

        return `
            <div class="focus-card" data-task-id="${task.id}">
                <div class="focus-card-title">${task.name || task.title}</div>
                <div class="focus-card-meta">
                    <span class="project-tag">${task.project || 'general'}</span>
                    ${dueText ? `<span class="due-tag ${isUrgent ? 'urgent' : ''}"><i data-lucide="clock"></i>${dueText}</span>` : ''}
                </div>
                <div class="focus-card-actions">
                    <button class="focus-btn-start" data-id="${task.id}">
                        <i data-lucide="terminal-square"></i> 開始
                    </button>
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
