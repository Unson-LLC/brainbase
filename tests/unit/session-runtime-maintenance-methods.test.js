import { afterEach, describe, expect, it, vi } from 'vitest';
import { runtimeMaintenanceMethods } from '../../server/services/session-runtime/runtime-maintenance-methods.js';
import { logger } from '../../server/utils/logger.js';

describe('runtimeMaintenanceMethods', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('CON-5 watchdog logs reconnect_ttyd recovery actions', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    const context = {
      runtimeReconciler: {
        reconcile: vi.fn(async () => ({
          actions: [{
            type: 'reconnect_ttyd',
            sessionId: 'session-1',
            reason: 'stale_ttyd_process',
            success: true
          }]
        }))
      },
      execPromise: vi.fn(async (command) => {
        if (command.includes('kern.tty.ptmx_max')) return { stdout: '512\n' };
        if (command.includes('/dev/pty')) return { stdout: '1\n' };
        return { stdout: '' };
      }),
      cleanupOrphans: vi.fn(async () => {}),
      repairActiveTtydSessions: vi.fn(async () => {}),
      stopTtyd: vi.fn(async () => {}),
      _healthMonitor: null,
      _ptyWatchdogTimer: null
    };

    runtimeMaintenanceMethods.startPtyWatchdog.call(context, 10);
    await vi.advanceTimersByTimeAsync(10);

    expect(context.runtimeReconciler.reconcile).toHaveBeenCalledWith({ dryRun: false, recover: true });
    expect(warnSpy).toHaveBeenCalledWith('[PTY Watchdog] Runtime reconciliation recovered 1 issue(s)');

    runtimeMaintenanceMethods.stopPtyWatchdog.call(context);
  });

  it('CON-5 watchdog does not log failed reconnect_ttyd as recovered', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});

    const context = {
      runtimeReconciler: {
        reconcile: vi.fn(async () => ({
          actions: [{
            type: 'reconnect_ttyd',
            sessionId: 'session-1',
            reason: 'stale_ttyd_process',
            success: false,
            error: 'port unavailable'
          }]
        }))
      },
      execPromise: vi.fn(async (command) => {
        if (command.includes('kern.tty.ptmx_max')) return { stdout: '512\n' };
        if (command.includes('/dev/pty')) return { stdout: '1\n' };
        return { stdout: '' };
      }),
      cleanupOrphans: vi.fn(async () => {}),
      repairActiveTtydSessions: vi.fn(async () => {}),
      stopTtyd: vi.fn(async () => {}),
      _healthMonitor: null,
      _ptyWatchdogTimer: null
    };

    runtimeMaintenanceMethods.startPtyWatchdog.call(context, 10);
    await vi.advanceTimersByTimeAsync(10);

    expect(warnSpy).not.toHaveBeenCalledWith('[PTY Watchdog] Runtime reconciliation recovered 1 issue(s)');
    expect(errorSpy).toHaveBeenCalledWith('[PTY Watchdog] Runtime reconciliation failed for 1 issue(s)');

    runtimeMaintenanceMethods.stopPtyWatchdog.call(context);
  });

  it('CON-5 watchdog does not log failed restart_terminal_runtime as recovered', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'info').mockImplementation(() => {});

    const context = {
      runtimeReconciler: {
        reconcile: vi.fn(async () => ({
          actions: [{
            type: 'restart_terminal_runtime',
            sessionId: 'session-1',
            reason: 'pane_error_flood',
            success: false,
            error: 'tmux unavailable'
          }]
        }))
      },
      execPromise: vi.fn(async (command) => {
        if (command.includes('kern.tty.ptmx_max')) return { stdout: '512\n' };
        if (command.includes('/dev/pty')) return { stdout: '1\n' };
        return { stdout: '' };
      }),
      cleanupOrphans: vi.fn(async () => {}),
      repairActiveTtydSessions: vi.fn(async () => {}),
      stopTtyd: vi.fn(async () => {}),
      _healthMonitor: null,
      _ptyWatchdogTimer: null
    };

    runtimeMaintenanceMethods.startPtyWatchdog.call(context, 10);
    await vi.advanceTimersByTimeAsync(10);

    expect(warnSpy).not.toHaveBeenCalledWith('[PTY Watchdog] Runtime reconciliation recovered 1 issue(s)');
    expect(errorSpy).toHaveBeenCalledWith('[PTY Watchdog] Runtime reconciliation failed for 1 issue(s)');

    runtimeMaintenanceMethods.stopPtyWatchdog.call(context);
  });

  it('INV-3 repairActiveTtydSessions does not restart sessions without persisted ttydProcess', async () => {
    const ensureTtydForActiveSession = vi.fn(async () => ({ restarted: true }));
    const context = {
      _isXtermOnlyMode: vi.fn(() => false),
      stateStore: {
        get: vi.fn(() => ({
          sessions: [{
            id: 'session-1',
            intendedState: 'active',
            engine: 'codex'
          }]
        }))
      },
      getRuntimeStatus: vi.fn(() => ({ ttydRunning: false })),
      ensureTtydForActiveSession
    };

    const result = await runtimeMaintenanceMethods.repairActiveTtydSessions.call(context);

    expect(ensureTtydForActiveSession).not.toHaveBeenCalled();
    expect(result).toEqual({
      checked: 1,
      restarted: 0,
      failed: 0,
      skipped: 1
    });
  });

  it('CON-9 repairActiveTtydSessions does not restart startup pending sessions with persisted ttydProcess', async () => {
    const ensureTtydForActiveSession = vi.fn(async () => ({ restarted: true }));
    const context = {
      _isXtermOnlyMode: vi.fn(() => false),
      stateStore: {
        get: vi.fn(() => ({
          sessions: [{
            id: 'session-startup-pending',
            intendedState: 'active',
            startupStatus: 'pending',
            startupPhase: 'worktree',
            engine: 'codex',
            ttydProcess: {
              pid: 12345,
              port: 40020,
              engine: 'codex'
            }
          }]
        }))
      },
      getRuntimeStatus: vi.fn(() => ({ ttydRunning: false })),
      ensureTtydForActiveSession
    };

    const result = await runtimeMaintenanceMethods.repairActiveTtydSessions.call(context);

    expect(ensureTtydForActiveSession).not.toHaveBeenCalled();
    expect(result).toEqual({
      checked: 1,
      restarted: 0,
      failed: 0,
      skipped: 1
    });
  });

  it('INV-3 restoreActiveSessions does not reconnect ttyd for active tmux without persisted ttydProcess', async () => {
    const restartTtydForExistingTmux = vi.fn(async () => ({ port: 40020 }));
    const clearTtydProcessInfo = vi.fn(async () => {});
    const context = {
      stateStore: {
        get: vi.fn(() => ({
          sessions: [{
            id: 'session-1',
            intendedState: 'active',
            engine: 'codex'
          }]
        }))
      },
      execPromise: vi.fn(async (command) => {
        if (command.includes('tmux list-sessions')) return { stdout: 'session-1\n' };
        if (command.includes('ps aux')) return { stdout: '' };
        return { stdout: '' };
      }),
      _isXtermOnlyMode: vi.fn(() => false),
      resolveSessionWorkspacePath: vi.fn(async () => '/tmp/project'),
      _getStoredWorkspacePath: vi.fn(() => '/tmp/project'),
      _isProcessRunning: vi.fn(() => false),
      activeSessions: new Map(),
      _restartTtydForExistingTmux: restartTtydForExistingTmux,
      _clearTtydProcessInfo: clearTtydProcessInfo,
      _pauseSessionsForMissingTmux: vi.fn(async () => {}),
      cleanupOrphans: vi.fn(async () => {}),
      nextPort: 40000
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

    expect(restartTtydForExistingTmux).not.toHaveBeenCalled();
    expect(clearTtydProcessInfo).not.toHaveBeenCalled();
    expect(context.activeSessions.size).toBe(0);
  });

  it('CON-7 restoreActiveSessions recognizes full console session ids in ttyd ps output', async () => {
    const restartTtydForExistingTmux = vi.fn(async () => ({ port: 40123 }));
    const saveTtydProcessInfo = vi.fn(async () => {});
    const context = {
      stateStore: {
        get: vi.fn(() => ({
          sessions: [{
            id: 'session-12345-abcd',
            intendedState: 'active',
            engine: 'codex',
            path: '/tmp/session-path',
            ttydProcess: {
              pid: 12345,
              port: 40123,
              engine: 'codex'
            }
          }]
        }))
      },
      execPromise: vi.fn(async (command) => {
        if (command.includes('tmux list-sessions')) return { stdout: 'session-12345-abcd\n' };
        if (command.includes('ps aux')) {
          return {
            stdout: 'user 12345 0.0 0.1 ttyd -p 40123 -b /console/session-12345-abcd tmux attach -t session-12345-abcd\n'
          };
        }
        return { stdout: '' };
      }),
      _isXtermOnlyMode: vi.fn(() => false),
      resolveSessionWorkspacePath: vi.fn(async () => '/tmp/session-path'),
      _getStoredWorkspacePath: vi.fn(() => '/tmp/session-cwd'),
      _isProcessRunning: vi.fn(() => true),
      activeSessions: new Map(),
      _restartTtydForExistingTmux: restartTtydForExistingTmux,
      _saveTtydProcessInfo: saveTtydProcessInfo,
      _clearTtydProcessInfo: vi.fn(async () => {}),
      _pauseSessionsForMissingTmux: vi.fn(async () => {}),
      cleanupOrphans: vi.fn(async () => {}),
      nextPort: 40000
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

    expect(restartTtydForExistingTmux).not.toHaveBeenCalled();
    expect(saveTtydProcessInfo).not.toHaveBeenCalled();
    expect(context.activeSessions.get('session-12345-abcd')).toMatchObject({
      pid: 12345,
      port: 40123
    });
  });

  it('CON-7 restoreActiveSessions tolerates malformed encoded console session ids', async () => {
    const restartTtydForExistingTmux = vi.fn(async () => ({ port: 40123 }));
    const context = {
      stateStore: {
        get: vi.fn(() => ({
          sessions: [{
            id: 'session-%E0%A4%A',
            intendedState: 'active',
            engine: 'codex',
            ttydProcess: {
              pid: 12345,
              port: 40123,
              engine: 'codex'
            }
          }]
        }))
      },
      execPromise: vi.fn(async (command) => {
        if (command.includes('tmux list-sessions')) return { stdout: 'session-%E0%A4%A\n' };
        if (command.includes('ps aux')) {
          return {
            stdout: 'user 12345 0.0 0.1 ttyd -p 40123 -b /console/session-%E0%A4%A tmux attach -t session-%E0%A4%A\n'
          };
        }
        return { stdout: '' };
      }),
      _isXtermOnlyMode: vi.fn(() => false),
      resolveSessionWorkspacePath: vi.fn(async () => '/tmp/session-path'),
      _getStoredWorkspacePath: vi.fn(() => '/tmp/session-cwd'),
      _isProcessRunning: vi.fn(() => true),
      activeSessions: new Map(),
      _restartTtydForExistingTmux: restartTtydForExistingTmux,
      _saveTtydProcessInfo: vi.fn(async () => {}),
      _clearTtydProcessInfo: vi.fn(async () => {}),
      _pauseSessionsForMissingTmux: vi.fn(async () => {}),
      cleanupOrphans: vi.fn(async () => {}),
      nextPort: 40000
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

    expect(restartTtydForExistingTmux).not.toHaveBeenCalled();
    expect(context.activeSessions.get('session-%E0%A4%A')).toMatchObject({
      pid: 12345,
      port: 40123
    });
  });

  it('CON-3 restoreActiveSessions reconnects persisted stale ttyd with forceTtyd and cwd', async () => {
    const restartTtydForExistingTmux = vi.fn(async () => ({ port: 40123 }));
    const clearTtydProcessInfo = vi.fn(async () => {});
    const context = {
      stateStore: {
        get: vi.fn(() => ({
          sessions: [{
            id: 'session-1',
            intendedState: 'active',
            engine: 'codex',
            path: '/tmp/session-path',
            cwd: '/tmp/session-cwd',
            ttydProcess: {
              pid: 12345,
              port: 40123,
              engine: 'codex'
            }
          }]
        }))
      },
      execPromise: vi.fn(async (command) => {
        if (command.includes('tmux list-sessions')) return { stdout: 'session-1\n' };
        if (command.includes('ps aux')) return { stdout: '' };
        return { stdout: '' };
      }),
      _isXtermOnlyMode: vi.fn(() => false),
      resolveSessionWorkspacePath: vi.fn(async () => '/tmp/session-path'),
      _getStoredWorkspacePath: vi.fn(() => '/tmp/session-cwd'),
      _isProcessRunning: vi.fn(() => false),
      activeSessions: new Map(),
      _restartTtydForExistingTmux: restartTtydForExistingTmux,
      _clearTtydProcessInfo: clearTtydProcessInfo,
      _pauseSessionsForMissingTmux: vi.fn(async () => {}),
      cleanupOrphans: vi.fn(async () => {}),
      nextPort: 40000
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

    expect(restartTtydForExistingTmux).toHaveBeenCalledWith('session-1', 40123, 'codex', expect.objectContaining({
      cwd: '/tmp/session-path',
      previousTtydProcess: expect.objectContaining({
        pid: 12345,
        port: 40123,
        engine: 'codex'
      })
    }));
    expect(clearTtydProcessInfo).not.toHaveBeenCalled();
  });

  it('AP-2 restoreActiveSessions keeps persisted ttydProcess when reconnect fails', async () => {
    const reconnectError = new Error('port unavailable');
    const restartTtydForExistingTmux = vi.fn(async () => {
      throw reconnectError;
    });
    const clearTtydProcessInfo = vi.fn(async () => {});
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const context = {
      stateStore: {
        get: vi.fn(() => ({
          sessions: [{
            id: 'session-1',
            intendedState: 'active',
            engine: 'codex',
            path: '/tmp/session-path',
            ttydProcess: {
              pid: 12345,
              port: 40123,
              engine: 'codex'
            }
          }]
        }))
      },
      execPromise: vi.fn(async (command) => {
        if (command.includes('tmux list-sessions')) return { stdout: 'session-1\n' };
        if (command.includes('ps aux')) return { stdout: '' };
        return { stdout: '' };
      }),
      _isXtermOnlyMode: vi.fn(() => false),
      resolveSessionWorkspacePath: vi.fn(async () => '/tmp/session-path'),
      _getStoredWorkspacePath: vi.fn(() => '/tmp/session-path'),
      _isProcessRunning: vi.fn(() => false),
      activeSessions: new Map(),
      _restartTtydForExistingTmux: restartTtydForExistingTmux,
      _clearTtydProcessInfo: clearTtydProcessInfo,
      _pauseSessionsForMissingTmux: vi.fn(async () => {}),
      cleanupOrphans: vi.fn(async () => {}),
      nextPort: 40000
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

    expect(restartTtydForExistingTmux).toHaveBeenCalled();
    expect(clearTtydProcessInfo).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[restoreActiveSessions] Failed to reconnect ttyd for session-1:', reconnectError);
  });

  it('AP-3 restoreActiveSessions does not trust persisted pid unless it is an observed ttyd for the session', async () => {
    const restartTtydForExistingTmux = vi.fn(async () => ({ port: 40123 }));
    const context = {
      stateStore: {
        get: vi.fn(() => ({
          sessions: [{
            id: 'session-1',
            intendedState: 'active',
            engine: 'codex',
            path: '/tmp/session-path',
            ttydProcess: {
              pid: 12345,
              port: 40123,
              engine: 'codex'
            }
          }]
        }))
      },
      execPromise: vi.fn(async (command) => {
        if (command.includes('tmux list-sessions')) return { stdout: 'session-1\n' };
        if (command.includes('ps aux')) return { stdout: '' };
        return { stdout: '' };
      }),
      _isXtermOnlyMode: vi.fn(() => false),
      resolveSessionWorkspacePath: vi.fn(async () => '/tmp/session-path'),
      _getStoredWorkspacePath: vi.fn(() => '/tmp/session-path'),
      _isProcessRunning: vi.fn((pid) => pid === 12345),
      activeSessions: new Map(),
      _restartTtydForExistingTmux: restartTtydForExistingTmux,
      _clearTtydProcessInfo: vi.fn(async () => {}),
      _pauseSessionsForMissingTmux: vi.fn(async () => {}),
      cleanupOrphans: vi.fn(async () => {}),
      nextPort: 40000
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
    expect(restartTtydForExistingTmux).toHaveBeenCalledWith('session-1', 40123, 'codex', expect.objectContaining({
      cwd: '/tmp/session-path',
      previousTtydProcess: expect.objectContaining({
        pid: 12345,
        port: 40123,
        engine: 'codex'
      })
    }));
  });

  it('CON-6 restoreActiveSessions reconnect cwd prefers worktree path over session path and resolved cwd', async () => {
    const restartTtydForExistingTmux = vi.fn(async () => ({ port: 40123 }));
    const context = {
      stateStore: {
        get: vi.fn(() => ({
          sessions: [{
            id: 'session-1',
            intendedState: 'active',
            engine: 'codex',
            worktree: { path: '/tmp/worktree-path' },
            path: '/tmp/session-path',
            cwd: '/tmp/session-cwd',
            ttydProcess: { pid: 12345, port: 40123, engine: 'codex' }
          }]
        }))
      },
      execPromise: vi.fn(async (command) => {
        if (command.includes('tmux list-sessions')) return { stdout: 'session-1\n' };
        if (command.includes('ps aux')) return { stdout: '' };
        return { stdout: '' };
      }),
      _isXtermOnlyMode: vi.fn(() => false),
      resolveSessionWorkspacePath: vi.fn(async () => '/tmp/resolved-tmux-path'),
      _getStoredWorkspacePath: vi.fn(() => '/tmp/stored-path'),
      _isProcessRunning: vi.fn(() => false),
      activeSessions: new Map(),
      _restartTtydForExistingTmux: restartTtydForExistingTmux,
      _clearTtydProcessInfo: vi.fn(async () => {}),
      _pauseSessionsForMissingTmux: vi.fn(async () => {}),
      cleanupOrphans: vi.fn(async () => {}),
      nextPort: 40000
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

    expect(restartTtydForExistingTmux).toHaveBeenCalledWith('session-1', 40123, 'codex', expect.objectContaining({
      cwd: '/tmp/worktree-path',
      previousTtydProcess: expect.objectContaining({
        pid: 12345,
        port: 40123,
        engine: 'codex'
      })
    }));
  });

  it('CON-6 restoreActiveSessions reconnect cwd falls back to session cwd', async () => {
    const restartTtydForExistingTmux = vi.fn(async () => ({ port: 40123 }));
    const context = {
      stateStore: {
        get: vi.fn(() => ({
          sessions: [{
            id: 'session-1',
            intendedState: 'active',
            engine: 'codex',
            cwd: '/tmp/session-cwd',
            ttydProcess: { pid: 12345, port: 40123, engine: 'codex' }
          }]
        }))
      },
      execPromise: vi.fn(async (command) => {
        if (command.includes('tmux list-sessions')) return { stdout: 'session-1\n' };
        if (command.includes('ps aux')) return { stdout: '' };
        return { stdout: '' };
      }),
      _isXtermOnlyMode: vi.fn(() => false),
      resolveSessionWorkspacePath: vi.fn(async () => '/tmp/resolved-tmux-path'),
      _getStoredWorkspacePath: vi.fn(() => '/tmp/stored-path'),
      _isProcessRunning: vi.fn(() => false),
      activeSessions: new Map(),
      _restartTtydForExistingTmux: restartTtydForExistingTmux,
      _clearTtydProcessInfo: vi.fn(async () => {}),
      _pauseSessionsForMissingTmux: vi.fn(async () => {}),
      cleanupOrphans: vi.fn(async () => {}),
      nextPort: 40000
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

    expect(restartTtydForExistingTmux).toHaveBeenCalledWith('session-1', 40123, 'codex', expect.objectContaining({
      cwd: '/tmp/session-cwd',
      previousTtydProcess: expect.objectContaining({
        pid: 12345,
        port: 40123,
        engine: 'codex'
      })
    }));
  });

  it('CON-7 cleanupOrphans protects ttyd processes for full console session ids', async () => {
    const context = {
      stateStore: {
        get: vi.fn(() => ({
          sessions: [{
            id: 'session-12345-abcd',
            intendedState: 'active',
            engine: 'codex',
            ttydProcess: {
              pid: 12345,
              port: 40123,
              engine: 'codex'
            }
          }]
        }))
      },
      execPromise: vi.fn(async (command) => {
        if (command.includes('ps aux')) {
          return {
            stdout: 'user 12345 0.0 0.1 ttyd -p 40123 -b /console/session-12345-abcd tmux attach -t session-12345-abcd\n'
          };
        }
        return { stdout: '' };
      }),
      activeSessions: new Map(),
      _saveTtydProcessInfo: vi.fn(async () => {})
    };

    await runtimeMaintenanceMethods.cleanupOrphans.call(context);

    expect(context.execPromise).not.toHaveBeenCalledWith('kill 12345');
  });

  it('CON-7 cleanupOrphans tolerates malformed encoded console session ids', async () => {
    const context = {
      stateStore: {
        get: vi.fn(() => ({
          sessions: [{
            id: 'session-%E0%A4%A',
            intendedState: 'active',
            engine: 'codex',
            ttydProcess: {
              pid: 12345,
              port: 40123,
              engine: 'codex'
            }
          }]
        }))
      },
      execPromise: vi.fn(async (command) => {
        if (command.includes('ps aux')) {
          return {
            stdout: 'user 12345 0.0 0.1 ttyd -p 40123 -b /console/session-%E0%A4%A tmux attach -t session-%E0%A4%A\n'
          };
        }
        return { stdout: '' };
      }),
      activeSessions: new Map(),
      _saveTtydProcessInfo: vi.fn(async () => {})
    };

    await runtimeMaintenanceMethods.cleanupOrphans.call(context);

    expect(context.execPromise).not.toHaveBeenCalledWith('kill 12345');
  });
});
