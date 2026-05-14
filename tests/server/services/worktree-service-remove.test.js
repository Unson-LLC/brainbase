import { afterEach, describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'fs';
import { WorktreeService } from '../../../server/services/worktree-service.js';

describe('WorktreeService.remove', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('物理ディレクトリ削除後にpathが残っている場合_falseを返す', async () => {
        const execPromise = vi.fn().mockResolvedValue({ stdout: '' });
        const service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);
        vi.spyOn(fs, 'rm').mockResolvedValue(undefined);
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);

        const removed = await service.remove('session-1', '/tmp/repo/salestailor-app');

        expect(removed).toBe(false);
        expect(fs.rm).toHaveBeenCalledWith(
            '/tmp/worktrees/session-1-salestailor-app',
            { recursive: true, force: true }
        );
    });

    it('物理ディレクトリ削除後にpathが存在しない場合_trueを返す', async () => {
        const execPromise = vi.fn().mockResolvedValue({ stdout: '' });
        const service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);
        vi.spyOn(fs, 'rm').mockResolvedValue(undefined);
        vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));

        const removed = await service.remove('session-1', '/tmp/repo/salestailor-app');

        expect(removed).toBe(true);
    });
});

describe('WorktreeService.merge cleanup', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('PR merge後に物理ディレクトリが残っている場合_falseを返す', async () => {
        const execPromise = vi.fn()
            .mockResolvedValueOnce({ stdout: 'main\n' })
            .mockResolvedValueOnce({ stdout: 'git@github.com:Unson-LLC/brainbase.git\n' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: 'session-1: abc\n' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '- feat: archive\n' })
            .mockResolvedValueOnce({ stdout: 'https://github.com/Unson-LLC/brainbase/pull/123\n' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' });
        const service = new WorktreeService('/tmp/worktrees', '/tmp/canonical-repo', execPromise);
        vi.spyOn(fs, 'rm').mockResolvedValue(undefined);
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);

        const result = await service.merge('session-1', '/tmp/repo', 'Archive flow');

        expect(result).toEqual({
            success: false,
            error: 'Worktree cleanup failed after merge',
            prUrl: 'https://github.com/Unson-LLC/brainbase/pull/123'
        });
    });
});

describe('WorktreeService merge deployment guard', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('canonical repoのdefault@がbaseに追いついていない場合_ready=falseを返す', async () => {
        const execPromise = vi.fn()
            .mockResolvedValueOnce({ stdout: '' }) // git rev-parse HEAD
            .mockResolvedValueOnce({ stdout: 'jj 0.26.0\n' }) // jj version
            .mockResolvedValueOnce({ stdout: 'default-commit\n' })
            .mockResolvedValueOnce({ stdout: 'develop-commit\n' })
            .mockResolvedValueOnce({ stdout: 'Working copy changes:\n' })
            .mockResolvedValueOnce({ stdout: 'server/services/worktree-service.js | 12 ++++++++++++\n' });
        const service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);

        const status = await service.getMergeDeploymentGuardStatus('/tmp/repo', {
            mainBranchName: 'develop',
            fetchRemote: false
        });

        expect(status.ready).toBe(false);
        expect(status.reason).toBe('canonical_workspace_not_deployed');
        expect(status.defaultCommit).toBe('default-commit');
        expect(status.mainCommit).toBe('develop-commit');
    });

    it('canonical repoの差分がworkspace artifactだけなら_ready=trueを返す', async () => {
        const execPromise = vi.fn()
            .mockResolvedValueOnce({ stdout: '' }) // git rev-parse HEAD
            .mockResolvedValueOnce({ stdout: 'jj 0.26.0\n' }) // jj version
            .mockResolvedValueOnce({ stdout: 'default-commit\n' })
            .mockResolvedValueOnce({ stdout: 'develop-commit\n' })
            .mockResolvedValueOnce({ stdout: 'Working copy changes:\nM .claude/skills/example/SKILL.md\n' })
            .mockResolvedValueOnce({ stdout: '.claude/skills/example/SKILL.md | 2 +-\n' });
        const service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);

        const status = await service.getMergeDeploymentGuardStatus('/tmp/repo', {
            mainBranchName: 'develop',
            fetchRemote: false
        });

        expect(status.ready).toBe(true);
        expect(status.reason).toBe('ok_ignored_artifact_delta');
    });

    it('merge後のcanonical repo同期でfetchとdefault@ rebaseを実行する', async () => {
        const execPromise = vi.fn();
        const service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);
        const jjSpy = vi.spyOn(service, '_execJujutsuWithStaleRetry').mockResolvedValue({ stdout: '' });
        vi.spyOn(service, 'getMergeDeploymentGuardStatus').mockResolvedValue({
            ready: true,
            canonical: true,
            reason: 'ok',
            defaultCommit: 'same',
            mainCommit: 'same'
        });

        const result = await service.syncCanonicalWorkspaceAfterMerge('/tmp/repo', 'develop');

        expect(result.success).toBe(true);
        expect(jjSpy).toHaveBeenCalledWith('/tmp/repo', 'git fetch');
        expect(jjSpy).toHaveBeenCalledWith('/tmp/repo', 'rebase -b default@ -d "develop"');
    });
});
