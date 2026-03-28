// @ts-check
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { getProjectFromSession } from '../../project-mapping.js';
import { escapeHtml, refreshIcons } from '../../ui-helpers.js';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx', '.markdown']);

export class FolderTreeView {
    constructor({ sessionService, fileViewerService }) {
        this.sessionService = sessionService;
        this.fileViewerService = fileViewerService || null;
        this.store = appStore;
        this.eventBus = eventBus;
        this._loadingPaths = new Set();
        this._ensuringVisiblePaths = new Set();
    }

    _getFolderTreeState() {
        const state = this.store.getState().folderTree;
        if (state) return state;
        return {
            bySessionId: {},
            expandedPaths: {},
            activeFileBySessionId: {},
            rootOverrideBySessionId: {},
            loading: false,
            error: null
        };
    }

    _setFolderTreeState(nextState) {
        this.store.setState({ folderTree: nextState });
    }

    _expandedKey(sessionId, relativePath) {
        return `${sessionId}:${relativePath || ''}`;
    }

    _getAncestorPaths(relativePath) {
        const parts = String(relativePath || '').split('/').filter(Boolean);
        if (parts.length <= 1) return [];
        const parents = [];
        for (let i = 1; i < parts.length; i += 1) {
            const parent = parts.slice(0, i).join('/');
            parents.push(parent);
        }
        return parents;
    }

    _ensureExpandedForFile(sessionId, relativePath) {
        const ancestors = this._getAncestorPaths(relativePath);
        if (!ancestors.length) return;

        const folderTree = this._getFolderTreeState();
        const expandedPaths = { ...(folderTree.expandedPaths || {}) };
        let changed = false;

        ancestors.forEach((ancestorPath) => {
            const key = this._expandedKey(sessionId, ancestorPath);
            if (!expandedPaths[key]) {
                expandedPaths[key] = true;
                changed = true;
            }
        });

        if (!changed) return;
        this._setFolderTreeState({
            ...folderTree,
            expandedPaths
        });
    }

    async _ensureFileVisible(sessionId, relativePath) {
        const key = `${sessionId}:${relativePath || ''}`;
        if (!relativePath || this._ensuringVisiblePaths.has(key)) return;

        this._ensuringVisiblePaths.add(key);
        try {
            await this._ensureRootLoaded(sessionId);
            const ancestors = this._getAncestorPaths(relativePath);
            for (const ancestorPath of ancestors) {
                await this._ensurePathLoaded(sessionId, ancestorPath);
            }
        } finally {
            this._ensuringVisiblePaths.delete(key);
        }
    }

    _isPathLoading(sessionId, relativePath) {
        return this._loadingPaths.has(this._expandedKey(sessionId, relativePath));
    }

    _getSessionCwd(sessionId) {
        const sessions = this.store.getState().sessions || [];
        const session = sessions.find((item) => item.id === sessionId);
        if (!session) return null;
        return session.worktree?.path || session.path || null;
    }

    _getSessionCache(sessionId) {
        const folderTree = this._getFolderTreeState();
        const bySessionId = folderTree.bySessionId || {};
        return bySessionId[sessionId] || null;
    }

    _getRootOverride(sessionId) {
        const folderTree = this._getFolderTreeState();
        return folderTree.rootOverrideBySessionId?.[sessionId] || null;
    }

    _stripNode(node = {}) {
        return {
            name: node.name || '',
            relativePath: node.relativePath || '',
            type: node.type || 'file',
            hasChildren: Boolean(node.hasChildren),
            size: typeof node.size === 'number' ? node.size : undefined
        };
    }

    _cacheNodesByPath(nodesByPath, nodes = []) {
        for (const node of nodes) {
            if (node?.type !== 'directory' || !Array.isArray(node.children)) continue;
            const key = node.relativePath || '';
            nodesByPath[key] = node.children.map((child) => this._stripNode(child));
            this._cacheNodesByPath(nodesByPath, node.children);
        }
    }

    async _ensureRootLoaded(sessionId) {
        const cache = this._getSessionCache(sessionId);
        const hasRoot = Boolean(cache?.nodesByPath && Object.prototype.hasOwnProperty.call(cache.nodesByPath, ''));
        if (hasRoot || this._isPathLoading(sessionId, '')) return;
        await this._loadPath(sessionId, '', 2);
    }

