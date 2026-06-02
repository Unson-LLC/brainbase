import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { WorktreeService } from '../../server/services/worktree-service.js';
import { logger } from '../../server/utils/logger.js';

// STR-012 jj non-repo conflict inspection guard — in-process e2e (no browser).

function svc(execPromise: any) {
  return new WorktreeService('/tmp/worktrees', '/tmp/repo', execPromise) as any;
}

function rejectingExec(message: string, stderr: string) {
  return () => Promise.reject(Object.assign(new Error(message), { stderr }));
}

test.describe('str-012-jj-norepo-conflict-guard', () => {
  test('STR-012 ac:1 "There is no jj repo" 由来の失敗時、_hasWorkingCopyConflicts は warn せず false（conflict なし）を返す', async () => {
    const warns: any[] = [];
    const orig = logger.warn;
    (logger as any).warn = (...a: any[]) => warns.push(a);
    try {
      const result = await svc(rejectingExec('There is no jj repo in "/x/session-y"', 'Error: There is no jj repo in "/x/session-y"\n'))._hasWorkingCopyConflicts('/x/session-y');
      expect(result === false && warns.length === 0).toBe(true); // "There is no jj repo" 由来の失敗時、_hasWorkingCopyConflicts は warn せず false（conflict なし）を返す
    } finally {
      (logger as any).warn = orig;
    }
  });

  test('STR-012 ac:2 "No conflicts found" は従来どおり warn せず false を返す（既存挙動を維持）', async () => {
    const warns: any[] = [];
    const orig = logger.warn;
    (logger as any).warn = (...a: any[]) => warns.push(a);
    try {
      const result = await svc(rejectingExec('No conflicts found', 'No conflicts found\n'))._hasWorkingCopyConflicts('/tmp/wt');
      expect(result === false && warns.length === 0).toBe(true); // "No conflicts found" は従来どおり warn せず false を返す（既存挙動を維持）
    } finally {
      (logger as any).warn = orig;
    }
  });

  test('STR-012 ac:3 上記以外の一般的な jj エラーは従来どおり logger.warn で記録する（warn を握り潰さない）', async () => {
    const warns: any[] = [];
    const orig = logger.warn;
    (logger as any).warn = (...a: any[]) => warns.push(a);
    try {
      const result = await svc(rejectingExec('failed to snapshot the working copy', 'Error: failed to snapshot the working copy\n'))._hasWorkingCopyConflicts('/tmp/wt');
      expect(result === false && warns.length === 1).toBe(true); // 上記以外の一般的な jj エラーは従来どおり logger.warn で記録する（warn を握り潰さない）
    } finally {
      (logger as any).warn = orig;
    }
  });

  test('STR-012 ac:4 VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる', () => {
    const artifacts = [
      'docs/stories/STR-012-jj-norepo-conflict-guard.md',
      'docs/specs/STR-012-jj-norepo-conflict-guard.md',
      'server/services/worktree-service.js',
      'tests/server/services/worktree-service-conflict-inspect.test.js',
      'tests/e2e/str-012-jj-norepo-conflict-guard.spec.ts',
    ];
    expect(artifacts.every((p) => fs.existsSync(p))).toBe(true); // VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる
  });
});
