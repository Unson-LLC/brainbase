import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * Next Tasks表示のUIコンポーネント
 */
export class NextTasksView {
    constructor({ taskService }) {
        this.taskService = taskService;
        this.container = null;
        this._unsubscribers = [];
        this.showAll = false;
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
        const unsub3 = eventBus.on(EVENTS.TASK_DELETED, () => this.render());

        this._unsubscribers.push(unsub1, unsub2, unsub3);
    }

    /**
     * Next Tasksをレンダリング
     */
    render() {
        if (!this.container) return;

        const result = this.taskService.getNextTasks({ showAll: this.showAll });
        const { tasks, remainingCount } = result;

        if (tasks.length === 0) {
            this.container.innerHTML = '<div class="timeline-empty">他のタスクなし</div>';
            this._hideRemainingToggle();
            return;
        }

        // 現行版と同じ構造: ラッパーなしで直接タスクアイテムを挿入
        let html = '';
        tasks.forEach(task => {
            html += this._renderNextTaskItem(task);
        });

        this.container.innerHTML = html;

        // Lucideアイコンを初期化
        if (window.lucide) {
            window.lucide.createIcons();
        }

        this._updateRemainingToggle(remainingCount);
        this._attachEventHandlers();
    }

    /**
     * 残タスク表示ボタンの更新
     */
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

    /**
     * 残タスク表示ボタンを非表示
     */
    _hideRemainingToggle() {
        const toggleEl = document.getElementById('remaining-tasks-toggle');
        if (toggleEl) toggleEl.style.display = 'none';
    }

    /**
     * Next Task ItemのHTML生成
     * @param {Object} task - タスクオブジェクト
     * @returns {string} HTML文字列
     */
    _renderNextTaskItem(task) {
        const priorityBadge = task.priority
            ? `<span class="next-task-priority ${task.priority}">${task.priority}</span>`
            : '';

        return `
            <div class="next-task-item" data-task-id="${task.id}">
                <div class="next-task-checkbox" data-id="${task.id}">
                    <i data-lucide="check"></i>
                </div>
                <div class="next-task-content">
                    <div class="next-task-title">${task.name || task.title}</div>
                    <div class="next-task-meta">
                        <span class="next-task-project">${task.project || 'general'}</span>
                        ${priorityBadge}
                    </div>
                </div>
                <div class="next-task-actions">
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

    /**
     * DOMイベントハンドラーをアタッチ
     */
    _attachEventHandlers() {
        // Checkbox - Complete task
        this.container.querySelectorAll('.next-task-checkbox').forEach(checkbox => {
            checkbox.addEventListener('click', async (e) => {
                const taskId = checkbox.dataset.id;
                if (taskId) {
                    await this.taskService.completeTask(taskId);
                }
            });
        });

        // Start button - Emit START_TASK event
        this.container.querySelectorAll('.start-task-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const taskId = btn.dataset.id;
                if (taskId) {
                    eventBus.emit(EVENTS.START_TASK, { taskId });
                }
            });
        });

        // Edit button - Emit EDIT_TASK event
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

        // Delete button
        this.container.querySelectorAll('.delete-task-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const taskId = btn.dataset.id;
                if (taskId && confirm('このタスクを削除しますか？')) {
                    await this.taskService.deleteTask(taskId);
                }
            });
        });

        // Show more tasks button (別要素なのでdocument.querySelectorを使用)
        const showMoreBtn = document.getElementById('show-more-tasks');
        if (showMoreBtn) {
            showMoreBtn.addEventListener('click', () => {
                this.showAll = true;
                this.render();
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
