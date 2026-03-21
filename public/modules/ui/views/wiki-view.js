/**
 * Wiki View
 * 右パネル: プロジェクト/カテゴリ別の索引のみ
 * ページ内容はwiki-reader-overlay（メインエリア）に表示
 */
import { escapeHtml } from '../../ui-helpers.js';

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

    _groupPages(pages) {
        const groups = {};
        for (const page of pages) {
            const parts = page.path.split('/');
            const groupKey = parts[0] || '_root';
            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(page);
        }
        return groups;
    }

    _groupLabel(key) {
        const labels = {
            '_archived': '📦 アーカイブ',
            '_common': '🏢 共通',
            'brainbase': '🧠 brainbase',
            'salestailor': '📱 SalesTailor',
            'zeims': '⚡ Zeims',
            'tech-knight': '🛡️ Tech Knight',
            'baao': '🎯 BAAO',
            'unson': '☁️ UNSON',
            'index': '📖 トップ',
        };
        return labels[key] || key;
    }

    _groupOrder(key) {
        const order = ['index', 'brainbase', 'salestailor', 'zeims', 'tech-knight', 'baao', 'unson', '_common', '_archived'];
        const idx = order.indexOf(key);
        return idx >= 0 ? idx : 50;
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
        const groups = this._groupPages(filtered);
        const sortedKeys = Object.keys(groups).sort((a, b) => this._groupOrder(a) - this._groupOrder(b));

        let indexHtml = '';
        for (const key of sortedKeys) {
            const pages = groups[key];
            const collapsed = this._collapsed[key] ?? (key === '_archived');
            const chevron = collapsed ? 'chevron-right' : 'chevron-down';
            const label = this._groupLabel(key);
            const count = pages.length;

            indexHtml += `<div class="wiki-idx-group" data-group="${escapeHtml(key)}">
                <div class="wiki-idx-group-header${collapsed ? ' collapsed' : ''}">
                    <i data-lucide="${chevron}"></i>
                    <span class="wiki-idx-group-label">${label}</span>
                    <span class="wiki-idx-group-count">${count}</span>
                </div>`;

            if (!collapsed) {
                indexHtml += '<div class="wiki-idx-group-items">';
                const sorted = [...pages].sort((a, b) => (a.title || a.path).localeCompare(b.title || b.path));
                for (const page of sorted) {
                    const subpath = page.path.split('/').slice(1).join('/') || page.path;
                    const title = escapeHtml(page.title || subpath);
                    indexHtml += `<div class="wiki-idx-item" data-path="${escapeHtml(page.path)}" title="${escapeHtml(page.path)}">
                        <span class="wiki-idx-item-title">${title}</span>
                    </div>`;
                }
                indexHtml += '</div>';
            }
            indexHtml += '</div>';
        }

        if (!indexHtml) {
            indexHtml = '<div class="wiki-idx-empty">ページなし</div>';
        }

        this._container.innerHTML = `<div class="wiki-idx">
            <div class="wiki-idx-header">
                <input type="text" class="wiki-idx-search" placeholder="検索..." value="${escapeHtml(this._filter)}" />
                <button class="wiki-idx-refresh" title="更新"><i data-lucide="refresh-cw"></i></button>
            </div>
            <div class="wiki-idx-list">${indexHtml}</div>
        </div>`;

        this._bindEvents();
        if (typeof window.lucide !== 'undefined') {
            window.lucide.createIcons({ nodes: [this._container] });
        }
    }

    _bindEvents() {
        if (!this._container) return;

        // Group toggle
        this._container.querySelectorAll('.wiki-idx-group-header').forEach(el => {
            el.addEventListener('click', () => {
                const group = el.closest('.wiki-idx-group')?.dataset.group;
                if (group) {
                    this._collapsed[group] = !this._collapsed[group];
                    this._render();
                }
            });
        });

        // Page click → open overlay
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
                // re-focus search after render
                const newInput = this._container.querySelector('.wiki-idx-search');
                if (newInput) {
                    newInput.focus();
                    newInput.setSelectionRange(newInput.value.length, newInput.value.length);
                }
            });
        }
    }

    // --- Overlay (main area content display) ---

    _ensureOverlay() {
        if (document.getElementById('wiki-reader-overlay')) {
            this._overlay = document.getElementById('wiki-reader-overlay');
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
        // Insert after dashboard-overlay
        const dashOverlay = document.getElementById('dashboard-overlay');
        if (dashOverlay) {
            dashOverlay.parentElement.insertBefore(overlay, dashOverlay.nextSibling);
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

        // Show overlay with loading state
        this._overlay.classList.add('open');
        breadcrumb.textContent = path;
        body.innerHTML = '<div class="wiki-reader-loading">読み込み中...</div>';

        if (typeof window.lucide !== 'undefined') {
            window.lucide.createIcons({ nodes: [this._overlay] });
        }

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
