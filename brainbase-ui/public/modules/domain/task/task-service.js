import { httpClient } from '../../core/http-client.js';
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';

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
        const tasks = await this.httpClient.get('/tasks');
        this.store.setState({ tasks });
        this.eventBus.emit(EVENTS.TASK_LOADED, { tasks });
        return tasks;
    }

    /**
     * タスク完了
     * @param {string} taskId - 完了するタスクのID
     */
    async completeTask(taskId) {
        await this.httpClient.post(`/tasks/${taskId}/complete`);
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

        await this.httpClient.post(`/tasks/${taskId}/defer`, { priority: newPriority });
        await this.loadTasks(); // リロード
        this.eventBus.emit(EVENTS.TASK_DEFERRED, { taskId });
    }

    /**
     * フィルタリング済みタスク取得
     * @returns {Array} フィルタリング後のタスク配列
     */
    getFilteredTasks() {
        const { tasks, filters } = this.store.getState();
        const { taskFilter, showAllTasks } = filters;

        let filtered = tasks || [];

        // テキストフィルタ
        if (taskFilter) {
            filtered = filtered.filter(t =>
                t.title?.includes(taskFilter) ||
                t.content?.includes(taskFilter)
            );
        }

        // 完了タスクフィルタ
        if (!showAllTasks) {
            filtered = filtered.filter(t => t.status !== 'done');
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
        return tasks.find(t => t.priority === 'high') || tasks[0];
    }

    /**
     * Next Tasks取得（フォーカスタスク以外のタスク）
     * @returns {Array} Next Tasks配列
     */
    getNextTasks() {
        const focusTask = this.getFocusTask();
        const filtered = this.getFilteredTasks();

        // フォーカスタスクを除外
        let nextTasks = focusTask
            ? filtered.filter(t => t.id !== focusTask.id)
            : filtered;

        // 優先度でソート（high > medium > low）
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        nextTasks.sort((a, b) => {
            const aPriority = priorityOrder[a.priority] || 0;
            const bPriority = priorityOrder[b.priority] || 0;
            return bPriority - aPriority;
        });

        return nextTasks;
    }

    /**
     * タスク削除
     * @param {string} taskId - 削除するタスクのID
     */
    async deleteTask(taskId) {
        await this.httpClient.delete(`/tasks/${taskId}`);
        await this.loadTasks(); // リロード
        this.eventBus.emit(EVENTS.TASK_DELETED, { taskId });
    }
}
