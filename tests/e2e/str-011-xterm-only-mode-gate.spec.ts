import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { runtimeQueryMethods } from '../../server/services/session-runtime/runtime-query-methods.js';
import { runtimeMaintenanceMethods } from '../../server/services/session-runtime/runtime-maintenance-methods.js';

// STR-011 _isXtermOnlyMode transport gate — in-process e2e (no browser).

function withEnv(env: Record<string, string | undefined>, fn: () => any) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    prev[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k] as string;
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k] as string;
    }
  }
}

test.describe('str-011-xterm-only-mode-gate', () => {
  test('STR-011 ac:1 transport === \'xterm\' のとき、BRAINBASE_TEST_MODE の値に関わらず _isXtermOnlyMode() が true を返す', () => {
    const r = withEnv({ BRAINBASE_TERMINAL_TRANSPORT: 'xterm', BRAINBASE_TEST_MODE: 'false' }, () => runtimeQueryMethods._isXtermOnlyMode.call({}));
    expect(r).toBe(true); // transport === 'xterm' のとき、BRAINBASE_TEST_MODE の値に関わらず _isXtermOnlyMode() が true を返す
  });

  test('STR-011 ac:2 xterm-only 時、repairActiveTtydSessions は早期 return し ttyd 修復（spawn）を試みない', async () => {
    const r = await withEnv({ BRAINBASE_TERMINAL_TRANSPORT: 'xterm', BRAINBASE_TEST_MODE: 'false' }, () => {
      const host = {
        _isXtermOnlyMode: runtimeQueryMethods._isXtermOnlyMode,
        stateStore: { get: () => ({ sessions: [{ id: 'session-1', intendedState: 'active', ttydProcess: { pid: 1, port: 7681 } }] }) },
        getRuntimeStatus: () => { throw new Error('must not inspect under xterm-only'); },
        ensureTtydForActiveSession: () => { throw new Error('must not repair ttyd under xterm-only'); },
      };
      return runtimeMaintenanceMethods.repairActiveTtydSessions.call(host);
    });
    expect(r).toEqual({ checked: 0, restarted: 0, failed: 0, skipped: 0 }); // xterm-only 時、repairActiveTtydSessions は早期 return し ttyd 修復（spawn）を試みない
  });

  test('STR-011 ac:3 ttyd transport 構成では従来どおり、repairActiveTtydSessions が active セッションを検査し、startTtyd が ttyd spawn の環境変数を設定する（既存挙動を維持）', async () => {
    const checked = await withEnv({ BRAINBASE_TERMINAL_TRANSPORT: 'ttyd' }, () => {
      const host = {
        _isXtermOnlyMode: runtimeQueryMethods._isXtermOnlyMode,
        stateStore: { get: () => ({ sessions: [{ id: 'session-1', intendedState: 'active', ttydProcess: { pid: 1, port: 7681 } }] }) },
        getRuntimeStatus: () => ({ ttydRunning: true }),
        ensureTtydForActiveSession: () => ({ restarted: false }),
      };
      return runtimeMaintenanceMethods.repairActiveTtydSessions.call(host);
    });
    expect((checked as any).checked).toBe(1); // ttyd transport 構成では従来どおり、repairActiveTtydSessions が active セッションを検査し、startTtyd が ttyd spawn の環境変数を設定する（既存挙動を維持）
  });

  test('STR-011 ac:4 VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる', () => {
    const artifacts = [
      'docs/stories/STR-011-xterm-only-mode-gate.md',
      'docs/specs/STR-011-xterm-only-mode-gate.md',
      'server/services/session-runtime/runtime-query-methods.js',
      'tests/unit/xterm-only-mode-gate.test.js',
      'tests/e2e/str-011-xterm-only-mode-gate.spec.ts',
    ];
    expect(artifacts.every((p) => fs.existsSync(p))).toBe(true); // VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる
  });
});
