import { eventBus, EVENTS } from '/modules/core/event-bus.js';
import { appStore } from '/modules/core/store.js';
import { NocoDBTaskAdapter } from './nocodb-task-adapter.js';
import { NocoDBTaskRepository } from './nocodb-task-repository.js';

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

            // イベント発火
            eventBus.emit(EVENTS.NOCODB_TASKS_LOADED, {
                tasks: this.tasks,
                projects: this.projects
            });

            return this.tasks;
        } catch (error) {
            this.error = error.message || 'Failed to load NocoDB tasks';
            console.error('NocoDBTaskService.loadTasks error:', error);

            eventBus.emit(EVENTS.NOCODB_TASK_ERROR, {
                error: this.error
            });

            throw error;
        } finally {
            this.loading = false;
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

        const nocoStatus = this.adapter.toNocoDBStatus(newStatus);

        try {
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
            console.error('NocoDBTaskService.updateStatus error:', error);
            eventBus.emit(EVENTS.NOCODB_TASK_ERROR, {
                error: error.message || 'Failed to update task'
            });
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
            return (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
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
