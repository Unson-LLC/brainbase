import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';
import { NocoDBTaskAdapter } from './nocodb-task-adapter.js';
import { NocoDBTaskRepository } from './nocodb-task-repository.js';

const UNASSIGNED_FILTER_VALUE = '__unassigned__';
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * NocoDBTaskService
 * NocoDBタスクのビジネスロジック
 */
export class NocoDBTaskService {
    constructor({ httpClient }) {
        this.repository = new NocoDBTaskRepository({ httpClient });
        this.adapter = new NocoDBTaskAdapter();
        this.tasks = [];
        this.projects = [];
        this.loading = false;
        this.error = null;
    }

    /**
     * 全プロジェクトからタスク取得・ストア更新
     * @returns {Promise<Array>}
     */
    async loadTasks() {
        if (this.loading) {
            return this.tasks;
        }

        this.loading = true;
        this.error = null;

        try {
            const response = await this.repository.fetchAllTasks();
            const rawTasks = response.records || [];
            this.projects = response.projects || [];

            // 内部形式に変換
            this.tasks = rawTasks.map(record => this.adapter.toInternalTask(record));

            // Store更新
            appStore.setState({
                nocodbTasks: this.tasks,
                nocodbProjects: this.projects
            });

            return this.tasks;
        } catch (error) {
            this.error = this._handleOperationError(
                'loadTasks',
                error,
                'Failed to load NocoDB tasks',
                { emitEvent: false }
            );
            throw error;
        } finally {
            // loading = false の後にイベント発火（render時にisLoading()がfalseを返すため）
            this.loading = false;

            if (!this.error) {
                eventBus.emit(EVENTS.NOCODB_TASKS_LOADED, {
                    tasks: this.tasks,
                    projects: this.projects
                });
            } else {
                eventBus.emit(EVENTS.NOCODB_TASK_ERROR, {
                    error: this.error
                });
            }
        }
    }

    /**
     * タスクステータス更新
     * @param {string} taskId - 内部タスクID (nocodb:{project}:{recordId})
     * @param {string} newStatus - 新しいステータス (pending/in_progress/completed)
     */
    async updateStatus(taskId, newStatus) {
        const task = this._findTaskOrThrow(taskId);

        const nocoStatus = this.adapter.toNocoDBStatus(newStatus);

        try {
            await this.repository.updateTask(
                task.nocodbRecordId,
                task.nocodbBaseId,
                { 'ステータス': nocoStatus }
            );

            // ローカル状態更新
            this._applyLocalTaskUpdates(task, { status: newStatus });

            // Store更新
            this._syncTasksToStore();

            // イベント発火
            eventBus.emit(EVENTS.NOCODB_TASK_UPDATED, { task });

            return task;
        } catch (error) {
            this._handleOperationError('updateStatus', error, 'Failed to update task');
            throw error;
        }
    }

    /**
     * タスク更新（全フィールド対応）
     * @param {string} taskId - 内部タスクID
     * @param {Object} updates - 更新データ { name, priority, due, description }
     */
    async updateTask(taskId, updates) {
        const task = this._findTaskOrThrow(taskId);

        // 内部形式→NocoDB形式に変換
        const nocoFields = this.adapter.toNocoDBFields(updates);

        try {
            await this.repository.updateTask(
                task.nocodbRecordId,
                task.nocodbBaseId,
                nocoFields
            );

            // ローカル状態更新
            this._applyLocalTaskUpdates(task, updates);

            // Store更新
            this._syncTasksToStore();

            // イベント発火
            eventBus.emit(EVENTS.NOCODB_TASK_UPDATED, { task });

            return task;
        } catch (error) {
            this._handleOperationError('updateTask', error, 'Failed to update task');
            throw error;
        }
    }

