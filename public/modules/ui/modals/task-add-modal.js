import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * タスク追加モーダル
 */
export class TaskAddModal {
    constructor({ taskService }) {
        this.taskService = taskService;
        this.modalElement = null;
        this._unsubscribers = [];
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
    open() {
        if (!this.modalElement) return;

        // フォームをクリア
        this._clearForm();

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
    _clearForm() {
        const titleInput = document.getElementById('add-task-title');
        const projectInput = document.getElementById('add-task-project');
        const priorityInput = document.getElementById('add-task-priority');
        const dueInput = document.getElementById('add-task-due');
        const descriptionInput = document.getElementById('add-task-description');

        if (titleInput) titleInput.value = '';
        if (projectInput) projectInput.value = 'general';
        if (priorityInput) priorityInput.value = 'medium';
        if (dueInput) dueInput.value = '';
        if (descriptionInput) descriptionInput.value = '';

        // エラー表示をクリア
        this._hideError();
    }

    /**
     * タスクを保存
     */
    async save() {
        const titleInput = document.getElementById('add-task-title');
        const projectInput = document.getElementById('add-task-project');
        const priorityInput = document.getElementById('add-task-priority');
        const dueInput = document.getElementById('add-task-due');
        const descriptionInput = document.getElementById('add-task-description');

        const title = titleInput?.value?.trim() || '';

        // バリデーション
        if (!title) {
            this._showError('タスク名は必須です');
            titleInput?.focus();
            return;
        }

        const taskData = {
            title,
            project: projectInput?.value || 'general',
            priority: priorityInput?.value || 'medium',
            due: dueInput?.value || null,
            description: descriptionInput?.value || ''
        };

        try {
            await this.taskService.createTask(taskData);
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
        const titleInput = document.getElementById('add-task-title');
        if (titleInput) {
            titleInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.save();
                }
            });
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
