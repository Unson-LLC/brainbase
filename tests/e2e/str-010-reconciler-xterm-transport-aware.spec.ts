import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { TerminalRuntimeReconciler } from '../../server/services/terminal-runtime-reconciler.js';

// STR-010 reconciler transport-aware ttyd classification — in-process e2e (no browser).

const staleTtydEntry = () => ({
  sessionId: 'session-1',
  intendedState: 'active',
  session: { ttydProcess: { pid: 4242, port: 7681 } },
  ttyd: [],
  tmux: { exists: true },
  pane: { stuck: false },
  ownership: {},
});

function reconciler(terminalTransport: string) {
  return new TerminalRuntimeReconciler({
    stateStore: { get: () => ({ sessions: [] }) },
    runtimeRegistry: { getSession: () => null, getAll: () => ({ sessions: {} }), updateSession: () => {} },
    execSyncFn: () => '',
    terminalTransport,
  } as any);
}

test.describe('str-010-reconciler-xterm-transport-aware', () => {
  test('STR-010 ac:1 xterm transport 時、active + tmux 生存 + 永続 ttydProcess + 実 ttyd なし のセッションを stale_ttyd_process 扱いせず DEGRADED にしない', () => {
    const { runtimeState, issues } = reconciler('xterm')._classifyRuntimeState(staleTtydEntry());
    const ok = !issues.some((i: any) => i.type === 'stale_ttyd_process') && runtimeState !== 'degraded';
    expect(ok).toBe(true); // xterm transport 時、active + tmux 生存 + 永続 ttydProcess + 実 ttyd なし のセッションを stale_ttyd_process 扱いせず DEGRADED にしない
  });

  test('STR-010 ac:2 ttyd transport 時は従来どおり stale_ttyd_process で DEGRADED 分類する（既存挙動を維持）', () => {
    const { runtimeState, issues } = reconciler('ttyd')._classifyRuntimeState(staleTtydEntry());
    const ok = issues.some((i: any) => i.type === 'stale_ttyd_process') && runtimeState === 'degraded';
    expect(ok).toBe(true); // ttyd transport 時は従来どおり stale_ttyd_process で DEGRADED 分類する（既存挙動を維持）
  });

  test('STR-010 ac:3 xterm transport で recover 実行時、該当セッションに reconnect_ttyd アクションを出さない（churn 停止）', async () => {
    let reconnectCalled = false;
    const r = new TerminalRuntimeReconciler({
      stateStore: { get: () => ({ sessions: [{ id: 'session-1', intendedState: 'active', ttydProcess: { pid: 4242, port: 7681 } }] }) },
      runtimeQuery: { _isTmuxSessionRunningSync: () => true },
      runtimeLifecycle: {
        _restartTtydForExistingTmux: () => { reconnectCalled = true; return {}; },
        startTtyd: () => { reconnectCalled = true; return {}; },
        ensureSessionRuntime: () => {},
      },
      runtimeRegistry: { getSession: () => null, getAll: () => ({ sessions: {} }), updateSession: () => {} },
      execSyncFn: () => '',
      terminalTransport: 'xterm',
    } as any);
    const result = await r.reconcile({ dryRun: false, recover: true });
    const reconnects = (result.actions || []).filter((a: any) => a.type === 'reconnect_ttyd');
    expect(reconnects.length === 0 && reconnectCalled === false).toBe(true); // xterm transport で recover 実行時、該当セッションに reconnect_ttyd アクションを出さない（churn 停止）
  });

  test('STR-010 ac:4 VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる', () => {
    const artifacts = [
      'docs/stories/STR-010-reconciler-xterm-transport-aware.md',
      'docs/specs/STR-010-reconciler-xterm-transport-aware.md',
      'server/services/terminal-runtime-reconciler.js',
      'tests/unit/reconciler-xterm-transport-aware.test.js',
      'tests/e2e/str-010-reconciler-xterm-transport-aware.spec.ts',
    ];
    expect(artifacts.every((p) => fs.existsSync(p))).toBe(true); // VibePro dogfood run として Story -> Architecture -> Spec -> Test -> Code -> Run evidence が追跡できる
  });
});
