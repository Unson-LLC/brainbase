import { httpClient } from '../../core/http-client.js';
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { filterByPriority } from '../../utils/task-filters.js';

/**
 * タスクのビジネスロジック
 * app.jsから抽出したタスク管理機能を集約
 */
export class TaskService {
    constructor() {
        this.httpClient = httpClient;
        this.store = appStore;
        this.eventBus = eventBus;
    }

    /**
     * タスク一覧取得
     * @returns {Promise<Array>} タスク配列
     */
    async loadTasks() {
        const tasks = await this.httpClient.get('/api/tasks');
        this.store.setState({ tasks });
        this.eventBus.emit(EVENTS.TASK_LOADED, { tasks });
        return tasks;
    }

    /**
     * タスク完了
     * @param {string} taskId - 完了するタスクのID
     */
    async completeTask(taskId) {
        await this.httpClient.put(`/api/tasks/${taskId}`, { status: 'done' });
        await this.loadTasks(); // リロード
        this.eventBus.emit(EVENTS.TASK_COMPLETED, { taskId });
    }

    /**
     * タスク延期
     * @param {string} taskId - 延期するタスクのID
     */
    async deferTask(taskId) {
        const { tasks } = this.store.getState();
        const task = tasks.find(t => t.id === taskId);
        if (!task) return;

        // 優先度を下げる（high → medium → low → low）
        const priorityMap = { high: 'medium', medium: 'low', low: 'low' };
        const newPriority = priorityMap[task.priority] || 'low';

        await this.httpClient.post(`/api/tasks/${taskId}/defer`, { priority: newPriority });
        await this.loadTasks(); // リロード
        this.eventBus.emit(EVENTS.TASK_DEFERRED, { taskId });
    }

    /**
     * フィルタリング済みタスク取得
     * @returns {Array} フィルタリング後のタスク配列
     */
    getFilteredTasks() {
        const { tasks, filters } = this.store.getState();
        const { taskFilter, showAllTasks, priorityFilter } = filters;

        let filtered = tasks || [];

        // テキストフィルタ
        if (taskFilter) {
            filtered = filtered.filter(t =>
                t.name?.includes(taskFilter) ||
                t.description?.includes(taskFilter)
            );
        }

        // 完了タスクフィルタ
        if (!showAllTasks) {
            filtered = filtered.filter(t => t.status !== 'done');
        }

        // 優先度フィルタ
        if (priorityFilter) {
            filtered = filterByPriority(filtered, priorityFilter);
        }

        return filtered;
    }

    /**
     * フォーカスタスク取得
     * 優先度highのタスク、なければ最初のタスク
     * @returns {Object|undefined} フォーカスすべきタスク
     */
    getFocusTask() {
        const tasks = this.getFilteredTasks();
        return tasks.find(t => t.priority === 'high' || t.priority === 'highest' || t.priority === 'critical') || tasks[0];
    }

    /**
     * Next Tasks取得（フォーカスタスク以外のタスク）
     * @param {Object} options - オプション
     * @param {boolean} options.showAll - 全件表示するか（デフォルト: false、上限10件）
     * @param {string} options.owner - オーナーフィルター（任意）
     * @returns {Array} Next Tasks配列
     */
    getNextTasks(options = {}) {
        const { showAll = false, owner = null } = options;
        const MAX_VISIBLE_TASKS = 10;

        const { tasks, filters } = this.store.getState();
        const { priorityFilter } = filters || {};

        // 優先度フィルターが設定されている場合はfocusTaskを除外しない
        const focusTask = priorityFilter ? null : this.getFocusTask();

        // オーナーフィルター + status !== 'done' + フォーカスタスク除外（priorityFilterがない場合のみ）
        let nextTasks = (tasks || []).filter(t =>
            t.status !== 'done' &&
            (!focusTask || t.id !== focusTask.id) &&
            (!owner || t.owner === owner)
        );

        // 優先度フィルター適用
        if (priorityFilter) {
            nextTasks = filterByPriority(nextTasks, priorityFilter);
        }

        // 優先度でソート（critical/highest > high > medium > normal/low）
        const priorityOrder = { critical: 5, highest: 5, high: 4, medium: 3, normal: 2, low: 1 };
        nextTasks.sort((a, b) => {
            const aPriority = priorityOrder[a.priority] || 0;
            const bPriority = priorityOrder[b.priority] || 0;
            return bPriority - aPriority;
        });

        // 表示件数制限
        const visibleTasks = showAll ? nextTasks : nextTasks.slice(0, MAX_VISIBLE_TASKS);

        return {
            tasks: visibleTasks,
            totalCount: nextTasks.length,
            remainingCount: Math.max(0, nextTasks.length - MAX_VISIBLE_TASKS)
        };
    }

    /**
     * タスク更新
     * @param {string} taskId - 更新するタスクのID
     * @param {Object} updates - 更新内容
     */
    async updateTask(taskId, updates) {
        await this.httpClient.put(`/api/tasks/${taskId}`, updates);
        await this.loadTasks(); // リロード
        this.eventBus.emit(EVENTS.TASK_UPDATED, { taskId, updates });
    }

    /**
     * タスク削除
     * @param {string} taskId - 削除するタスクのID
     */
    async deleteTask(taskId) {
        await this.httpClient.delete(`/api/tasks/${taskId}`);
        await this.loadTasks(); // リロード
        this.eventBus.emit(EVENTS.TASK_DELETED, { taskId });
    }
}
