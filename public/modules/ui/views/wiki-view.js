/**
 * Wiki View
 * 右パネル: プロジェクト/カテゴリ別の索引のみ
 * ページ内容はconsole-area内のオーバーレイに表示（ターミナル部分のみ覆う）
 */
import { escapeHtml, refreshIcons } from '../../ui-helpers.js';

export class WikiView {
    constructor({ wikiService, service, eventBus, container }) {
        this.wikiService = wikiService || service;
        this._container = container || null;
        this._pages = [];
        this._collapsed = {};  // group collapse state
        this._overlay = null;
        this._filter = '';
    }

    mount(container) {
        this._container = container;
        this._ensureOverlay();
        this._render();
        this._loadPages();
    }

    async _loadPages() {
        try {
            const result = await this.wikiService.getPages();
            this._pages = Array.isArray(result) ? result : [];
        } catch {
            this._pages = [];
        }
        this._render();
    }

    // --- Grouping ---

    // --- Folder tree builder ---

    _buildTree(pages) {
        const root = { _children: {}, _pages: [] };
        for (const page of pages) {
            const parts = page.path.split('/');
            let node = root;
            for (let i = 0; i < parts.length - 1; i++) {
                const seg = parts[i];
                if (!node._children[seg]) node._children[seg] = { _children: {}, _pages: [] };
                node = node._children[seg];
            }
            node._pages.push(page);
        }
        return root;
    }

    _folderLabel(key) {
        return key;
    }

    _folderOrder(key) {
        const order = ['index', 'brainbase', 'salestailor', 'zeims', 'tech-knight', 'baao', 'unson', '_common', '_archived'];
        const idx = order.indexOf(key);
        return idx >= 0 ? idx : 50;
    }

    _countPages(node) {
        let count = node._pages.length;
        for (const child of Object.values(node._children)) {
            count += this._countPages(child);
        }
        return count;
    }

    _renderTree(node, depth = 0, parentPath = '') {
        let html = '';
        // Sort folders
        const folderKeys = Object.keys(node._children).sort((a, b) => {
            if (depth === 0) return this._folderOrder(a) - this._folderOrder(b);
            return a.localeCompare(b);
        });

        for (const key of folderKeys) {
            const child = node._children[key];
            const folderPath = parentPath ? `${parentPath}/${key}` : key;
            const collapsed = this._collapsed[folderPath] ?? (key === '_archived' || depth >= 2);
            const chevron = collapsed ? 'chevron-right' : 'chevron-down';
            const label = this._folderLabel(key);
            const count = this._countPages(child);

            html += `<div class="wiki-idx-folder" data-depth="${depth}">
                <div class="wiki-idx-folder-header" data-folder="${escapeHtml(folderPath)}" style="padding-left: ${depth * 16 + 4}px">
                    <i data-lucide="${collapsed ? 'folder' : 'folder-open'}"></i>
                    <i data-lucide="${chevron}" class="wiki-idx-chevron"></i>
                    <span class="wiki-idx-folder-label">${label}</span>
                    <span class="wiki-idx-folder-count">${count}</span>
                </div>`;

            if (!collapsed) {
                html += this._renderTree(child, depth + 1, folderPath);
                // Render pages in this folder
                const sorted = [...child._pages].sort((a, b) => (a.title || a.path).localeCompare(b.title || b.path));
                for (const page of sorted) {
                    const name = page.path.split('/').pop();
                    const title = escapeHtml(page.title || name);
                    html += `<div class="wiki-idx-item" data-path="${escapeHtml(page.path)}" title="${escapeHtml(page.path)}" style="padding-left: ${(depth + 1) * 16 + 4}px">
                        <span class="wiki-idx-item-title">${title}</span>
                    </div>`;
                }
            }
            html += '</div>';
        }

        // Root-level pages (no folder)
        if (depth === 0) {
            const sorted = [...node._pages].sort((a, b) => (a.title || a.path).localeCompare(b.title || b.path));
            for (const page of sorted) {
                const title = escapeHtml(page.title || page.path);
                html += `<div class="wiki-idx-item" data-path="${escapeHtml(page.path)}" title="${escapeHtml(page.path)}" style="padding-left: 4px">
                    <span class="wiki-idx-item-title">${title}</span>
                </div>`;
            }
        }

        return html;
    }

    // --- Index render (right panel) ---

    _matchesFilter(page) {
        if (!this._filter) return true;
        const q = this._filter.toLowerCase();
        return (page.title || '').toLowerCase().includes(q) || page.path.toLowerCase().includes(q);
    }

    _render() {
        if (!this._container) return;
        const filtered = this._pages.filter(p => this._matchesFilter(p));
        const tree = this._buildTree(filtered);
        const indexHtml = this._renderTree(tree) || '<div class="wiki-idx-empty">ページなし</div>';

        this._container.innerHTML = `<div class="wiki-idx">
            <div class="wiki-idx-header">
                <input type="text" class="wiki-idx-search" placeholder="検索..." value="${escapeHtml(this._filter)}" />
                <button class="wiki-idx-refresh" title="更新"><i data-lucide="refresh-cw"></i></button>
            </div>
            <div class="wiki-idx-list">${indexHtml}</div>
        </div>`;

        // Apply collapsed state via classList
        this._container.querySelectorAll('.wiki-idx-folder-header').forEach(el => {
            const folder = el.dataset.folder;
            if (folder && this._collapsed[folder]) {
                el.classList.add('collapsed');
            }
        });

        this._bindEvents();
        refreshIcons({ nodes: [this._container] });
    }

