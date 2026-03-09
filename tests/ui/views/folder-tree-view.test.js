import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FolderTreeView } from '../../../public/modules/ui/views/folder-tree-view.js';
import { appStore } from '../../../public/modules/core/store.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

describe('FolderTreeView', () => {
    let folderTreeView;
    let sessionService;
    let container;

    beforeEach(() => {
        document.body.innerHTML = '<div id="test-container"></div>';
        container = document.getElementById('test-container');

        sessionService = {
            getSessionFolderTree: vi.fn(),
            openFileInDefaultApp: vi.fn().mockResolvedValue({ success: true })
        };
        folderTreeView = new FolderTreeView({ sessionService });

        appStore.setState({
            sessions: [],
            currentSessionId: null,
            ui: {
                ...(appStore.getState().ui || {}),
                sidebarPrimaryView: 'folders'
            },
            folderTree: {
                bySessionId: {},
                expandedPaths: {},
                loading: false,
                error: null
            }
        });
        vi.clearAllMocks();
    });

    it('セッション未選択時_emptyを表示する', () => {
        folderTreeView.render(container);
        expect(container.textContent).toContain('セッションを選択してね');
    });

    it('初期表示時_ルートフォルダを読み込んで表示できる', async () => {
        appStore.setState({
            sessions: [{ id: 'session-1', name: 'S1', path: '/tmp/project' }],
            currentSessionId: 'session-1'
        });
        sessionService.getSessionFolderTree.mockResolvedValue({
            sessionId: 'session-1',
            rootPath: '/tmp/project',
            baseRelativePath: '',
            nodes: [
                { name: 'src', relativePath: 'src', type: 'directory', hasChildren: true },
                { name: 'README.md', relativePath: 'README.md', type: 'file', hasChildren: false }
            ]
        });

        folderTreeView.render(container);
        await vi.waitFor(() => {
            expect(sessionService.getSessionFolderTree).toHaveBeenCalledWith('session-1', '?depth=2');
        });

        folderTreeView.render(container);
        expect(container.textContent).toContain('src');
        expect(container.textContent).toContain('README.md');
    });

    it('ファイルクリック時_open-fileが呼ばれてイベントが発火される', async () => {
        appStore.setState({
            sessions: [{ id: 'session-1', name: 'S1', path: '/tmp/project' }],
            currentSessionId: 'session-1',
            folderTree: {
                bySessionId: {
                    'session-1': {
                        rootPath: '/tmp/project',
                        nodesByPath: {
                            '': [
                                { name: 'README.md', relativePath: 'README.md', type: 'file', hasChildren: false }
                            ]
                        }
                    }
                },
                expandedPaths: {},
                loading: false,
                error: null
            }
        });
        const listener = vi.fn();
        const unsubscribe = eventBus.on(EVENTS.FOLDER_TREE_FILE_OPENED, listener);

        folderTreeView.render(container);
        const fileButton = container.querySelector('.folder-tree-file');
        fileButton.click();

        await vi.waitFor(() => {
            expect(sessionService.openFileInDefaultApp).toHaveBeenCalledWith('README.md', '/tmp/project', 'session-1');
        });
        expect(listener).toHaveBeenCalled();
        unsubscribe();
    });
});
