import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../public/modules/toast.js', () => ({
    showSuccess: vi.fn(),
    showError: vi.fn()
}));

import { FileViewerView } from '../../../public/modules/ui/views/file-viewer-view.js';
import { appStore } from '../../../public/modules/core/store.js';
import { showSuccess } from '../../../public/modules/toast.js';

describe('FileViewerView', () => {
    let view;
    let fileViewerService;
    let container;

    beforeEach(() => {
        document.body.innerHTML = '<div id="test-container"></div>';
        container = document.getElementById('test-container');

        fileViewerService = {
            close: vi.fn()
        };

        view = new FileViewerView({ fileViewerService });
        appStore.setState({ fileViewer: null });
        vi.clearAllMocks();
    });

    it('fileViewerがnullの場合_空状態メッセージが表示される', () => {
        view.mount(container);
        expect(container.innerHTML).toBe('<div class="file-viewer-empty">ターミナルやTreeからファイルを選択してね</div>');
    });

    it('Markdownコンテンツ表示時_renderedHtmlが表示される', () => {
        appStore.setState({
            fileViewer: {
                relativePath: 'README.md',
                fileName: 'README.md',
                content: '# Hello',
                renderedHtml: '<h1>Hello</h1>',
                isMarkdown: true,
                loading: false,
                error: null
            }
        });

        view.mount(container);
        expect(container.querySelector('.file-viewer-markdown')).toBeTruthy();
        expect(container.querySelector('.file-viewer-markdown').innerHTML).toContain('<h1>Hello</h1>');
    });

    it('テキストコンテンツ表示時_preタグで表示される', () => {
        appStore.setState({
            fileViewer: {
                relativePath: 'app.js',
                fileName: 'app.js',
                content: 'console.log("hello");',
                renderedHtml: null,
                isMarkdown: false,
                loading: false,
                error: null
            }
        });

        view.mount(container);
        expect(container.querySelector('.file-viewer-text')).toBeTruthy();
        expect(container.textContent).toContain('console.log');
    });

    it('HTMLファイル表示時_iframeでページとして表示される', () => {
        appStore.setState({
            fileViewer: {
                relativePath: 'public/index.html',
                fileName: 'index.html',
                content: '<!doctype html><h1>Hello</h1>',
                renderedHtml: null,
                isMarkdown: false,
                isHtml: true,
                htmlPreviewUrl: '/api/sessions/session-1/html-preview/public/index.html',
                loading: false,
                error: null
            }
        });

        view.mount(container);
        const frame = container.querySelector('.file-viewer-html-frame');
        expect(frame).toBeTruthy();
        expect(frame.getAttribute('src')).toBe('/api/sessions/session-1/html-preview/public/index.html');
        expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-popups allow-modals');
        expect(container.querySelector('.file-viewer-text')).toBeNull();
        expect(container.innerHTML).not.toContain('<!doctype');
    });

    it('HTMLメタ情報が欠けていても拡張子からiframe表示にfallbackする', () => {
        appStore.setState({
            fileViewer: {
                sessionId: 'session-1',
                relativePath: 'public/setup.html',
                fileName: 'setup.html',
                content: '<!DOCTYPE html><html><body>Setup</body></html>',
                renderedHtml: null,
                isMarkdown: false,
                loading: false,
                error: null
            }
        });

        view.mount(container);

        const frame = container.querySelector('.file-viewer-html-frame');
        expect(frame).toBeTruthy();
        expect(frame.getAttribute('src')).toBe('/api/sessions/session-1/html-preview/public/setup.html');
        expect(container.querySelector('.file-viewer-text')).toBeNull();
        expect(container.innerHTML).not.toContain('&lt;!DOCTYPE');
    });

    it('画像ファイル表示時_imgで画像として表示される', () => {
        appStore.setState({
            fileViewer: {
                sessionId: 'session-1',
                relativePath: 'assets/logo.png',
                fileName: 'logo.png',
                content: null,
                renderedHtml: null,
                isMarkdown: false,
                isHtml: false,
                isImage: true,
                imagePreviewUrl: '/api/sessions/session-1/html-preview/assets/logo.png',
                loading: false,
                error: null
            }
        });

        view.mount(container);
        const image = container.querySelector('.file-viewer-image');
        expect(image).toBeTruthy();
        expect(image.getAttribute('src')).toBe('/api/sessions/session-1/html-preview/assets/logo.png');
        expect(image.getAttribute('alt')).toBe('logo.png');
        expect(container.querySelector('.file-viewer-html-frame')).toBeNull();
        expect(container.querySelector('.file-viewer-text')).toBeNull();
    });

    it('画像メタ情報が欠けていても拡張子からimg表示にfallbackする', () => {
        appStore.setState({
            fileViewer: {
                sessionId: 'session-1',
                relativePath: '.vibepro/out/chart.webp',
                fileName: 'chart.webp',
                content: null,
                renderedHtml: null,
                isMarkdown: false,
                loading: false,
                error: null
            }
        });

        view.mount(container);
        const image = container.querySelector('.file-viewer-image');
        expect(image).toBeTruthy();
        expect(image.getAttribute('src')).toBe('/api/sessions/session-1/html-preview/.vibepro/out/chart.webp');
    });

    it('エラー表示時_エラーメッセージが表示される', () => {
        appStore.setState({
            fileViewer: {
                relativePath: 'missing.md',
                fileName: 'missing.md',
                content: null,
                renderedHtml: null,
                isMarkdown: false,
                loading: false,
                error: 'File not found'
            }
        });

        view.mount(container);
        expect(container.querySelector('.file-viewer-error')).toBeTruthy();
        expect(container.textContent).toContain('File not found');
    });

    it('Backボタンクリック時_fileViewerService.closeが呼ばれる', () => {
        appStore.setState({
            fileViewer: {
                relativePath: 'README.md',
                fileName: 'README.md',
                content: 'test',
                renderedHtml: null,
                isMarkdown: false,
                loading: false,
                error: null
            }
        });

        view.mount(container);
        const backBtn = container.querySelector('.file-viewer-back');
        expect(backBtn).toBeTruthy();
        backBtn.click();
        expect(fileViewerService.close).toHaveBeenCalled();
    });

    it('コンテンツ表示時_ツールバーにCopyとDownloadボタンが表示される', () => {
        appStore.setState({
            fileViewer: {
                relativePath: 'app.js',
                fileName: 'app.js',
                content: 'hello',
                renderedHtml: null,
                isMarkdown: false,
                loading: false,
                error: null
            }
        });

        view.mount(container);
        expect(container.querySelector('[data-action="copy"]')).toBeTruthy();
        expect(container.querySelector('[data-action="download"]')).toBeTruthy();
        expect(container.querySelector('[data-action="toggle"]')).toBeNull();
    });

    it('Markdownファイル表示時_トグルボタンも表示される', () => {
        appStore.setState({
            fileViewer: {
                relativePath: 'README.md',
                fileName: 'README.md',
                content: '# Hello',
                renderedHtml: '<h1>Hello</h1>',
                isMarkdown: true,
                loading: false,
                error: null
            }
        });

        view.mount(container);
        expect(container.querySelector('[data-action="toggle"]')).toBeTruthy();
    });

    it('トグルボタンクリック時_Markdownがraw表示に切り替わる', () => {
        appStore.setState({
            fileViewer: {
                relativePath: 'README.md',
                fileName: 'README.md',
                content: '# Hello',
                renderedHtml: '<h1>Hello</h1>',
                isMarkdown: true,
                loading: false,
                error: null
            }
        });

        view.mount(container);
        expect(container.querySelector('.file-viewer-markdown')).toBeTruthy();

        container.querySelector('[data-action="toggle"]').click();
        expect(container.querySelector('.file-viewer-markdown')).toBeNull();
        expect(container.querySelector('.file-viewer-text')).toBeTruthy();
    });

    it('別ファイルを開くとトグル状態がリセットされる', () => {
        appStore.setState({
            fileViewer: {
                relativePath: 'a.md',
                fileName: 'a.md',
                content: '# A',
                renderedHtml: '<h1>A</h1>',
                isMarkdown: true,
                loading: false,
                error: null
            }
        });

        view.mount(container);
        container.querySelector('[data-action="toggle"]').click();
        expect(container.querySelector('.file-viewer-text')).toBeTruthy();

        // Open different file
        appStore.setState({
            fileViewer: {
                relativePath: 'b.md',
                fileName: 'b.md',
                content: '# B',
                renderedHtml: '<h1>B</h1>',
                isMarkdown: true,
                loading: false,
                error: null
            }
        });

        expect(container.querySelector('.file-viewer-markdown')).toBeTruthy();
    });

    it('Copyボタンクリック時_クリップボードにコンテンツがコピーされる', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText },
            writable: true,
            configurable: true
        });

        appStore.setState({
            fileViewer: {
                relativePath: 'test.js',
                fileName: 'test.js',
                content: 'const x = 1;',
                renderedHtml: null,
                isMarkdown: false,
                loading: false,
                error: null
            }
        });

        view.mount(container);
        container.querySelector('[data-action="copy"]').click();
        await vi.waitFor(() => {
            expect(writeText).toHaveBeenCalledWith('const x = 1;');
        });
        expect(showSuccess).toHaveBeenCalledWith('Copied!');
    });

    it('loading中はツールバーが表示されない', () => {
        appStore.setState({
            fileViewer: {
                relativePath: 'test.js',
                fileName: 'test.js',
                content: null,
                renderedHtml: null,
                isMarkdown: false,
                loading: true,
                error: null
            }
        });

        view.mount(container);
        expect(container.querySelector('.file-viewer-toolbar')).toBeNull();
    });

    it('unmount呼び出し時_コンテナがクリアされる', () => {
        appStore.setState({
            fileViewer: {
                relativePath: 'test.md',
                fileName: 'test.md',
                content: 'content',
                renderedHtml: null,
                isMarkdown: false,
                loading: false,
                error: null
            }
        });

        view.mount(container);
        expect(container.innerHTML).not.toBe('');

        view.unmount();
        expect(view.container).toBeNull();
    });
});
