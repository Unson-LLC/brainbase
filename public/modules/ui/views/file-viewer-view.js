// @ts-check
import { appStore } from '../../core/store.js';
import { isHtmlPreviewPath } from '../../file-preview-config.js';
import { escapeHtml, refreshIcons } from '../../ui-helpers.js';
import { showSuccess, showError } from '../../toast.js';
import { BaseView } from './base-view.js';

/**
 * ファイルビューアのUIコンポーネント
 * Markdownレンダリング / テキストプレビューを表示
 */
export class FileViewerView extends BaseView {
    constructor({ fileViewerService }) {
        super();
        this.fileViewerService = fileViewerService;
        this.store = appStore;
        /** @type {boolean} Markdown raw/preview toggle */
        this._showRaw = false;
        /** @type {string|null} Track current file to reset toggle on change */
        this._currentPath = null;
    }

    _setupEventListeners() {
        this._addSubscription(
            this.store.subscribeToSelector(
                (state) => state.fileViewer,
                () => this.render()
            )
        );
    }

    render() {
        if (!this.container) return;

        const fileViewer = this.store.getState().fileViewer;

        if (!fileViewer) {
            this.container.innerHTML = '<div class="file-viewer-empty">ターミナルやTreeからファイルを選択してね</div>';
            return;
        }

        const { sessionId, relativePath, fileName, content, renderedHtml, isMarkdown, isHtml, htmlPreviewUrl, loading, error } = fileViewer;

        // Reset toggle when file changes
        if (relativePath !== this._currentPath) {
            this._showRaw = false;
            this._currentPath = relativePath;
        }

        const title = fileName || relativePath || '';
        const subtitle = relativePath && relativePath !== title ? relativePath : '';
        const hasContent = !loading && !error && content != null;
        const shouldPreviewHtml = Boolean(isHtml || isHtmlPreviewPath(fileName || relativePath));
        const resolvedHtmlPreviewUrl = shouldPreviewHtml
            ? (htmlPreviewUrl || this._buildHtmlPreviewUrl(sessionId, relativePath))
            : null;

        let bodyHtml = '';
        if (loading) {
            bodyHtml = '<div class="file-viewer-loading">Loading...</div>';
        } else if (error) {
            bodyHtml = `<div class="file-viewer-error">${escapeHtml(error)}</div>`;
        } else if (shouldPreviewHtml && resolvedHtmlPreviewUrl) {
            bodyHtml = `
                <iframe
                    class="file-viewer-html-frame"
                    src="${escapeHtml(resolvedHtmlPreviewUrl)}"
                    sandbox="allow-scripts allow-forms allow-popups allow-modals"
                    referrerpolicy="no-referrer"
                    title="${escapeHtml(title || 'HTML preview')}"
                ></iframe>
            `;
        } else if (isMarkdown && !this._showRaw && renderedHtml) {
            bodyHtml = `<div class="file-viewer-markdown">${renderedHtml}</div>`;
        } else if (content != null) {
            bodyHtml = `<pre class="file-viewer-text"><code>${escapeHtml(content)}</code></pre>`;
        }

        // Toolbar buttons (only when content is loaded)
        const toggleIcon = this._showRaw ? 'eye' : 'code';
        const toggleTitle = this._showRaw ? 'Show preview' : 'Show raw';
        const toggleClass = this._showRaw ? ' active' : '';
        const toolbarHtml = hasContent ? `
            <div class="file-viewer-toolbar">
                <button class="file-viewer-toolbar-btn" data-action="copy" title="Copy raw content">
                    <i data-lucide="copy"></i>
                </button>
                <button class="file-viewer-toolbar-btn" data-action="download" title="Download file">
                    <i data-lucide="download"></i>
                </button>
                ${isMarkdown && !shouldPreviewHtml ? `<button class="file-viewer-toolbar-btn${toggleClass}" data-action="toggle" title="${toggleTitle}">
                    <i data-lucide="${toggleIcon}"></i>
                </button>` : ''}
            </div>
        ` : '';

        this.container.innerHTML = `
            <div class="file-viewer">
                <div class="file-viewer-header">
                    <button class="file-viewer-back" title="Back to console">
                        <i data-lucide="arrow-left"></i>
                        <span>Back</span>
                    </button>
                    <div class="file-viewer-meta">
                        <div class="file-viewer-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
                        ${subtitle ? `<div class="file-viewer-path" title="${escapeHtml(subtitle)}">${escapeHtml(subtitle)}</div>` : ''}
                    </div>
                    ${toolbarHtml}
                </div>
                <div class="file-viewer-content">
                    ${bodyHtml}
                </div>
            </div>
        `;

        const backBtn = this.container.querySelector('.file-viewer-back');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.fileViewerService.close();
            });
        }

        // Toolbar event listeners
        this.container.querySelector('[data-action="copy"]')
            ?.addEventListener('click', () => this._handleCopy());
        this.container.querySelector('[data-action="download"]')
            ?.addEventListener('click', () => this._handleDownload());
        this.container.querySelector('[data-action="toggle"]')
            ?.addEventListener('click', () => this._handleMarkdownToggle());

        // Markdownレンダリング内のリンクを新しいタブで開く
        this.container.querySelector('.file-viewer-markdown')
            ?.addEventListener('click', (e) => {
                if (!(e.target instanceof Element)) return;
                const anchor = e.target.closest('a');
                if (!anchor) return;
                e.preventDefault();
                window.open(anchor.href, '_blank', 'noopener,noreferrer');
            });

        refreshIcons();
    }

    _buildHtmlPreviewUrl(sessionId, relativePath) {
        if (!sessionId || !relativePath) return null;
        const encodedPath = String(relativePath)
            .split('/')
            .filter(Boolean)
            .map((segment) => encodeURIComponent(segment))
            .join('/');
        if (!encodedPath) return null;
        return `/api/sessions/${encodeURIComponent(sessionId)}/html-preview/${encodedPath}`;
    }

    /** Copy raw file content to clipboard */
    async _handleCopy() {
        const state = this.store.getState().fileViewer;
        if (!state?.content) return;
        try {
            await navigator.clipboard.writeText(state.content);
            showSuccess('Copied!');
        } catch {
            showError('Failed to copy');
        }
    }

    /** Download file via Blob + <a download> */
    _handleDownload() {
        const state = this.store.getState().fileViewer;
        if (!state?.content || !state?.fileName) return;
        try {
            const blob = new Blob([state.content], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = state.fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch {
            showError('Failed to download');
        }
    }

    /** Toggle markdown rendered/raw view */
    _handleMarkdownToggle() {
        this._showRaw = !this._showRaw;
        this.render();
    }
}
