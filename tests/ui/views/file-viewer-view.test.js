import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileViewerView } from '../../../public/modules/ui/views/file-viewer-view.js';
import { appStore } from '../../../public/modules/core/store.js';

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
