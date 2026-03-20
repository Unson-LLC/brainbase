/**
 * Wiki View
 * ページ一覧ツリー + Markdownコンテンツ表示
 * サーバー /api/wiki に接続
 */
import { escapeHtml } from '../../ui-helpers.js';

export class WikiView {
    constructor({ wikiService, service, eventBus, container }) {
        this.wikiService = wikiService || service;
        this._container = container || null;
        this._pages = [];
        this._currentPath = null;
        this._currentPage = null;
        this._loading = false;
    }

    mount(container) {
        this._container = container;
        this._render();
        this._loadPages();
    }

    async _loadPages() {
        try {
            this._pages = await this.wikiService.getPages();
        } catch {
            this._pages = [];
        }
        this._render();
    }

    async _selectPage(path) {
        this._currentPath = path;
        this._currentPage = null;
        this._loading = true;
        this._render();

        try {
            const page = await this.wikiService.getPage(path);
            if (page && page.content) {
                this._currentPage = page;
            }
        } catch { /* ignore */ }
        this._loading = false;
        this._render();
    }

    _buildTree(pages) {
        const root = {};
        for (const page of pages) {
            const parts = page.path.split('/');
            let node = root;
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (!node[part]) node[part] = {};
                if (i === parts.length - 1) {
                    node[part]._page = page;
                }
                if (!node[part]._children) node[part]._children = {};
                if (i < parts.length - 1) {
                    node = node[part]._children;
                }
            }
        }
        return root;
    }

    _renderTreeNode(node) {
        let html = '';
        const entries = Object.entries(node)
            .filter(([k]) => k !== '_page' && k !== '_children')
            .sort(([a], [b]) => a.localeCompare(b));

        for (const [name, data] of entries) {
            const page = data._page;
            const children = data._children || {};
            const childKeys = Object.keys(children).filter(k => k !== '_page' && k !== '_children');

            if (page) {
                const active = this._currentPath === page.path ? ' active' : '';
                const title = escapeHtml(page.title || name);
                html += `<div class="wiki-tree-page${active}" data-path="${escapeHtml(page.path)}">
                    <span class="wiki-tree-page-title">${title}</span>
                </div>`;
            } else if (childKeys.length > 0) {
                html += `<div class="wiki-tree-folder">
                    <div class="wiki-tree-folder-toggle">
                        <span class="wiki-tree-folder-name">${escapeHtml(name)}</span>
                    </div>
                </div>`;
            }

            if (childKeys.length > 0) {
                html += `<div class="wiki-tree-children">${this._renderTreeNode(children)}</div>`;
            }
        }
        return html;
    }

    _renderMarkdown(content) {
        if (typeof window.marked !== 'undefined') {
            try {
                return window.marked.parse(content);
            } catch {
                return `<pre>${escapeHtml(content)}</pre>`;
            }
        }
        return `<pre>${escapeHtml(content)}</pre>`;
    }

    _render() {
        if (!this._container) return;

        const tree = this._buildTree(this._pages);
        const treeHtml = this._renderTreeNode(tree);
        const treeContent = treeHtml || '<div class="wiki-loading">ページなし</div>';
        const count = this._pages.length;

        let mainHtml;
        if (this._loading) {
            mainHtml = '<div class="wiki-loading">読み込み中...</div>';
        } else if (!this._currentPath) {
            mainHtml = `<div class="wiki-empty-state">
                <p>ページを選択してください</p>
            </div>`;
        } else if (!this._currentPage) {
            mainHtml = `<div class="wiki-empty-state">
                <p>ページが見つかりません</p>
            </div>`;
        } else {
            const breadcrumb = this._currentPage.path.split('/').map((seg, i, arr) => {
                const cls = i === arr.length - 1 ? ' current' : '';
                return `<span class="wiki-breadcrumb-item${cls}">${escapeHtml(seg)}</span>`;
            }).join('<span class="wiki-breadcrumb-sep">/</span>');

            mainHtml = `<div class="wiki-content-wrapper">
                <div class="wiki-toolbar">
                    <div class="wiki-breadcrumb">${breadcrumb}</div>
                </div>
                <div class="wiki-content-body">${this._renderMarkdown(this._currentPage.content)}</div>
            </div>`;
        }

        this._container.innerHTML = `<div class="wiki-layout">
            <div class="wiki-sidebar">
                <div class="wiki-sidebar-header">
                    <span class="wiki-sidebar-title">ページ (${count})</span>
                    <button class="wiki-new-btn wiki-refresh-btn" title="更新"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
                </div>
                <div class="wiki-tree">${treeContent}</div>
            </div>
            <div class="wiki-main">${mainHtml}</div>
        </div>`;
        this._bindEvents();
    }

    _bindEvents() {
        if (!this._container) return;

        this._container.querySelectorAll('.wiki-tree-page').forEach(el => {
            el.addEventListener('click', () => {
                const path = el.dataset.path;
                if (path) this._selectPage(path);
            });
        });

        const refreshBtn = this._container.querySelector('.wiki-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this._loadPages());
        }
    }

    unmount() {
        if (this._container) this._container.innerHTML = '';
    }

    destroy() {
        this.unmount();
    }
}
