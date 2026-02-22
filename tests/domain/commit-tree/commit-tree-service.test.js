import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommitTreeService } from '../../../public/modules/domain/commit-tree/commit-tree-service.js';

// httpClientのモック
vi.mock('../../../public/modules/core/http-client.js', () => ({
    httpClient: {
        get: vi.fn()
    }
}));

// appStoreのモック
vi.mock('../../../public/modules/core/store.js', () => ({
    appStore: {
        setState: vi.fn(),
        getState: vi.fn(() => ({}))
    }
}));

// eventBusのモック
vi.mock('../../../public/modules/core/event-bus.js', () => ({
    eventBus: {
        emit: vi.fn(),
        on: vi.fn(),
        onAsync: vi.fn()
    },
    EVENTS: {
        COMMIT_LOG_LOADED: 'COMMIT_LOG_LOADED'
    }
}));

describe('CommitTreeService', () => {
    let service;
    let httpClient;
    let appStore;
    let eventBus;

    beforeEach(async () => {
        // モジュールを動的インポートしてモックを取得
        const httpModule = await import('../../../public/modules/core/http-client.js');
        const storeModule = await import('../../../public/modules/core/store.js');
        const eventModule = await import('../../../public/modules/core/event-bus.js');

        httpClient = httpModule.httpClient;
        appStore = storeModule.appStore;
        eventBus = eventModule.eventBus;

        // モックをリセット
        vi.clearAllMocks();

        service = new CommitTreeService();
    });

    describe('checkCommitNotify', () => {
        it('成功時にlastNotifyタイムスタンプを返す', async () => {
            const mockTimestamp = 1234567890;
            httpClient.get.mockResolvedValue({ lastNotify: mockTimestamp });

            const result = await service.checkCommitNotify('session-123');

            expect(result).toBe(mockTimestamp);
            expect(httpClient.get).toHaveBeenCalledWith('/api/sessions/session-123/commit-notify');
        });

        it('lastNotifyがない場合は0を返す', async () => {
            httpClient.get.mockResolvedValue({});

            const result = await service.checkCommitNotify('session-123');

            expect(result).toBe(0);
        });

        it('エラー時は0を返す', async () => {
            httpClient.get.mockRejectedValue(new Error('Network error'));

            const result = await service.checkCommitNotify('session-123');

            expect(result).toBe(0);
        });
    });

    describe('loadCommitLog', () => {
        it('正常にコミットログを取得してStoreとイベントバスを更新', async () => {
            const mockCommitLog = {
                commits: [{ hash: 'abc123', message: 'test commit' }],
                repoType: 'git'
            };
            httpClient.get.mockResolvedValue(mockCommitLog);

            await service.loadCommitLog('session-123', 50);

            expect(httpClient.get).toHaveBeenCalledWith('/api/sessions/session-123/commit-log?limit=50');
            expect(appStore.setState).toHaveBeenCalledWith({ commitLog: mockCommitLog });
            expect(eventBus.emit).toHaveBeenCalledWith('COMMIT_LOG_LOADED', mockCommitLog);
        });

        it('sessionIdがない場合はnullを設定してイベント発火', async () => {
            await service.loadCommitLog(null);

            expect(httpClient.get).not.toHaveBeenCalled();
            expect(appStore.setState).toHaveBeenCalledWith({ commitLog: null });
            expect(eventBus.emit).toHaveBeenCalledWith('COMMIT_LOG_LOADED', {
                commits: [],
                repoType: null
            });
        });

        it('空文字のsessionIdの場合もnullを設定', async () => {
            await service.loadCommitLog('');

            expect(httpClient.get).not.toHaveBeenCalled();
            expect(appStore.setState).toHaveBeenCalledWith({ commitLog: null });
        });

        it('エラー時はnullを設定してエラー情報とともにイベント発火', async () => {
            const mockError = new Error('404 Not Found');
            httpClient.get.mockRejectedValue(mockError);

            await service.loadCommitLog('session-123');

            expect(appStore.setState).toHaveBeenCalledWith({ commitLog: null });
            expect(eventBus.emit).toHaveBeenCalledWith('COMMIT_LOG_LOADED', {
                commits: [],
                repoType: null,
                error: '404 Not Found'
            });
        });

        it('デフォルトのlimit値は50', async () => {
            httpClient.get.mockResolvedValue({ commits: [], repoType: 'git' });

            await service.loadCommitLog('session-123');

            expect(httpClient.get).toHaveBeenCalledWith('/api/sessions/session-123/commit-log?limit=50');
        });

        it('カスタムlimit値を指定できる', async () => {
            httpClient.get.mockResolvedValue({ commits: [], repoType: 'git' });

            await service.loadCommitLog('session-123', 100);

            expect(httpClient.get).toHaveBeenCalledWith('/api/sessions/session-123/commit-log?limit=100');
        });
    });
});
