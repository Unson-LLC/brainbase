import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';

/**
 * NocoDBTasksView
 * NocoDBタスク一覧の表示コンポーネント
 */
export class NocoDBTasksView {
    constructor({ nocodbTaskService }) {
        this.service = nocodbTaskService;
        this.container = null;
        this.unsubscribers = [];
        this.members = [];  // メンバーリスト（担当者ドロップダウン用）
        this.selfFilterValue = '__self__';
        this.unassignedFilterValue = '__unassigned__';
        this.currentFilter = this._createDefaultFilter();
    }

    _createDefaultFilter() {
        return {
            project: '',
            assignee: this.selfFilterValue,
            searchText: '',
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
            this._updateAssigneeFilter();
            this.render();
        });

        // NocoDB タスク更新
        const unsub2 = eventBus.on(EVENTS.NOCODB_TASK_UPDATED, () => this.render());

        // NocoDB タスク削除
        const unsub3 = eventBus.on(EVENTS.NOCODB_TASK_DELETED, () => this.render());

        // NocoDB エラー
        const unsub4 = eventBus.on(EVENTS.NOCODB_TASK_ERROR, (event) => {
            this._showError(event.detail?.error || 'エラーが発生しました');
        });

        const unsub5 = appStore.subscribe((change) => {
            if (change.key === 'preferences') {
                this._updateAssigneeFilter();
                this.render();
            }
        });

