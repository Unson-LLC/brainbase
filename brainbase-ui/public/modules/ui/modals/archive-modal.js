import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * アーカイブセッション表示モーダル
 */
export class ArchiveModal {
    constructor({ sessionService }) {
        this.sessionService = sessionService;
        this.modalElement = null;
        this.searchTerm = '';
        this.projectFilter = '';
        this._unsubscribers = [];
    }

    /**
     * モーダルをマウント
     */
    mount() {
        this.modalElement = document.getElementById('archive-modal');
        if (!this.modalElement) {
            console.warn('ArchiveModal: #archive-modal not found');
            return;
        }

        this._attachEventHandlers();
        this._setupEventSubscriptions();
    }

    /**
     * モーダルを開く
     */
    open() {
        if (!this.modalElement) return;

        // プロジェクトフィルターを更新
        this._updateProjectFilter();

        // 検索をクリア
        const searchInput = document.getElementById('archive-search');
        if (searchInput) {
            searchInput.value = '';
            this.searchTerm = '';
        }

        const projectFilterEl = document.getElementById('archive-project-filter');
        if (projectFilterEl) {
            projectFilterEl.value = '';
            this.projectFilter = '';
        }

        // リストをレンダリング
        this._renderList();

        // モーダルを表示
        this.modalElement.classList.add('active');

        // 検索欄にフォーカス
        if (searchInput) {
            searchInput.focus();
        }
    }

    /**
     * モーダルを閉じる
     */
    close() {
        if (!this.modalElement) return;
        this.modalElement.classList.remove('active');
    }

    /**
     * プロジェクトフィルターオプション更新
     */
    _updateProjectFilter() {
        const projectFilterEl = document.getElementById('archive-project-filter');
        if (!projectFilterEl) return;

        const projects = this.sessionService.getUniqueProjects();

        projectFilterEl.innerHTML = '<option value="">すべてのプロジェクト</option>';
        projects.forEach(proj => {
            projectFilterEl.innerHTML += `<option value="${proj}">${proj}</option>`;
        });
    }

    /**
     * アーカイブリストをレンダリング
     */
    _renderList() {
        const archivedSessions = this.sessionService.getArchivedSessions(
            this.searchTerm,
            this.projectFilter
        );

        const archiveListEl = document.getElementById('archive-list');
        const archiveEmptyEl = document.getElementById('archive-empty');

        if (!archiveListEl || !archiveEmptyEl) return;

        if (archivedSessions.length === 0) {
            archiveListEl.innerHTML = '';
            archiveEmptyEl.style.display = 'block';
            return;
        }

        archiveEmptyEl.style.display = 'none';

        archiveListEl.innerHTML = archivedSessions.map(session => {
            const name = session.name || session.id;
            const project = session.project || 'General';
            const date = session.createdDate
                ? new Date(session.createdDate).toLocaleDateString('ja-JP')
                : '';

            return `
                <div class="archive-item" data-id="${session.id}">
                    <div class="archive-item-info">
                        <div class="archive-item-name">${name}</div>
                        <div class="archive-item-meta">
                            <span class="archive-item-project">${project}</span>
                            ${date ? `<span class="archive-item-date">${date}</span>` : ''}
                        </div>
                    </div>
                    <div class="archive-item-actions">
                        <button class="btn-secondary" data-action="unarchive" data-id="${session.id}" title="復元">
                            <i data-lucide="archive-restore"></i>
                        </button>
                        <button class="btn-danger" data-action="delete" data-id="${session.id}" title="削除">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Lucide icons初期化
        if (window.lucide) {
            window.lucide.createIcons();
        }

        // アクションボタンにイベントハンドラーをアタッチ
        this._attachListEventHandlers();
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

        // 検索入力
        const searchInput = document.getElementById('archive-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value;
                this._renderList();
            });
        }

        // プロジェクトフィルター
        const projectFilterEl = document.getElementById('archive-project-filter');
        if (projectFilterEl) {
            projectFilterEl.addEventListener('change', (e) => {
                this.projectFilter = e.target.value;
                this._renderList();
            });
        }
    }

    /**
     * リスト内のイベントハンドラーをアタッチ
     */
    _attachListEventHandlers() {
        // Unarchive buttons
        const unarchiveBtns = this.modalElement.querySelectorAll('[data-action="unarchive"]');
        unarchiveBtns.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const sessionId = btn.dataset.id;
                if (sessionId) {
                    await this.sessionService.unarchiveSession(sessionId);
                    this._renderList();
                }
            });
        });

        // Delete buttons
        const deleteBtns = this.modalElement.querySelectorAll('[data-action="delete"]');
        deleteBtns.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const sessionId = btn.dataset.id;
                if (sessionId && confirm('このセッションを完全に削除しますか？')) {
                    await this.sessionService.deleteSession(sessionId);
                    this._renderList();
                }
            });
        });
    }

    /**
     * イベント購読設定
     */
    _setupEventSubscriptions() {
        // セッションが更新されたらリストを再レンダリング
        const unsub1 = eventBus.on(EVENTS.SESSION_UPDATED, () => {
            if (this.modalElement?.classList.contains('active')) {
                this._renderList();
            }
        });

        const unsub2 = eventBus.on(EVENTS.SESSION_DELETED, () => {
            if (this.modalElement?.classList.contains('active')) {
                this._renderList();
            }
        });

        this._unsubscribers.push(unsub1, unsub2);
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
