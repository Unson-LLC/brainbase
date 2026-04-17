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
    killFn = vi.fn(),
    registryEntry = null,
    tmuxRunning = true,
    ownerSnapshot = null,
    sessions = [{ id: 'session-1', name: 'Session 1', engine: 'claude', intendedState: 'active' }],
    ensureSessionRuntime = vi.fn()
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
      runtimeLifecycle: { ensureSessionRuntime },
      ownershipService: ownership,
      runtimeRegistry: registry,
      execSyncFn: vi.fn(() => dryProcesses),
      killFn
    });
    return { reconciler, registry, killFn, ownership, ensureSessionRuntime };
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
});
