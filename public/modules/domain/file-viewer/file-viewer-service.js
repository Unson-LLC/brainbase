// @ts-check
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { isHtmlPreviewPath, isImagePreviewPath } from '../../file-preview-config.js';

/**
 * ファイルビューアのビジネスロジック
 * Markdownファイルをブラウザ内でプレビュー表示する
 */
export class FileViewerService {
    constructor({ sessionService }) {
        this.sessionService = sessionService;
        this.store = appStore;
        this.eventBus = eventBus;
    }

    /**
     * ファイルを開く
     * @param {string} sessionId - セッションID
     * @param {string} relativePath - セッションワークスペースからの相対パス
     */
    async openFile(sessionId, relativePath) {
        const previewTarget = this._parseBrowserPreviewUrl(relativePath);
        if (previewTarget) {
            const previewSessionId = previewTarget.sessionId || sessionId;
            const previewPath = previewTarget.relativePath;
            const fileName = previewPath.split('/').pop() || previewPath;
            this.store.setState({
                fileViewer: {
                    sessionId: previewSessionId,
                    relativePath: previewPath,
                    fileName,
                    content: null,
                    renderedHtml: null,
                    size: 0,
                    isMarkdown: false,
                    isHtml: previewTarget.isHtml,
                    isImage: previewTarget.isImage,
                    htmlPreviewUrl: previewTarget.isHtml ? previewTarget.previewUrl : null,
                    imagePreviewUrl: previewTarget.isImage ? previewTarget.previewUrl : null,
                    treeNavigable: false,
                    treeRootPath: null,
                    treeRelativePath: null,
                    loading: false,
                    error: null
                }
            });
            await this.eventBus.emit(EVENTS.FILE_VIEWER_OPENED, {
                sessionId: previewSessionId,
                relativePath: previewPath,
                treeNavigable: false,
                treeRootPath: null,
                treeRelativePath: null,
                fileName,
                isMarkdown: false,
                isHtml: previewTarget.isHtml,
                isImage: previewTarget.isImage
            });
            return;
        }

        if (isImagePreviewPath(relativePath)) {
            const fileName = relativePath.split('/').pop() || relativePath;
            const imagePreviewUrl = this._buildAssetPreviewUrl(sessionId, relativePath);
            this.store.setState({
                fileViewer: {
                    sessionId,
                    relativePath,
                    fileName,
                    content: null,
                    renderedHtml: null,
                    size: 0,
                    isMarkdown: false,
                    isHtml: false,
                    isImage: true,
                    htmlPreviewUrl: null,
                    imagePreviewUrl,
                    treeNavigable: false,
                    treeRootPath: null,
                    treeRelativePath: null,
                    loading: false,
                    error: null
                }
            });
            await this.eventBus.emit(EVENTS.FILE_VIEWER_OPENED, {
                sessionId,
                relativePath,
                treeNavigable: false,
                treeRootPath: null,
                treeRelativePath: null,
                fileName,
                isMarkdown: false,
                isHtml: false,
                isImage: true
            });
            return;
        }

        try {
            const result = await this.sessionService.getFileContent(sessionId, relativePath);
            const { fileName, content, size, isMarkdown, isHtml, htmlPreviewUrl, treeNavigable, treeRootPath, treeRelativePath } = result;

            const rendered = isMarkdown ? this._renderMarkdown(content) : null;
            const shouldPreviewHtml = Boolean(isHtml || isHtmlPreviewPath(fileName || relativePath));
            const encodedPreviewPath = String(relativePath || '')
                .split('/')
                .filter(Boolean)
                .map((segment) => encodeURIComponent(segment))
                .join('/');
            const previewUrl = shouldPreviewHtml
                ? (htmlPreviewUrl || `/api/sessions/${encodeURIComponent(sessionId)}/html-preview/${encodedPreviewPath}`)
                : null;

            this.store.setState({
                fileViewer: {
                    sessionId,
                    relativePath,
                    fileName,
                    content,
                    renderedHtml: rendered,
                    size,
                    isMarkdown,
                    isHtml: shouldPreviewHtml,
                    isImage: false,
                    htmlPreviewUrl: previewUrl,
                    imagePreviewUrl: null,
                    treeNavigable: Boolean(treeNavigable),
                    treeRootPath: treeRootPath || null,
                    treeRelativePath: treeRelativePath || null,
                    loading: false,
                    error: null
                }
            });

            await this.eventBus.emit(EVENTS.FILE_VIEWER_OPENED, {
                sessionId,
                relativePath,
                treeNavigable: Boolean(treeNavigable),
                treeRootPath: treeRootPath || null,
                treeRelativePath: treeRelativePath || null,
                fileName,
                isMarkdown,
                isHtml: shouldPreviewHtml,
                isImage: false
            });
        } catch (error) {
            this.store.setState({
                fileViewer: {
                    sessionId,
                    relativePath,
                    fileName: relativePath.split('/').pop() || relativePath,
                    content: null,
                    renderedHtml: null,
                    size: 0,
                    isMarkdown: false,
                    isHtml: false,
                    isImage: false,
                    htmlPreviewUrl: null,
                    imagePreviewUrl: null,
                    loading: false,
                    error: error.message || 'Failed to load file'
                }
            });

            await this.eventBus.emit(EVENTS.FILE_VIEWER_LOAD_FAILED, {
                sessionId,
                relativePath,
                error: error.message || 'Failed to load file'
            });
        }
    }