    _bindEvents() {
        if (!this._container) return;

        // Folder toggle
        this._container.querySelectorAll('.wiki-idx-folder-header').forEach(el => {
            el.addEventListener('click', () => {
                const folder = el.dataset.folder;
                if (folder) {
                    this._collapsed[folder] = !this._collapsed[folder];
                    this._render();
                }
            });
        });

        // Page click → open overlay on terminal
        this._container.querySelectorAll('.wiki-idx-item').forEach(el => {
            el.addEventListener('click', () => {
                const path = el.dataset.path;
                if (path) this._openPage(path);
            });
        });

        // Refresh
        const refreshBtn = this._container.querySelector('.wiki-idx-refresh');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this._loadPages());
        }

        // Search
        const searchInput = this._container.querySelector('.wiki-idx-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this._filter = e.target.value;
                this._render();
                const newInput = this._container.querySelector('.wiki-idx-search');
                if (newInput) {
                    newInput.focus();
                    newInput.setSelectionRange(newInput.value.length, newInput.value.length);
                }
            });
        }
    }

    // --- Overlay (covers console-area only) ---

    _ensureOverlay() {
        const existing = document.getElementById('wiki-reader-overlay');
        if (existing) {
            this._overlay = existing;
            // If mounted in a mobile tab, move the overlay there
            const mobileTabParent = this._container?.closest('.mobile-tab-content');
            if (mobileTabParent && existing.parentElement !== mobileTabParent) {
                mobileTabParent.appendChild(existing);
            }
            return;
        }
        const overlay = document.createElement('div');
        overlay.id = 'wiki-reader-overlay';
        overlay.className = 'wiki-reader-overlay';
        overlay.innerHTML = `
            <div class="wiki-reader-header">
                <div class="wiki-reader-breadcrumb"></div>
                <button class="wiki-reader-close icon-btn" title="閉じる" aria-label="Wiki閲覧を閉じる">
                    <i data-lucide="x"></i>
                </button>
            </div>
            <div class="wiki-reader-body"></div>
        `;
        // Insert overlay: if mounted in a mobile tab content, use that container;
        // otherwise use console-area (desktop) or body as fallback.
        const mobileTabParent = this._container?.closest('.mobile-tab-content');
        const consoleArea = document.getElementById('console-area');
        if (mobileTabParent) {
            mobileTabParent.appendChild(overlay);
        } else if (consoleArea) {
            consoleArea.appendChild(overlay);
        } else {
            document.body.appendChild(overlay);
        }
        this._overlay = overlay;

        // Close button
        overlay.querySelector('.wiki-reader-close').addEventListener('click', () => this._closeOverlay());

        // Escape key
        this._onKeydown = (e) => {
            if (e.key === 'Escape' && this._overlay?.classList.contains('open')) {
                this._closeOverlay();
            }
        };
        document.addEventListener('keydown', this._onKeydown);
    }

    async _openPage(path) {
        if (!this._overlay) return;
        const body = this._overlay.querySelector('.wiki-reader-body');
        const breadcrumb = this._overlay.querySelector('.wiki-reader-breadcrumb');

        this._overlay.classList.add('open');
        breadcrumb.textContent = path;
        body.innerHTML = '<div class="wiki-reader-loading">読み込み中...</div>';

        refreshIcons({ nodes: [this._overlay] });

        try {
            const page = await this.wikiService.getPage(path);
            if (page && page.content) {
                breadcrumb.innerHTML = this._renderBreadcrumb(page.path, page.title);
                body.innerHTML = `<div class="wiki-reader-content">${this._renderMarkdown(page.content)}</div>`;
            } else {
                body.innerHTML = '<div class="wiki-reader-loading">ページが見つかりません</div>';
            }
        } catch {
            body.innerHTML = '<div class="wiki-reader-loading">読み込みエラー</div>';
        }
    }

    _closeOverlay() {
        if (this._overlay) this._overlay.classList.remove('open');
    }

    _renderBreadcrumb(path, title) {
        const parts = path.split('/');
        let html = parts.map((seg, i) => {
            const cls = i === parts.length - 1 ? ' current' : '';
            return `<span class="wiki-reader-bc-item${cls}">${escapeHtml(seg)}</span>`;
        }).join('<span class="wiki-reader-bc-sep">/</span>');
        if (title) {
            html += `<span class="wiki-reader-bc-title">${escapeHtml(title)}</span>`;
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

    unmount() {
        this._closeOverlay();
        if (this._onKeydown) {
            document.removeEventListener('keydown', this._onKeydown);
        }
        if (this._container) this._container.innerHTML = '';
    }

    destroy() {
        this.unmount();
        if (this._overlay) {
            this._overlay.remove();
            this._overlay = null;
        }
    }
}
