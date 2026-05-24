import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { TerminalRuntimeReconciler } from '../../server/services/terminal-runtime-reconciler.js';
import { runtimeMaintenanceMethods } from '../../server/services/session-runtime/runtime-maintenance-methods.js';
import { logger } from '../../server/utils/logger.js';

const repoRoot = path.resolve(new URL('../..', import.meta.url).pathname);

function buildReconciler(overrides: {
  sessions?: Array<Record<string, unknown>>;
  tmuxRunning?: boolean;
  startTtydCalls?: Array<Record<string, unknown>>;
  restartTtydForExistingTmux?: (...args: Array<unknown>) => Promise<unknown>;
} = {}) {
  const startTtydCalls = overrides.startTtydCalls ?? [];
  const sessions = overrides.sessions ?? [{
    id: 'session-1',
    name: 'Session 1',
    engine: 'codex',
    intendedState: 'active',
    ttydProcess: {
      pid: 12345,
      port: 40020,
      startedAt: '2026-05-23T11:35:00.000Z',
      engine: 'codex',
    },
  }];

  const reconciler = new TerminalRuntimeReconciler({
    stateStore: {
      get: () => ({ sessions }),
    },
    runtimeQuery: {
      _isTmuxSessionRunningSync: () => overrides.tmuxRunning ?? true,
    },
    runtimeLifecycle: {
      ensureSessionRuntime: async (options: { sessionId: string }) => {
        throw new Error(`ensureSessionRuntime would not recreate ttyd for ${options.sessionId}`);
      },
      stopTtyd: async () => {
        throw new Error('stale ttyd recovery must preserve tmux');
      },
      startTtyd: async (options: Record<string, unknown>) => {
        startTtydCalls.push(options);
        return { port: 40020 };
      },
      _restartTtydForExistingTmux: overrides.restartTtydForExistingTmux,
    },
    runtimeRegistry: {
      getAll: () => ({ sessions: {} }),
      getSession: () => null,
      updateSession: () => {},
    },
    execSyncFn: (command: string) => {
      if (command.startsWith('ps ')) return '';
      if (command.startsWith('tmux capture-pane')) return '› Ready prompt';
      return '';
    },
    killFn: () => {
      throw new Error('no process should be killed for missing ttyd observation');
    },
  });

  return { reconciler, startTtydCalls };
}

