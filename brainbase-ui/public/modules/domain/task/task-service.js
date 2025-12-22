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
}
