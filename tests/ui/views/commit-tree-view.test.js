import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { CommitTreeView } from '../../../public/modules/ui/views/commit-tree-view.js';

// eventBusのモック
vi.mock('../../../public/modules/core/event-bus.js', () => ({
    eventBus: {
        on: vi.fn((event, handler) => {
            // unsubscribe関数を返す
            return () => {};
        }),
        emit: vi.fn()
    },
    EVENTS: {
        SESSION_CHANGED: 'SESSION_CHANGED',
        COMMIT_LOG_LOADED: 'COMMIT_LOG_LOADED'
    }
}));

// appStoreのモック
vi.mock('../../../public/modules/core/store.js', () => ({
    appStore: {
        getState: vi.fn(() => ({
            currentSessionId: null,
            commitLog: null
        }))
    }
}));

// ui-helpersのモック
vi.mock('../../../public/modules/ui-helpers.js', () => ({
    escapeHtml: vi.fn((str) => str)
}));

describe('CommitTreeView', () => {
    let view;
    let mockService;
    let dom;
    let container;
    let eventBus;
    let appStore;

    beforeEach(async () => {
        // JSDOMでDOM環境をセットアップ
        dom = new JSDOM('<!DOCTYPE html><html><body><div id="commit-tree-container"></div></body></html>');
        global.document = dom.window.document;
        global.window = dom.window;

        // モジュールをインポートしてモックを取得
        const eventModule = await import('../../../public/modules/core/event-bus.js');
        const storeModule = await import('../../../public/modules/core/store.js');

        eventBus = eventModule.eventBus;
        appStore = storeModule.appStore;

        // モックをリセット
        vi.clearAllMocks();

        container = document.getElementById('commit-tree-container');

        mockService = {
            loadCommitLog: vi.fn(),
            checkCommitNotify: vi.fn().mockResolvedValue(0)
        };

        view = new CommitTreeView({ commitTreeService: mockService });
    });

    afterEach(() => {
        // タイマーをクリア
        if (view._pollInterval) {
            clearInterval(view._pollInterval);
        }
        // グローバルをクリア
        delete global.document;
        delete global.window;
    });

    describe('constructor', () => {
        it('CommitTreeServiceを受け取る', () => {
            expect(view.commitTreeService).toBe(mockService);
        });

        it('初期状態でコンテナはnull', () => {
            expect(view.container).toBeNull();
        });
    });

    describe('mount', () => {
        it('コンテナを設定してrenderを呼び出す', () => {
            const renderSpy = vi.spyOn(view, 'render');

            view.mount(container);

            expect(view.container).toBe(container);
            expect(renderSpy).toHaveBeenCalled();
        });

        it('イベントリスナーを設定する', () => {
            view.mount(container);

            expect(eventBus.on).toHaveBeenCalled();
        });
    });

    describe('render', () => {
        it('コンテナがない場合は何もしない', () => {
            const result = view.render();

            expect(result).toBeUndefined();
        });

        it('commitLogがない場合は空の状態を表示', () => {
            appStore.getState.mockReturnValue({
                currentSessionId: null,
                commitLog: null
            });

            view.mount(container);
            view.render();

            expect(container.innerHTML).toBeTruthy();
        });

        it('commitLogがある場合は描画する', () => {
            appStore.getState.mockReturnValue({
                currentSessionId: 'session-123',
                commitLog: {
                    commits: [
                        {
                            hash: 'abc123',
                            shortHash: 'abc123',
                            message: 'test commit',
                            author: 'Test User',
                            timestamp: '2026-01-01T00:00:00Z',
                            bookmarks: [],
                            isWorkingCopy: false
                        }
                    ],
                    repoType: 'git'
                }
            });

            view.mount(container);
            view.render();

            expect(container.innerHTML).toBeTruthy();
        });
    });

    describe('イベントリスナー', () => {
        it('SESSION_CHANGEDイベントでloadCommitLogを呼び出す', () => {
            let sessionChangedHandler;
            eventBus.on.mockImplementation((event, handler) => {
                if (event === 'SESSION_CHANGED') {
                    sessionChangedHandler = handler;
                }
                return () => {};
            });

            view.mount(container);

            // SESSION_CHANGEDイベントをシミュレート
            if (sessionChangedHandler) {
                sessionChangedHandler({ detail: { sessionId: 'session-123' } });
            }

            expect(mockService.loadCommitLog).toHaveBeenCalledWith('session-123');
        });

        it('COMMIT_LOG_LOADEDイベントでrenderを呼び出す', () => {
            let commitLogLoadedHandler;
            eventBus.on.mockImplementation((event, handler) => {
                if (event === 'COMMIT_LOG_LOADED') {
                    commitLogLoadedHandler = handler;
                }
                return () => {};
            });

            const renderSpy = vi.spyOn(view, 'render');
            view.mount(container);

            // COMMIT_LOG_LOADEDイベントをシミュレート
            if (commitLogLoadedHandler) {
                commitLogLoadedHandler({});
            }

            expect(renderSpy).toHaveBeenCalled();
        });
    });
});
