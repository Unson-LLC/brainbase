import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { WorktreeService } from '../../../server/services/worktree-service.js';

// story-worktree-service-git-migration: acceptance-criteria coverage for the
// jj -> git migration of WorktreeService (docs/stories/story-worktree-service-git-migration.md).

describe('story-worktree-service-git-migration ac:1 session worktree lifecycle completes via git worktree/branch only', () => {
    let execPromise;
    let service;

    beforeEach(() => {
        vi.restoreAllMocks();
        execPromise = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);
    });

    it('story-worktree-service-git-migration S-001 create() creates the worktree with git worktree add -b and never shells out to jj', async () => {
        vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
        vi.spyOn(fs, 'access').mockImplementation(async (targetPath) => {
            if (targetPath === '/tmp/repo') return undefined;
            throw Object.assign(new Error('not found'), { code: 'ENOENT' });
        });

        execPromise
            .mockResolvedValueOnce({ stdout: '' }) // rev-parse --git-dir (_isGitRepo)
            .mockResolvedValueOnce({ stdout: '' }) // worktree list --porcelain
            .mockResolvedValueOnce({ stdout: 'develop\n' }) // symbolic-ref (main branch name)
            .mockResolvedValueOnce({ stdout: 'origin/develop-commit\n' }) // rev-parse origin/develop (base revision)
            .mockResolvedValueOnce({ stdout: '' }) // worktree add -b
            .mockResolvedValueOnce({ stdout: 'origin/develop-commit\n' }); // rev-parse (start commit)

        const result = await service.create('session-1', '/tmp/repo', { skipFetch: true });

        expect(result.worktreePath).toBe('/tmp/worktrees/session-1-repo');
        expect(result.branchName).toBe('session/session-1');
        expect(execPromise).toHaveBeenCalledWith(
            'git -C "/tmp/repo" worktree add -b "session/session-1" "/tmp/worktrees/session-1-repo" "origin/develop"'
        );
        for (const call of execPromise.mock.calls) {
            expect(call[0]).not.toMatch(/\bjj\b/);
        }
    });

    it('story-worktree-service-git-migration S-006 remove() removes the worktree with git worktree remove --force and deletes the session branch', async () => {
        execPromise.mockResolvedValue({ stdout: '' });
        vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));

        const removed = await service.remove('session-1', '/tmp/repo');

        expect(removed).toBe(true);
        expect(execPromise).toHaveBeenCalledWith(
            'git -C "/tmp/repo" worktree remove --force "/tmp/worktrees/session-1-repo"'
        );
        expect(execPromise).toHaveBeenCalledWith('git -C "/tmp/repo" branch -D "session/session-1"');
        for (const call of execPromise.mock.calls) {
            expect(call[0]).not.toMatch(/\bjj\b/);
        }
    });

    it('story-worktree-service-git-migration S-001 create() reuses an already-registered worktree (from git worktree list --porcelain) instead of re-adding it', async () => {
        vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
        vi.spyOn(fs, 'access').mockImplementation(async (targetPath) => {
            if (targetPath === '/tmp/repo') return undefined;
            throw Object.assign(new Error('not found'), { code: 'ENOENT' });
        });

        execPromise
            .mockResolvedValueOnce({ stdout: '' }) // rev-parse --git-dir
            .mockResolvedValueOnce({
                stdout: [
                    'worktree /tmp/repo',
                    'HEAD abc',
                    'branch refs/heads/develop',
                    '',
                    'worktree /tmp/worktrees/session-1-repo',
                    'HEAD def',
                    'branch refs/heads/session/session-1',
                    ''
                ].join('\n')
            })
            .mockResolvedValueOnce({ stdout: 'develop\n' }) // main branch name (reuse path)
            .mockResolvedValueOnce({ stdout: 'origin/develop-commit\n' }) // base revision resolve
            .mockResolvedValueOnce({ stdout: 'workspace-head\n' }); // start commit

        const result = await service.create('session-1', '/tmp/repo', { skipFetch: true });

        expect(result.worktreePath).toBe('/tmp/worktrees/session-1-repo');
        expect(result.startCommit).toBe('workspace-head');
        expect(execPromise).not.toHaveBeenCalledWith(expect.stringContaining('worktree add'));
    });
});

