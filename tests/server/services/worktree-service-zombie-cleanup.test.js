import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WorktreeService } from '../../../server/services/worktree-service.js';

describe('WorktreeService.cleanupZombieWorktrees', () => {
    let service;
    let mockExec;

    beforeEach(() => {
        mockExec = vi.fn();
        service = new WorktreeService('/tmp/worktrees', '/tmp/repo', mockExec);
    });

    it('登録済みワークスペースは削除しない', async () => {
        const { promises: fs } = await import('fs');

        vi.spyOn(fs, 'readdir').mockResolvedValueOnce([
            { name: 'session-1-brainbase', isDirectory: () => true }
        ]);
        vi.spyOn(fs, 'access').mockResolvedValueOnce(undefined); // .jj exists

        mockExec.mockResolvedValueOnce({
            stdout: 'session-1-brainbase: abc123\ndefault: def456\n'
        });

        const removed = await service.cleanupZombieWorktrees('/tmp/repo');

        expect(removed).toEqual([]);
    });

    it('jj workspace listに無いworktreeをゾンビとして削除する', async () => {
        const { promises: fs } = await import('fs');

        vi.spyOn(fs, 'readdir').mockResolvedValueOnce([
            { name: 'session-zombie-brainbase', isDirectory: () => true },
            { name: 'session-alive-brainbase', isDirectory: () => true }
        ]);
        // .jj access checks: both exist
        vi.spyOn(fs, 'access')
            .mockResolvedValueOnce(undefined)   // zombie .jj exists
            .mockResolvedValueOnce(undefined);  // alive .jj exists
        vi.spyOn(fs, 'rm').mockResolvedValueOnce(undefined);

        mockExec.mockResolvedValueOnce({
            stdout: 'session-alive-brainbase: abc123\ndefault: def456\n'
        });

        const removed = await service.cleanupZombieWorktrees('/tmp/repo');

        expect(removed).toEqual(['session-zombie-brainbase']);
        expect(fs.rm).toHaveBeenCalledWith(
            '/tmp/worktrees/session-zombie-brainbase',
            { recursive: true, force: true }
        );
    });

    it('.jjディレクトリがないディレクトリはスキップする', async () => {
        const { promises: fs } = await import('fs');

        vi.spyOn(fs, 'readdir').mockResolvedValueOnce([
            { name: 'random-dir', isDirectory: () => true }
        ]);
        // .jj access fails (not a worktree)
        vi.spyOn(fs, 'access').mockRejectedValueOnce(new Error('ENOENT'));

        mockExec.mockResolvedValueOnce({ stdout: 'default: abc123\n' });

        const removed = await service.cleanupZombieWorktrees('/tmp/repo');

        expect(removed).toEqual([]);
    });

    it('jjコマンド失敗時は空配列を返す', async () => {
        const { promises: fs } = await import('fs');

        vi.spyOn(fs, 'readdir').mockResolvedValueOnce([
            { name: 'session-1-brainbase', isDirectory: () => true }
        ]);

        mockExec.mockRejectedValueOnce(new Error('jj not found'));

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
