// @ts-check
import { appStore } from '../../core/store.js';
import { escapeHtml, refreshIcons } from '../../ui-helpers.js';
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
            this.container.innerHTML = '';
            return;
        }

        const { relativePath, fileName, content, renderedHtml, isMarkdown, loading, error } = fileViewer;
        const title = fileName || relativePath || '';
        const subtitle = relativePath && relativePath !== title ? relativePath : '';

        let bodyHtml = '';
        if (loading) {
            bodyHtml = '<div class="file-viewer-loading">Loading...</div>';
        } else if (error) {
            bodyHtml = `<div class="file-viewer-error">${escapeHtml(error)}</div>`;
        } else if (isMarkdown && renderedHtml) {
            bodyHtml = `<div class="file-viewer-markdown">${renderedHtml}</div>`;
        } else if (content != null) {
            bodyHtml = `<pre class="file-viewer-text"><code>${escapeHtml(content)}</code></pre>`;
        }

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
        refreshIcons();
    }
}
