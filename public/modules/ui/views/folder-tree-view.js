import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { getProjectFromSession } from '../../project-mapping.js';
import { escapeHtml } from '../../ui-helpers.js';

export class FolderTreeView {
    constructor({ sessionService }) {
        this.sessionService = sessionService;
        this.store = appStore;
        this.eventBus = eventBus;
        this._loadingPaths = new Set();
    }

    _getFolderTreeState() {
        const state = this.store.getState().folderTree;
        if (state) return state;
        return {
            bySessionId: {},
            expandedPaths: {},
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

    async _openFile(sessionId, relativePath) {
        const cwd = this._getSessionCwd(sessionId);
        try {
            await this.sessionService.openFileInDefaultApp(relativePath, cwd);
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

    _renderTreeNodes(sessionId, nodes, level, expandedPaths, nodesByPath) {
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
                                    ? this._renderTreeNodes(sessionId, children, level + 1, expandedPaths, nodesByPath)
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

                    return `
                        <li class="folder-tree-item file">
                            <button class="folder-tree-node folder-tree-file" data-path="${escapeHtml(relativePath)}">
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
        const rootPath = cache?.rootPath || this._getSessionCwd(sessionId) || '-';
        const expandedPaths = folderTree.expandedPaths || {};
        const nodesByPath = cache?.nodesByPath || {};

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
            bodyHtml = this._renderTreeNodes(sessionId, rootNodes, 0, expandedPaths, nodesByPath);
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

        if (window.lucide) {
            window.lucide.createIcons();
        }
    }
}
