import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorktreeService } from '../../../server/services/worktree-service.js';
import { promises as fs } from 'fs';

describe('WorktreeService.getStatus - bookmarkPushed判定', () => {
    let service;
    let mockExec;

    beforeEach(() => {
        mockExec = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', mockExec);

        // fs.access をモック（workspace存在チェック用）
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);
    });

    it('getStatus呼び出し時_fetch実行される', async () => {
        // Arrange: _getMainBranchName, jj log, jj status, jj bookmark listをモック
        mockExec
            .mockResolvedValueOnce({ stdout: 'main\n' }) // _getMainBranchName
            .mockResolvedValueOnce({ stdout: '0\n' })    // jj log (changesNotPushed)
            .mockResolvedValueOnce({ stdout: 'No changes\n' }) // jj status
            .mockResolvedValueOnce({ stdout: '' })        // jj git fetch
            .mockResolvedValueOnce({ stdout: 'session-1\n' }); // jj bookmark list

        // Act
        await service.getStatus('session-1', '/tmp/repo', null);

        // Assert: jj git fetch が呼ばれたか確認
        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining('jj -R "/tmp/repo" git fetch')
        );
    });

    it('getStatus呼び出し時_bookmark list --all-remotesが使用される', async () => {
        // Arrange
        mockExec
            .mockResolvedValueOnce({ stdout: 'main\n' })
            .mockResolvedValueOnce({ stdout: '0\n' })
            .mockResolvedValueOnce({ stdout: 'No changes\n' })
            .mockResolvedValueOnce({ stdout: '' })        // jj git fetch
            .mockResolvedValueOnce({ stdout: 'session-1\n' }); // jj bookmark list --all-remotes

        // Act
        await service.getStatus('session-1', '/tmp/repo', null);

        // Assert: --all-remotes オプションが使用されたか確認
        expect(mockExec).toHaveBeenCalledWith(
            expect.stringContaining('bookmark list "session-1" --all-remotes --no-pager')
        );
    });

    it('getStatus呼び出し時_remoteのbookmarkが存在する場合_bookmarkPushed=trueが返される', async () => {
        // Arrange: リモートのbookmarkが存在するケース
        const bookmarkListOutput = `session-1: abc123
  @origin: abc123
`;
        mockExec
            .mockResolvedValueOnce({ stdout: 'main\n' })
            .mockResolvedValueOnce({ stdout: '0\n' })
            .mockResolvedValueOnce({ stdout: 'No changes\n' })
            .mockResolvedValueOnce({ stdout: '' })        // jj git fetch
            .mockResolvedValueOnce({ stdout: bookmarkListOutput }); // jj bookmark list --all-remotes

        // Act
        const status = await service.getStatus('session-1', '/tmp/repo', null);

        // Assert
        expect(status.bookmarkPushed).toBe(true);
    });

    it('getStatus呼び出し時_remoteのbookmarkが存在しない場合_bookmarkPushed=falseが返される', async () => {
        // Arrange: リモートのbookmarkが存在しないケース
        const bookmarkListOutput = `session-1: abc123
`;
        mockExec
            .mockResolvedValueOnce({ stdout: 'main\n' })
            .mockResolvedValueOnce({ stdout: '0\n' })
            .mockResolvedValueOnce({ stdout: 'No changes\n' })
            .mockResolvedValueOnce({ stdout: '' })        // jj git fetch
            .mockResolvedValueOnce({ stdout: bookmarkListOutput }); // jj bookmark list --all-remotes

        // Act
        const status = await service.getStatus('session-1', '/tmp/repo', null);

        // Assert
        expect(status.bookmarkPushed).toBe(false);
    });

    it('getStatus呼び出し時_bookmark候補が複数ある場合_いずれかがremoteに存在すればtrue', async () => {
        // Arrange: session/session-1 形式でリモートに存在
        mockExec
            .mockResolvedValueOnce({ stdout: 'main\n' })
            .mockResolvedValueOnce({ stdout: '0\n' })
            .mockResolvedValueOnce({ stdout: 'No changes\n' })
            .mockResolvedValueOnce({ stdout: '' })        // jj git fetch
            .mockResolvedValueOnce({ stdout: '' })        // 1st candidate: session-1 (not found)
            .mockResolvedValueOnce({ stdout: 'session/session-1: abc123\n  @origin: abc123\n' }); // 2nd candidate: session/session-1 (found)

        // Act
        const status = await service.getStatus('session-1', '/tmp/repo', null);

        // Assert
        expect(status.bookmarkPushed).toBe(true);
    });

    it('getStatus呼び出し時_needsIntegrationはbookmarkPushedを除外して判定される', async () => {
        // Arrange: bookmarkPushed=false でも、changesNotPushed=0 かつ hasWorkingCopyChanges=false なら needsIntegration=false
        mockExec
            .mockResolvedValueOnce({ stdout: 'main\n' })
            .mockResolvedValueOnce({ stdout: '0\n' })     // changesNotPushed = 0
            .mockResolvedValueOnce({ stdout: 'No changes\n' }) // hasWorkingCopyChanges = false
            .mockResolvedValueOnce({ stdout: '' })        // jj git fetch
            .mockResolvedValueOnce({ stdout: 'session-1: abc123\n' }); // bookmarkPushed = false

        // Act
        const status = await service.getStatus('session-1', '/tmp/repo', null);

        // Assert
        expect(status.bookmarkPushed).toBe(false);
        expect(status.needsIntegration).toBe(false); // bookmarkPushedは除外されるべき
    });
});