describe('story-worktree-service-git-migration ac:2 merge deployment guard reports ready:false on mismatch/dirty and ok_ignored_artifact_delta for artifact-only diffs', () => {
    let execPromise;
    let service;

    beforeEach(() => {
        vi.restoreAllMocks();
        execPromise = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);
    });

    it('canonical repo not a git repo -> ready:false reason:not_git_repo', async () => {
        execPromise
            .mockResolvedValueOnce({ stdout: '' }) // rev-parse --verify HEAD
            .mockRejectedValueOnce(new Error('fatal: not a git repository'));

        const status = await service.getMergeDeploymentGuardStatus('/tmp/repo', { mainBranchName: 'develop' });

        expect(status.ready).toBe(false);
        expect(status.reason).toBe('not_git_repo');
    });

    it('dirty working tree (non-artifact path) -> ready:false reason:canonical_workspace_dirty', async () => {
        execPromise
            .mockResolvedValueOnce({ stdout: '' }) // rev-parse --verify HEAD
            .mockResolvedValueOnce({ stdout: '' }) // rev-parse --git-dir
            .mockResolvedValueOnce({ stdout: 'head-commit\n' })
            .mockResolvedValueOnce({ stdout: 'main-commit\n' })
            .mockResolvedValueOnce({ stdout: 'M  server/services/worktree-service.js\n' }); // status --porcelain

        const status = await service.getMergeDeploymentGuardStatus('/tmp/repo', {
            mainBranchName: 'develop',
            fetchRemote: false
        });

        expect(status.ready).toBe(false);
        expect(status.reason).toBe('canonical_workspace_dirty');
    });

    it('story-worktree-service-git-migration S-002 HEAD ahead of main with non-artifact diff -> ready:false reason:canonical_workspace_not_deployed', async () => {
        execPromise
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: 'head-commit\n' })
            .mockResolvedValueOnce({ stdout: 'main-commit\n' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: 'server/services/worktree-service.js\n' });

        const status = await service.getMergeDeploymentGuardStatus('/tmp/repo', {
            mainBranchName: 'develop',
            fetchRemote: false
        });

        expect(status.ready).toBe(false);
        expect(status.reason).toBe('canonical_workspace_not_deployed');
    });

    it('story-worktree-service-git-migration S-003 HEAD ahead of main with artifact-only diff -> ready:true reason:ok_ignored_artifact_delta', async () => {
        execPromise
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: 'head-commit\n' })
            .mockResolvedValueOnce({ stdout: 'main-commit\n' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '.claude/skills/example/SKILL.md\n' });

        const status = await service.getMergeDeploymentGuardStatus('/tmp/repo', {
            mainBranchName: 'develop',
            fetchRemote: false
        });

        expect(status.ready).toBe(true);
        expect(status.reason).toBe('ok_ignored_artifact_delta');
    });

    it('unresolvable HEAD/main revision -> ready:false reason:unresolved_git_revision', async () => {
        execPromise
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' }) // rev-parse HEAD -> empty
            .mockResolvedValueOnce({ stdout: '' }) // rev-parse origin/develop -> empty
            .mockResolvedValueOnce({ stdout: '' }); // status --porcelain

        const status = await service.getMergeDeploymentGuardStatus('/tmp/repo', {
            mainBranchName: 'develop',
            fetchRemote: false
        });

        expect(status.ready).toBe(false);
        expect(status.reason).toBe('unresolved_git_revision');
    });
});

describe('story-worktree-service-git-migration ac:3 syncCanonicalWorkspaceAfterMerge uses fetch+checkout -B and fails loud on error', () => {
    let execPromise;
    let service;

    beforeEach(() => {
        vi.restoreAllMocks();
        execPromise = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);
    });

    it('story-worktree-service-git-migration S-004 successful sync runs git fetch origin then git checkout -B <main> origin/<main>', async () => {
        vi.spyOn(service, 'getMergeDeploymentGuardStatus').mockResolvedValue({ ready: true });
        execPromise.mockResolvedValue({ stdout: '' });

        const result = await service.syncCanonicalWorkspaceAfterMerge('/tmp/repo', 'develop');

        expect(result.success).toBe(true);
        expect(execPromise).toHaveBeenCalledWith('git -C "/tmp/repo" fetch origin');
        expect(execPromise).toHaveBeenCalledWith('git -C "/tmp/repo" checkout -B "develop" "origin/develop"');
    });

    it('story-worktree-service-git-migration S-004 checkout -B failure (e.g. would clobber local changes) is reported as deploy_sync_failed, not silently swallowed', async () => {
        execPromise
            .mockResolvedValueOnce({ stdout: '' }) // fetch origin
            .mockRejectedValueOnce(new Error('error: Your local changes to the following files would be overwritten by checkout'));

        const result = await service.syncCanonicalWorkspaceAfterMerge('/tmp/repo', 'develop');

        expect(result.success).toBe(false);
        expect(result.reason).toBe('deploy_sync_failed');
        expect(result.error).toContain('would be overwritten');
    });

    it('sync succeeds but guard still not ready afterwards -> success:false with guard reason surfaced', async () => {
        execPromise.mockResolvedValue({ stdout: '' });
        vi.spyOn(service, 'getMergeDeploymentGuardStatus').mockResolvedValue({
            ready: false,
            reason: 'canonical_workspace_dirty'
        });

        const result = await service.syncCanonicalWorkspaceAfterMerge('/tmp/repo', 'develop');

        expect(result.success).toBe(false);
        expect(result.reason).toBe('canonical_workspace_dirty');
    });
});

