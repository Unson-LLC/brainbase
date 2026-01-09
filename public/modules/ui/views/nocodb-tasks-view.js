import { eventBus, EVENTS } from '/modules/core/event-bus.js';
import { appStore } from '/modules/core/store.js';

/**
 * NocoDBTasksView
 * NocoDBタスク一覧の表示コンポーネント
 */
export class NocoDBTasksView {
    constructor({ nocodbTaskService }) {
        this.service = nocodbTaskService;
        this.container = null;
        this.unsubscribers = [];
        this.currentFilter = {
            project: '',
            hideCompleted: true
        };
    }

    /**
     * DOMコンテナにマウント
     * @param {HTMLElement} container - マウント先のコンテナ
     */
    mount(container) {
        this.container = container;
        this._setupEventListeners();
        this.render();
    }

    /**
     * イベントリスナーの設定
     */
    _setupEventListeners() {
        // NocoDB タスク読み込み完了
        const unsub1 = eventBus.on(EVENTS.NOCODB_TASKS_LOADED, () => {
            this._updateProjectFilter();
            this.render();
        });

        // NocoDB タスク更新
        const unsub2 = eventBus.on(EVENTS.NOCODB_TASK_UPDATED, () => this.render());

        // NocoDB エラー
        const unsub3 = eventBus.on(EVENTS.NOCODB_TASK_ERROR, (event) => {
            this._showError(event.detail?.error || 'エラーが発生しました');
        });

        this.unsubscribers.push(unsub1, unsub2, unsub3);
    }

    /**
     * タブ切り替え時の初期化
     */
    async onTabActivated() {
        // 初回またはデータなしの場合のみロード
        if (this.service.tasks.length === 0) {
            this._showLoading();
            try {
                await this.service.loadTasks();
            } catch (error) {
                this._showError(error.message);
            }
        }
    }

    /**
     * プロジェクトフィルタの更新
     */
    _updateProjectFilter() {
        const projectFilter = document.getElementById('nocodb-project-filter');
        if (!projectFilter) return;

        const projects = this.service.getProjects();
        const currentValue = projectFilter.value;

        // オプションを再構築
        projectFilter.innerHTML = '<option value="">全プロジェクト</option>';
        projects.forEach(p => {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = p.name || p.id;
            projectFilter.appendChild(option);
        });

        // 元の値を復元
        if (currentValue) {
            projectFilter.value = currentValue;
        }
    }

    /**
     * フィルタ変更ハンドラ
     */
    handleFilterChange(project) {
        this.currentFilter.project = project;
        this.render();
    }

    /**
     * 完了タスク表示トグル
     */
    handleHideCompletedChange(hideCompleted) {
        this.currentFilter.hideCompleted = hideCompleted;
        this.render();
    }

    /**
     * 同期ボタンハンドラ
     */
    async handleSync() {
        const syncBtn = document.getElementById('nocodb-sync-btn');
        if (syncBtn) {
            syncBtn.classList.add('spinning');
        }

        try {
            await this.service.loadTasks();
        } catch (error) {
            this._showError(error.message);
        } finally {
            if (syncBtn) {
                syncBtn.classList.remove('spinning');
            }
        }
    }

    /**
     * ローディング表示
     */
    _showLoading() {
        if (!this.container) return;
        this.container.innerHTML = `
            <div class="loading">
                <i data-lucide="loader-2" class="spin"></i>
                <span>NocoDB タスクを読み込み中...</span>
            </div>
        `;
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    /**
     * エラー表示
     */
    _showError(message) {
        if (!this.container) return;
        this.container.innerHTML = `
            <div class="error-state">
                <i data-lucide="alert-circle"></i>
                <p>${this._escapeHtml(message)}</p>
                <button class="btn-secondary btn-sm" onclick="document.getElementById('nocodb-sync-btn')?.click()">
                    再試行
                </button>
            </div>
        `;
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    /**
     * タスク一覧をレンダリング
     */
    render() {
        if (!this.container) return;

        if (this.service.isLoading()) {
            this._showLoading();
            return;
        }

        const tasks = this.service.getFilteredTasks(this.currentFilter);

        if (tasks.length === 0) {
            this.container.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="inbox"></i>
                    <p>担当タスクがありません</p>
                </div>
            `;
            if (window.lucide) {
                window.lucide.createIcons();
            }
            return;
        }

        this.container.innerHTML = tasks.map(task => this._renderTaskItem(task)).join('');
        this._attachStatusHandlers();

        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    /**
     * タスクアイテムのHTML生成
     */
    _renderTaskItem(task) {
        const priorityEmoji = {
            high: '🔴',
            medium: '🟡',
            low: '🔵'
        }[task.priority] || '';

        const statusClass = task.status === 'completed' ? 'completed' : '';
        const dueDateHtml = task.due ? this._formatDueDate(task.due) : '';

        return `
            <div class="nocodb-task-item ${statusClass}" data-task-id="${task.id}">
                <div class="task-header">
                    <span class="project-badge">${this._escapeHtml(task.projectName || task.project)}</span>
                    <span class="priority-indicator">${priorityEmoji}</span>
                </div>
                <div class="task-title">${this._escapeHtml(task.title)}</div>
                <div class="task-meta">
                    ${dueDateHtml}
                    <select class="task-status-select" data-task-id="${task.id}">
                        <option value="pending" ${task.status === 'pending' ? 'selected' : ''}>未着手</option>
                        <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>進行中</option>
                        <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>完了</option>
                    </select>
                </div>
            </div>
        `;
    }

    /**
     * Due date formatting
     */
    _formatDueDate(dueStr) {
        if (!dueStr) return '';

        const due = new Date(dueStr);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const dueDate = new Date(due);
        dueDate.setHours(0, 0, 0, 0);

        let text = '';
        let isUrgent = false;

        if (dueDate < today) {
            text = '期限切れ';
            isUrgent = true;
        } else if (dueDate.getTime() === today.getTime()) {
            text = '今日';
            isUrgent = true;
        } else if (dueDate.getTime() === tomorrow.getTime()) {
            text = '明日';
        } else {
            const month = due.getMonth() + 1;
            const day = due.getDate();
            text = `${month}/${day}`;
        }

        return `<span class="deadline ${isUrgent ? 'urgent' : ''}"><i data-lucide="calendar"></i> ${text}</span>`;
    }

    /**
     * ステータス変更ハンドラをアタッチ
     */
    _attachStatusHandlers() {
        this.container.querySelectorAll('.task-status-select').forEach(select => {
            select.addEventListener('change', async (e) => {
                const taskId = e.target.dataset.taskId;
                const newStatus = e.target.value;

                try {
                    await this.service.updateStatus(taskId, newStatus);
                } catch (error) {
                    console.error('Failed to update status:', error);
                    // リバート
                    this.render();
                }
            });
        });
    }

    /**
     * HTMLエスケープ
     */
    _escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * クリーンアップ
     */
    unmount() {
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
        if (this.container) {
            this.container.innerHTML = '';
            this.container = null;
        }
    }
}
