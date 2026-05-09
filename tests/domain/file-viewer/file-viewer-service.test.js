import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileViewerService } from '../../../public/modules/domain/file-viewer/file-viewer-service.js';
import { appStore } from '../../../public/modules/core/store.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { listenForEvent } from '../../helpers/event-test-utils.js';

describe('FileViewerService', () => {
    let service;
    let sessionService;

    beforeEach(() => {
        sessionService = {
            getFileContent: vi.fn()
        };
        service = new FileViewerService({ sessionService });

        appStore.setState({ fileViewer: null });
        vi.clearAllMocks();
    });

    it('openFile呼び出し時_ストアが更新されFILE_VIEWER_OPENEDイベントが発火される', async () => {
        sessionService.getFileContent.mockResolvedValue({
            sessionId: 'session-1',
            relativePath: 'docs/README.md',
            fileName: 'README.md',
            content: '# Hello',
            size: 7,
            isMarkdown: true
        });

        const listener = vi.fn();
        const unsub = eventBus.on(EVENTS.FILE_VIEWER_OPENED, listener);

        await service.openFile('session-1', 'docs/README.md');

        const state = appStore.getState().fileViewer;
        expect(state).toBeTruthy();
        expect(state.fileName).toBe('README.md');
        expect(state.isMarkdown).toBe(true);
        expect(state.error).toBeNull();
        expect(listener).toHaveBeenCalled();

        unsub();
    });

    it('openFile失敗時_エラー状態がストアに設定されFILE_VIEWER_LOAD_FAILEDが発火される', async () => {
        sessionService.getFileContent.mockRejectedValue(new Error('Not found'));

        const listener = vi.fn();
        const unsub = eventBus.on(EVENTS.FILE_VIEWER_LOAD_FAILED, listener);

        await service.openFile('session-1', 'missing.md');

        const state = appStore.getState().fileViewer;
        expect(state.error).toBe('Not found');
        expect(listener).toHaveBeenCalled();

        unsub();
    });

    it('openFile_HTMLファイルの場合_ページプレビューURLをストアに設定する', async () => {
        sessionService.getFileContent.mockResolvedValue({
            sessionId: 'session-1',
            relativePath: 'public/index.html',
            fileName: 'index.html',
            content: '<!doctype html><h1>Hello</h1>',
            size: 32,
            isMarkdown: false,
            isHtml: true,
            htmlPreviewUrl: '/api/sessions/session-1/html-preview/public/index.html'
        });

        await service.openFile('session-1', 'public/index.html');

        const state = appStore.getState().fileViewer;
        expect(state.isHtml).toBe(true);
        expect(state.htmlPreviewUrl).toBe('/api/sessions/session-1/html-preview/public/index.html');
        expect(state.renderedHtml).toBeNull();
    });

    it('HTMLプレビューURLの場合_ファイル取得せずiframe状態へ正規化する', async () => {
        await service.openFile('session-1', '/api/sessions/session-1/html-preview/public/setup.html');

        const state = appStore.getState().fileViewer;
        expect(sessionService.getFileContent).not.toHaveBeenCalled();
        expect(state.relativePath).toBe('public/setup.html');
        expect(state.fileName).toBe('setup.html');
        expect(state.isHtml).toBe(true);
        expect(state.htmlPreviewUrl).toBe('/api/sessions/session-1/html-preview/public/setup.html');
        expect(state.error).toBeNull();
    });

    it('close呼び出し時_ストアがクリアされFILE_VIEWER_CLOSEDイベントが発火される', async () => {
        appStore.setState({
            fileViewer: {
                sessionId: 'session-1',
                relativePath: 'docs/test.md',
                fileName: 'test.md',
                content: 'test'
            }
        });

        const listener = vi.fn();
        const unsub = eventBus.on(EVENTS.FILE_VIEWER_CLOSED, listener);

        await service.close();

        expect(appStore.getState().fileViewer).toBeNull();
        expect(listener.mock.calls[0][0].detail).toEqual(expect.objectContaining({
            sessionId: 'session-1',
            relativePath: 'docs/test.md'
        }));

        unsub();
    });

    it('_isMarkdownFile_Markdown拡張子を正しく判定する', () => {
        expect(service._isMarkdownFile('README.md')).toBe(true);
        expect(service._isMarkdownFile('doc.mdx')).toBe(true);
        expect(service._isMarkdownFile('notes.markdown')).toBe(true);
        expect(service._isMarkdownFile('script.js')).toBe(false);
        expect(service._isMarkdownFile('')).toBe(false);
        expect(service._isMarkdownFile(null)).toBe(false);
    });
});