describe('story-worktree-service-git-migration ac:4 getStatus reports unpushed commits, dirty working copy, and conflicts using git only', () => {
    let execPromise;
    let service;

    beforeEach(() => {
        vi.restoreAllMocks();
        execPromise = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);
    });

    it('story-worktree-service-git-migration S-005 unpushed commit count comes from git rev-list --count', async () => {
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);
        vi.spyOn(service, '_getBranchInfos').mockResolvedValue([]);
        vi.spyOn(service, '_countCommitsAheadOfBase').mockResolvedValue(0);

        execPromise
            .mockResolvedValueOnce({ stdout: 'develop\n' })
            .mockResolvedValueOnce({ stdout: '3\n' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' }); // ls-files -u (needsIntegration triggers conflict check)

        const status = await service.getStatus('session-1', '/tmp/repo', 'base-commit');

        expect(status.changesNotPushed).toBe(3);
        expect(execPromise).toHaveBeenCalledWith(
            'git -C "/tmp/worktrees/session-1-repo" rev-list --count "base-commit..HEAD"'
        );
    });

    it('story-worktree-service-git-migration S-005 dirty working copy detected via git status --porcelain (non-artifact path)', async () => {
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);
        vi.spyOn(service, '_getBranchInfos').mockResolvedValue([]);
        vi.spyOn(service, '_countCommitsAheadOfBase').mockResolvedValue(0);

        execPromise
            .mockResolvedValueOnce({ stdout: 'develop\n' })
            .mockResolvedValueOnce({ stdout: '0\n' })
            .mockResolvedValueOnce({ stdout: ' M src/index.js\n' })
            .mockResolvedValueOnce({ stdout: '' });

        const status = await service.getStatus('session-1', '/tmp/repo', 'base-commit');

        expect(status.hasWorkingCopyChanges).toBe(true);
    });

    it('story-worktree-service-git-migration S-005 conflicts detected via git ls-files -u', async () => {
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);
        vi.spyOn(service, '_getBranchInfos').mockResolvedValue([]);
        vi.spyOn(service, '_countCommitsAheadOfBase').mockResolvedValue(1);

        execPromise
            .mockResolvedValueOnce({ stdout: 'develop\n' })
            .mockResolvedValueOnce({ stdout: '0\n' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '100644 abc 1\tfile.txt\n100644 def 2\tfile.txt\n100644 ghi 3\tfile.txt\n' });

        const status = await service.getStatus('session-1', '/tmp/repo', 'base-commit');

        expect(status.hasConflicts).toBe(true);
        expect(execPromise).toHaveBeenCalledWith('git -C "/tmp/worktrees/session-1-repo" ls-files -u');
    });
});

describe('story-worktree-service-git-migration ac:5 no jj command invocation remains in worktree-service.js', () => {
    it('the source file contains no jj CLI invocations', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const { fileURLToPath } = await import('url');
        const currentDir = path.dirname(fileURLToPath(import.meta.url));
        const sourcePath = path.resolve(currentDir, '../../../server/services/worktree-service.js');
        const source = await fs.promises.readFile(sourcePath, 'utf8');

        expect(source).not.toMatch(/\bjj -R\b/);
        expect(source).not.toMatch(/\bjj git\b/);
        expect(source).not.toMatch(/\bjj workspace\b/);
        expect(source).not.toMatch(/\bjj bookmark\b/);
        expect(source).not.toMatch(/\bjj log\b/);
        expect(source).not.toMatch(/\bjj status\b/);
        expect(source).not.toMatch(/\bjj resolve\b/);
    });
});
