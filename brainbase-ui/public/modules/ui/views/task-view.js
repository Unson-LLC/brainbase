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
        return `
            <div class="focus-task" data-focus-task>
                <h3>🎯 Focus Task</h3>
                ${this._renderTask(task)}
            </div>
        `;
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
        // 完了ボタン
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
