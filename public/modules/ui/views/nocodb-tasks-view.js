import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';
import { getProjectConfig } from '../../project-mapping.js';
import { escapeHtml, refreshIcons, formatDueDate } from '../../ui-helpers.js';
import { BaseView } from './base-view.js';

/**
 * NocoDBTasksView
 * NocoDBタスク一覧の表示コンポーネント
 */
export class NocoDBTasksView extends BaseView {
    constructor({ nocodbTaskService }) {
        super();
        this.service = nocodbTaskService;
        this.members = [];  // メンバーリスト（担当者ドロップダウン用）
        this.selfFilterValue = '__self__';
        this.unassignedFilterValue = '__unassigned__';
        this.currentFilter = {
            project: '',
            assignee: this.selfFilterValue,
            searchText: '',
            hideCompleted: true
        };
        this.openStatusTaskId = null;
    }

    /**
     * DOMコンテナにマウント
     * @param {HTMLElement} container - マウント先のコンテナ
     */
    _setupEventListeners() {
        this._renderOn(eventBus, EVENTS.NOCODB_TASK_UPDATED, EVENTS.NOCODB_TASK_DELETED);
        this._addSubscriptions(
            eventBus.on(EVENTS.NOCODB_TASKS_LOADED, () => {
                this._updateProjectFilter();
                this._updateAssigneeFilter();
                this.render();
            }),
            eventBus.on(EVENTS.NOCODB_TASK_ERROR, (event) => {
                this._showError(event.detail?.error || 'エラーが発生しました');
            }),
            appStore.subscribe((change) => {
                if (change.key === 'preferences') {
                    this._updateAssigneeFilter();
                    this.render();
                }
            })
        );
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

    /**
     * フィルタ変更ハンドラ
     */
    handleFilterChange(project) {
        this.currentFilter.project = project;
        this.render();
    }

    /**
     * 担当者フィルタ変更ハンドラ
     */
    handleAssigneeFilterChange(assignee) {
        this.currentFilter.assignee = assignee;
        this.render();
    }

    /**
     * タスク名検索変更ハンドラ
     */
    handleSearchFilterChange(searchText) {
        this.currentFilter.searchText = searchText.trim();
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
        refreshIcons();
    }

    /**
     * エラー表示
     */
    _showError(message) {
        if (!this.container) return;
        this.container.innerHTML = `
            <div class="error-state">
                <i data-lucide="alert-circle"></i>
                <p>${escapeHtml(message)}</p>
                <button class="btn-secondary btn-sm" onclick="document.getElementById('nocodb-sync-btn')?.click()">
                    再試行
                </button>
            </div>
        `;
        refreshIcons();
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
        if (this.openStatusTaskId && !tasks.some(task => task.id === this.openStatusTaskId)) {
            this.openStatusTaskId = null;
        }

        if (tasks.length === 0) {
            this.container.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="inbox"></i>
                    <p>担当タスクがありません</p>
                </div>
            `;
            refreshIcons();
            return;
        }

        this.container.innerHTML = tasks.map(task => this._renderTaskItem(task)).join('');
        this._attachStatusHandlers();

        refreshIcons();
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

        refreshIcons();
    }

    /**
     * タスクアイテムのHTML生成
     */
    _renderTaskItem(task) {
        const priorityClass = ['high', 'medium', 'low'].includes(task.priority) ? task.priority : 'normal';

        const statusClass = task.status === 'completed' ? 'completed' : '';
        const statusTone = this._getStatusTone(task.status);
        const statusLabel = this._getStatusLabel(task.status);
        const isOverdue = this._isOverdue(task.due);
        const dueDateHtml = task.due ? this._formatDueDate(task.due) : '';
        const assignee = task.assignee || '未割当';
        const assigneeInitials = this._getAssigneeInitials(assignee);
        const isStatusOpen = this.openStatusTaskId === task.id;
        const projectLabel = task.projectName || task.project || 'Project';
        const projectIconHtml = this._renderProjectIcon(task.project || projectLabel, projectLabel);
        const escapedTitle = escapeHtml(task.title);

        return `
            <div class="nocodb-task-item ${statusClass}${isOverdue ? ' overdue' : ''}" data-task-id="${task.id}">
                <div class="task-header">
                    <span class="project-badge" title="${escapeHtml(projectLabel)}" aria-label="${escapeHtml(projectLabel)}">${projectIconHtml}</span>
                    <span class="priority-indicator ${priorityClass}" aria-label="優先度: ${escapeHtml(task.priority || 'normal')}"></span>
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
                <div class="task-title" tabindex="0" data-full-title="${escapedTitle}" aria-label="${escapedTitle}">
                    <span class="task-title-text">${escapedTitle}</span>
                </div>
                <div class="task-meta">
                    ${dueDateHtml}
                    <div class="task-status-combobox" data-task-id="${task.id}">
                        <button class="task-status-select status-${statusTone}" type="button" data-task-id="${task.id}" data-status-value="${escapeHtml(task.status)}" aria-haspopup="listbox" aria-expanded="${isStatusOpen}" aria-label="ステータス: ${escapeHtml(statusLabel)}">
                            <span class="task-status-label">${escapeHtml(statusLabel)}</span>
                            <i data-lucide="chevron-down" class="task-status-chevron"></i>
                        </button>
                        <div class="task-status-menu" role="listbox" style="display: ${isStatusOpen ? 'block' : 'none'};">
                            ${this._renderStatusOptions(task.status)}
                        </div>
                    </div>
                    <div class="assignee-combobox" data-task-id="${task.id}">
                        <button class="assignee-trigger" type="button" title="${escapeHtml(assignee)}">
                            <span class="assignee-avatar" aria-hidden="true">${escapeHtml(assigneeInitials)}</span>
                            <span class="assignee-value">${escapeHtml(assignee)}</span>
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

    _isLucideIconName(value) {
        return typeof value === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value.trim());
    }

    _renderProjectIcon(projectId, projectName) {
        const projectConfig = getProjectConfig(projectId);
        const configuredIcon = String(projectConfig?.icon || projectConfig?.emoji || '').trim();
        if (configuredIcon) {
            if (this._isLucideIconName(configuredIcon)) {
                return `<i data-lucide="${escapeHtml(configuredIcon)}"></i>`;
            }
            return `<span class="project-badge-text">${escapeHtml(configuredIcon)}</span>`;
        }

        const initials = String(projectName || 'Project')
            .split(/[\s._-]+/)
            .filter(Boolean)
            .map(part => Array.from(part)[0])
            .join('')
            .slice(0, 2)
            .toUpperCase() || 'P';
        return `<span class="project-badge-text">${escapeHtml(initials)}</span>`;
    }

    _getStatusTone(status) {
        if (status === 'completed') return 'completed';
        if (status === 'in_progress') return 'progress';
        if (status === 'review' || status === 'review_waiting') return 'review';
        if (status === 'generating' || status === 'generated') return 'generating';
        return 'pending';
    }

    _getStatusLabel(status) {
        if (status === 'completed') return '完了';
        if (status === 'in_progress') return '進行中';
        if (status === 'review' || status === 'review_waiting') return 'レビュー待ち';
        if (status === 'generating' || status === 'generated') return '生成中';
        return '未着手';
    }

    _getStatusOptions() {
        return [
            { value: 'pending', label: '未着手', tone: 'pending' },
            { value: 'in_progress', label: '進行中', tone: 'progress' },
            { value: 'completed', label: '完了', tone: 'completed' }
        ];
    }

    _renderStatusOptions(currentStatus) {
        return this._getStatusOptions().map((option) => {
            const selected = option.value === currentStatus;
            return `
                <button class="task-status-option status-${option.tone}${selected ? ' selected' : ''}" type="button" role="option" aria-selected="${selected}" data-status-value="${option.value}">
                    <span>${escapeHtml(option.label)}</span>
                    ${selected ? '<i data-lucide="check" class="check-icon"></i>' : ''}
                </button>
            `;
        }).join('');
    }

    _getAssigneeInitials(assignee) {
        const text = String(assignee || '').trim();
        if (!text || text === '未割当') return '未';
        const parts = text.split(/[\s._-]+/).filter(Boolean);
        if (parts.length >= 2) {
            return parts.map((part) => Array.from(part)[0]).join('').slice(0, 2).toUpperCase();
        }
        return Array.from(text).slice(0, 2).join('').toUpperCase();
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
            options += `<div class="assignee-option ${isSelected ? 'selected' : ''}" data-value="${escapeHtml(name)}">
                <span class="option-text">${escapeHtml(name)}</span>
                ${isSelected ? '<i data-lucide="check" class="check-icon"></i>' : ''}
            </div>`;
        }

        // 現在の担当者がリストにない場合
        if (currentAssignee && !this.members.includes(currentAssignee)) {
            options = `<div class="assignee-option" data-value="">
                <span class="option-text">未割当</span>
            </div>
            <div class="assignee-option selected" data-value="${escapeHtml(currentAssignee)}">
                <span class="option-text">${escapeHtml(currentAssignee)} (未登録)</span>
                <i data-lucide="check" class="check-icon"></i>
            </div>`;
            for (const name of this.members) {
                options += `<div class="assignee-option" data-value="${escapeHtml(name)}">
                    <span class="option-text">${escapeHtml(name)}</span>
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

        const text = formatDueDate(dueStr);
        const isUrgent = text === '期限切れ' || text === '今日';

        return `<span class="deadline ${isUrgent ? 'urgent' : ''}"><i data-lucide="calendar"></i> ${text}</span>`;
    }

    /**
     * ステータス変更ハンドラをアタッチ
     */
    _attachStatusHandlers() {
        this.container.querySelectorAll('.task-status-combobox').forEach(combobox => {
            const trigger = combobox.querySelector('.task-status-select');
            const menu = combobox.querySelector('.task-status-menu');
            const taskId = combobox.dataset.taskId;
            const keepInteractionLocal = (e) => {
                e.stopPropagation();
            };

            const closeMenu = () => {
                menu.style.display = 'none';
                trigger.setAttribute('aria-expanded', 'false');
                if (this.openStatusTaskId === taskId) {
                    this.openStatusTaskId = null;
                }
            };

            const openMenu = () => {
                this.openStatusTaskId = taskId;
                this.container.querySelectorAll('.task-status-menu').forEach(p => {
                    p.style.display = 'none';
                });
                this.container.querySelectorAll('.task-status-select').forEach(button => {
                    button.setAttribute('aria-expanded', 'false');
                });
                this.container.querySelectorAll('.assignee-popover').forEach(p => {
                    p.style.display = 'none';
                });
                menu.style.display = 'block';
                trigger.setAttribute('aria-expanded', 'true');
            };

            const toggleMenu = () => {
                if (menu.style.display === 'none') {
                    openMenu();
                    return;
                }
                closeMenu();
            };

            trigger.addEventListener('pointerdown', keepInteractionLocal);
            trigger.addEventListener('mousedown', keepInteractionLocal);
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleMenu();
            });
            trigger.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleMenu();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    openMenu();
                    menu.querySelector('.task-status-option')?.focus();
                } else if (e.key === 'Escape') {
                    closeMenu();
                }
            });

            menu.addEventListener('pointerdown', keepInteractionLocal);
            menu.addEventListener('mousedown', keepInteractionLocal);
            menu.addEventListener('click', async (e) => {
                e.stopPropagation();
                const option = e.target.closest('.task-status-option');
                if (!option) return;

                const newStatus = option.dataset.statusValue;
                closeMenu();

                try {
                    await this.service.updateStatus(taskId, newStatus);
                } catch (error) {
                    console.error('Failed to update status:', error);
                    // リバート
                    this.render();
                }
            });
            menu.addEventListener('keydown', (e) => {
                e.stopPropagation();
                const option = e.target.closest('.task-status-option');
                if ((e.key === 'Enter' || e.key === ' ') && option) {
                    e.preventDefault();
                    option.click();
                } else if (e.key === 'Escape') {
                    closeMenu();
                    trigger.focus();
                }
            });
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.task-status-combobox')) {
                this.openStatusTaskId = null;
                this.container?.querySelectorAll('.task-status-menu').forEach(menu => {
                    menu.style.display = 'none';
                });
                this.container?.querySelectorAll('.task-status-select').forEach(trigger => {
                    trigger.setAttribute('aria-expanded', 'false');
                });
            }
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
     * クリーンアップ
     */
}
