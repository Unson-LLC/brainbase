import { describe, expect, it } from 'vitest';
import { TerminalRuntimeReconciler } from '../../server/services/terminal-runtime-reconciler.js';

// STR-010: In production the terminal transport is xterm (tmux + WebSocket); ttyd
// is not the live mechanism and zero ttyd processes run. The reconciler used to
// classify an active session that has a persisted ttydProcess record but no
// observed ttyd as `stale_ttyd_process` -> DEGRADED -> force reconnect_ttyd every
// watchdog cycle, producing the chronic "recovered N issue(s)" churn that never
// converges. When transport is xterm, a missing ttyd is NOT degraded.

function buildReconciler({ terminalTransport } = {}) {
  return new TerminalRuntimeReconciler({
    stateStore: { get: () => ({ sessions: [] }) },
    runtimeRegistry: { getSession: () => null, getAll: () => ({ sessions: {} }), updateSession: () => {} },
    execSyncFn: () => '',
    terminalTransport,
  });
}

const staleTtydEntry = () => ({
  sessionId: 'session-1',
  intendedState: 'active',
  session: { ttydProcess: { pid: 4242, port: 7681 } },
  ttyd: [],
  tmux: { exists: true },
  pane: { stuck: false },
  ownership: {},
});

describe('reconciler transport-aware ttyd classification', () => {
  it('xterm transport時_active+tmux+persisted ttydProcess+ttyd無し_stale_ttyd_processを出さずdegradedにしない', () => {
    const reconciler = buildReconciler({ terminalTransport: 'xterm' });
    const { runtimeState, issues } = reconciler._classifyRuntimeState(staleTtydEntry());
    expect(issues.some((i) => i.type === 'stale_ttyd_process')).toBe(false);
    expect(runtimeState).not.toBe('degraded');
  });

  it('ttyd transport(既定)時_同じ条件_従来どおりstale_ttyd_processでdegradedになる', () => {
    const reconciler = buildReconciler({ terminalTransport: 'ttyd' });
    const { runtimeState, issues } = reconciler._classifyRuntimeState(staleTtydEntry());
    expect(issues.some((i) => i.type === 'stale_ttyd_process')).toBe(true);
    expect(runtimeState).toBe('degraded');
  });

  it('xterm transport時_reconcile recover_該当セッションにreconnect_ttydアクションを出さない', async () => {
    let reconnectCalled = false;
    const reconciler = new TerminalRuntimeReconciler({
      stateStore: { get: () => ({ sessions: [{ id: 'session-1', intendedState: 'active', ttydProcess: { pid: 4242, port: 7681 } }] }) },
      runtimeQuery: { _isTmuxSessionRunningSync: () => true },
      runtimeLifecycle: {
        _restartTtydForExistingTmux: () => { reconnectCalled = true; return {}; },
        startTtyd: () => { reconnectCalled = true; return {}; },
        ensureSessionRuntime: () => {},
      },
      runtimeRegistry: { getSession: () => null, getAll: () => ({ sessions: {} }), updateSession: () => {} },
      execSyncFn: (command) => String(command).startsWith('tmux') ? '' : '',
      terminalTransport: 'xterm',
    });
    const result = await reconciler.reconcile({ dryRun: false, recover: true });
    const reconnects = (result.actions || []).filter((a) => a.type === 'reconnect_ttyd');
    expect(reconnects.length).toBe(0);
    expect(reconnectCalled).toBe(false);
  });
});
