import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import { WorktreeService } from '../../../server/services/worktree-service.js';

function makeLockError(repoPath) {
    const err = new Error(
        `Command failed: jj -R "${repoPath}" workspace add ...\n` +
        `Error: Failed to reset Git HEAD state\n` +
        `Caused by:\n` +
        `1: Could not acquire lock for index file\n` +
        `2: The lock for resource '${repoPath}/.git/index' could not be obtained immediately after 1 attempt(s). The lockfile at '${repoPath}/.git/index.lock' might need manual deletion.\n`
    );
    return err;
}

describe('WorktreeService stale index.lock recovery', () => {
    let service;
    let mockExec;
    const repoPath = '/tmp/repo-stale-lock-test';

    beforeEach(() => {
        vi.restoreAllMocks();
        mockExec = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', mockExec);
    });

    describe('_isIndexLockError', () => {
        it('index.lockメッセージを含むエラーをtrueと判定する', () => {
            expect(service._isIndexLockError(makeLockError('/repo'))).toBe(true);
        });

        it('"Could not acquire lock for index file"メッセージをtrueと判定する', () => {
            const err = new Error('Could not acquire lock for index file');
            expect(service._isIndexLockError(err)).toBe(true);
        });

        it('無関係なエラーをfalseと判定する', () => {
            expect(service._isIndexLockError(new Error('network unreachable'))).toBe(false);
            expect(service._isIndexLockError(null)).toBe(false);
            expect(service._isIndexLockError(undefined)).toBe(false);
        });
    });

    describe('_isStaleLockfile', () => {
        it('lockfileが存在しない場合_falseを返す', async () => {
            vi.spyOn(fsPromises, 'stat').mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
            const result = await service._isStaleLockfile('/tmp/nonexistent.lock');
            expect(result).toBe(false);
        });

        it('mtimeが30秒以内なら_lsof結果に関係なくfalse', async () => {
            vi.spyOn(fsPromises, 'stat').mockResolvedValue({ mtimeMs: Date.now() - 5_000 });
            mockExec.mockResolvedValue({ stdout: '' });
            const result = await service._isStaleLockfile('/tmp/fresh.lock');
            expect(result).toBe(false);
        });

        it('mtimeが30秒超でlsofで活物プロセス検出_falseを返す', async () => {
            vi.spyOn(fsPromises, 'stat').mockResolvedValue({ mtimeMs: Date.now() - 60_000 });
            mockExec.mockResolvedValue({ stdout: 'git\t12345\tksato\t...\n' });
            const result = await service._isStaleLockfile('/tmp/held.lock');
            expect(result).toBe(false);
        });

        it('mtimeが30秒超でlsofで活物プロセスなし_trueを返す', async () => {
            vi.spyOn(fsPromises, 'stat').mockResolvedValue({ mtimeMs: Date.now() - 120_000 });
            mockExec.mockResolvedValue({ stdout: '' });
            const result = await service._isStaleLockfile('/tmp/stale.lock');
            expect(result).toBe(true);
        });

        it('lsofコマンド自体が失敗しても_mtime条件を満たせばtrueを返す', async () => {
            vi.spyOn(fsPromises, 'stat').mockResolvedValue({ mtimeMs: Date.now() - 120_000 });
            mockExec.mockRejectedValue(new Error('lsof: command not found'));
            const result = await service._isStaleLockfile('/tmp/stale-no-lsof.lock');
            expect(result).toBe(true);
        });
    });

    describe('_recoverStaleLockfile', () => {
        it('staleなら削除してtrueを返し警告ログを出す', async () => {
            vi.spyOn(service, '_isStaleLockfile').mockResolvedValue(true);
            const unlinkSpy = vi.spyOn(fsPromises, 'unlink').mockResolvedValue(undefined);
            const result = await service._recoverStaleLockfile(repoPath);
            expect(result).toBe(true);
            expect(unlinkSpy).toHaveBeenCalledWith(`${repoPath}/.git/index.lock`);
        });

        it('staleでなければ削除せずfalseを返す', async () => {
            vi.spyOn(service, '_isStaleLockfile').mockResolvedValue(false);
            const unlinkSpy = vi.spyOn(fsPromises, 'unlink');
            const result = await service._recoverStaleLockfile(repoPath);
            expect(result).toBe(false);
            expect(unlinkSpy).not.toHaveBeenCalled();
        });
    });

    describe('_execJujutsuWithStaleRetry index.lock recovery', () => {
        it('index.lockエラー発生時_lockfileがstaleなら自動削除して再試行する', async () => {
            mockExec
                .mockRejectedValueOnce(makeLockError(repoPath))
                .mockResolvedValueOnce({ stdout: 'recovered output' });
            vi.spyOn(service, '_recoverStaleLockfile').mockResolvedValue(true);

            const result = await service._execJujutsuWithStaleRetry(repoPath, 'workspace list');

            expect(result.stdout).toBe('recovered output');
            expect(mockExec).toHaveBeenCalledTimes(2);
            expect(service._recoverStaleLockfile).toHaveBeenCalledWith(repoPath);
        });

        it('index.lockエラー発生時_lockfileがstaleでなければ元のエラーをthrowする', async () => {
            const lockErr = makeLockError(repoPath);
            mockExec.mockRejectedValueOnce(lockErr);
            vi.spyOn(service, '_recoverStaleLockfile').mockResolvedValue(false);

            await expect(service._execJujutsuWithStaleRetry(repoPath, 'workspace list'))
                .rejects.toBe(lockErr);
            expect(mockExec).toHaveBeenCalledTimes(1);
        });

        it('index.lock以外のエラーは従来通りthrowされる', async () => {
            const otherErr = new Error('network unreachable');
            mockExec.mockRejectedValueOnce(otherErr);
            const recoverSpy = vi.spyOn(service, '_recoverStaleLockfile');

            await expect(service._execJujutsuWithStaleRetry(repoPath, 'workspace list'))
                .rejects.toBe(otherErr);
            expect(recoverSpy).not.toHaveBeenCalled();
        });

        it('既存のstale working copy回復経路は変わらず動く', async () => {
            const staleErr = new Error('The working copy is stale, run `jj workspace update-stale`');
            mockExec
                .mockRejectedValueOnce(staleErr)
                .mockResolvedValueOnce({ stdout: '' })  // workspace update-stale
                .mockResolvedValueOnce({ stdout: 'after-stale-recovery' });

            const result = await service._execJujutsuWithStaleRetry(repoPath, 'workspace list');

            expect(result.stdout).toBe('after-stale-recovery');
            expect(mockExec).toHaveBeenCalledTimes(3);
            expect(mockExec.mock.calls[1][0]).toContain('workspace update-stale');
        });
    });
});
