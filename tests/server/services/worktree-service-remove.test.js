import { afterEach, describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'fs';
import { WorktreeService } from '../../../server/services/worktree-service.js';

describe('WorktreeService.remove', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('worktree remove成功後にpathが残っている場合_falseを返す', async () => {
        const execPromise = vi.fn().mockResolvedValue({ stdout: '' });
        const service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);

        const removed = await service.remove('session-1', '/tmp/repo/salestailor-app');

        expect(removed).toBe(false);
        expect(execPromise).toHaveBeenCalledWith(
            'git -C "/tmp/repo/salestailor-app" worktree remove --force "/tmp/worktrees/session-1-salestailor-app"'
        );
    });

    it('worktree remove成功後にpathが存在しない場合_trueを返しbranchを削除する', async () => {
        const execPromise = vi.fn().mockResolvedValue({ stdout: '' });
        const service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);
        vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));

        const removed = await service.remove('session-1', '/tmp/repo/salestailor-app');

        expect(removed).toBe(true);
        expect(execPromise).toHaveBeenCalledWith('git -C "/tmp/repo/salestailor-app" branch -D "session/session-1"');
    });

    it('worktree remove失敗時_fs.rmとworktree pruneへフォールバックする', async () => {
        const execPromise = vi.fn()
            .mockRejectedValueOnce(new Error('fatal: is not a working tree'))
            .mockResolvedValueOnce({ stdout: '' }) // worktree prune
            .mockResolvedValueOnce({ stdout: '' }); // branch -D
        const service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);
        const rmSpy = vi.spyOn(fs, 'rm').mockResolvedValue(undefined);
        vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));

        const removed = await service.remove('session-1', '/tmp/repo');

        expect(removed).toBe(true);
        expect(rmSpy).toHaveBeenCalledWith('/tmp/worktrees/session-1-repo', { recursive: true, force: true });
        expect(execPromise).toHaveBeenCalledWith('git -C "/tmp/repo" worktree prune');
    });

    it('INV-2: workspaceId指定時はそのgenerationの物理ディレクトリとbranchを掃除する', async () => {
        const execPromise = vi.fn().mockResolvedValue({ stdout: '' });
        const service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);
        vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));

        const removed = await service.remove('session-1', '/tmp/repo', {
            workspaceId: 'session-1-g2',
            generation: 2
        });

        expect(removed).toBe(true);
        expect(execPromise).toHaveBeenCalledWith(
            'git -C "/tmp/repo" worktree remove --force "/tmp/worktrees/session-1-g2-repo"'
        );
        expect(execPromise).toHaveBeenCalledWith('git -C "/tmp/repo" branch -D "session/session-1-g2"');
    });
});

describe('WorktreeService.merge cleanup', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('PR merge後に物理ディレクトリが残っている場合_falseを返す', async () => {
        const execPromise = vi.fn()
            .mockResolvedValueOnce({ stdout: '- feat: archive\n' }) // git log
            .mockResolvedValueOnce({ stdout: 'https://github.com/Unson-LLC/brainbase/pull/123\n' }) // gh pr create
            .mockResolvedValueOnce({ stdout: '' }) // gh pr merge
            .mockResolvedValueOnce({ stdout: '' }); // worktree remove --force (succeeds, but directory still exists per fs.access mock below)
        const service = new WorktreeService('/tmp/worktrees', '/tmp/canonical-repo', execPromise);
        vi.spyOn(service, '_getMainBranchName').mockResolvedValue('main');
        vi.spyOn(service, '_getGitHubRepoSpec').mockResolvedValue('Unson-LLC/brainbase');
        vi.spyOn(service, '_getBranchInfos').mockResolvedValue([
            { name: 'session-1', pushed: true, output: 'session-1@origin' }
        ]);
        vi.spyOn(service, '_pushBranchForMerge').mockResolvedValue(undefined);
        vi.spyOn(service, 'syncCanonicalWorkspaceAfterMerge').mockResolvedValue({ success: true });
        vi.spyOn(fs, 'access').mockResolvedValue(undefined); // worktree still present after remove attempts

        const result = await service.merge('session-1', '/tmp/repo', 'Archive flow');

        expect(result).toMatchObject({
            success: false,
            merged: true,
            error: 'Worktree cleanup failed after merge',
            prUrl: 'https://github.com/Unson-LLC/brainbase/pull/123',
            rotation: {
                active: null,
                retired: {
                    workspaceId: 'session-1',
                    workspaceName: 'session-1-repo',
                    path: '/tmp/worktrees/session-1-repo'
                }
            }
        });
    });
});