    _parseBrowserPreviewUrl(value) {
        if (typeof value !== 'string' || !value) return null;
        let pathname = value;
        try {
            const baseUrl = typeof window !== 'undefined' && window.location?.origin
                ? window.location.origin
                : 'http://localhost';
            pathname = new URL(value, baseUrl).pathname;
        } catch {
            pathname = value.split(/[?#]/, 1)[0];
        }

        const match = pathname.match(/^\/api\/sessions\/([^/]+)\/html-preview\/(.+)$/);
        if (!match) return null;
        const previewSessionId = decodeURIComponent(match[1]);
        const relativePath = match[2]
            .split('/')
            .filter(Boolean)
            .map((segment) => decodeURIComponent(segment))
            .join('/');
        const isHtml = isHtmlPreviewPath(relativePath);
        const isImage = isImagePreviewPath(relativePath);
        if (!isHtml && !isImage) return null;
        const previewUrl = this._buildAssetPreviewUrl(previewSessionId, relativePath);
        return {
            sessionId: previewSessionId,
            relativePath,
            previewUrl,
            isHtml,
            isImage
        };
    }

    _buildAssetPreviewUrl(sessionId, relativePath) {
        const rawPath = String(relativePath || '');
        if (rawPath.startsWith('/') || rawPath.startsWith('~/') || rawPath.startsWith('file:///')) {
            const fileName = rawPath.split('/').filter(Boolean).pop() || 'asset';
            return `/api/sessions/${encodeURIComponent(sessionId)}/html-preview/__external__/${encodeURIComponent(fileName)}?path=${encodeURIComponent(rawPath)}`;
        }

        const encodedPath = String(relativePath || '')
            .split('/')
            .filter(Boolean)
            .map((segment) => encodeURIComponent(segment))
            .join('/');
        return `/api/sessions/${encodeURIComponent(sessionId)}/html-preview/${encodedPath}`;
    }

    /**
     * ファイルビューアを閉じる
     */
    async close() {
        const closedFile = this.store.getState().fileViewer || {};
        this.store.setState({ fileViewer: null });
        await this.eventBus.emit(EVENTS.FILE_VIEWER_CLOSED, {
            sessionId: closedFile.sessionId || null,
            relativePath: closedFile.relativePath || null
        });
    }

    /**
     * Markdownファイルかどうか判定
     * @param {string} fileName - ファイル名
     * @returns {boolean}
     */
    _isMarkdownFile(fileName) {
        if (!fileName) return false;
        const dot = fileName.lastIndexOf('.');
        if (dot < 0) return false;
        const ext = fileName.slice(dot).toLowerCase();
        return ext === '.md' || ext === '.mdx' || ext === '.markdown';
    }

    /**
     * MarkdownをHTMLにレンダリング（サニタイズ済み）
     * @param {string} content - Markdown文字列
     * @returns {string} サニタイズ済みHTML
     */
    _renderMarkdown(content) {
        if (typeof window === 'undefined') return content;
        const marked = /** @type {any} */ (window).marked;
        const DOMPurify = /** @type {any} */ (window).DOMPurify;

        if (!marked || !DOMPurify) {
            // fallback: エスケープして返す
            return content;
        }

        const rawHtml = marked.parse(content);
        return DOMPurify.sanitize(rawHtml);
    }
}
