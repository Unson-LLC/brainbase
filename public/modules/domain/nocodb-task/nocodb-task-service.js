import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';
import { NocoDBTaskAdapter } from './nocodb-task-adapter.js';
import { NocoDBTaskRepository } from './nocodb-task-repository.js';

const UNASSIGNED_FILTER_VALUE = '__unassigned__';
const PRIORITY_SORT_ORDER = { high: 0, medium: 1, low: 2 };
const DEFAULT_PRIORITY_RANK = 2;

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
        const fields = this.adapter.toNocoDBFields({ status: newStatus });

        return this._applyTaskMutation({
            taskId,
            fields,
            context: 'updateStatus',
            fallbackMessage: 'Failed to update task',
            localMutator: task => {
                this._applyLocalTaskUpdates(task, { status: newStatus });
            }
        });
    }

    /**
     * タスク更新（全フィールド対応）
     * @param {string} taskId - 内部タスクID
     * @param {Object} updates - 更新データ { name, priority, due, description }
     */
    async updateTask(taskId, updates) {
        const nocoFields = this.adapter.toNocoDBFields(updates);

        return this._applyTaskMutation({
            taskId,
            fields: nocoFields,
            context: 'updateTask',
            fallbackMessage: 'Failed to update task',
            localMutator: task => {
                this._applyLocalTaskUpdates(task, updates);
            }
        });
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
            this._handleMutationError('deleteTask', error, 'Failed to delete task');
            throw error;
        }
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

    _handleMutationError(context, error, fallbackMessage) {
        console.error(`NocoDBTaskService.${context} error:`, error);
        eventBus.emit(EVENTS.NOCODB_TASK_ERROR, {
            error: error.message || fallbackMessage
        });
    }

    /**
     * フィルタ適用済みタスク取得
     * @param {Object} filters - フィルタ条件
     * @returns {Array}
     */
    getFilteredTasks(filters = {}) {
        const normalizedFilters = this._normalizeFilters(filters);
        const filtered = this.tasks.filter(task => this._matchesFilters(task, normalizedFilters));
        return this._sortByPriority(filtered);
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

    async _applyTaskMutation({ taskId, fields, context, fallbackMessage, localMutator }) {
        const task = this._findTaskOrThrow(taskId);

        try {
            await this.repository.updateTask(
                task.nocodbRecordId,
                task.nocodbBaseId,
                fields
            );

            if (typeof localMutator === 'function') {
                localMutator(task);
            }

            this._syncTasksToStore();
            eventBus.emit(EVENTS.NOCODB_TASK_UPDATED, { task });

            return task;
        } catch (error) {
            this._handleMutationError(context, error, fallbackMessage);
            throw error;
        }
    }

    _applyLocalTaskUpdates(task, updates = {}) {
        if (!updates) {
            return;
        }

        if (updates.name) {
            task.title = updates.name;
            task.name = updates.name;
        }
        if (updates.priority) {
            task.priority = updates.priority;
        }
        if ('due' in updates) {
            task.due = updates.due;
            task.deadline = updates.due;
        }
        if ('description' in updates) {
            task.description = updates.description ?? '';
        }
        if ('assignee' in updates) {
            task.assignee = updates.assignee ?? '';
        }
        if (updates.status) {
            task.status = updates.status;
        }
    }

    _normalizeFilters(filters = {}) {
        const rawAssignee = typeof filters.assignee === 'string' ? filters.assignee.trim() : undefined;
        const searchText = typeof filters.searchText === 'string'
            ? filters.searchText.trim().toLowerCase()
            : '';

        return {
            project: typeof filters.project === 'string' ? filters.project : '',
            status: typeof filters.status === 'string' ? filters.status : '',
            hideCompleted: Boolean(filters.hideCompleted),
            priority: typeof filters.priority === 'string' ? filters.priority : '',
            isUnassignedFilter: rawAssignee === UNASSIGNED_FILTER_VALUE,
            assigneeLower: rawAssignee && rawAssignee !== UNASSIGNED_FILTER_VALUE
                ? rawAssignee.toLowerCase()
                : '',
            searchText,
            hasSearchText: Boolean(searchText)
        };
    }

    _matchesFilters(task, filters) {
        if (filters.project && task.project !== filters.project) {
            return false;
        }

        if (filters.status && task.status !== filters.status) {
            return false;
        }

        if (filters.hideCompleted && task.status === 'completed') {
            return false;
        }

        if (filters.priority && task.priority !== filters.priority) {
            return false;
        }

        if (filters.isUnassignedFilter) {
            if (task.assignee) {
                return false;
            }
        } else if (filters.assigneeLower) {
            const assignee = task.assignee?.toLowerCase() || '';
            if (assignee !== filters.assigneeLower) {
                return false;
            }
        }

        if (filters.hasSearchText && !this._taskMatchesSearch(task, filters.searchText)) {
            return false;
        }

        return true;
    }

    _taskMatchesSearch(task, text) {
        const title = typeof task.title === 'string' ? task.title.toLowerCase() : '';
        const description = typeof task.description === 'string' ? task.description.toLowerCase() : '';
        return title.includes(text) || description.includes(text);
    }

    _sortByPriority(tasks) {
        return tasks.sort((a, b) => {
            const aPriority = PRIORITY_SORT_ORDER[a.priority] ?? DEFAULT_PRIORITY_RANK;
            const bPriority = PRIORITY_SORT_ORDER[b.priority] ?? DEFAULT_PRIORITY_RANK;
            return aPriority - bPriority;
        });
    }
}
