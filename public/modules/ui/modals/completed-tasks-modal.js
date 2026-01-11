import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * 完了タスク一覧モーダル
 */
export class CompletedTasksModal {
    constructor({ taskService }) {
        this.taskService = taskService;
        this.modalElement = null;
        this.dateFilter = null;  // null = 全期間, 7, 30, 90
        this._unsubscribers = [];
    }

    /**
     * モーダルをマウント
     */
    mount() {
        this.modalElement = document.getElementById('completed-tasks-modal');
        if (!this.modalElement) {
            console.warn('CompletedTasksModal: #completed-tasks-modal not found');
            return;
        }

        this._attachEventHandlers();
    }

    /**
     * モーダルを開く
     */
    open() {
        if (!this.modalElement) return;

        // フィルターをリセット
        this.dateFilter = null;
        const filterSelect = document.getElementById('completed-date-filter');
        if (filterSelect) {
            filterSelect.value = '';
        }

        // リストを描画
        this._renderList();

        // モーダルを表示
        this.modalElement.classList.add('active');
    }

    /**
     * モーダルを閉じる
     */
    close() {
        if (!this.modalElement) return;

        this.modalElement.classList.remove('active');
    }

    /**
     * タスクを復活
     * @param {string} taskId - 復活するタスクのID
     */
    async restoreTask(taskId) {
        try {
            await this.taskService.restoreTask(taskId);
            // リストを再描画
            this._renderList();
        } catch (error) {
            console.error('Failed to restore task:', error);
        }
    }

    /**
     * リストを描画
     */
    _renderList() {
        const listElement = document.getElementById('completed-tasks-list');
        const emptyElement = document.getElementById('completed-tasks-empty');

        if (!listElement) return;

        const completedTasks = this.taskService.getCompletedTasks(this.dateFilter);

        if (completedTasks.length === 0) {
            listElement.innerHTML = '';
            if (emptyElement) emptyElement.style.display = 'block';
            return;
        }

        if (emptyElement) emptyElement.style.display = 'none';

        // 日付でグループ化
        const grouped = this._groupByDate(completedTasks);

        let html = '';
        for (const [date, tasks] of Object.entries(grouped)) {
            html += `<div class="completed-date-group">`;
            html += `<div class="completed-date-header">${date}</div>`;
            for (const task of tasks) {
                const taskName = task.name || task.title || '(無題)';
                const project = task.project || '';
                const priority = task.priority || '';

                html += `
                    <div class="completed-task-item" data-task-id="${task.id}">
                        <div class="completed-task-info">
                            <div class="completed-task-name">${this._escapeHtml(taskName)}</div>
                            <div class="completed-task-meta">
                                ${project ? `<span class="task-project">${this._escapeHtml(project)}</span>` : ''}
                                ${priority ? `<span class="task-priority priority-${priority}">${this._getPriorityLabel(priority)}</span>` : ''}
                            </div>
                        </div>
                        <button class="restore-task-btn btn-icon" title="復活">
                            <i data-lucide="rotate-ccw"></i>
                        </button>
                    </div>
                `;
            }
            html += `</div>`;
        }

        listElement.innerHTML = html;

        // Lucide iconsを初期化
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

        // 復活ボタンにイベントを追加
        listElement.querySelectorAll('.restore-task-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const taskItem = e.target.closest('.completed-task-item');
                const taskId = taskItem?.dataset.taskId;
                if (taskId) {
                    this.restoreTask(taskId);
                }
            });
        });
    }

    /**
     * タスクを日付でグループ化
     * @param {Array} tasks - タスク配列
     * @returns {Object} 日付をキーとしたオブジェクト
     */
    _groupByDate(tasks) {
        const grouped = {};
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

        for (const task of tasks) {
            const dateStr = task.updated || task.created || '';
            const date = dateStr ? dateStr.split('T')[0] : '不明';

            let label = date;
            if (date === today) {
                label = '今日';
            } else if (date === yesterday) {
                label = '昨日';
            }

            if (!grouped[label]) {
                grouped[label] = [];
            }
            grouped[label].push(task);
        }

        return grouped;
    }

    /**
     * 優先度ラベルを取得
     * @param {string} priority - 優先度
     * @returns {string} ラベル
     */
    _getPriorityLabel(priority) {
        const labels = {
            high: '高',
            medium: '中',
            low: '低'
        };
        return labels[priority] || priority;
    }

    /**
     * HTMLエスケープ
     * @param {string} text - テキスト
     * @returns {string} エスケープ済みテキスト
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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

        // バックドロップクリック
        this.modalElement.addEventListener('click', (e) => {
            if (e.target === this.modalElement) {
                this.close();
            }
        });

        // 日付フィルター変更
        const filterSelect = document.getElementById('completed-date-filter');
        if (filterSelect) {
            filterSelect.addEventListener('change', (e) => {
                const value = e.target.value;
                this.dateFilter = value ? parseInt(value, 10) : null;
                this._renderList();
            });
        }

        // TASK_COMPLETED イベントをリスン（モーダル表示中に更新）
        const unsub = eventBus.on(EVENTS.TASK_COMPLETED, () => {
            if (this.modalElement?.classList.contains('active')) {
                this._renderList();
            }
        });
        this._unsubscribers.push(unsub);
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
