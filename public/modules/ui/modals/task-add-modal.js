// @ts-check
import { appStore } from '../../core/store.js';
import { BaseModal } from './base-modal.js';

const ERROR_ID = 'add-task-error';

/**
 * タスク追加モーダル（NocoDBタスクのみ）
 */
export class TaskAddModal extends BaseModal {
    constructor({ nocodbTaskService }) {
        super('add-task-modal');
        this.nocodbTaskService = nocodbTaskService;
        this.nocodbProjects = [];
        this._configLoaded = false;
    }

    async open() {
        if (!this.modalElement) return;

        this._setModalTitle();
        await this._clearForm();
        this.modalElement.classList.add('active');
        setTimeout(() => this._focus('add-task-title'), 100);
    }

    close() {
        super.close();
        this._clearForm();
    }

    async _clearForm() {
        this._setVal('add-task-title', '');
        this._setVal('add-task-assignee', this._getDefaultAssignee());
        await this._populateProjectSelect();
        this._setVal('add-task-priority', 'medium');
        this._setVal('add-task-due', this._getDefaultDueDate());
        this._setVal('add-task-description', '');
        this._hideError(ERROR_ID);
    }

    async save() {
        const title = this._val('add-task-title');
        let assignee = this._val('add-task-assignee');
        let priority = this._val('add-task-priority');
        let due = this._val('add-task-due');
        const description = this._val('add-task-description');

        if (!title) {
            this._showError(ERROR_ID, 'タスク名は必須です');
            this._focus('add-task-title');
            return;
        }
        const project = this._val('add-task-project');
        const canonicalProject = this._isCanonicalProject(project);
        const assigneePersonId = canonicalProject ? this._getAuthenticatedPersonId() : '';
        if (canonicalProject && !assigneePersonId) {
            this._showError(ERROR_ID, '担当者を特定するため再認証してください');
            return;
        }
        if (!canonicalProject && !assignee) {
            assignee = this._getDefaultAssignee();
            this._setVal('add-task-assignee', assignee);
        }
        if (!priority) {
            priority = 'medium';
            this._setVal('add-task-priority', priority);
        }
        if (!due) {
            due = this._getDefaultDueDate();
            this._setVal('add-task-due', due);
        }

        if (!project) {
            this._showError(ERROR_ID, 'プロジェクトは必須です');
            this._focus('add-task-project');
            return;
        }

        try {
            if (!this.nocodbTaskService) {
                throw new Error('NocoDBタスクサービスが初期化されていません');
            }
            const payload = { projectId: project, title, priority, due, description };
            if (canonicalProject) payload.assigneePersonId = assigneePersonId;
            else payload.assignee = assignee;
            await this.nocodbTaskService.createTask(payload);
            this.close();
        } catch (error) {
            console.error('Failed to create task:', error);
            this._showError(ERROR_ID, 'タスクの作成に失敗しました');
        }
    }

    _attachEventHandlers() {
        const saveBtn = /** @type {HTMLInputElement|null} */ (document.getElementById('save-add-task-btn'));
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.save());
        }

        this._attachEnterKeyHandler('add-task-title', () => this.save());

        const project = /** @type {HTMLSelectElement|null} */ (document.getElementById('add-task-project'));
        project?.addEventListener('change', () => this._syncAssigneeMode());
    }

    _setModalTitle() {
        const titleEl = /** @type {HTMLInputElement|null} */ (document.getElementById('add-task-modal-title'));
        if (!titleEl) return;
        titleEl.textContent = 'プロジェクトタスク追加';
    }

    _getDefaultAssignee() {
        const assignee = appStore.getState().preferences?.user?.assignee?.trim();
        return assignee || '自分';
    }

    _getAuthenticatedPersonId() {
        return appStore.getState().auth?.access?.personId?.trim() || '';
    }

    _isCanonicalProject(projectId) {
        return Boolean(
            this.nocodbTaskService?.isCanonicalProject?.(projectId)
            || this.nocodbProjects.some(project => project.id === projectId && project.canonicalTaskStore)
        );
    }

    _syncAssigneeMode() {
        const input = /** @type {HTMLInputElement|null} */ (document.getElementById('add-task-assignee'));
        if (!input) return;
        const canonicalProject = this._isCanonicalProject(this._val('add-task-project'));
        input.readOnly = canonicalProject;
        input.setAttribute('aria-readonly', canonicalProject ? 'true' : 'false');
        if (canonicalProject) {
            input.value = this._getAuthenticatedPersonId() ? this._getDefaultAssignee() : '';
            input.placeholder = '再認証が必要です';
        } else {
            input.placeholder = '担当者名';
            if (!input.value) input.value = this._getDefaultAssignee();
        }
    }

    _getDefaultDueDate() {
        const date = new Date();
        date.setDate(date.getDate() + 7);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    async _loadProjects() {
        if (this._configLoaded) return;

        try {
            const res = await fetch('/api/config/projects');
            if (!res.ok) {
                throw new Error('Failed to load project config');
            }
            const data = await res.json();
            const projects = data.projects || [];
            this.nocodbProjects = projects.filter(p => !p.archived && p.nocodb);
            this._configLoaded = true;
        } catch (error) {
            console.warn('Failed to load projects:', error);
            this.nocodbProjects = [];
        }
    }

    async _populateProjectSelect() {
        const projectInput = /** @type {HTMLInputElement|null} */ (document.getElementById('add-task-project'));
        if (!projectInput) return;

        await this._loadProjects();

        const list = this.nocodbProjects;
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

        list.forEach(project => {
            const option = document.createElement('option');
            option.value = project.id;
            option.textContent = project.nocodb?.base_name || project.id;
            projectInput.appendChild(option);
        });

        const optionValues = Array.from(/** @type {any} */ (projectInput).options).map((/** @type {any} */ opt) => opt.value);
        if (previousValue && optionValues.includes(previousValue)) {
            projectInput.value = previousValue;
        } else {
            projectInput.value = list[0]?.id || '';
        }
        this._syncAssigneeMode();
    }
}
