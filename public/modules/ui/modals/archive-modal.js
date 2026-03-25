import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';
import { showConfirm } from '../../confirm-modal.js';
import { getProjectFromPath } from '../../project-mapping.js';
import { escapeHtml, refreshIcons } from '../../ui-helpers.js';
import { BaseModal } from './base-modal.js';

/**
 * アーカイブセッション表示モーダル
 */
export class ArchiveModal extends BaseModal {
    constructor({ sessionService }) {
        super('archive-modal');
        this.sessionService = sessionService;
        this.searchTerm = '';
        this.projectFilter = '';
    }

    mount() {
        super.mount();
        if (!this.modalElement) return;
        this._setupEventSubscriptions();
    }

    async open() {
        if (!this.modalElement) return;

        const currentFilters = appStore.getState().filters || {};
        appStore.setState({
            filters: { ...currentFilters, showArchivedSessions: true }
        });

        await this.sessionService.loadSessions();

        appStore.setState({
            filters: { ...currentFilters, showArchivedSessions: false }
        });

        this._updateProjectFilter();

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

        this._renderList();
        this.modalElement.classList.add('active');

        if (searchInput) {
            searchInput.focus();
        }
    }

    _updateProjectFilter() {
        const projectFilterEl = document.getElementById('archive-project-filter');
        if (!projectFilterEl) return;

        const archivedSessions = this.sessionService.getArchivedSessions('', '');
        const projects = new Set();
        archivedSessions.forEach(s => {
            const project = getProjectFromPath(s.path);
            if (project) projects.add(project);
        });
        const sortedProjects = Array.from(projects).sort();

        projectFilterEl.innerHTML = '<option value="">すべてのプロジェクト</option>';
        sortedProjects.forEach(proj => {
            projectFilterEl.innerHTML += `<option value="${proj}">${proj}</option>`;
        });
    }

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
            const project = getProjectFromPath(session.path);

            let dateValue = session.archivedAt || session.createdDate || session.createdAt;

            if (!dateValue && session.id) {
                const match = session.id.match(/session-(\d{13})/);
                if (match) {
                    dateValue = parseInt(match[1], 10);
                }
            }

            const date = dateValue
                ? new Date(dateValue).toLocaleDateString('ja-JP')
                : '-';
            const dateIcon = session.archivedAt ? '📦' : '📅';

            const escapedId = escapeHtml(session.id);
            const escapedName = escapeHtml(name);
            const escapedProject = escapeHtml(project);
            const escapedDate = escapeHtml(date);
            return `
                <div class="archive-item" data-id="${escapedId}">
                    <div class="archive-item-info">
                        <div class="archive-item-name">${escapedName}</div>
                        <div class="archive-item-meta">
                            <span class="archive-item-project">${escapedProject}</span>
                            <span class="archive-item-date">${dateIcon} ${escapedDate}</span>
                        </div>
                    </div>
                    <div class="archive-item-actions">
                        <button class="btn-secondary" data-action="unarchive" data-id="${escapedId}" title="復元">
                            <i data-lucide="archive-restore"></i>
                        </button>
                        <button class="btn-danger" data-action="delete" data-id="${escapedId}" title="削除">
                            <i data-lucide="trash-2"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        refreshIcons();

        this._attachListEventHandlers();
    }

    _attachEventHandlers() {
        const searchInput = document.getElementById('archive-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value;
                this._renderList();
            });
        }

        const projectFilterEl = document.getElementById('archive-project-filter');
        if (projectFilterEl) {
            projectFilterEl.addEventListener('change', (e) => {
                this.projectFilter = e.target.value;
                this._renderList();
            });
        }
    }

    _attachListEventHandlers() {
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

        const deleteBtns = this.modalElement.querySelectorAll('[data-action="delete"]');
        deleteBtns.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const sessionId = btn.dataset.id;
                if (!sessionId) return;
                const confirmed = await showConfirm(
                    'このセッションを完全に削除しますか？',
                    { title: '削除確認', okText: '削除', cancelText: 'キャンセル', danger: true }
                );
                if (!confirmed) return;
                await this.sessionService.deleteSession(sessionId);
                this._renderList();
            });
        });
    }

    _setupEventSubscriptions() {
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

        this._addSubscription(unsub1);
        this._addSubscription(unsub2);
    }
}