    async _ensurePathLoaded(sessionId, relativePath) {
        const cache = this._getSessionCache(sessionId);
        const hasPath = Boolean(cache?.nodesByPath && Object.prototype.hasOwnProperty.call(cache.nodesByPath, relativePath));
        if (hasPath || this._isPathLoading(sessionId, relativePath)) return;
        await this._loadPath(sessionId, relativePath, 1);
    }

    async _loadPath(sessionId, relativePath, depth) {
        const loadingKey = this._expandedKey(sessionId, relativePath);
        this._loadingPaths.add(loadingKey);

        const currentState = this._getFolderTreeState();
        this._setFolderTreeState({
            ...currentState,
            loading: true,
            error: null
        });

        try {
            const params = new URLSearchParams();
            if (relativePath) params.set('path', relativePath);
            params.set('depth', String(depth));
            const rootOverride = this._getRootOverride(sessionId);
            if (rootOverride) params.set('root', rootOverride);
            const query = params.toString();
            const response = await this.sessionService.getSessionFolderTree(sessionId, query ? `?${query}` : '');

            const latest = this._getFolderTreeState();
            const bySessionId = { ...(latest.bySessionId || {}) };
            const currentCache = bySessionId[sessionId] || { rootPath: null, nodesByPath: {} };
            const nodesByPath = { ...(currentCache.nodesByPath || {}) };
            const baseRelativePath = response?.baseRelativePath || relativePath || '';
            const nodes = Array.isArray(response?.nodes) ? response.nodes : [];

            nodesByPath[baseRelativePath] = nodes.map((node) => this._stripNode(node));
            this._cacheNodesByPath(nodesByPath, nodes);

            bySessionId[sessionId] = {
                rootPath: response?.rootPath || currentCache.rootPath || this._getSessionCwd(sessionId),
                nodesByPath,
                truncated: Boolean(response?.truncated),
                truncatedPath: response?.truncatedPath || null
            };

            this._setFolderTreeState({
                ...latest,
                bySessionId,
                loading: this._loadingPaths.size > 0,
                error: null
            });

            await this.eventBus.emit(EVENTS.FOLDER_TREE_LOADED, {
                sessionId,
                relativePath: baseRelativePath,
                nodeCount: nodes.length
            });
        } catch (error) {
            const latest = this._getFolderTreeState();
            this._setFolderTreeState({
                ...latest,
                loading: this._loadingPaths.size > 0,
                error: error.message || 'フォルダ読み込みに失敗'
            });
            await this.eventBus.emit(EVENTS.FOLDER_TREE_LOAD_FAILED, {
                sessionId,
                relativePath,
                error: error.message || 'Failed to load folder tree'
            });
        } finally {
            this._loadingPaths.delete(loadingKey);
            if (!this._loadingPaths.size) {
                const latest = this._getFolderTreeState();
                if (latest.loading) {
                    this._setFolderTreeState({
                        ...latest,
                        loading: false
                    });
                }
            }
        }
    }

    async _toggleDirectory(sessionId, relativePath, hasChildren) {
        const folderTree = this._getFolderTreeState();
        const expandedPaths = { ...(folderTree.expandedPaths || {}) };
        const key = this._expandedKey(sessionId, relativePath);
        const isExpanded = Boolean(expandedPaths[key]);
        expandedPaths[key] = !isExpanded;

        this._setFolderTreeState({
            ...folderTree,
            expandedPaths
        });

        await this.eventBus.emit(EVENTS.FOLDER_TREE_NODE_TOGGLED, {
            sessionId,
            relativePath,
            expanded: !isExpanded
        });

        if (!isExpanded && hasChildren) {
            await this._ensurePathLoaded(sessionId, relativePath);
        }
    }

    _isMarkdownFile(fileName) {
        if (!fileName) return false;
        const dot = fileName.lastIndexOf('.');
        if (dot < 0) return false;
        return MARKDOWN_EXTENSIONS.has(fileName.slice(dot).toLowerCase());
    }

