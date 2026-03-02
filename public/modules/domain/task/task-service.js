import { httpClient } from '../../core/http-client.js';
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { filterByPriority } from '../../utils/task-filters.js';

const PRIORITY_DOWNGRADE_MAP = { high: 'medium', medium: 'low', low: 'low' };
const DEFAULT_PRIORITY = 'low';
const PRIORITY_ORDER = { critical: 5, highest: 5, high: 4, medium: 3, normal: 2, low: 1 };
const FOCUS_PRIORITIES = ['critical', 'highest', 'high'];
const MAX_VISIBLE_NEXT_TASKS = 10;

function getDeadlineValue(task = {}) {
    return task.deadline || task.due || null;
}

function getDeadlineTimestamp(task) {
    const value = getDeadlineValue(task);
    return value ? new Date(value).getTime() : null;
}

function compareByDeadlineAndPriority(a, b) {
    const aDeadlineTs = getDeadlineTimestamp(a);
    const bDeadlineTs = getDeadlineTimestamp(b);

    if (aDeadlineTs === null && bDeadlineTs === null) {
        return (PRIORITY_ORDER[b.priority] || 0) - (PRIORITY_ORDER[a.priority] || 0);
    }
    if (aDeadlineTs === null) return 1;
    if (bDeadlineTs === null) return -1;

    if (aDeadlineTs !== bDeadlineTs) {
        return aDeadlineTs - bDeadlineTs;
    }

    return (PRIORITY_ORDER[b.priority] || 0) - (PRIORITY_ORDER[a.priority] || 0);
}

function resolveTaskActivityDate(task) {
    if (task?.updated) return new Date(task.updated);
    if (task?.created) return new Date(task.created);
    return null;
}

function getActivityTimestamp(task) {
    const activityDate = resolveTaskActivityDate(task);
    return activityDate ? activityDate.getTime() : 0;
}

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

    // Ensures state stays fresh after any write operation
    async _requestAndRefresh(requestCall) {
        const result = await requestCall();
        await this.loadTasks();
        return result;
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
        await this._requestAndRefresh(() =>
            this.httpClient.put(`/api/tasks/${taskId}`, { status: 'done' })
        );
        const eventResult = await this.eventBus.emit(EVENTS.TASK_COMPLETED, { taskId });
        return { success: true, taskId, eventResult };
    }

    /**
     * タスク延期
     * @param {string} taskId - 延期するタスクのID
     * @returns {Promise<{success: boolean, taskId: string, newPriority: string, eventResult: Object}|null>}
     */
    async deferTask(taskId) {
        const { tasks = [] } = this.store.getState();
        const task = tasks.find(t => t.id === taskId);
        if (!task) return null;

        // 優先度を下げる（high → medium → low → low）
        const newPriority = PRIORITY_DOWNGRADE_MAP[task.priority] || DEFAULT_PRIORITY;

        await this._requestAndRefresh(() =>
            this.httpClient.post(`/api/tasks/${taskId}/defer`, { priority: newPriority })
        );
        const eventResult = await this.eventBus.emit(EVENTS.TASK_DEFERRED, { taskId });
        return { success: true, taskId, newPriority, eventResult };
    }

    /**
     * フィルタリング済みタスク取得
     * @returns {Array} フィルタリング後のタスク配列
     */
    getFilteredTasks() {
        const { tasks = [], filters = {} } = this.store.getState();
        const { taskFilter, showAllTasks, priorityFilter } = filters;

        let filtered = tasks;

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
        return tasks.find(t => FOCUS_PRIORITIES.includes(t.priority)) || tasks[0];
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
        nextTasks.sort(compareByDeadlineAndPriority);

        // 表示件数制限
        const visibleTasks = showAll ? nextTasks : nextTasks.slice(0, MAX_VISIBLE_NEXT_TASKS);

        return {
            tasks: visibleTasks,
            totalCount: nextTasks.length,
            remainingCount: Math.max(0, nextTasks.length - MAX_VISIBLE_NEXT_TASKS)
        };
    }

    /**
     * タスク更新
     * @param {string} taskId - 更新するタスクのID
     * @param {Object} updates - 更新内容
     * @returns {Promise<{success: boolean, taskId: string, updates: Object, eventResult: Object}>}
     */
    async updateTask(taskId, updates) {
        await this._requestAndRefresh(() =>
            this.httpClient.put(`/api/tasks/${taskId}`, updates)
        );
        const eventResult = await this.eventBus.emit(EVENTS.TASK_UPDATED, { taskId, updates });
        return { success: true, taskId, updates, eventResult };
    }

    /**
     * タスク削除
     * @param {string} taskId - 削除するタスクのID
     * @returns {Promise<{success: boolean, taskId: string, eventResult: Object}>}
     */
    async deleteTask(taskId) {
        await this._requestAndRefresh(() =>
            this.httpClient.delete(`/api/tasks/${taskId}`)
        );
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
        const task = await this._requestAndRefresh(() =>
            this.httpClient.post('/api/tasks', taskData)
        );
        const eventResult = await this.eventBus.emit(EVENTS.TASK_CREATED, { task });
        return { success: true, task, eventResult };
    }

    /**
     * 完了済みタスク取得（API経由）
     * @param {number|null} dayFilter - 過去N日間のフィルター（nullで全期間）
     * @returns {Promise<Array>} 完了済みタスク配列（新しい順）
     */
    async getCompletedTasks(dayFilter = null) {
        // API経由で完了タスクを取得
        let completed = await this.httpClient.get('/api/tasks/completed');

        if (dayFilter) {
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - dayFilter);
            completed = completed.filter(t => {
                // created または updated を完了日として使用
                const completedDate = resolveTaskActivityDate(t);
                return completedDate && completedDate >= cutoff;
            });
        }

        // 新しい順でソート
        return completed.sort((a, b) => getActivityTimestamp(b) - getActivityTimestamp(a));
    }

    /**
     * タスク復活（完了→未完了に戻す）
     * @param {string} taskId - 復活するタスクのID
     * @returns {Promise<{success: boolean, taskId: string, eventResult: Object}>}
     */
    async restoreTask(taskId) {
        await this._requestAndRefresh(() =>
            this.httpClient.put(`/api/tasks/${taskId}`, { status: 'todo' })
        );
        const eventResult = await this.eventBus.emit(EVENTS.TASK_RESTORED, { taskId });
        return { success: true, taskId, eventResult };
    }
}
