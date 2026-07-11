import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { WorktreeService } from '../../../server/services/worktree-service.js';

// story-worktree-service-git-migration: real-git end-to-end coverage for the
// jj -> git migration of WorktreeService (docs/stories/story-worktree-service-git-migration.md).
// No mocks: every git operation below runs against real temp repositories.

const execPromise = promisify(exec);

async function run(cwd, command) {
    return execPromise(command, { cwd });
}

async function git(repoPath, args) {
    return run(repoPath, `git -C "${repoPath}" ${args}`);
}

describe('story-worktree-service-git-migration e2e (real git repos)', () => {
    let tmpRoot;
    let originBare;
    let canonicalRepo;
    let worktreesDir;
    let service;
    let savedGuardEnv;

    beforeEach(async () => {
        savedGuardEnv = process.env.BRAINBASE_DISABLE_MERGE_DEPLOY_GUARD;
        delete process.env.BRAINBASE_DISABLE_MERGE_DEPLOY_GUARD;

        const base = await fs.mkdtemp(path.join(os.tmpdir(), 'wt-service-e2e-'));
        tmpRoot = await fs.realpath(base);

        originBare = path.join(tmpRoot, 'origin.git');
        canonicalRepo = path.join(tmpRoot, 'canonical');
        worktreesDir = path.join(tmpRoot, 'worktrees');

        // 1. bare repo acting as "origin"
        await fs.mkdir(originBare, { recursive: true });
        await run(originBare, `git init --bare "${originBare}"`);

        // 2. canonical checkout: clone bare, create initial commit on develop, push
        await run(tmpRoot, `git clone "${originBare}" "${canonicalRepo}"`);
        await git(canonicalRepo, 'config user.name "Test User"');
        await git(canonicalRepo, 'config user.email "test@example.com"');
        await git(canonicalRepo, 'checkout -b develop');
        await fs.writeFile(path.join(canonicalRepo, 'README.md'), '# canonical\n');
        await git(canonicalRepo, 'add README.md');
        await git(canonicalRepo, 'commit -m "initial commit"');
        await git(canonicalRepo, 'push -u origin develop');
        await git(canonicalRepo, 'remote set-head origin develop');

        await fs.mkdir(worktreesDir, { recursive: true });

        service = new WorktreeService(worktreesDir, canonicalRepo, execPromise);
    }, 30000);

    afterEach(async () => {
        if (savedGuardEnv === undefined) {
            delete process.env.BRAINBASE_DISABLE_MERGE_DEPLOY_GUARD;
        } else {
            process.env.BRAINBASE_DISABLE_MERGE_DEPLOY_GUARD = savedGuardEnv;
        }
        if (tmpRoot) {
            await fs.rm(tmpRoot, { recursive: true, force: true });
        }
    }, 30000);

    it('story-worktree-service-git-migration S-001 create() creates a real worktree/branch and reuses it on replay', async () => {
        const sessionId = 'e2e-session-1';

        const result = await service.create(sessionId, canonicalRepo, { skipFetch: true });

        expect(result.branchName).toBe(`session/${sessionId}`);
        expect(result.repoPath).toBe(canonicalRepo);
        expect(result.startCommit).toMatch(/^[0-9a-f]{40}$/);

        // worktree is registered with git
        const { stdout: worktreeList } = await git(canonicalRepo, 'worktree list --porcelain');
        expect(worktreeList).toContain(path.resolve(result.worktreePath));

        // physical directory exists and is a git worktree
        await expect(fs.access(result.worktreePath)).resolves.toBeUndefined();

        // session branch actually exists in canonical repo
        const { stdout: branchShow } = await git(canonicalRepo, `rev-parse --verify "refs/heads/session/${sessionId}"`);
        expect(branchShow.trim()).toBe(result.startCommit);

        // replay: calling create() again reuses the existing worktree (idempotency)
        const secondResult = await service.create(sessionId, canonicalRepo, { skipFetch: true });
        expect(secondResult.worktreePath).toBe(result.worktreePath);

        const { stdout: worktreeListAfter } = await git(canonicalRepo, 'worktree list --porcelain');
        const occurrences = worktreeListAfter.split('\n')
            .filter((line) => line.trim() === `worktree ${path.resolve(result.worktreePath)}`);
        expect(occurrences).toHaveLength(1);
    }, 30000);

    it('story-worktree-service-git-migration S-005 getStatus() reports commits-ahead and working-copy dirtiness from real git state', async () => {
        const sessionId = 'e2e-session-2';
        const created = await service.create(sessionId, canonicalRepo, { skipFetch: true });

        // Clean state: no changes yet
        const cleanStatus = await service.getStatus(sessionId, canonicalRepo, created.startCommit, { fetchRemote: false });
        expect(cleanStatus.exists).toBe(true);
        expect(cleanStatus.hasWorkingCopyChanges).toBe(false);
        expect(cleanStatus.changesNotPushed).toBe(0);

        // Add + commit a real file in the worktree
        await fs.writeFile(path.join(created.worktreePath, 'feature.txt'), 'hello world\n');
        await git(created.worktreePath, 'add feature.txt');
        await git(created.worktreePath, 'commit -m "add feature"');

        const statusAfterCommit = await service.getStatus(sessionId, canonicalRepo, created.startCommit, { fetchRemote: false });
        expect(statusAfterCommit.changesNotPushed).toBeGreaterThanOrEqual(1);
        expect(statusAfterCommit.hasWorkingCopyChanges).toBe(false);

        // Add an uncommitted file -> hasWorkingCopyChanges should flip to true
        await fs.writeFile(path.join(created.worktreePath, 'untracked.txt'), 'wip\n');
        const statusAfterUntracked = await service.getStatus(sessionId, canonicalRepo, created.startCommit, { fetchRemote: false });
        expect(statusAfterUntracked.hasWorkingCopyChanges).toBe(true);
    }, 30000);

    it('story-worktree-service-git-migration S-002/S-003 getMergeDeploymentGuardStatus() detects undeployed canonical vs artifact-only delta using real fetch/diff', async () => {
        // Second clone pushes a new commit to origin, simulating a merge that happened elsewhere
        const otherClone = path.join(tmpRoot, 'other-clone');
        await run(tmpRoot, `git clone "${originBare}" "${otherClone}"`);
        await git(otherClone, 'config user.name "Other User"');
        await git(otherClone, 'config user.email "other@example.com"');
        await git(otherClone, 'checkout develop');
        await fs.writeFile(path.join(otherClone, 'src.txt'), 'real source change\n');
        await git(otherClone, 'add src.txt');
        await git(otherClone, 'commit -m "real source change"');
        await git(otherClone, 'push origin develop');

        // canonical is still on the old commit -> not deployed
        const guardStatus = await service.getMergeDeploymentGuardStatus(canonicalRepo, {
            mainBranchName: 'develop',
            fetchRemote: true
        });
        expect(guardStatus.canonical).toBe(true);
        expect(guardStatus.ready).toBe(false);
        expect(guardStatus.reason).toBe('canonical_workspace_not_deployed');

        // Now build an artifact-only delta scenario: sync canonical up to date first,
        // then push an artifact-only change (CLAUDE.md) from the other clone.
        await git(canonicalRepo, 'fetch origin');
        await git(canonicalRepo, 'checkout -B develop origin/develop');

        await fs.writeFile(path.join(otherClone, 'CLAUDE.md'), '# artifact only change\n');
        await git(otherClone, 'add CLAUDE.md');
        await git(otherClone, 'commit -m "artifact only change"');
        await git(otherClone, 'push origin develop');

        const artifactOnlyStatus = await service.getMergeDeploymentGuardStatus(canonicalRepo, {
            mainBranchName: 'develop',
            fetchRemote: true
        });
        expect(artifactOnlyStatus.canonical).toBe(true);
        expect(artifactOnlyStatus.ready).toBe(true);
        expect(artifactOnlyStatus.reason).toBe('ok_ignored_artifact_delta');
    }, 30000);

    it('story-worktree-service-git-migration S-004 syncCanonicalWorkspaceAfterMerge() converges canonical (including from detached HEAD) and fails loud on unresolved conflicts', async () => {
        const otherClone = path.join(tmpRoot, 'other-clone-sync');
        await run(tmpRoot, `git clone "${originBare}" "${otherClone}"`);
        await git(otherClone, 'config user.name "Other User"');
        await git(otherClone, 'config user.email "other@example.com"');
        await git(otherClone, 'checkout develop');
        await fs.writeFile(path.join(otherClone, 'src2.txt'), 'more real source change\n');
        await git(otherClone, 'add src2.txt');
        await git(otherClone, 'commit -m "more real source change"');
        await git(otherClone, 'push origin develop');

        // canonical is behind -> guard should be not-ready before sync
        const beforeSync = await service.getMergeDeploymentGuardStatus(canonicalRepo, {
            mainBranchName: 'develop',
            fetchRemote: true
        });
        expect(beforeSync.ready).toBe(false);

        const syncResult = await service.syncCanonicalWorkspaceAfterMerge(canonicalRepo, 'develop');
        expect(syncResult.success).toBe(true);
        expect(syncResult.status.ready).toBe(true);

        const { stdout: branchAfterSync } = await git(canonicalRepo, 'branch --show-current');
        expect(branchAfterSync.trim()).toBe('develop');

        const { stdout: headAfterSync } = await git(canonicalRepo, 'rev-parse HEAD');
        const { stdout: originDevelopSha } = await git(canonicalRepo, 'rev-parse origin/develop');
        expect(headAfterSync.trim()).toBe(originDevelopSha.trim());

        // detached HEAD convergence: put canonical in detached HEAD, then sync again
        await git(canonicalRepo, 'checkout --detach HEAD');
        const { stdout: detachedCheck } = await git(canonicalRepo, 'branch --show-current');
        expect(detachedCheck.trim()).toBe('');

        const syncFromDetached = await service.syncCanonicalWorkspaceAfterMerge(canonicalRepo, 'develop');
        expect(syncFromDetached.success).toBe(true);
        const { stdout: branchAfterDetachedSync } = await git(canonicalRepo, 'branch --show-current');
        expect(branchAfterDetachedSync.trim()).toBe('develop');

        // Negative path: canonical has an uncommitted conflicting change that blocks checkout -B
        await fs.writeFile(path.join(otherClone, 'src2.txt'), 'yet another real source change\n');
        await git(otherClone, 'add src2.txt');
        await git(otherClone, 'commit -m "conflicting upstream change"');
        await git(otherClone, 'push origin develop');

        // Make canonical dirty in a way that conflicts with the incoming checkout -B reset:
        // an untracked file whose path collides with a file origin/develop will bring in
        // is not enough to fail checkout -B (it force-resets branch ref, not working tree
        // conflict-checks the same way); instead, simulate a genuine failure by removing
        // write permission on the .git directory so the fetch/checkout sequence errors out.
        const gitDir = path.join(canonicalRepo, '.git');
        await fs.chmod(gitDir, 0o500);
        try {
            const failedSync = await service.syncCanonicalWorkspaceAfterMerge(canonicalRepo, 'develop');
            expect(failedSync.success).toBe(false);
            expect(failedSync.reason).toBe('deploy_sync_failed');
        } finally {
            await fs.chmod(gitDir, 0o700);
        }
    }, 30000);

    it('story-worktree-service-git-migration S-006 remove() deletes the real worktree directory, its git registration, and the session branch', async () => {
        const sessionId = 'e2e-session-6';
        const created = await service.create(sessionId, canonicalRepo, { skipFetch: true });

        await expect(fs.access(created.worktreePath)).resolves.toBeUndefined();

        const removed = await service.remove(sessionId, canonicalRepo);
        expect(removed).toBe(true);

        await expect(fs.access(created.worktreePath)).rejects.toThrow();

        const { stdout: worktreeListAfter } = await git(canonicalRepo, 'worktree list --porcelain');
        expect(worktreeListAfter).not.toContain(path.resolve(created.worktreePath));

        await expect(
            git(canonicalRepo, `rev-parse --verify "refs/heads/session/${sessionId}"`)
        ).rejects.toThrow();
    }, 30000);

    it('story-worktree-service-git-migration S-007 cleanupZombieWorktrees() removes a fabricated zombie directory not registered with git worktree list', async () => {
        const sessionId = 'e2e-session-7';
        await service.create(sessionId, canonicalRepo, { skipFetch: true });

        // Fabricate a zombie: a directory with a .git file (worktree marker) that
        // git worktree list does NOT know about.
        const zombieDir = path.join(worktreesDir, 'zombie-workspace-repo');
        await fs.mkdir(zombieDir, { recursive: true });
        await fs.writeFile(path.join(zombieDir, '.git'), 'gitdir: /nonexistent/path\n');

        const removedDirs = await service.cleanupZombieWorktrees(canonicalRepo);

        expect(removedDirs).toContain('zombie-workspace-repo');
        await expect(fs.access(zombieDir)).rejects.toThrow();

        // Real worktree from create() must be untouched
        const { stdout: worktreeListAfter } = await git(canonicalRepo, 'worktree list --porcelain');
        expect(worktreeListAfter).toContain(`${sessionId}-canonical`);
    }, 30000);
});