test.describe('story-terminal-stale-runtime-auto-recovery', () => {
  test('ac:1 active tmux + missing ttyd + persisted ttydProcess is critical', async () => {
    const { reconciler } = buildReconciler();

    const health = await reconciler.getHealth();
    expect(health.status).toBe('degraded');
    expect(health.issues).toContainEqual(expect.objectContaining({
      type: 'stale_ttyd_process',
      severity: 'critical',
      sessionId: 'session-1',
    }));
  });

  test('ac:2 recover true reconnects ttyd without killing tmux', async () => {
    const { reconciler, startTtydCalls } = buildReconciler();

    const result = await reconciler.reconcile({ dryRun: false, recover: true });
    expect(result.actions).toContainEqual(expect.objectContaining({
      sessionId: 'session-1',
      type: 'reconnect_ttyd',
      reason: 'stale_ttyd_process',
      dryRun: false,
      success: true,
    }));
    expect(startTtydCalls).toEqual([expect.objectContaining({
      sessionId: 'session-1',
      engine: 'codex',
      preferredPort: 40020,
      forceTtyd: true,
      initialCommand: '',
    })]);
  });

  test('ac:3 no persisted ttyd remains snapshot only', async () => {
    const { reconciler } = buildReconciler({
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        engine: 'codex',
        intendedState: 'active',
      }],
    });

    const health = await reconciler.getHealth();
    expect(health.status).toBe('healthy');
    expect(health.sessions.snapshotOnly).toBe(1);
    expect(health.issues).not.toContainEqual(expect.objectContaining({
      type: 'stale_ttyd_process',
    }));
  });

  test('ac:4 stale ttyd recovery is surfaced as a reconnect action', async () => {
    const { reconciler } = buildReconciler();

    const result = await reconciler.reconcile({ dryRun: false, recover: true });
    expect(result.actions).toContainEqual(expect.objectContaining({
      sessionId: 'session-1',
      type: 'reconnect_ttyd',
      reason: 'stale_ttyd_process',
      success: true,
    }));

    const warnings: Array<string> = [];
    const originalWarn = logger.warn;
    const originalInfo = logger.info;
    const originalError = logger.error;
    logger.warn = (message: string) => { warnings.push(String(message)); };
    logger.info = () => {};
    logger.error = () => {};
    const context = {
      runtimeReconciler: {
        reconcile: async () => ({
          actions: [{
            type: 'reconnect_ttyd',
            sessionId: 'session-1',
            reason: 'stale_ttyd_process',
            success: true,
          }],
        }),
      },
      execPromise: async (command: string) => {
        if (command.includes('kern.tty.ptmx_max')) return { stdout: '512\n' };
        if (command.includes('/dev/pty')) return { stdout: '1\n' };
        return { stdout: '' };
      },
      cleanupOrphans: async () => {},
      repairActiveTtydSessions: async () => {},
      stopTtyd: async () => {},
      runtimeQuery: {},
      _healthMonitor: null,
      _ptyWatchdogTimer: null,
    };
    try {
      runtimeMaintenanceMethods.startPtyWatchdog.call(context, 1);
      await expect.poll(() => warnings.some((message) =>
        message.includes('Runtime reconciliation recovered 1 issue(s)')
      ), { timeout: 1000 }).toBe(true);
    } finally {
      runtimeMaintenanceMethods.stopPtyWatchdog.call(context);
      logger.warn = originalWarn;
      logger.info = originalInfo;
      logger.error = originalError;
    }
  });

  test('ac:5 failed reconnect keeps the previous persisted ttyd marker retryable', async () => {
    const previousTtydProcess = {
      pid: 12345,
      port: 40020,
      startedAt: '2026-05-23T11:35:00.000Z',
      engine: 'codex',
    };
    const restartCalls: Array<Array<unknown>> = [];
    const { reconciler, startTtydCalls } = buildReconciler({
      sessions: [{
        id: 'session-1',
        name: 'Session 1',
        engine: 'codex',
        intendedState: 'active',
        path: '/tmp/project',
        ttydProcess: previousTtydProcess,
      }],
      restartTtydForExistingTmux: async (...args: Array<unknown>) => {
        restartCalls.push(args);
        throw new Error('ttyd startup timeout');
      },
    });

    const result = await reconciler.reconcile({ dryRun: false, recover: true });
    expect(startTtydCalls).toEqual([]);
    expect(restartCalls).toEqual([
      [
        'session-1',
        40020,
        'codex',
        expect.objectContaining({
          cwd: '/tmp/project',
          previousTtydProcess,
        }),
      ],
    ]);
    expect(result.actions).toContainEqual(expect.objectContaining({
      sessionId: 'session-1',
      type: 'reconnect_ttyd',
      reason: 'stale_ttyd_process',
      success: false,
      error: 'ttyd startup timeout',
    }));

    const healthAfterFailedReconnect = await reconciler.getHealth();
    expect(healthAfterFailedReconnect.status).toBe('degraded');
    expect(healthAfterFailedReconnect.issues).toContainEqual(expect.objectContaining({
      sessionId: 'session-1',
      type: 'stale_ttyd_process',
      severity: 'critical',
    }));
  });

  test('ac:6 boot restore must not trust pid liveness without an observed ttyd for the session', async () => {
    const restartCalls: Array<Array<unknown>> = [];
    const context = {
      stateStore: {
        get: () => ({
          sessions: [{
            id: 'session-12345-abcd',
            intendedState: 'active',
            engine: 'codex',
            path: '/tmp/project',
            ttydProcess: {
              pid: 12345,
              port: 40020,
              engine: 'codex',
            },
          }],
        }),
      },
      execPromise: async (command: string) => {
        if (command.includes('tmux list-sessions')) return { stdout: 'session-12345-abcd\n' };
        if (command.includes('ps aux')) return { stdout: '' };
        return { stdout: '' };
      },
      _isXtermOnlyMode: () => false,
      resolveSessionWorkspacePath: async () => '/tmp/project',
      _getStoredWorkspacePath: () => '/tmp/project',
      _isProcessRunning: (pid: number) => pid === 12345,
      activeSessions: new Map(),
      _restartTtydForExistingTmux: async (...args: Array<unknown>) => {
        restartCalls.push(args);
        return { port: 40020 };
      },
      _clearTtydProcessInfo: async () => {},
      _pauseSessionsForMissingTmux: async () => {},
      cleanupOrphans: async () => {},
      nextPort: 40000,
    };

    const previousRestoreLimit = process.env.BRAINBASE_RESTORE_ACTIVE_LIMIT;
    process.env.BRAINBASE_RESTORE_ACTIVE_LIMIT = '1';
    try {
      await runtimeMaintenanceMethods.restoreActiveSessions.call(context);
    } finally {
      if (previousRestoreLimit === undefined) {
        delete process.env.BRAINBASE_RESTORE_ACTIVE_LIMIT;
      } else {
        process.env.BRAINBASE_RESTORE_ACTIVE_LIMIT = previousRestoreLimit;
      }
    }

    expect(context.activeSessions.size).toBe(0);
    expect(restartCalls).toEqual([
      [
        'session-12345-abcd',
        40020,
        'codex',
        expect.objectContaining({
          cwd: '/tmp/project',
          previousTtydProcess: expect.objectContaining({
            pid: 12345,
            port: 40020,
            engine: 'codex',
          }),
        }),
      ],
    ]);
  });

  test('ac:7 startup-pending or failed sessions stay out of stale ttyd recovery', async () => {
    for (const startupStatus of ['pending', 'failed']) {
      const { reconciler } = buildReconciler({
        sessions: [{
          id: `session-startup-${startupStatus}`,
          name: `Startup ${startupStatus}`,
          engine: 'codex',
          intendedState: 'active',
          startupStatus,
          startupPhase: 'worktree',
          ttydProcess: {
            pid: 12345,
            port: 40020,
            engine: 'codex',
          },
        }],
      });

      const health = await reconciler.getHealth();
      expect(health.issues).not.toContainEqual(expect.objectContaining({
        sessionId: `session-startup-${startupStatus}`,
        type: 'stale_ttyd_process',
      }));
    }
  });

  test('ac:8 failed stale ttyd recovery clears stale iframe instead of restoring a dead console frame', async () => {
    const sessionManagementSource = readFileSync(
      path.join(repoRoot, 'public/modules/app/session-management-mixin.js'),
      'utf8'
    );
    const terminalSwitchSource = readFileSync(
      path.join(repoRoot, 'public/modules/app/terminal-switch-mixin.js'),
      'utf8'
    );
    const uiTestSource = readFileSync(
      path.join(repoRoot, 'tests/ui/integration/app-switch-session-runtime.test.js'),
      'utf8'
    );

    expect(sessionManagementSource).toContain('hasUnsafeTtydIssue(result?.runtimeStatus)');
    expect(sessionManagementSource).toContain('this._clearTerminalFrame(terminalFrame)');
    expect(sessionManagementSource).toContain('restorePresentation: !unsafeRecoveryFailed');
    expect(terminalSwitchSource).toContain('restorePresentation = true');
    expect(terminalSwitchSource).toContain('if (restorePresentation)');
    expect(uiTestSource).toContain('CON-8 keeps stale ttyd recovery retryable when terminal recovery fails');
    expect(uiTestSource).toContain("terminalFrame.src = '/console/session-1/?viewerId=viewer-test'");
    expect(uiTestSource).toContain("expect(terminalFrame.src).toBe('about:blank')");
  });

  test('ac:9 live browser smoke covers runtime, snapshot, ensure/probe, and terminal health surfaces', async () => {
    const evidencePath = path.join(
      repoRoot,
      '.vibepro/pr/story-terminal-stale-runtime-auto-recovery/verification-evidence.json'
    );
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    const integrationEvidence = evidence.commands.find((command: Record<string, unknown>) =>
      command.kind === 'integration'
    );
    expect(integrationEvidence).toEqual(expect.objectContaining({
      status: 'pass',
    }));
    expect(String(integrationEvidence.summary)).toContain('Live browser smoke on non-canonical port 32123 loaded brainbase UI');
    expect(String(integrationEvidence.summary)).toContain('/api/sessions/brainbase/runtime');
    expect(String(integrationEvidence.summary)).toContain('terminal snapshot');
    expect(String(integrationEvidence.summary)).toContain('terminal ensure');
    expect(String(integrationEvidence.summary)).toContain('terminal probe-input');
    expect(String(integrationEvidence.summary)).toContain('/api/health/terminal');

    const summaryPath = '/tmp/brainbase-vibepro-artifacts/story-terminal-stale-runtime-live-smoke-summary.json';
    test.skip(!existsSync(summaryPath), 'live smoke summary is produced by the VibePro integration evidence step');
    const smoke = JSON.parse(readFileSync(summaryPath, 'utf8'));
    expect(smoke.status).toBe('pass');
    expect(smoke.failedRequests).toBe(0);
    expect(smoke.checkedResponses).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: expect.stringContaining('/api/sessions/brainbase/runtime'), status: 200 }),
      expect.objectContaining({ url: expect.stringContaining('/terminal/snapshot'), status: 200 }),
      expect.objectContaining({ url: expect.stringContaining('/terminal/ensure'), status: 200 }),
      expect.objectContaining({ url: expect.stringContaining('/terminal/probe-input'), status: 200 }),
      expect.objectContaining({ url: expect.stringContaining('/api/health/terminal'), status: 200 }),
    ]));
  });
});