describe('WorktreeService merge deployment guard', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('canonical repoのHEADがmainに追いついていない場合_ready=falseを返す', async () => {
        const execPromise = vi.fn()
            .mockResolvedValueOnce({ stdout: '' }) // git rev-parse --verify HEAD
            .mockResolvedValueOnce({ stdout: '' }) // git -C repo rev-parse --git-dir (_isGitRepo)
            .mockResolvedValueOnce({ stdout: 'head-commit\n' }) // rev-parse HEAD
            .mockResolvedValueOnce({ stdout: 'develop-commit\n' }) // rev-parse refs/remotes/origin/develop
            .mockResolvedValueOnce({ stdout: '' }) // status --porcelain (clean)
            .mockResolvedValueOnce({ stdout: 'server/services/worktree-service.js\n' }); // diff --name-only
        const service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);

        const status = await service.getMergeDeploymentGuardStatus('/tmp/repo', {
            mainBranchName: 'develop',
            fetchRemote: false
        });

        expect(status.ready).toBe(false);
        expect(status.reason).toBe('canonical_workspace_not_deployed');
        expect(status.defaultCommit).toBe('head-commit');
        expect(status.mainCommit).toBe('develop-commit');
    });

    it('canonical repoの差分がworkspace artifactだけなら_ready=trueを返す', async () => {
        const execPromise = vi.fn()
            .mockResolvedValueOnce({ stdout: '' }) // rev-parse --verify HEAD
            .mockResolvedValueOnce({ stdout: '' }) // rev-parse --git-dir
            .mockResolvedValueOnce({ stdout: 'head-commit\n' })
            .mockResolvedValueOnce({ stdout: 'develop-commit\n' })
            .mockResolvedValueOnce({ stdout: '' }) // status --porcelain
            .mockResolvedValueOnce({ stdout: '.claude/skills/example/SKILL.md\n' }); // diff --name-only
        const service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);

        const status = await service.getMergeDeploymentGuardStatus('/tmp/repo', {
            mainBranchName: 'develop',
            fetchRemote: false
        });

        expect(status.ready).toBe(true);
        expect(status.reason).toBe('ok_ignored_artifact_delta');
    });

    it('canonical repoがgitでない場合_not_git_repoでready=falseを返す', async () => {
        const execPromise = vi.fn()
            .mockResolvedValueOnce({ stdout: '' }) // rev-parse --verify HEAD
            .mockRejectedValueOnce(new Error('fatal: not a git repository')); // rev-parse --git-dir
        const service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);

        const status = await service.getMergeDeploymentGuardStatus('/tmp/repo', {
            mainBranchName: 'develop',
            fetchRemote: false
        });

        expect(status.ready).toBe(false);
        expect(status.reason).toBe('not_git_repo');
        expect(status.error).toContain('Git repo');
    });

    it('merge後のcanonical repo同期でfetchとcheckout -Bを実行する', async () => {
        const execPromise = vi.fn();
        const service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);
        const gitSpy = vi.spyOn(service, '_execGitWithLockRetry').mockResolvedValue({ stdout: '' });
        vi.spyOn(service, 'getMergeDeploymentGuardStatus').mockResolvedValue({
            ready: true,
            canonical: true,
            reason: 'ok',
            defaultCommit: 'same',
            mainCommit: 'same'
        });

        const result = await service.syncCanonicalWorkspaceAfterMerge('/tmp/repo', 'develop');

        expect(result.success).toBe(true);
        expect(gitSpy).toHaveBeenCalledWith('/tmp/repo', 'fetch origin');
        expect(gitSpy).toHaveBeenCalledWith('/tmp/repo', 'checkout -B "develop" "origin/develop"');
    });

    it('checkout -Bが失敗した場合_deploy_sync_failedを返す', async () => {
        const execPromise = vi.fn();
        const service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);
        vi.spyOn(service, '_execGitWithLockRetry')
            .mockResolvedValueOnce({ stdout: '' }) // fetch origin
            .mockRejectedValueOnce(new Error('local changes would be overwritten by checkout'));

        const result = await service.syncCanonicalWorkspaceAfterMerge('/tmp/repo', 'develop');

        expect(result.success).toBe(false);
        expect(result.reason).toBe('deploy_sync_failed');
        expect(result.error).toContain('local changes would be overwritten');
    });
});
