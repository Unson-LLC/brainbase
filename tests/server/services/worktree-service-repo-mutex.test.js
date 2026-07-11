import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorktreeService } from '../../../server/services/worktree-service.js';

function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('WorktreeService _withRepoLock', () => {
    let service;
    let mockExec;

    beforeEach(() => {
        vi.restoreAllMocks();
        mockExec = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', mockExec);
    });

    it('同一repoPathでの呼び出しを直列実行する', async () => {
        const order = [];
        const d1 = deferred();
        const d2 = deferred();

        const p1 = service._withRepoLock('/repo-A', async () => {
            order.push('a-start');
            await d1.promise;
            order.push('a-end');
            return 'A';
        });
        const p2 = service._withRepoLock('/repo-A', async () => {
            order.push('b-start');
            await d2.promise;
            order.push('b-end');
            return 'B';
        });

        // p1 が a-end するまで p2 は b-start に到達しない
        await Promise.resolve();
        await Promise.resolve();
        expect(order).toEqual(['a-start']);

        d1.resolve();
        await p1;
        expect(order).toEqual(['a-start', 'a-end', 'b-start']);

        d2.resolve();
        await p2;
        expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
    });

    it('異なるrepoPathの呼び出しは並列実行される', async () => {
        const order = [];
        const d1 = deferred();
        const d2 = deferred();

        const p1 = service._withRepoLock('/repo-A', async () => {
            order.push('a-start');
            await d1.promise;
            order.push('a-end');
        });
        const p2 = service._withRepoLock('/repo-B', async () => {
            order.push('b-start');
            await d2.promise;
            order.push('b-end');
        });

        await Promise.resolve();
        await Promise.resolve();
        // 両方とも start している = 並列に動いている
        expect(order).toEqual(expect.arrayContaining(['a-start', 'b-start']));

        d2.resolve();
        await p2;
        d1.resolve();
        await p1;
    });

    it('chain内のerrorは後続の呼び出しを止めない', async () => {
        const results = [];

        const p1 = service._withRepoLock('/repo-A', async () => {
            throw new Error('boom');
        }).catch((e) => results.push(`err:${e.message}`));

        const p2 = service._withRepoLock('/repo-A', async () => {
            results.push('ok');
            return 'OK';
        });

        await p1;
        await p2;
        expect(results).toContain('err:boom');
        expect(results).toContain('ok');
    });
});

describe('WorktreeService _execGitWithLockRetry mutex', () => {
    let service;
    let mockExec;

    beforeEach(() => {
        vi.restoreAllMocks();
        mockExec = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', mockExec);
    });

    it('同一repoPathで並走呼び出されたとき内部execが直列実行される', async () => {
        const callOrder = [];
        const d1 = deferred();
        const d2 = deferred();

        mockExec.mockImplementationOnce(async () => {
            callOrder.push('first-start');
            await d1.promise;
            callOrder.push('first-end');
            return { stdout: '1' };
        }).mockImplementationOnce(async () => {
            callOrder.push('second-start');
            await d2.promise;
            callOrder.push('second-end');
            return { stdout: '2' };
        });

        const p1 = service._execGitWithLockRetry('/repo-A', 'worktree list --porcelain');
        const p2 = service._execGitWithLockRetry('/repo-A', 'branch --list');

        await Promise.resolve();
        await Promise.resolve();
        // p1 が end する前に p2 が start することはない
        expect(callOrder).toEqual(['first-start']);

        d1.resolve();
        await p1;
        expect(callOrder).toEqual(['first-start', 'first-end', 'second-start']);

        d2.resolve();
        await p2;
        expect(callOrder).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
    });

    it('コマンドをgit -C repoPath形式に組み立てて実行する', async () => {
        mockExec.mockResolvedValueOnce({ stdout: 'ok' });

        const result = await service._execGitWithLockRetry('/repo-A', 'fetch origin');

        expect(result.stdout).toBe('ok');
        expect(mockExec).toHaveBeenCalledWith('git -C "/repo-A" fetch origin');
    });
});

describe('WorktreeService.merge uses _execGitWithLockRetry for main-repo writes', () => {
    let service;
    let mockExec;
    const repoPath = '/repo-merge-test';

    beforeEach(() => {
        vi.restoreAllMocks();
        mockExec = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', mockExec);
    });

    it('git push が _execGitWithLockRetry 経由で実行される（stale index.lock auto-recovery 有効）', async () => {
        const wrapSpy = vi.spyOn(service, '_execGitWithLockRetry').mockImplementation(async () => ({ stdout: '' }));

        vi.spyOn(service, '_getMainBranchName').mockResolvedValue('main');
        vi.spyOn(service, '_getGitHubRepoSpec').mockResolvedValue('owner/repo');
        vi.spyOn(service, '_getBranchInfos').mockResolvedValue([
            { name: 'session/session-1', pushed: false, output: 'session/session-1' }
        ]);
        vi.spyOn(service, 'syncCanonicalWorkspaceAfterMerge').mockResolvedValue({ success: true });

        mockExec.mockResolvedValue({ stdout: 'https://github.com/o/r/pull/1' });

        const { promises: fsPromises } = await import('fs');
        vi.spyOn(fsPromises, 'access').mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

        const result = await service.merge('session-1', repoPath, 'My Session');

        expect(result.success).toBe(true);
        const wrappedCommands = wrapSpy.mock.calls.map((c) => c[1]);
        expect(wrappedCommands.some((cmd) => cmd.includes('push origin'))).toBe(true);
        expect(wrappedCommands.some((cmd) => cmd.includes('worktree remove --force'))).toBe(true);
    });
});