        this.unsubscribers.push(unsub1, unsub2, unsub3, unsub4, unsub5);
    }

    /**
     * タブ切り替え時の初期化
     */
    async onTabActivated() {
        // メンバーリストをロード（担当者ドロップダウン用）
        if (this.members.length === 0) {
            await this._loadMembers();
        }

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
     * メンバーリストを取得（担当者ドロップダウン用）
     */
    async _loadMembers() {
        try {
            const res = await fetch('/api/config/slack/members');
            const members = await res.json();
            // brainbase_nameを抽出し、重複を除去
            const names = members.map(m => m.brainbase_name).filter(Boolean);
            this.members = [...new Set(names)];
            this._updateAssigneeFilter();
        } catch (error) {
            console.warn('Failed to load members:', error);
            this.members = [];
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
     * 担当者フィルタの更新
     */
    _updateAssigneeFilter() {
        const assigneeFilter = document.getElementById('nocodb-assignee-filter');
        if (!assigneeFilter) return;

        const currentValue = assigneeFilter.value;
        const candidates = new Set();

        this.members.forEach(name => {
            if (name) candidates.add(name);
        });

        (this.service.tasks || []).forEach(task => {
            if (task.assignee) candidates.add(task.assignee);
        });

        const sorted = Array.from(candidates).sort((a, b) => a.localeCompare(b));

        assigneeFilter.innerHTML = `
            <option value="">全担当者</option>
            <option value="${this.selfFilterValue}">自分だけ</option>
            <option value="${this.unassignedFilterValue}">未割当</option>
        `;

        sorted.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            assigneeFilter.appendChild(option);
        });

        const desiredValue = this.currentFilter.assignee || currentValue || '';
        if (desiredValue) {
            this.currentFilter.assignee = desiredValue;
        }
        assigneeFilter.value = desiredValue;
        if (assigneeFilter.value !== desiredValue) {
            assigneeFilter.value = '';
            this.currentFilter.assignee = '';
        }
    }

    _setFilter(key, value, transform = (val) => val) {
        this.currentFilter[key] = transform(value);
        this.render();
    }

    /**
     * フィルタ変更ハンドラ
     */
    handleFilterChange(project) {
        this._setFilter('project', project);
    }

    /**
     * 担当者フィルタ変更ハンドラ
     */
    handleAssigneeFilterChange(assignee) {
        this._setFilter('assignee', assignee);
    }

    /**
     * タスク名検索変更ハンドラ
     */
    handleSearchFilterChange(searchText) {
        this._setFilter('searchText', (searchText || '').trim());
    }

    /**
     * 完了タスク表示トグル
     */
    handleHideCompletedChange(hideCompleted) {
        this._setFilter('hideCompleted', hideCompleted);
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

        const resolvedFilter = { ...this.currentFilter };
        const selfAssignee = appStore.getState().preferences?.user?.assignee?.trim() || '';
        if (resolvedFilter.assignee === this.selfFilterValue) {
            if (!selfAssignee) {
                this._showMissingSelfAssignee();
                return;
            }
            resolvedFilter.assignee = selfAssignee;
        }

        const tasks = this.service.getFilteredTasks(resolvedFilter);

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
     * 自分の担当者名が未設定の場合の表示
     */
    _showMissingSelfAssignee() {
        if (!this.container) return;
        this.container.innerHTML = `
            <div class="empty-state">
                <i data-lucide="user"></i>
                <p>「自分だけ」フィルタを使うには、Settings → Integrations で担当者名を設定してください</p>
                <button class="btn-secondary btn-sm" id="open-nocodb-self-settings">設定を開く</button>
            </div>
        `;

        const openBtn = this.container.querySelector('#open-nocodb-self-settings');
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                eventBus.emit('settings:open-tab', { tabId: 'integrations', subTab: 'nocodb' });
            });
        }

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
        const isOverdue = this._isOverdue(task.due);
        const dueDateHtml = task.due ? this._formatDueDate(task.due) : '';

        return `
            <div class="nocodb-task-item ${statusClass}${isOverdue ? ' overdue' : ''}" data-task-id="${task.id}">
                <div class="task-header">
                    <span class="project-badge">${this._escapeHtml(task.projectName || task.project)}</span>
                    <span class="priority-indicator">${priorityEmoji}</span>
                    <div class="nocodb-task-actions">
                        <button class="nocodb-task-action-btn nocodb-task-start-btn" data-task-id="${task.id}" title="セッションを開始">
                            <i data-lucide="play"></i>
                        </button>
                        <button class="nocodb-task-action-btn nocodb-task-edit-btn" data-task-id="${task.id}" title="編集">
                            <i data-lucide="edit-2"></i>
                        </button>
                        <button class="nocodb-task-action-btn nocodb-task-delete-btn" data-task-id="${task.id}" title="削除">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
                <div class="task-title">${this._escapeHtml(task.title)}</div>
                <div class="task-meta">
                    ${dueDateHtml}
                    <select class="task-status-select" data-task-id="${task.id}">
                        <option value="pending" ${task.status === 'pending' ? 'selected' : ''}>未着手</option>
                        <option value="in_progress" ${task.status === 'in_progress' ? 'selected' : ''}>進行中</option>
                        <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>完了</option>
                    </select>
                    <div class="assignee-combobox" data-task-id="${task.id}">
                        <button class="assignee-trigger" type="button">
                            <i data-lucide="user" class="assignee-icon"></i>
                            <span class="assignee-value">${this._escapeHtml(task.assignee || '未割当')}</span>
                            <i data-lucide="chevron-down" class="chevron-icon"></i>
                        </button>
                        <div class="assignee-popover" style="display: none;">
                            <input type="text" class="assignee-search" placeholder="検索...">
                            <div class="assignee-options">
                                ${this._renderComboboxOptions(task.assignee)}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Combobox用のオプションを生成
     */
    _renderComboboxOptions(currentAssignee) {
        let options = `<div class="assignee-option ${!currentAssignee ? 'selected' : ''}" data-value="">
            <span class="option-text">未割当</span>
            ${!currentAssignee ? '<i data-lucide="check" class="check-icon"></i>' : ''}
        </div>`;

        for (const name of this.members) {
            const isSelected = name === currentAssignee;
            options += `<div class="assignee-option ${isSelected ? 'selected' : ''}" data-value="${this._escapeHtml(name)}">
                <span class="option-text">${this._escapeHtml(name)}</span>
                ${isSelected ? '<i data-lucide="check" class="check-icon"></i>' : ''}
            </div>`;
        }

        // 現在の担当者がリストにない場合
        if (currentAssignee && !this.members.includes(currentAssignee)) {
            options = `<div class="assignee-option" data-value="">
                <span class="option-text">未割当</span>
            </div>
            <div class="assignee-option selected" data-value="${this._escapeHtml(currentAssignee)}">
                <span class="option-text">${this._escapeHtml(currentAssignee)} ⚠️</span>
                <i data-lucide="check" class="check-icon"></i>
            </div>`;
            for (const name of this.members) {
                options += `<div class="assignee-option" data-value="${this._escapeHtml(name)}">
                    <span class="option-text">${this._escapeHtml(name)}</span>
                </div>`;
            }
        }

        return options;
    }

    /**
     * 期限切れかどうか判定
     * @param {string|null} dueStr - 期限日
     * @returns {boolean}
     */
    _isOverdue(dueStr) {
        if (!dueStr) return false;
        const due = new Date(dueStr);
        due.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return due < today;
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
        // ステータス変更
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

        // 担当者Combobox
        this._attachComboboxHandlers();

        // 開始ボタン - セッション作成
        this.container.querySelectorAll('.nocodb-task-start-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const taskId = btn.dataset.taskId;
                const task = this.service.tasks.find(t => t.id === taskId);
                if (task) {
                    eventBus.emit(EVENTS.START_TASK, { task });
                }
            });
        });

        // 編集ボタン
        this.container.querySelectorAll('.nocodb-task-edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const taskId = btn.dataset.taskId;
                const task = this.service.tasks.find(t => t.id === taskId);
                if (task) {
                    eventBus.emit(EVENTS.EDIT_TASK, { task });
                }
            });
        });

        // 削除ボタン
        this.container.querySelectorAll('.nocodb-task-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const taskId = btn.dataset.taskId;
                const task = this.service.tasks.find(t => t.id === taskId);

                if (task && confirm(`「${task.title}」を削除しますか？`)) {
                    try {
                        await this.service.deleteTask(taskId);
                    } catch (error) {
                        console.error('Failed to delete task:', error);
                        this._showError('タスクの削除に失敗しました');
                    }
                }
            });
        });
    }

    /**
     * Comboboxイベントハンドラをアタッチ
     */
    _attachComboboxHandlers() {
        this.container.querySelectorAll('.assignee-combobox').forEach(combobox => {
            const trigger = combobox.querySelector('.assignee-trigger');
            const popover = combobox.querySelector('.assignee-popover');
            const searchInput = combobox.querySelector('.assignee-search');
            const optionsContainer = combobox.querySelector('.assignee-options');
            const taskId = combobox.dataset.taskId;

            // トリガークリックでポップオーバー表示/非表示
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = popover.style.display !== 'none';

                // 他のポップオーバーを閉じる
                this.container.querySelectorAll('.assignee-popover').forEach(p => {
                    p.style.display = 'none';
                });

                if (!isOpen) {
                    popover.style.display = 'block';
                    searchInput.value = '';
                    searchInput.focus();
                    this._filterOptions(optionsContainer, '');
                }
            });

            // 検索入力でフィルタリング
            searchInput.addEventListener('input', (e) => {
                this._filterOptions(optionsContainer, e.target.value);
            });

            // ESCキーで閉じる
            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    popover.style.display = 'none';
                }
            });

            // オプション選択
            optionsContainer.addEventListener('click', async (e) => {
                const option = e.target.closest('.assignee-option');
                if (!option) return;

                const newAssignee = option.dataset.value;
                popover.style.display = 'none';

                try {
                    await this.service.updateTask(taskId, { assignee: newAssignee });
                } catch (error) {
                    console.error('Failed to update assignee:', error);
                    this.render();
                }
            });
        });

        // クリックアウトでポップオーバーを閉じる
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.assignee-combobox')) {
                this.container?.querySelectorAll('.assignee-popover').forEach(p => {
                    p.style.display = 'none';
                });
            }
        });
    }

    /**
     * オプションをフィルタリング
     */
    _filterOptions(container, searchTerm) {
        const term = searchTerm.toLowerCase();
        container.querySelectorAll('.assignee-option').forEach(option => {
            const text = option.querySelector('.option-text').textContent.toLowerCase();
            option.style.display = text.includes(term) ? 'flex' : 'none';
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
