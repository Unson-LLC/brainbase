import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorktreeService } from '../../../server/services/worktree-service.js';

describe('WorktreeService.cleanupZombieWorktrees', () => {
    let service;
    let mockExec;

    beforeEach(() => {
        mockExec = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', mockExec);
    });

    it('登録済みworktreeは削除しない', async () => {
        const { promises: fs } = await import('fs');

        vi.spyOn(fs, 'readdir').mockResolvedValueOnce([
            { name: 'session-1-brainbase', isDirectory: () => true }
        ]);
        vi.spyOn(fs, 'access').mockResolvedValueOnce(undefined); // .git exists

        mockExec.mockResolvedValueOnce({
            stdout: [
                'worktree /tmp/repo',
                'HEAD abc123',
                'branch refs/heads/main',
                '',
                'worktree /tmp/worktrees/session-1-brainbase',
                'HEAD def456',
                'branch refs/heads/session/session-1',
                ''
            ].join('\n')
        });

        const removed = await service.cleanupZombieWorktrees('/tmp/repo');

        expect(removed).toEqual([]);
    });

    it('git worktree listに無いworktreeをゾンビとして削除する', async () => {
        const { promises: fs } = await import('fs');

        vi.spyOn(fs, 'readdir').mockResolvedValueOnce([
            { name: 'session-zombie-brainbase', isDirectory: () => true },
            { name: 'session-alive-brainbase', isDirectory: () => true }
        ]);
        // .git access checks: both exist
        vi.spyOn(fs, 'access')
            .mockResolvedValueOnce(undefined)   // zombie .git exists
            .mockResolvedValueOnce(undefined);  // alive .git exists
        vi.spyOn(fs, 'rm').mockResolvedValueOnce(undefined);

        mockExec
            .mockResolvedValueOnce({
                stdout: [
                    'worktree /tmp/repo',
                    'HEAD abc123',
                    'branch refs/heads/main',
                    '',
                    'worktree /tmp/worktrees/session-alive-brainbase',
                    'HEAD def456',
                    'branch refs/heads/session/session-alive',
                    ''
                ].join('\n')
            })
            .mockResolvedValueOnce({ stdout: '' }); // worktree prune

        const removed = await service.cleanupZombieWorktrees('/tmp/repo');

        expect(removed).toEqual(['session-zombie-brainbase']);
        expect(fs.rm).toHaveBeenCalledWith(
            '/tmp/worktrees/session-zombie-brainbase',
            { recursive: true, force: true }
        );
        expect(mockExec).toHaveBeenCalledWith('git -C "/tmp/repo" worktree prune');
    });

    it('.gitがないディレクトリはスキップする', async () => {
        const { promises: fs } = await import('fs');

        vi.spyOn(fs, 'readdir').mockResolvedValueOnce([
            { name: 'random-dir', isDirectory: () => true }
        ]);
        // .git access fails (not a worktree)
        vi.spyOn(fs, 'access').mockRejectedValueOnce(new Error('ENOENT'));

        mockExec.mockResolvedValueOnce({ stdout: 'worktree /tmp/repo\nHEAD abc123\nbranch refs/heads/main\n' });

        const removed = await service.cleanupZombieWorktrees('/tmp/repo');

        expect(removed).toEqual([]);
    });

    it('git worktree listコマンド失敗時は空配列を返す', async () => {
        const { promises: fs } = await import('fs');

        vi.spyOn(fs, 'readdir').mockResolvedValueOnce([
            { name: 'session-1-brainbase', isDirectory: () => true }
        ]);

        mockExec.mockRejectedValueOnce(new Error('git not found'));

        const removed = await service.cleanupZombieWorktrees('/tmp/repo');

        expect(removed).toEqual([]);
    });

    it('worktreesディレクトリが空なら何もしない', async () => {
        const { promises: fs } = await import('fs');

        vi.spyOn(fs, 'readdir').mockResolvedValueOnce([]);

        const removed = await service.cleanupZombieWorktrees('/tmp/repo');

        expect(removed).toEqual([]);
        expect(mockExec).not.toHaveBeenCalled();
    });
});
