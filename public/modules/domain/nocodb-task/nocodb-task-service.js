import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';
import { NocoDBTaskAdapter } from './nocodb-task-adapter.js';
import { NocoDBTaskRepository } from './nocodb-task-repository.js';

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
            this._updateStore({ nocodbProjects: this.projects });

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
        const task = this._findTaskOrThrow(taskId);

        const nocoStatus = this.adapter.toNocoDBStatus(newStatus);

        try {
            await this.repository.updateTask(
                task.nocodbRecordId,
                task.nocodbBaseId,
                { 'ステータス': nocoStatus }
            );

            // ローカル状態更新
            this._applyTaskUpdates(task, { status: newStatus });

            // Store更新
            this._updateStore();

            // イベント発火
            this._emitTaskUpdated(task);

            return task;
        } catch (error) {
            this._handleMutationError('updateStatus', error, 'Failed to update task');
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
            this._applyTaskUpdates(task, updates);

            // Store更新
            this._updateStore();

            // イベント発火
            this._emitTaskUpdated(task);

            return task;
        } catch (error) {
            this._handleMutationError('updateTask', error, 'Failed to update task');
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
            this._handleMutationError('createTask', error, 'Failed to create task');
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
            this._handleMutationError('deleteTask', error, 'Failed to delete task');
        }
    }

    /**
     * フィルタ適用済みタスク取得
     * @param {Object} filters - フィルタ条件
     * @returns {Array}
     */
    getFilteredTasks(filters = {}) {
        let result = [...this.tasks];
        const unassignedValue = '__unassigned__';

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
        if (filters.assignee === unassignedValue) {
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

    _findTaskOrThrow(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) {
            throw new Error('Task not found');
        }
        return task;
    }

    _updateStore(additionalState = {}) {
        const state = { nocodbTasks: [...this.tasks] };
        Object.entries(additionalState).forEach(([key, value]) => {
            if (value !== undefined) {
                state[key] = value;
            }
        });
        appStore.setState(state);
    }

    _emitTaskUpdated(task) {
        eventBus.emit(EVENTS.NOCODB_TASK_UPDATED, { task });
    }

    _handleMutationError(context, error, fallbackMessage) {
        const message = error?.message || fallbackMessage;
        console.error(`NocoDBTaskService.${context} error:`, error);
        eventBus.emit(EVENTS.NOCODB_TASK_ERROR, {
            error: message
        });
        throw error;
    }

    _applyTaskUpdates(task, updates = {}) {
        const applyIfDefined = (key, applyFn) => {
            if (!Object.prototype.hasOwnProperty.call(updates, key)) {
                return;
            }

            const value = updates[key];
            if (value === undefined) {
                return;
            }

            applyFn(value);
        };

        applyIfDefined('name', (value) => {
            task.title = value;
            task.name = value;
        });

        applyIfDefined('priority', (value) => {
            task.priority = value;
        });

        applyIfDefined('due', (value) => {
            const dueValue = value ?? null;
            task.due = dueValue;
            task.deadline = dueValue;
        });

        applyIfDefined('description', (value) => {
            task.description = value;
        });

        applyIfDefined('assignee', (value) => {
            task.assignee = value;
        });

        applyIfDefined('status', (value) => {
            task.status = value;
        });
    }
}
