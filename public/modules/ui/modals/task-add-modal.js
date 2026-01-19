/**
 * タスク追加モーダル
 */
export class TaskAddModal {
    constructor({ taskService, nocodbTaskService }) {
        this.taskService = taskService;
        this.nocodbTaskService = nocodbTaskService;
        this.modalElement = null;
        this._unsubscribers = [];
        this.mode = 'local';
        this.projects = [];
        this.nocodbProjects = [];
        this._configLoaded = false;
    }

    /**
     * モーダルをマウント
     */
    mount() {
        this.modalElement = document.getElementById('add-task-modal');
        if (!this.modalElement) {
            console.warn('TaskAddModal: #add-task-modal not found');
            return;
        }

        this._attachEventHandlers();
    }

    /**
     * モーダルを開く
     */
    async open({ mode = 'local' } = {}) {
        if (!this.modalElement) return;

        this.mode = mode;
        this._setModalTitle();

        // フォームをクリア
        await this._clearForm();

        // モーダルを表示
        this.modalElement.classList.add('active');

        // タイトル入力にフォーカス
        const titleInput = document.getElementById('add-task-title');
        if (titleInput) {
            setTimeout(() => titleInput.focus(), 100);
        }
    }

    /**
     * モーダルを閉じる
     */
    close() {
        if (!this.modalElement) return;

        this.modalElement.classList.remove('active');
        this._clearForm();
    }

    /**
     * フォームをクリア
     */
    async _clearForm() {
        const titleInput = document.getElementById('add-task-title');
        const assigneeInput = document.getElementById('add-task-assignee');
        const projectInput = document.getElementById('add-task-project');
        const priorityInput = document.getElementById('add-task-priority');
        const dueInput = document.getElementById('add-task-due');
        const descriptionInput = document.getElementById('add-task-description');

        if (titleInput) titleInput.value = '';
        if (assigneeInput) assigneeInput.value = this._getDefaultAssignee();
        await this._populateProjectSelect();
        if (priorityInput) priorityInput.value = 'medium';
        if (dueInput) dueInput.value = this._getDefaultDueDate();
        if (descriptionInput) descriptionInput.value = '';

        // エラー表示をクリア
        this._hideError();
    }

    /**
     * タスクを保存
     */
    async save() {
        const titleInput = document.getElementById('add-task-title');
        const assigneeInput = document.getElementById('add-task-assignee');
        const projectInput = document.getElementById('add-task-project');
        const priorityInput = document.getElementById('add-task-priority');
        const dueInput = document.getElementById('add-task-due');
        const descriptionInput = document.getElementById('add-task-description');

        const title = titleInput?.value?.trim() || '';
        let assignee = assigneeInput?.value?.trim() || '';
        let priority = priorityInput?.value || '';
        let due = dueInput?.value || '';

        // バリデーション
        if (!title) {
            this._showError('タスク名は必須です');
            titleInput?.focus();
            return;
        }
        if (!assignee) {
            assignee = this._getDefaultAssignee();
            if (assigneeInput) assigneeInput.value = assignee;
        }
        if (!priority) {
            priority = 'medium';
            if (priorityInput) priorityInput.value = priority;
        }
        if (!due) {
            due = this._getDefaultDueDate();
            if (dueInput) dueInput.value = due;
        }
        if (!assignee) {
            this._showError('担当者は必須です');
            assigneeInput?.focus();
            return;
        }
        if (!due) {
            this._showError('期限は必須です');
            dueInput?.focus();
            return;
        }

        const project = projectInput?.value || (this.mode === 'nocodb' ? '' : 'general');
        if (!project) {
            this._showError('プロジェクトは必須です');
            projectInput?.focus();
            return;
        }

        try {
            if (this.mode === 'nocodb') {
                if (!this.nocodbTaskService) {
                    throw new Error('NocoDBタスクサービスが初期化されていません');
                }
                await this.nocodbTaskService.createTask({
                    projectId: project,
                    title,
                    assignee,
                    priority,
                    due,
                    description: descriptionInput?.value || ''
                });
            } else {
                await this.taskService.createTask({
                    title,
                    project,
                    priority,
                    due,
                    description: descriptionInput?.value || '',
                    owner: assignee
                });
            }
            this.close();
        } catch (error) {
            console.error('Failed to create task:', error);
            this._showError('タスクの作成に失敗しました');
        }
    }

