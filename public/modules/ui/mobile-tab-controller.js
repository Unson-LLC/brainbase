import { eventBus, EVENTS } from '../core/event-bus.js';
import { appStore } from '../core/store.js';

const TAB_IDS = ['terminal', 'files', 'wiki', 'tasks', 'feed'];

export class MobileTabController {
    constructor({ container }) {
        this._container = container;
        this._mountedTabs = new Set();
        this._activeTab = 'terminal';
        this._tabBar = null;
    }

    init() {
        this._tabBar = document.getElementById('mobile-tab-bar');
        if (!this._tabBar) return;

        this._tabBar.addEventListener('click', (e) => {
            const btn = e.target.closest('.mobile-tab');
            if (!btn) return;
            const tab = btn.dataset.tab;
            if (tab) this.switchTab(tab);
        });

        eventBus.on(EVENTS.SESSION_CHANGED, () => {
            if (this._activeTab !== 'terminal') {
                this._refreshActiveTab();
            }
        });
    }

    switchTab(tab) {
        if (!TAB_IDS.includes(tab) || tab === this._activeTab) return;
        this._activeTab = tab;

        // Update tab bar buttons
        this._tabBar.querySelectorAll('.mobile-tab').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        // Toggle body class
        if (tab === 'terminal') {
            document.body.classList.remove('mobile-tab-active');
        } else {
            document.body.classList.add('mobile-tab-active');
        }

        // Show/hide tab content
        document.querySelectorAll('.mobile-tab-content').forEach(el => {
            el.classList.toggle('active', el.dataset.tab === tab);
        });

        // Lazy mount
        if (tab !== 'terminal' && !this._mountedTabs.has(tab)) {
            this._mountTab(tab);
            this._mountedTabs.add(tab);
        }

        eventBus.emit(EVENTS.MOBILE_TAB_CHANGED, { tab });

        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    async _mountTab(tab) {
        const el = document.getElementById(`mobile-tab-content-${tab}`);
        if (!el) return;

        switch (tab) {
            case 'files':
                await this._mountFilesTab(el);
                break;
            case 'wiki':
                await this._mountWikiTab(el);
                break;
            case 'tasks':
                this._mountTasksTab(el);
                break;
            case 'feed':
                await this._mountFeedTab(el);
                break;
        }
    }

    async _mountWikiTab(el) {
        try {
            const { WikiView } = await import('./views/wiki-view.js');
            const wikiService = this._container.get('wikiService');
            const view = new WikiView({ wikiService });
            view.mount(el);
        } catch (error) {
            el.textContent = 'Wiki の読み込みに失敗しました';
            console.error('Failed to mount wiki tab:', error);
        }
    }

    async _mountFeedTab(el) {
        try {
            const { LiveFeedView } = await import('./views/live-feed-view.js');
            const liveFeedService = this._container.get('liveFeedService');
            const view = new LiveFeedView({ liveFeedService });
            view.mount(el);
        } catch (error) {
            el.textContent = 'Feed の読み込みに失敗しました';
            console.error('Failed to mount feed tab:', error);
        }
    }

    async _mountFilesTab(el) {
        try {
            const sessionId = appStore.getState().currentSessionId;
            if (!sessionId) {
                el.textContent = 'セッションを選択してください';
                return;
            }
            this._filesEl = el;

            // Create tree + preview containers
            el.innerHTML = `
                <div class="mobile-files-tree"></div>
                <div class="mobile-files-preview hidden"></div>
            `;
            const treeContainer = el.querySelector('.mobile-files-tree');
            const previewContainer = el.querySelector('.mobile-files-preview');

            // Mount FolderTreeView
            const { FolderTreeView } = await import('./views/folder-tree-view.js');
            const fileViewerService = this._container.get('fileViewerService');
            const sessionService = this._container.get('sessionService');
            this._folderTreeView = new FolderTreeView({ sessionService, fileViewerService });
            this._folderTreeView.render(treeContainer);

            // Mount FileViewerView into preview container
            const { FileViewerView } = await import('./views/file-viewer-view.js');
            this._fileViewerView = new FileViewerView({ fileViewerService });
            this._fileViewerView.mount(previewContainer);

            // Subscribe to fileViewer state to toggle tree/preview
            this._fileViewerUnsubscribe = appStore.subscribeToSelector(
                (state) => state.fileViewer,
                (fileViewer) => {
                    if (!this._filesEl) return;
                    const tree = this._filesEl.querySelector('.mobile-files-tree');
                    const preview = this._filesEl.querySelector('.mobile-files-preview');
                    if (!tree || !preview) return;

                    if (fileViewer && (fileViewer.content != null || fileViewer.loading)) {
                        tree.classList.add('hidden');
                        preview.classList.remove('hidden');
                    } else {
                        tree.classList.remove('hidden');
                        preview.classList.add('hidden');
                    }
                }
            );
        } catch (error) {
            el.textContent = 'Files の読み込みに失敗しました';
            console.error('Failed to mount files tab:', error);
        }
    }

    _mountTasksTab(el) {
        const tasksContent = document.getElementById('tasks-tab-content');
        if (tasksContent) {
            el.innerHTML = tasksContent.innerHTML;
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        } else {
            el.textContent = 'Tasks の読み込みに失敗しました';
        }
    }

    _refreshActiveTab() {
        if (this._activeTab === 'files') {
            this._mountedTabs.delete('files');
            const el = document.getElementById('mobile-tab-content-files');
            if (el) {
                el.innerHTML = '';
                this._mountTab('files');
                this._mountedTabs.add('files');
            }
        }
    }
}