    /**
     * タスク作成
     * @param {Object} payload - 新規タスク情報
     * @param {string} payload.projectId - プロジェクトID
     * @param {string} payload.title - タスク名
     * @param {string} payload.assignee - 担当者
     * @param {string} payload.priority - 優先度
     * @param {string} payload.due - 期限
     * @param {string} payload.description - 説明
     */
    async createTask(payload) {
        try {
            const created = await this.repository.createTask(payload);
            await this.loadTasks();
            eventBus.emit(EVENTS.NOCODB_TASK_CREATED, { task: created });
            return created;
        } catch (error) {
            this._handleOperationError('createTask', error, 'Failed to create task');
            throw error;
        }
    }

    /**
     * タスク削除
     * @param {string} taskId - 内部タスクID
     */
    async deleteTask(taskId) {
        const task = this._findTaskOrThrow(taskId);

        try {
            await this.repository.deleteTask(
                task.nocodbRecordId,
                task.nocodbBaseId
            );

            // ローカル状態から削除
            this.tasks = this.tasks.filter(t => t.id !== taskId);

            // Store更新
            this._syncTasksToStore();

            // イベント発火
            eventBus.emit(EVENTS.NOCODB_TASK_DELETED, { taskId });

            return { success: true };
        } catch (error) {
            this._handleOperationError('deleteTask', error, 'Failed to delete task');
            throw error;
        }
    }

    /**
     * フィルタ適用済みタスク取得
     * @param {Object} filters - フィルタ条件
     * @returns {Array}
     */
    getFilteredTasks(filters = {}) {
        let result = [...this.tasks];
        const {
            project,
            status,
            hideCompleted,
            priority,
            assignee,
            searchText
        } = filters;

        if (project) {
            result = result.filter(t => t.project === project);
        }

        if (status) {
            result = result.filter(t => t.status === status);
        }

        if (hideCompleted) {
            result = result.filter(t => t.status !== 'completed');
        }

        if (priority) {
            result = result.filter(t => t.priority === priority);
        }

        if (assignee === UNASSIGNED_FILTER_VALUE) {
            result = result.filter(t => !t.assignee);
        } else if (assignee) {
            const normalizedAssignee = assignee.toLowerCase();
            result = result.filter(t => t.assignee?.toLowerCase() === normalizedAssignee);
        }

        if (searchText) {
            const normalizedText = searchText.toLowerCase();
            result = result.filter(t =>
                t.title?.toLowerCase().includes(normalizedText) ||
                t.description?.toLowerCase().includes(normalizedText)
            );
        }

        result.sort((a, b) => (
            (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
        ));

        return result;
    }

    /**
     * プロジェクト一覧取得
     * @returns {Array}
     */
    getProjects() {
        return this.projects;
    }

    /**
     * ローディング状態取得
     * @returns {boolean}
     */
    isLoading() {
        return this.loading;
    }

    /**
     * エラー状態取得
     * @returns {string|null}
     */
    getError() {
        return this.error;
    }

    _findTaskOrThrow(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) {
            throw new Error('Task not found');
        }
        return task;
    }

    _syncTasksToStore() {
        appStore.setState({ nocodbTasks: [...this.tasks] });
    }

    _applyLocalTaskUpdates(task, updates = {}) {
        if (updates.name) {
            task.title = updates.name;
        }
        if (updates.priority) {
            task.priority = updates.priority;
        }
        if (updates.due !== undefined) {
            task.due = updates.due;
        }
        if (updates.description !== undefined) {
            task.description = updates.description;
        }
        if (updates.assignee !== undefined) {
            task.assignee = updates.assignee;
        }
        if (updates.status) {
            task.status = updates.status;
        }
    }

    _handleOperationError(context, error, fallbackMessage, { emitEvent = true } = {}) {
        const message = (error && error.message) || fallbackMessage;
        console.error(`NocoDBTaskService.${context} error:`, error);
        if (emitEvent) {
            eventBus.emit(EVENTS.NOCODB_TASK_ERROR, { error: message });
        }
        return message;
    }
}
