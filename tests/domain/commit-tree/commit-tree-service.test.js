import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommitTreeService } from '../../../public/modules/domain/commit-tree/commit-tree-service.js';
import { httpClient } from '../../../public/modules/core/http-client.js';
import { appStore } from '../../../public/modules/core/store.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

vi.mock('../../../public/modules/core/http-client.js', () => ({
    httpClient: {
        get: vi.fn()
    }
}));

describe('CommitTreeService', () => {
    let service;

    beforeEach(() => {
        service = new CommitTreeService();
        vi.clearAllMocks();
        appStore.setState({ commitLog: null });
    });

    it('loadCommitLog呼び出し時_APIからデータ取得してStore更新される', async () => {
        const mockResponse = {
            commits: [
                { hash: 'abc1234', description: 'test', isWorkingCopy: true, bookmarks: ['main'], timestamp: '', author: 'ksato' }
            ],
            repoType: 'jj',
            worktreePath: '/tmp/test'
        };

        httpClient.get.mockResolvedValueOnce(mockResponse);

        const emitted = [];
        const unsub = eventBus.on(EVENTS.COMMIT_LOG_LOADED, (e) => emitted.push(e.detail));

        await service.loadCommitLog('session-1');

        expect(httpClient.get).toHaveBeenCalledWith('/api/sessions/session-1/commit-log?limit=50');
        expect(appStore.getState().commitLog).toEqual(mockResponse);
        expect(emitted).toHaveLength(1);

        unsub();
    });

    it('sessionIdがnullの場合_Store がnullに設定される', async () => {
        const emitted = [];
        const unsub = eventBus.on(EVENTS.COMMIT_LOG_LOADED, (e) => emitted.push(e.detail));

        await service.loadCommitLog(null);

        expect(httpClient.get).not.toHaveBeenCalled();
        expect(appStore.getState().commitLog).toBeNull();
        expect(emitted).toHaveLength(1);
        expect(emitted[0].commits).toEqual([]);

        unsub();
    });

    it('API呼び出しが失敗した場合_エラーハンドリングされStore がnullに設定される', async () => {
        httpClient.get.mockRejectedValueOnce(new Error('Session does not have a worktree'));

        await service.loadCommitLog('session-no-worktree');

        expect(appStore.getState().commitLog).toBeNull();
    });

    it('カスタムlimitが指定された場合_APIに渡される', async () => {
        httpClient.get.mockResolvedValueOnce({ commits: [], repoType: 'jj' });

        await service.loadCommitLog('session-1', 20);

        expect(httpClient.get).toHaveBeenCalledWith('/api/sessions/session-1/commit-log?limit=20');
    });
});