    /**
     * エラーを表示
     * @param {string} message - エラーメッセージ
     */
    _showError(message) {
        const errorElement = document.getElementById('add-task-error');
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
    }

    /**
     * エラーを非表示
     */
    _hideError() {
        const errorElement = document.getElementById('add-task-error');
        if (errorElement) {
            errorElement.textContent = '';
            errorElement.style.display = 'none';
        }
    }

    /**
     * イベントハンドラーをアタッチ
     */
    _attachEventHandlers() {
        // 閉じるボタン
        const closeBtns = this.modalElement.querySelectorAll('.close-modal-btn');
        closeBtns.forEach(btn => {
            btn.addEventListener('click', () => this.close());
        });

        // 保存ボタン
        const saveBtn = document.getElementById('save-add-task-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.save());
        }

        // バックドロップクリック
        this.modalElement.addEventListener('click', (e) => {
            if (e.target === this.modalElement) {
                this.close();
            }
        });

        // Enterキーで保存（タイトル入力欄）
        // IME変換中（isComposing）はスキップ
        const titleInput = document.getElementById('add-task-title');
        if (titleInput) {
            titleInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                    e.preventDefault();
                    this.save();
                }
            });
        }
    }

    /**
     * モーダルタイトルを更新
     */
    _setModalTitle() {
        const titleEl = document.getElementById('add-task-modal-title');
        if (!titleEl) return;
        titleEl.textContent = this.mode === 'nocodb' ? 'プロジェクトタスク追加' : 'ローカルタスク追加';
    }

    /**
     * デフォルト担当者名を取得
     */
    _getDefaultAssignee() {
        return '自分';
    }

    /**
     * 1週間後の期限日を取得
     */
    _getDefaultDueDate() {
        const date = new Date();
        date.setDate(date.getDate() + 7);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * プロジェクト一覧を読み込み
     */
    async _loadProjects() {
        if (this._configLoaded) return;

        try {
            const res = await fetch('/api/config/projects');
            if (!res.ok) {
                throw new Error('Failed to load project config');
            }
            const data = await res.json();
            const projects = data.projects || [];
            this.projects = projects.filter(p => !p.archived);
            this.nocodbProjects = this.projects.filter(p => p.nocodb);
            this._configLoaded = true;
        } catch (error) {
            console.warn('Failed to load projects:', error);
            this.projects = [];
            this.nocodbProjects = [];
        }
    }

    /**
     * プロジェクト選択肢を更新
     */
    async _populateProjectSelect() {
        const projectInput = document.getElementById('add-task-project');
        if (!projectInput) return;

        await this._loadProjects();

        const list = this.mode === 'nocodb' ? this.nocodbProjects : this.projects;
        const previousValue = projectInput.value;

        projectInput.innerHTML = '';

        if (list.length === 0) {
            const option = document.createElement('option');
            option.value = 'general';
            option.textContent = 'general';
            projectInput.appendChild(option);
            projectInput.value = 'general';
            return;
        }

        if (this.mode !== 'nocodb') {
            const generalOption = document.createElement('option');
            generalOption.value = 'general';
            generalOption.textContent = 'general';
            projectInput.appendChild(generalOption);
        }

        list.forEach(project => {
            const option = document.createElement('option');
            option.value = project.id;
            option.textContent = this.mode === 'nocodb'
                ? (project.nocodb?.base_name || project.id)
                : project.id;
            projectInput.appendChild(option);
        });

        const optionValues = Array.from(projectInput.options).map(opt => opt.value);
        if (previousValue && optionValues.includes(previousValue)) {
            projectInput.value = previousValue;
        } else {
            projectInput.value = this.mode === 'nocodb'
                ? (list[0]?.id || '')
                : 'general';
        }
    }

    /**
     * クリーンアップ
     */
    unmount() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        this.modalElement = null;
    }
}
