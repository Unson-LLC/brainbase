import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorktreeService } from '../../../server/services/worktree-service.js';
import { logger } from '../../../server/utils/logger.js';

// STR-012: _hasWorkingCopyConflicts runs `jj resolve --list` to detect conflicts.
// A workspace that is not a jj repo (e.g. a git-only worktree) makes jj exit with
// "There is no jj repo in ...". This is a legitimate state with no jj conflicts, but
// it fell through to logger.warn and spammed the error log every poll. Treat it (like
// "No conflicts found") as a benign no-conflicts result without warning.

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
    it('No conflicts found_benignと判定する', () => {
      expect(service(vi.fn())._isBenignConflictInspectError('No conflicts found')).toBe(true);
    });

    it('There is no jj repo_benignと判定する', () => {
      expect(service(vi.fn())._isBenignConflictInspectError('Error: There is no jj repo in "/x/y"')).toBe(true);
    });

    it('一般的なjjエラー_benignではない', () => {
      expect(service(vi.fn())._isBenignConflictInspectError('Error: failed to snapshot the working copy')).toBe(false);
    });
  });

  describe('_hasWorkingCopyConflicts', () => {
    it('jj非リポジトリ_falseを返しwarnしない', async () => {
      const exec = vi.fn().mockRejectedValue(Object.assign(new Error('There is no jj repo in "/Volumes/UNSON-DRIVE/brainbase-worktrees/session-x"'), {
        stderr: 'Error: There is no jj repo in "/Volumes/UNSON-DRIVE/brainbase-worktrees/session-x"\n',
      }));
      const result = await service(exec)._hasWorkingCopyConflicts('/Volumes/UNSON-DRIVE/brainbase-worktrees/session-x');
      expect(result).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('No conflicts found_falseを返しwarnしない(既存挙動)', async () => {
      const exec = vi.fn().mockRejectedValue(Object.assign(new Error('No conflicts found'), { stderr: 'No conflicts found\n' }));
      const result = await service(exec)._hasWorkingCopyConflicts('/tmp/wt');
      expect(result).toBe(false);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('一般的なjjエラー_falseを返すが従来どおりwarnする', async () => {
      const exec = vi.fn().mockRejectedValue(Object.assign(new Error('failed to snapshot the working copy'), { stderr: 'Error: failed to snapshot the working copy\n' }));
      const result = await service(exec)._hasWorkingCopyConflicts('/tmp/wt');
      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('conflictあり_trueを返す', async () => {
      const exec = vi.fn().mockResolvedValue({ stdout: 'path/to/file.txt    2-sided conflict\n' });
      const result = await service(exec)._hasWorkingCopyConflicts('/tmp/wt');
      expect(result).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
