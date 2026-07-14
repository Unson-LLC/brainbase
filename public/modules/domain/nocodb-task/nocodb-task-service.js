// @ts-check
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';
import { NocoDBTaskAdapter } from './nocodb-task-adapter.js';
import { NocoDBTaskRepository } from './nocodb-task-repository.js';

/**
 * NocoDBTaskService
 * NocoDBタスクのビジネスロジック
 */
export class NocoDBTaskService {
    constructor({ httpClient, repository = null, adapter = null }) {
        this.repository = repository || new NocoDBTaskRepository({ httpClient });
        this.adapter = adapter || new NocoDBTaskAdapter();
        this.tasks = [];
        this.projects = [];
        this.loading = false;
        this.error = null;
        this.canonicalTaskStore = null;
    }

    /** catchブロック共通: ログ+エラーイベント+rethrow */
    _handleError(context, error) {
        console.error(`NocoDBTaskService.${context} error:`, error);
        eventBus.emit(EVENTS.NOCODB_TASK_ERROR, {
            error: error.message || `Failed to ${context}`
        });
        throw error;
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
            this.canonicalTaskStore = response.canonicalTaskStore || null;
            const rawTasks = (response.records || []).filter(record => record.baseId !== this.canonicalTaskStore?.baseId);
            this.projects = response.projects || [];

            const canonicalTasks = this.repository.hasBearerAuth()
                ? (await this.repository.fetchCanonicalTasks()).items || []
                : [];
            this.tasks = [
                ...canonicalTasks.map(task => this.adapter.toInternalCanonicalTask(task)),
                ...rawTasks.map(record => this.adapter.toInternalTask(record))
            ];

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
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) {
            throw new Error('Task not found');
        }

        try {
            if (task.canonicalTaskId) {
                this._assertCanonicalBearer();
                const result = await this.repository.transitionCanonicalTask(task.canonicalTaskId, {
                    expected_version: task.canonicalVersion,
                    to_status: newStatus
                }, this._operationKey('status'));
                const projected = this.adapter.toInternalCanonicalTask(result);
                Object.assign(task, projected);
                appStore.setState({ nocodbTasks: [...this.tasks] });
                eventBus.emit(EVENTS.NOCODB_TASK_UPDATED, { task });
                return task;
            }
            const nocoStatus = this.adapter.toNocoDBStatus(newStatus);
            await this.repository.updateTask(
                task.nocodbRecordId,
                task.nocodbBaseId,
                { 'ステータス': nocoStatus }
            );

            // ローカル状態更新
            task.status = newStatus;

            // Store更新
            appStore.setState({ nocodbTasks: [...this.tasks] });

            // イベント発火
            eventBus.emit(EVENTS.NOCODB_TASK_UPDATED, { task });

            return task;
        } catch (error) {
            this._handleError('updateStatus', error);
        }
    }

    /**
     * タスク更新（全フィールド対応）
     * @param {string} taskId - 内部タスクID
     * @param {Object} updates - 更新データ { name, priority, due, description }
     */
    async updateTask(taskId, updates) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) {
            throw new Error('Task not found');
        }

        try {
            if (task.canonicalTaskId) {
                this._assertCanonicalBearer();
                const payload = {
                    expected_version: task.canonicalVersion,
                    ...(updates.name ? { title: updates.name } : {}),
                    ...(updates.priority ? { priority: updates.priority } : {}),
                    ...(updates.due !== undefined ? { due_at: updates.due || null } : {}),
                    ...(updates.description !== undefined ? { description: updates.description } : {})
                };
                const result = await this.repository.updateCanonicalTask(task.canonicalTaskId, payload, this._operationKey('update'));
                Object.assign(task, this.adapter.toInternalCanonicalTask(result));
                appStore.setState({ nocodbTasks: [...this.tasks] });
                eventBus.emit(EVENTS.NOCODB_TASK_UPDATED, { task });
                return task;
            }
            const nocoFields = this.adapter.toNocoDBFields(updates);
            await this.repository.updateTask(
                task.nocodbRecordId,
                task.nocodbBaseId,
                nocoFields
            );

            // ローカル状態更新
            if (updates.name) task.title = updates.name;
            if (updates.priority) task.priority = updates.priority;
            if (updates.due !== undefined) task.due = updates.due;
            if (updates.description !== undefined) task.description = updates.description;
            if (updates.assignee !== undefined) task.assignee = updates.assignee;

            // Store更新
            appStore.setState({ nocodbTasks: [...this.tasks] });

            // イベント発火
            eventBus.emit(EVENTS.NOCODB_TASK_UPDATED, { task });

            return task;
        } catch (error) {
            this._handleError('updateTask', error);
        }
    }

    /**
     * タスク作成
     * @param {Object} payload - 新規タスク情報
     * @param {string} payload.projectId - プロジェクトID
     * @param {string} [payload.baseId] - NocoDB base ID
     * @param {string} payload.title - タスク名
     * @param {string} payload.assignee - 担当者
     * @param {string} payload.priority - 優先度
     * @param {string} payload.due - 期限
     * @param {string} payload.description - 説明
     */
    async createTask(payload) {
        try {
            if (this._isCanonicalProject(payload.projectId, payload.baseId)) {
                this._assertCanonicalBearer();
                const created = await this.repository.createCanonicalTask({
                    title: payload.title,
                    description: payload.description || null,
                    priority: payload.priority || 'medium',
                    due_at: payload.due || null,
                    source_refs: [{ type: 'brainbase_web', project: payload.projectId }]
                }, this._operationKey('create'));
                await this.loadTasks();
                eventBus.emit(EVENTS.NOCODB_TASK_CREATED, { task: created });
                return created;
            }
            const created = await this.repository.createTask(payload);
            await this.loadTasks();
            eventBus.emit(EVENTS.NOCODB_TASK_CREATED, { task: created });
            return created;
        } catch (error) {
            this._handleError('createTask', error);
        }
    }

    /**
     * タスク削除
     * @param {string} taskId - 内部タスクID
     */
    async deleteTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) {
            throw new Error('Task not found');
        }

        try {
            if (task.canonicalTaskId) {
                this._assertCanonicalBearer();
                await this.repository.deleteCanonicalTask(task.canonicalTaskId, task.canonicalVersion, this._operationKey('delete'));
            } else {
            await this.repository.deleteTask(
                task.nocodbRecordId,
                task.nocodbBaseId
            );
            }

            // ローカル状態から削除
            this.tasks = this.tasks.filter(t => t.id !== taskId);

            // Store更新
            appStore.setState({ nocodbTasks: [...this.tasks] });

            // イベント発火
            eventBus.emit(EVENTS.NOCODB_TASK_DELETED, { taskId });

            return { success: true };
        } catch (error) {
            this._handleError('deleteTask', error);
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
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        result.sort((a, b) => {
            return (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
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

    _isCanonicalProject(projectId, baseId) {
        return Boolean(this.canonicalTaskStore && (
            baseId === this.canonicalTaskStore.baseId
            || projectId === this.canonicalTaskStore.project
            || this.projects.some(project => project.id === projectId && project.canonicalTaskStore)
        ));
    }

    _assertCanonicalBearer() {
        if (!this.repository.hasBearerAuth()) {
            const error = /** @type {Error & {code: string}} */ (
                new Error('Canonical Task operations require bearer authentication')
            );
            error.code = 'task_bearer_required';
            throw error;
        }
    }

    _operationKey(action) {
        const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return `browser-${action}-${nonce}`;
    }
}