    async _openFile(sessionId, relativePath) {
        const fileName = relativePath.split('/').pop() || relativePath;
        if (this.fileViewerService && this._isMarkdownFile(fileName)) {
            try {
                await this.fileViewerService.openFile(sessionId, relativePath);
                await this.eventBus.emit(EVENTS.FOLDER_TREE_FILE_OPENED, {
                    sessionId,
                    relativePath
                });
            } catch (error) {
                const folderTree = this._getFolderTreeState();
                this._setFolderTreeState({
                    ...folderTree,
                    error: error.message || 'ファイルオープンに失敗'
                });
                await this.eventBus.emit(EVENTS.FOLDER_TREE_LOAD_FAILED, {
                    sessionId,
                    relativePath,
                    error: error.message || 'Failed to open file'
                });
            }
            return;
        }

        const cwd = this._getSessionCwd(sessionId);
        try {
            await this.sessionService.openFileInDefaultApp(relativePath, cwd, sessionId);
            await this.eventBus.emit(EVENTS.FOLDER_TREE_FILE_OPENED, {
                sessionId,
                relativePath
            });
        } catch (error) {
            const folderTree = this._getFolderTreeState();
            this._setFolderTreeState({
                ...folderTree,
                error: error.message || 'ファイルオープンに失敗'
            });
            await this.eventBus.emit(EVENTS.FOLDER_TREE_LOAD_FAILED, {
                sessionId,
                relativePath,
                error: error.message || 'Failed to open file'
            });
        }
    }

    _renderTreeNodes(sessionId, nodes, level, expandedPaths, nodesByPath, activeRelativePath = null) {
        if (!Array.isArray(nodes) || nodes.length === 0) return '';
        const indent = Math.min(level, 8) * 12;

        return `
            <ul class="folder-tree-level" style="--folder-indent:${indent}px;">
                ${nodes.map((node) => {
                    const relativePath = node.relativePath || '';
                    if (node.type === 'directory') {
                        const expandKey = this._expandedKey(sessionId, relativePath);
                        const isExpanded = Boolean(expandedPaths[expandKey]);
                        const hasChildren = Boolean(node.hasChildren);
                        const icon = isExpanded ? 'folder-open' : 'folder';
                        const chevron = hasChildren ? (isExpanded ? 'chevron-down' : 'chevron-right') : 'dot';
                        const children = nodesByPath[relativePath];

                        let childrenHtml = '';
                        if (isExpanded) {
                            if (Array.isArray(children)) {
                                childrenHtml = children.length
                                    ? this._renderTreeNodes(sessionId, children, level + 1, expandedPaths, nodesByPath, activeRelativePath)
                                    : '<div class="folder-tree-empty-node">empty</div>';
                            } else if (hasChildren) {
                                if (!this._isPathLoading(sessionId, relativePath)) {
                                    void this._ensurePathLoaded(sessionId, relativePath);
                                }
                                childrenHtml = '<div class="folder-tree-loading-node">読み込み中...</div>';
                            }
                        }

                        return `
                            <li class="folder-tree-item directory">
                                <button class="folder-tree-node folder-tree-dir" data-path="${escapeHtml(relativePath)}" data-has-children="${hasChildren ? 'true' : 'false'}">
                                    <span class="folder-tree-chev"><i data-lucide="${chevron}"></i></span>
                                    <span class="folder-tree-icon"><i data-lucide="${icon}"></i></span>
                                    <span class="folder-tree-name">${escapeHtml(node.name || relativePath || '.')}</span>
                                </button>
                                ${childrenHtml}
                            </li>
                        `;
                    }

                    const isActive = activeRelativePath === relativePath;
                    return `
                        <li class="folder-tree-item file">
                            <button class="folder-tree-node folder-tree-file${isActive ? ' is-active' : ''}" data-path="${escapeHtml(relativePath)}" ${isActive ? 'aria-current="true"' : ''}>
                                <span class="folder-tree-chev spacer"></span>
                                <span class="folder-tree-icon"><i data-lucide="file-text"></i></span>
                                <span class="folder-tree-name">${escapeHtml(node.name || relativePath)}</span>
                            </button>
                        </li>
                    `;
                }).join('')}
            </ul>
        `;
    }

