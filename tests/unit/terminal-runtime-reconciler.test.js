import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalRuntimeReconciler } from '../../server/services/terminal-runtime-reconciler.js';

const NOW = new Date('2026-04-17T12:00:00.000Z');

describe('TerminalRuntimeReconciler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function buildReconciler({
    dryProcesses = '',
    paneOutput = '',
    killFn = vi.fn(),
    registryEntry = null,
    tmuxRunning = true,
    ownerSnapshot = null,
    sessions = [{ id: 'session-1', name: 'Session 1', engine: 'claude', intendedState: 'active' }],
    ensureSessionRuntime = vi.fn(),
    stopTtyd = vi.fn(),
    startTtyd = vi.fn()
  } = {}) {
    const registry = {
      getAll: vi.fn(() => ({ sessions: {} })),
      getSession: vi.fn(() => registryEntry),
      updateSession: vi.fn()
    };
    const ownership = {
      getTerminalOwnerSnapshot: vi.fn(() => ownerSnapshot),
      releaseTerminalOwnership: vi.fn(() => true)
    };
    const reconciler = new TerminalRuntimeReconciler({
      stateStore: {
        get: vi.fn(() => ({ sessions }))
      },
      runtimeQuery: {
        _isTmuxSessionRunningSync: vi.fn(() => tmuxRunning)
      },
      runtimeLifecycle: { ensureSessionRuntime, stopTtyd, startTtyd },
      ownershipService: ownership,
      runtimeRegistry: registry,
      execSyncFn: vi.fn((command) => String(command).startsWith('tmux capture-pane') ? paneOutput : dryProcesses),
      killFn
    });
    return { reconciler, registry, killFn, ownership, ensureSessionRuntime, stopTtyd, startTtyd };
  }

  it('activeかつtmuxとfresh probeがある場合_interactive_readyになる', async () => {
    const { reconciler } = buildReconciler({
      registryEntry: {
        observed: {
          inputProbe: { status: 'passed', lastPassedAt: '2026-04-17T11:59:30.000Z' }
        }
      }
    });

    const health = await reconciler.getHealth();

    expect(health.status).toBe('healthy');
    expect(health.sessions.interactiveReady).toBe(1);
    expect(health.sessionHealth[0]).toMatchObject({
      runtimeState: 'interactive_ready',
      issues: []
    });
  });

  it('activeかつtmuxがあるがprobeが古い場合_snapshot_onlyになる', async () => {
    const { reconciler } = buildReconciler({
      registryEntry: {
        observed: {
          inputProbe: { status: 'passed', lastPassedAt: '2026-04-17T11:58:00.000Z' }
        }
      }
    });

    const health = await reconciler.getHealth();

    expect(health.status).toBe('healthy');
    expect(health.sessions.snapshotOnly).toBe(1);
    expect(health.sessionHealth[0].runtimeState).toBe('snapshot_only');
  });

  it('activeでtmuxがない場合_degradedになる', async () => {
    const { reconciler } = buildReconciler({ tmuxRunning: false });

    const health = await reconciler.getHealth();

    expect(health.status).toBe('degraded');
    expect(health.sessions.degraded).toBe(1);
    expect(health.issues).toContainEqual(expect.objectContaining({
      type: 'tmux_missing',
      severity: 'critical'
    }));
  });

  it('inactive sessionはstoppedになる', async () => {
    const { reconciler } = buildReconciler({
      sessions: [{ id: 'session-1', intendedState: 'archived' }]
    });

    const health = await reconciler.getHealth();

    expect(health.status).toBe('healthy');
    expect(health.sessionHealth[0].runtimeState).toBe('stopped');
  });

  it('dryRun時_duplicate ttydを検出するがkillしない', async () => {
    const { reconciler, killFn } = buildReconciler({
      dryProcesses: [
        '100 1 100 ttyd -p 40101 tmux attach -t session-1 /console/session-1',
        '101 1 101 ttyd -p 40102 tmux attach -t session-1 /console/session-1'
      ].join('\n')
    });

    const result = await reconciler.reconcile({ dryRun: true });

    expect(result.actions).toContainEqual(expect.objectContaining({
      type: 'kill_stale_ttyd',
      sessionId: 'session-1',
      dryRun: true
    }));
    expect(killFn).not.toHaveBeenCalled();
  });

  it('non dryRun時_duplicate ttydをkillする', async () => {
    const { reconciler, killFn } = buildReconciler({
      dryProcesses: [
        '100 1 100 ttyd -p 40101 tmux attach -t session-1 /console/session-1',
        '101 1 101 ttyd -p 40102 tmux attach -t session-1 /console/session-1'
      ].join('\n')
    });

    await reconciler.reconcile({ dryRun: false });

    expect(killFn).toHaveBeenCalledWith(100, 'SIGTERM');
  });

  it('stale ownershipはdryRunでclear actionだけ返す', async () => {
    const { reconciler, ownership } = buildReconciler({
      ownerSnapshot: {
        ownerViewerId: 'viewer-1',
        ownerViewerLabel: 'Old browser',
        claimedAt: '2026-04-17T11:50:00.000Z',
        lastSeenAt: '2026-04-17T11:58:00.000Z'
      }
    });

    const result = await reconciler.reconcile({ dryRun: true });

    expect(result.actions).toContainEqual(expect.objectContaining({
      type: 'clear_stale_ownership',
      ownerViewerId: 'viewer-1',
      dryRun: true
    }));
    expect(ownership.releaseTerminalOwnership).not.toHaveBeenCalled();
  });

  it('stale ownershipはnon dryRunで解放する', async () => {
    const { reconciler, ownership } = buildReconciler({
      ownerSnapshot: {
        ownerViewerId: 'viewer-1',
        ownerViewerLabel: 'Old browser',
        claimedAt: '2026-04-17T11:50:00.000Z',
        lastSeenAt: '2026-04-17T11:58:00.000Z'
      }
    });

    await reconciler.reconcile({ dryRun: false });

    expect(ownership.releaseTerminalOwnership).toHaveBeenCalledWith('session-1', 'viewer-1', { force: true });
  });

  it('recover falseではensureSessionRuntimeを呼ばない', async () => {
    const { reconciler, ensureSessionRuntime } = buildReconciler({ tmuxRunning: false });

    await reconciler.reconcile({ dryRun: false, recover: false });

    expect(ensureSessionRuntime).not.toHaveBeenCalled();
  });

  it('recover trueではactive degraded sessionだけensureSessionRuntimeを呼ぶ', async () => {
    const { reconciler, ensureSessionRuntime } = buildReconciler({ tmuxRunning: false });

    await reconciler.reconcile({ dryRun: false, recover: true });

    expect(ensureSessionRuntime).toHaveBeenCalledWith({ sessionId: 'session-1' });
  });

  it('Codex paneがMallocStackLogging floodの場合_degraded issueになる', async () => {
    const { reconciler } = buildReconciler({
      paneOutput: Array.from({ length: 20 }, (_, index) =>
        `codex(${index}) MallocStackLogging: can't turn off malloc stack logging because it was not enabled.`
      ).join('\n')
    });

    const health = await reconciler.getHealth();

    expect(health.status).toBe('degraded');
    expect(health.sessions.degraded).toBe(1);
    expect(health.issues).toContainEqual(expect.objectContaining({
      type: 'codex_pane_error_flood',
      severity: 'critical'
    }));
    expect(health.sessionHealth[0].observed.pane).toMatchObject({
      stuck: true,
      matchedLines: 20
    });
  });

  it('recover trueでCodex pane floodの場合_tmuxごと再起動する', async () => {
    const stopTtyd = vi.fn(async () => true);
    const startTtyd = vi.fn(async () => ({ port: 40020 }));
    const { reconciler, ensureSessionRuntime } = buildReconciler({
      paneOutput: Array.from({ length: 20 }, (_, index) =>
        `codex(${index}) MallocStackLogging: can't turn off malloc stack logging because it was not enabled.`
      ).join('\n'),
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        engine: 'codex',
        intendedState: 'active',
        path: '/tmp/project',
        codexThreadId: '019e4ec7-0b5e-7ef3-8c97-3b57823b9291'
      }],
      stopTtyd,
      startTtyd
    });

    const result = await reconciler.reconcile({ dryRun: false, recover: true });

    expect(ensureSessionRuntime).not.toHaveBeenCalled();
    expect(stopTtyd).toHaveBeenCalledWith('session-1', { preserveTmux: false });
    expect(startTtyd).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      cwd: '/tmp/project',
      engine: 'codex',
      forceTtyd: true,
      codexResumeId: '019e4ec7-0b5e-7ef3-8c97-3b57823b9291'
    }));
    expect(result.actions).toContainEqual(expect.objectContaining({
      type: 'restart_terminal_runtime',
      reason: 'codex_pane_error_flood',
      success: true
    }));
  });
});
