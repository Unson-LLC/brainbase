import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';
import { NocoDBTaskAdapter } from './nocodb-task-adapter.js';
import { NocoDBTaskRepository } from './nocodb-task-repository.js';

const UNASSIGNED_ASSIGNEE = '__unassigned__';
const PRIORITY_SORT_ORDER = { high: 0, medium: 1, low: 2 };

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

    _findTaskOrThrow(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) {
            throw new Error('Task not found');
        }
        return task;
    }

    _updateStore() {
        appStore.setState({ nocodbTasks: [...this.tasks] });
    }

    _applyLocalUpdates(task, updates = {}) {
        if (updates.name !== undefined) {
            task.title = updates.name;
            task.name = updates.name;
        }
        if (updates.priority !== undefined) {
            task.priority = updates.priority;
        }
        if (updates.due !== undefined) {
            task.due = updates.due;
            task.deadline = updates.due;
        }
        if (updates.description !== undefined) {
            task.description = updates.description;
        }
        if (updates.assignee !== undefined) {
            task.assignee = updates.assignee;
        }
        if (updates.status !== undefined) {
            task.status = updates.status;
        }
    }

    _emitTaskError(error, fallbackMessage) {
        const message = error?.message || fallbackMessage;
        eventBus.emit(EVENTS.NOCODB_TASK_ERROR, {
            error: message
        });
        return message;
    }

    async _persistTaskUpdates(task, updates, nocoFields, { logLabel = 'updateTask', fallbackMessage = 'Failed to update task' } = {}) {
        try {
            await this.repository.updateTask(
                task.nocodbRecordId,
                task.nocodbBaseId,
                nocoFields
            );

            this._applyLocalUpdates(task, updates);
            this._updateStore();
            eventBus.emit(EVENTS.NOCODB_TASK_UPDATED, { task });

            return task;
        } catch (error) {
            console.error(`NocoDBTaskService.${logLabel} error:`, error);
            this._emitTaskError(error, fallbackMessage);
            throw error;
        }
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
            this.error = error.message || 'Failed to load NocoDB tasks';
            console.error('NocoDBTaskService.loadTasks error:', error);
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
        if (!newStatus) {
            throw new Error('New status is required');
        }

        const task = this._findTaskOrThrow(taskId);
        const nocoStatus = this.adapter.toNocoDBStatus(newStatus);
        const nocoFields = { 'ステータス': nocoStatus };

        return this._persistTaskUpdates(
            task,
            { status: newStatus },
            nocoFields,
            { logLabel: 'updateStatus' }
        );
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
        return this._persistTaskUpdates(task, updates, nocoFields, { logLabel: 'updateTask' });
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
            console.error('NocoDBTaskService.createTask error:', error);
            this._emitTaskError(error, 'Failed to create task');
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
            this._updateStore();

            // イベント発火
            eventBus.emit(EVENTS.NOCODB_TASK_DELETED, { taskId });

            return { success: true };
        } catch (error) {
            console.error('NocoDBTaskService.deleteTask error:', error);
            this._emitTaskError(error, 'Failed to delete task');
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

        // プロジェクトフィルタ
        if (filters.project) {
            result = result.filter(t => t.project === filters.project);
        }

        // ステータスフィルタ
        if (filters.status) {
            result = result.filter(t => t.status === filters.status);
        }

        // 完了タスク非表示
        if (filters.hideCompleted) {
            result = result.filter(t => t.status !== 'completed');
        }

        // 優先度フィルタ
        if (filters.priority) {
            result = result.filter(t => t.priority === filters.priority);
        }

        // 担当者フィルタ
        if (filters.assignee === UNASSIGNED_ASSIGNEE) {
            result = result.filter(t => !t.assignee);
        } else if (filters.assignee) {
            const assignee = filters.assignee.toLowerCase();
            result = result.filter(t => t.assignee?.toLowerCase() === assignee);
        }

        // テキスト検索
        if (filters.searchText) {
            const text = filters.searchText.toLowerCase();
            result = result.filter(t =>
                t.title?.toLowerCase().includes(text) ||
                t.description?.toLowerCase().includes(text)
            );
        }

        // 優先度でソート（high > medium > low）
        result.sort((a, b) => {
            return (PRIORITY_SORT_ORDER[a.priority] ?? 2) - (PRIORITY_SORT_ORDER[b.priority] ?? 2);
        });

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
}
