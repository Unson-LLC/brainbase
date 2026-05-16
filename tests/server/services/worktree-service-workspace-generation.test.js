import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { WorktreeService } from '../../../server/services/worktree-service.js';

describe('WorktreeService workspace generation', () => {
    let execPromise;
    let service;

    beforeEach(() => {
        vi.restoreAllMocks();
        execPromise = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);
    });

    it('C-1: create accepts an explicit workspace generation identity', async () => {
        vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
        vi.spyOn(fs, 'access').mockImplementation(async (targetPath) => {
            if (targetPath === '/tmp/repo') return undefined;
            throw Object.assign(new Error('not found'), { code: 'ENOENT' });
        });
        vi.spyOn(service, '_isJujutsuRepo').mockResolvedValue(true);
        vi.spyOn(service, '_ensureGitCompatibility').mockResolvedValue({
            gitWorktreePath: '/tmp/repo/.git/worktrees/session-1-g1-repo'
        });
        vi.spyOn(service, '_getMainBranchName').mockResolvedValue('develop');
        vi.spyOn(service, '_resolveWorkspaceBaseRevision').mockResolvedValue('develop');
        vi.spyOn(service, '_getWorkspaceStartCommit').mockResolvedValue('base123');

        execPromise
            .mockResolvedValueOnce({ stdout: '' }) // workspace list
            .mockResolvedValueOnce({ stdout: '' }) // workspace add
            .mockResolvedValueOnce({ stdout: '' }); // bookmark create

        const result = await service.create('session-1', '/tmp/repo', {
            workspaceId: 'session-1-g1',
            generation: 1,
            skipFetch: true
        });

        expect(result).toMatchObject({
            workspaceId: 'session-1-g1',
            generation: 1,
            workspaceName: 'session-1-g1-repo',
            worktreePath: '/tmp/worktrees/session-1-g1-repo',
            branchName: 'session/session-1-g1',
            startCommit: 'base123'
        });
        expect(execPromise).toHaveBeenCalledWith(
            'jj -R "/tmp/repo" workspace add --name "session-1-g1-repo" -r "develop" --sparse-patterns full "/tmp/worktrees/session-1-g1-repo"'
        );
        expect(execPromise).toHaveBeenCalledWith('jj -R "/tmp/repo" bookmark create -r develop "session/session-1-g1"');
    });

    it('S-1: merge can retire the active generation and create the next generation', async () => {
        vi.spyOn(service, '_getMainBranchName').mockResolvedValue('develop');
        vi.spyOn(service, '_getGitHubRepoSpec').mockResolvedValue('Unson-LLC/brainbase-unson');
        vi.spyOn(service, '_resolveMergeBookmarkName').mockResolvedValue('session/session-1-g1');
        vi.spyOn(service, '_pushBookmarkForMerge').mockResolvedValue(undefined);
        vi.spyOn(service, 'syncCanonicalWorkspaceAfterMerge').mockResolvedValue({ success: true });
        vi.spyOn(service, '_readPrMergeMetadata').mockResolvedValue({
            mergedAt: '2026-05-16T08:00:00Z',
            mergeCommit: 'merge123'
        });
        vi.spyOn(service, '_retireWorkspaceGeneration').mockResolvedValue({
            success: true,
            workspaceId: 'session-1-g1',
            generation: 1,
            workspaceName: 'session-1-g1-repo',
            workspacePath: '/tmp/worktrees/session-1-g1-repo',
            branchName: 'session/session-1-g1'
        });
        vi.spyOn(service, 'create').mockResolvedValue({
            workspaceId: 'session-1-g2',
            generation: 2,
            workspaceName: 'session-1-g2-repo',
            worktreePath: '/tmp/worktrees/session-1-g2-repo',
            branchName: 'session/session-1-g2',
            startCommit: 'develop123',
            repoPath: '/tmp/repo'
        });

        execPromise
            .mockResolvedValueOnce({ stdout: '- feat: rotate\n' })
            .mockResolvedValueOnce({ stdout: 'https://github.com/Unson-LLC/brainbase-unson/pull/999\n' })
            .mockResolvedValueOnce({ stdout: '' });

        const result = await service.merge('session-1', '/tmp/repo', 'Workspace rotation', {
            workspaceId: 'session-1-g1',
            generation: 1,
            workspacePath: '/tmp/worktrees/session-1-g1-repo',
            rotateAfterMerge: true
        });

        expect(result.success).toBe(true);
        expect(result.rotation.retired).toMatchObject({
            workspaceId: 'session-1-g1',
            generation: 1,
            branch: 'session/session-1-g1',
            mergedPrUrl: 'https://github.com/Unson-LLC/brainbase-unson/pull/999',
            mergeCommit: 'merge123'
        });
        expect(result.rotation.active).toMatchObject({
            workspaceId: 'session-1-g2',
            generation: 2,
            path: '/tmp/worktrees/session-1-g2-repo',
            branch: 'session/session-1-g2'
        });
        expect(service.create).toHaveBeenCalledWith('session-1', '/tmp/repo', {
            workspaceId: 'session-1-g2',
            generation: 2,
            skipFetch: true
        });
    });

    it('S-5: getStatus resolves the active workspace generation path', async () => {
        vi.spyOn(fs, 'access').mockResolvedValue(undefined);
        vi.spyOn(service, '_getMainBranchName').mockResolvedValue('develop');
        vi.spyOn(service, '_getBookmarkInfos').mockResolvedValue([
            { name: 'session/session-1-g2', pushed: true, output: 'session/session-1-g2: abc@origin' }
        ]);
        vi.spyOn(service, '_countCommitsAheadOfBase').mockResolvedValue(0);
        execPromise
            .mockResolvedValueOnce({ stdout: '0\n' })
            .mockResolvedValueOnce({ stdout: 'The working copy has no changes.\n' });

        const status = await service.getStatus('session-1', '/tmp/repo', 'base2', {
            workspaceId: 'session-1-g2',
            generation: 2,
            fetchRemote: false
        });

        expect(status.worktreePath).toBe('/tmp/worktrees/session-1-g2-repo');
        expect(status.workspaceName).toBe('session-1-g2-repo');
        expect(status.bookmarkName).toBe('session/session-1-g2');
        expect(status.workspaceId).toBe('session-1-g2');
        expect(status.generation).toBe(2);
    });
});
