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
        await this.eventBus.emit(EVENTS.TASK_LOADED, { tasks });
        return tasks;
    }

    /**
     * タスク完了
     * @param {string} taskId - 完了するタスクのID
     * @returns {Promise<{success: boolean, taskId: string, eventResult: Object}>}
     */
    async completeTask(taskId) {
        await this.httpClient.put(`/api/tasks/${taskId}`, { status: 'done' });
        await this.loadTasks(); // リロード
        const eventResult = await this.eventBus.emit(EVENTS.TASK_COMPLETED, { taskId });
        return { success: true, taskId, eventResult };
    }

    /**
     * タスク延期
     * @param {string} taskId - 延期するタスクのID
     * @returns {Promise<{success: boolean, taskId: string, newPriority: string, eventResult: Object}|null>}
     */
    async deferTask(taskId) {
        const { tasks } = this.store.getState();
        const task = tasks.find(t => t.id === taskId);
        if (!task) return null;

        // 優先度を下げる（high → medium → low → low）
        const priorityMap = { high: 'medium', medium: 'low', low: 'low' };
        const newPriority = priorityMap[task.priority] || 'low';

        await this.httpClient.post(`/api/tasks/${taskId}/defer`, { priority: newPriority });
        await this.loadTasks(); // リロード
        const eventResult = await this.eventBus.emit(EVENTS.TASK_DEFERRED, { taskId });
        return { success: true, taskId, newPriority, eventResult };
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

        // 期限の昇順でソート（期限なしは最後）、同じ期限なら優先度順
        const priorityOrder = { critical: 5, highest: 5, high: 4, medium: 3, normal: 2, low: 1 };
        nextTasks.sort((a, b) => {
            const aDeadline = a.deadline || a.due;
            const bDeadline = b.deadline || b.due;

            // 期限なしは最後
            if (!aDeadline && !bDeadline) {
                // 両方期限なしなら優先度順
                return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
            }
            if (!aDeadline) return 1;
            if (!bDeadline) return -1;

            // 期限の昇順
            const dateCompare = new Date(aDeadline).getTime() - new Date(bDeadline).getTime();
            if (dateCompare !== 0) return dateCompare;

            // 同じ期限なら優先度順
            return (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0);
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
     * @returns {Promise<{success: boolean, taskId: string, updates: Object, eventResult: Object}>}
     */
    async updateTask(taskId, updates) {
        await this.httpClient.put(`/api/tasks/${taskId}`, updates);
        await this.loadTasks(); // リロード
        const eventResult = await this.eventBus.emit(EVENTS.TASK_UPDATED, { taskId, updates });
        return { success: true, taskId, updates, eventResult };
    }

    /**
     * タスク削除
     * @param {string} taskId - 削除するタスクのID
     * @returns {Promise<{success: boolean, taskId: string, eventResult: Object}>}
     */
    async deleteTask(taskId) {
        await this.httpClient.delete(`/api/tasks/${taskId}`);
        await this.loadTasks(); // リロード
        const eventResult = await this.eventBus.emit(EVENTS.TASK_DELETED, { taskId });
        return { success: true, taskId, eventResult };
    }

    /**
     * タスク作成
     * @param {Object} taskData - タスクデータ
     * @param {string} taskData.title - タスク名（必須）
     * @param {string} taskData.project - プロジェクト名
     * @param {string} taskData.priority - 優先度 (low, medium, high)
     * @param {string} taskData.due - 期限 (YYYY-MM-DD)
     * @param {string} taskData.description - 説明
     * @returns {Promise<{success: boolean, task: Object, eventResult: Object}>}
     */
    async createTask(taskData) {
        const task = await this.httpClient.post('/api/tasks', taskData);
        await this.loadTasks(); // リロード
        const eventResult = await this.eventBus.emit(EVENTS.TASK_CREATED, { task });
        return { success: true, task, eventResult };
    }

    /**
     * 完了済みタスク取得
     * @param {number|null} dayFilter - 過去N日間のフィルター（nullで全期間）
     * @returns {Array} 完了済みタスク配列（新しい順）
     */
    getCompletedTasks(dayFilter = null) {
        const { tasks } = this.store.getState();
        let completed = (tasks || []).filter(t => t.status === 'done');

        if (dayFilter) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - dayFilter);
            completed = completed.filter(t => {
                // created または updated を完了日として使用
                const completedDate = t.updated ? new Date(t.updated) : (t.created ? new Date(t.created) : null);
                return completedDate && completedDate >= cutoff;
            });
        }

        // 新しい順でソート
        return completed.sort((a, b) => {
            const dateA = a.updated ? new Date(a.updated) : (a.created ? new Date(a.created) : new Date(0));
            const dateB = b.updated ? new Date(b.updated) : (b.created ? new Date(b.created) : new Date(0));
            return dateB - dateA;
        });
    }

    /**
     * タスク復活（完了→未完了に戻す）
     * @param {string} taskId - 復活するタスクのID
     * @returns {Promise<{success: boolean, taskId: string, eventResult: Object}>}
     */
    async restoreTask(taskId) {
        await this.httpClient.put(`/api/tasks/${taskId}`, { status: 'todo' });
        await this.loadTasks(); // リロード
        const eventResult = await this.eventBus.emit(EVENTS.TASK_RESTORED, { taskId });
        return { success: true, taskId, eventResult };
    }
}