    _bindEvents(container, sessionId) {
        container.querySelectorAll('.folder-tree-dir').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const relativePath = button.dataset.path || '';
                const hasChildren = button.dataset.hasChildren === 'true';
                void this._toggleDirectory(sessionId, relativePath, hasChildren);
            });
        });

        container.querySelectorAll('.folder-tree-file').forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const relativePath = button.dataset.path || '';
                if (!relativePath) return;
                void this._openFile(sessionId, relativePath);
            });
        });
    }

    _scrollActiveFileIntoView(container) {
        if (!container) return;
        const activeNode = container.querySelector('.folder-tree-file.is-active');
        if (!activeNode) return;

        const resolveScrollableAncestor = (node, stopAt) => {
            let current = node?.parentElement || null;
            while (current) {
                const style = window.getComputedStyle(current);
                const isScrollable = /(auto|scroll)/.test(style.overflowY || '')
                    && current.scrollHeight > current.clientHeight;
                if (isScrollable) return current;
                if (current === stopAt) break;
                current = current.parentElement;
            }
            return null;
        };

        const scrollContainer = resolveScrollableAncestor(activeNode, container) || container;

        requestAnimationFrame(() => {
            const nodeRect = activeNode.getBoundingClientRect();
            const containerRect = scrollContainer.getBoundingClientRect();
            const nodeTop = nodeRect.top - containerRect.top + scrollContainer.scrollTop;
            const nodeHeight = nodeRect.height;
            const viewportHeight = scrollContainer.clientHeight;
            const targetTop = Math.max(nodeTop - ((viewportHeight - nodeHeight) / 2), 0);
            scrollContainer.scrollTo({
                top: targetTop,
                behavior: 'smooth'
            });
        });
    }

    render(container) {
        if (!container) return;

        const state = this.store.getState();
        const sessionId = state.currentSessionId;
        if (!sessionId) {
            container.innerHTML = '<div class="empty-state">セッションを選択してね</div>';
            return;
        }

        const sessions = state.sessions || [];
        const session = sessions.find((item) => item.id === sessionId);
        if (!session) {
            container.innerHTML = '<div class="empty-state">セッションが見つからないよ</div>';
            return;
        }

        const project = getProjectFromSession(session);
        const folderTree = this._getFolderTreeState();
        const cache = this._getSessionCache(sessionId);
        const rootNodes = cache?.nodesByPath?.[''] || [];
        const rootPath = cache?.rootPath || this._getRootOverride(sessionId) || this._getSessionCwd(sessionId) || '-';
        const expandedPaths = folderTree.expandedPaths || {};
        const activeFileBySessionId = folderTree.activeFileBySessionId || {};
        const activeRelativePath = activeFileBySessionId[sessionId] || null;
        const nodesByPath = cache?.nodesByPath || {};

        if (activeRelativePath) {
            this._ensureExpandedForFile(sessionId, activeRelativePath);
            void this._ensureFileVisible(sessionId, activeRelativePath);
        }

        if (!cache && !this._isPathLoading(sessionId, '')) {
            void this._ensureRootLoaded(sessionId);
        }

        const loading = this._isPathLoading(sessionId, '');
        const error = folderTree.error;
        const truncated = Boolean(cache?.truncated);

        const header = `
            <div class="folder-tree-header">
                <div class="folder-tree-title"><i data-lucide="folder-tree"></i> ${escapeHtml(project || 'general')}</div>
                <div class="folder-tree-root" title="${escapeHtml(rootPath)}">${escapeHtml(rootPath)}</div>
            </div>
        `;

        let bodyHtml = '';
        if (error) {
            bodyHtml = `<div class="folder-tree-error">${escapeHtml(error)}</div>`;
        } else if (loading && rootNodes.length === 0) {
            bodyHtml = '<div class="folder-tree-loading">読み込み中...</div>';
        } else if (!rootNodes.length) {
            bodyHtml = '<div class="folder-tree-empty">表示できるフォルダがないよ</div>';
        } else {
            bodyHtml = this._renderTreeNodes(sessionId, rootNodes, 0, expandedPaths, nodesByPath, activeRelativePath);
        }

        const truncatedHtml = truncated
            ? '<div class="folder-tree-truncated">件数多いから先頭だけ表示してるよ</div>'
            : '';

        container.innerHTML = `
            <div class="folder-tree-view">
                ${header}
                <div class="folder-tree-body">
                    ${bodyHtml}
                </div>
                ${truncatedHtml}
            </div>
        `;

        this._bindEvents(container, sessionId);
        this._scrollActiveFileIntoView(container);
        refreshIcons();
    }
}
