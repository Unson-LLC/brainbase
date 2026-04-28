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
            .mockResolvedValueOnce({ stdout: '- feat: archive\n' })
            .mockResolvedValueOnce({ stdout: 'https://github.com/Unson-LLC/brainbase/pull/123\n' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' })
            .mockResolvedValueOnce({ stdout: '' });
        const service = new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);
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
