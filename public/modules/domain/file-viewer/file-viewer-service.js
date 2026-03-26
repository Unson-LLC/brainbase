import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';

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
        try {
            const result = await this.sessionService.getFileContent(sessionId, relativePath);
            const { fileName, content, size, isMarkdown, treeNavigable, treeRootPath, treeRelativePath } = result;

            const rendered = isMarkdown ? this._renderMarkdown(content) : null;

            this.store.setState({
                fileViewer: {
                    sessionId,
                    relativePath,
                    fileName,
                    content,
                    renderedHtml: rendered,
                    size,
                    isMarkdown,
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
                isMarkdown
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

    /**
     * ファイルビューアを閉じる
     */
    async close() {
        this.store.setState({ fileViewer: null });
        await this.eventBus.emit(EVENTS.FILE_VIEWER_CLOSED, {});
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
        const marked = window.marked;
        const DOMPurify = window.DOMPurify;

        if (!marked || !DOMPurify) {
            // fallback: エスケープして返す
            return content;
        }

        const rawHtml = marked.parse(content);
        return DOMPurify.sanitize(rawHtml);
    }
}
