import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeService } from '../../../server/services/worktree-service.js';
import { logger } from '../../../server/utils/logger.js';

// story-worktree-service-git-migration: _hasWorkingCopyConflicts runs
// `git ls-files -u` to detect conflicts. A workspace directory that has vanished
// mid-teardown (race with cleanup) makes git exit with "fatal: not a git
// repository". This is a legitimate state with no conflicts to report, but it
// must not spam the error log every poll — same treatment as the "No conflicts"
// path in the pre-migration jj implementation.

describe('WorktreeService conflict inspection', () => {
  let warnSpy;

  beforeEach(() => {
    vi.restoreAllMocks();
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  function service(execPromise) {
    return new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise);
  }

  describe('_isBenignConflictInspectError', () => {
    it('not a git repository_benignと判定する', () => {
      expect(service(vi.fn())._isBenignConflictInspectError('fatal: not a git repository (or any of the parent directories): .git')).toBe(true);
    });

    it('一般的なgitエラー_benignではない', () => {
      expect(service(vi.fn())._isBenignConflictInspectError('fatal: unable to read tree')).toBe(false);
    });
  });

  describe('_hasWorkingCopyConflicts', () => {
    it('worktreeが消えている場合_falseを返しwarnしない', async () => {
      const exec = vi.fn().mockRejectedValue(Object.assign(new Error('fatal: not a git repository (or any of the parent directories): .git'), {
        stderr: 'fatal: not a git repository (or any of the parent directories): .git\n',
      }));
      const result = await service(exec)._hasWorkingCopyConflicts('/Volumes/UNSON-DRIVE/brainbase-worktrees/session-x');
      expect(result).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('conflictなし_falseを返す', async () => {
      const exec = vi.fn().mockResolvedValue({ stdout: '' });
      const result = await service(exec)._hasWorkingCopyConflicts('/tmp/wt');
      expect(result).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('一般的なgitエラー_falseを返すが従来どおりwarnする', async () => {
      const exec = vi.fn().mockRejectedValue(Object.assign(new Error('fatal: unable to read tree'), { stderr: 'fatal: unable to read tree\n' }));
      const result = await service(exec)._hasWorkingCopyConflicts('/tmp/wt');
      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('conflictあり_trueを返す', async () => {
      const exec = vi.fn().mockResolvedValue({
        stdout: '100644 abc123 1\tpath/to/file.txt\n100644 def456 2\tpath/to/file.txt\n100644 ghi789 3\tpath/to/file.txt\n'
      });
      const result = await service(exec)._hasWorkingCopyConflicts('/tmp/wt');
      expect(result).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(exec).toHaveBeenCalledWith('git -C "/tmp/wt" ls-files -u');
    });
  });
});
