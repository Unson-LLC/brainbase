import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { createSessionServices } from '../../server/services/create-session-services.js';

const createStateStore = () => {
  let state = {
    sessions: [{ id: 'session-1' }, { id: 'session-2' }]
  };

  return {
    get: () => state,
    patchSession: async (sessionId, patch) => {
      state = {
        ...state,
        sessions: state.sessions.map((session) => {
          if (session.id !== sessionId) return session;
          const computedPatch = typeof patch === 'function' ? patch(session) : patch;
          if (!computedPatch) return session;
          const nextSession = { ...session, ...computedPatch };
          for (const [key, value] of Object.entries(computedPatch)) {
            if (value === undefined) {
              delete nextSession[key];
            }
          }
          return nextSession;
        })
      };
      return state;
    },
    update: async (next) => {
      state = next;
      return state;
    }
  };
};

const createManager = () => createSessionServices({
  serverDir: '/tmp',
  execPromise: async () => ({ stdout: '' }),
  stateStore: createStateStore(),
  worktreeService: {}
}).sessionApi;

describe('SessionManager', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('getRuntimeStatus_paused_session_does_not_probe_tmux', () => {
    vi.stubEnv('BRAINBASE_TERMINAL_TRANSPORT', '');
    const manager = createManager();
    const tmuxSpy = vi.spyOn(manager, '_isTmuxSessionRunningSync').mockReturnValue(true);
    const processSpy = vi.spyOn(manager, '_isProcessRunning').mockReturnValue(false);

    const runtimeStatus = manager.getRuntimeStatus({
      id: 'session-1',
      intendedState: 'paused',
      ttydProcess: { pid: 12345 }
    });

    expect(processSpy).toHaveBeenCalledWith(12345);
    expect(tmuxSpy).not.toHaveBeenCalled();
    expect(runtimeStatus.needsRestart).toBe(false);
    expect(runtimeStatus.interactiveTransport).toBe('none');
  });

  it('getRuntimeStatus_active_session_without_ttyd_marks_ttyd_restart_needed', () => {
    vi.stubEnv('BRAINBASE_TERMINAL_TRANSPORT', '');
    const manager = createManager();
    const tmuxSpy = vi.spyOn(manager, '_isTmuxSessionRunningSync').mockReturnValue(true);
    vi.spyOn(manager, '_isProcessRunning').mockReturnValue(false);

    const runtimeStatus = manager.getRuntimeStatus({
      id: 'session-1',
      intendedState: 'active',
      ttydProcess: { pid: 12345 }
    });

    expect(tmuxSpy).not.toHaveBeenCalled();
    expect(runtimeStatus.interactiveTransport).toBe('none');
    expect(runtimeStatus.interactiveReady).toBe(false);
    expect(runtimeStatus.needsRestart).toBe(true);
  });

  it('ensureTtydForActiveSession_active_tmux_without_ttyd_restarts_existing_tmux', async () => {
    vi.stubEnv('BRAINBASE_TERMINAL_TRANSPORT', '');
    const manager = createManager();
    vi.spyOn(manager, '_isProcessRunning').mockImplementation((pid) => pid === 23456);
    vi.spyOn(manager, '_isTmuxSessionRunning').mockResolvedValue(true);
    const restartSpy = vi.spyOn(manager, '_restartTtydForExistingTmux').mockImplementation(async (sessionId, preferredPort, engine) => {
      manager.activeSessions.set(sessionId, { port: preferredPort || 40100, pid: 23456, process: { pid: 23456 } });
      return { port: preferredPort || 40100, proxyPath: `/console/${sessionId}` };
    });

    const result = await manager.ensureTtydForActiveSession({
      id: 'session-1',
      intendedState: 'active',
      engine: 'claude',
      ttydProcess: { pid: 12345, port: 40123 }
    });

    expect(restartSpy).toHaveBeenCalledWith('session-1', 40123, 'claude');
    expect(result.restarted).toBe(true);
    expect(result.runtimeStatus.ttydRunning).toBe(true);
    expect(result.runtimeStatus.proxyPath).toBe('/console/session-1');
  });

  it('reportActivity_working_latest_sets_isWorking_true', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'working', now);

    const status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(true);
    expect(status.isDone).toBe(false);
  });

  it('reportActivity_done_latest_sets_isDone_true', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'done', now);

    const status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(false);
    expect(status.isDone).toBe(true);
  });

  it('done_then_working_sets_isWorking_true', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'done', now - 1000);
    manager.reportActivity('session-1', 'working', now);

    const status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(true);
    expect(status.isDone).toBe(false);
  });

  it('done_then_older_turn_started_is_ignored_as_out_of_order', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'done', now, {
      lifecycle: 'turn_completed',
      eventType: 'agent-turn-complete',
      turnId: 'turn-1'
    });
    manager.reportActivity('session-1', 'working', now - 1000, {
      lifecycle: 'turn_started',
      eventType: 'agent-turn-start',
      turnId: 'turn-1'
    });

    const status = manager.getSessionStatus()['session-1'];
    expect(status).toMatchObject({
      isWorking: false,
      isDone: true,
      activeTurnCount: 0,
      lastEventType: 'agent-turn-complete'
    });
  });

  it('working_then_done_sets_isDone_true', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'working', now - 1000);
    manager.reportActivity('session-1', 'done', now);

    const status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(false);
    expect(status.isDone).toBe(true);
  });

  it('clearDoneStatus_removes_done_state', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'done', now);
    manager.clearDoneStatus('session-1');

    const status = manager.getSessionStatus()['session-1'];
    expect(status).toBeUndefined();
  });

  it('clearDoneStatus_removes_ghost_working_state_without_active_turns', () => {
    const manager = createManager();
    manager.hookStatus.set('session-1', {
      status: 'working',
      timestamp: Date.now(),
      lastWorkingAt: Date.now(),
      lastDoneAt: 0,
      lastActivityAt: Date.now(),
      activeTurnIds: []
    });

    manager.clearDoneStatus('session-1');

    expect(manager.getSessionStatus()['session-1']).toBeUndefined();
  });

  it('clearDoneStatus_persists_pane_title_suppression_when_only_state_payload_is_stale', () => {
    const manager = createManager();
    manager._persistHookStatus = vi.fn();

    manager.clearDoneStatus('session-1');

    expect(manager._persistHookStatus).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        status: 'idle',
        lastEventType: 'done-read',
        paneTitleSuppressed: true
      }),
      expect.any(Number)
    );
  });

  it('stale working without active turns does not surface as done', () => {
    const manager = createManager();
    const staleTime = Date.now() - 60 * 60 * 1000 - 1000;

    manager.hookStatus.set('session-1', {
      status: 'working',
      timestamp: staleTime,
      lastWorkingAt: staleTime,
      lastDoneAt: 0,
      lastActivityAt: staleTime,
      activeTurnIds: []
    });

    expect(manager.getSessionStatus()['session-1']).toBeUndefined();
  });

  it('stale active turn with done timestamp does not surface as green done', () => {
    const manager = createManager();
    const staleTime = Date.now() - 6 * 60 * 1000;

    manager.hookStatus.set('session-1', {
      status: 'working',
      timestamp: staleTime,
      lastWorkingAt: staleTime,
      lastDoneAt: staleTime + 1000,
      lastActivityAt: staleTime,
      lastEventType: 'agent-turn-complete',
      activeTurnIds: ['turn-still-open']
    });

    expect(manager.getSessionStatus()['session-1']).toBeUndefined();
  });

  it('getSessionStatus_tmux_pane_title_spinner_is_reported_as_active_turn', () => {
    const manager = createManager();
    manager._listTmuxPaneTitles = () => [
      'session-1\t⠹ session-1...',
      'session-2\t› session-2'
    ];

    const status = manager.getSessionStatus();

    expect(status['session-1']).toMatchObject({
      isWorking: true,
      isDone: false,
      activeTurnCount: 1,
      lastEventType: 'tmux-pane-title-spinner'
    });
    expect(status['session-2']).toBeUndefined();
  });

  it('getSessionStatus_tmux_pane_title_spinner_does_not_override_done_hook_status', () => {
    const manager = createManager();
    const now = Date.now();
    manager.reportActivity('session-1', 'done', now, {
      lifecycle: 'turn_completed',
      eventType: 'agent-turn-complete'
    });
    manager._listTmuxPaneTitles = () => ['session-1\t⠹ session-1...'];

    const status = manager.getSessionStatus()['session-1'];

    expect(status).toMatchObject({
      isWorking: false,
      isDone: true,
      activeTurnCount: 0,
      lastEventType: 'agent-turn-complete'
    });
  });

  it('reportActivity_broadcasts_done_status_when_pane_title_spinner_remains_after_done', () => {
    const manager = createManager();
    const now = Date.now();
    manager._now = () => now;
    manager._listTmuxPaneTitles = () => ['session-1\t⠹ session-1...'];
    manager._activityWsBroadcast = vi.fn();

    manager.reportActivity('session-1', 'done', now, {
      lifecycle: 'turn_completed',
      eventType: 'agent-turn-complete'
    });

    expect(manager._activityWsBroadcast).toHaveBeenLastCalledWith('session-1', expect.objectContaining({
      isWorking: false,
      isDone: true,
      activeTurnCount: 0,
      lastEventType: 'agent-turn-complete'
    }));
  });

  it('clearDoneStatus_does_not_fall_back_to_pane_title_when_done_status_is_cleared', () => {
    const manager = createManager();
    const now = Date.now();
    manager._now = () => now;

    manager.reportActivity('session-1', 'done', now, {
      lifecycle: 'turn_completed',
      eventType: 'agent-turn-complete'
    });
    manager._listTmuxPaneTitles = () => ['session-1\t⠹ session-1...'];
    manager._activityWsBroadcast = vi.fn();

    manager.clearDoneStatus('session-1');

    expect(manager._activityWsBroadcast).toHaveBeenLastCalledWith('session-1', null);
    expect(manager.getSessionStatus()['session-1']).toBeUndefined();
  });

  it('real_working_signal_after_clearDoneStatus_allows_indicator_again', () => {
    const manager = createManager();
    const now = Date.now();
    manager._now = () => now;
    manager._listTmuxPaneTitles = () => ['session-1\t⠹ session-1...'];

    manager.reportActivity('session-1', 'done', now, {
      lifecycle: 'turn_completed',
      eventType: 'agent-turn-complete'
    });
    manager.clearDoneStatus('session-1');
    expect(manager.getSessionStatus()['session-1']).toBeUndefined();

    manager.reportActivity('session-1', 'working', now + 1000, {
      lifecycle: 'turn_started',
      eventType: 'brainbase/input-submit',
      activityKind: 'task_started'
    });

    expect(manager.getSessionStatus()['session-1']).toMatchObject({
      isWorking: true,
      isDone: false,
      lastEventType: 'brainbase/input-submit'
    });
  });

  it('getSessionStatus_tmux_pane_title_spinner_expires_when_title_stops_changing', () => {
    const manager = createManager();
    let now = 1000;
    manager._now = () => now;
    manager._listTmuxPaneTitles = () => ['session-1\t⠹ session-1...'];

    const firstStatus = manager.getSessionStatus()['session-1'];
    expect(firstStatus).toMatchObject({
      isWorking: true,
      lastEventType: 'tmux-pane-title-spinner',
      lastActivityAt: 1000
    });

    now += 30 * 1000 + 1;

    expect(manager.getSessionStatus()['session-1']).toBeUndefined();
  });

  it('getSessionStatus_tmux_pane_title_spinner_expires_when_pane_disappears', () => {
    const manager = createManager();
    let now = 1000;
    let rows = ['session-1\t⠹ session-1...'];
    manager._now = () => now;
    manager._listTmuxPaneTitles = () => rows;

    expect(manager.getSessionStatus()['session-1']).toMatchObject({ isWorking: true });

    now += 30 * 1000 + 1;
    rows = [];

    expect(manager.getSessionStatus()['session-1']).toBeUndefined();
  });

  it('getSessionStatus_tmux_pane_title_spinner_stays_active_when_title_changes', () => {
    const manager = createManager();
    let now = 1000;
    let title = 'session-1\t⠹ session-1...';
    manager._now = () => now;
    manager._listTmuxPaneTitles = () => [title];

    expect(manager.getSessionStatus()['session-1']).toMatchObject({ isWorking: true });

    now += 30 * 1000 + 1;
    title = 'session-1\t⠸ session-1...';

    expect(manager.getSessionStatus()['session-1']).toMatchObject({
      isWorking: true,
      lastEventType: 'tmux-pane-title-spinner'
    });
  });

  it('listTmuxPaneTitles_uses_short_cache_to_avoid_repeated_tmux_exec', () => {
    const manager = createManager();
    let now = 1000;
    manager._now = () => now;
    manager._readTmuxPaneTitles = vi.fn(() => ['session-1\t⠹ session-1...']);

    expect(manager._listTmuxPaneTitles()).toEqual(['session-1\t⠹ session-1...']);
    expect(manager._listTmuxPaneTitles()).toEqual(['session-1\t⠹ session-1...']);
    expect(manager._readTmuxPaneTitles).toHaveBeenCalledTimes(1);

    now += 1001;
    expect(manager._listTmuxPaneTitles()).toEqual(['session-1\t⠹ session-1...']);
    expect(manager._readTmuxPaneTitles).toHaveBeenCalledTimes(2);
  });

  it('restoreHookStatus_prunes_stale_working_without_active_turns', async () => {
    const staleTime = Date.now() - 60 * 60 * 1000 - 1000;
    let state = {
      sessions: [{
        id: 'session-1',
        hookStatus: {
          status: 'working',
          timestamp: staleTime,
          lastWorkingAt: staleTime,
          lastDoneAt: 0,
          lastActivityAt: staleTime,
          activeTurnIds: []
        }
      }]
    };

    const stateStore = {
      get: () => state,
      patchSession: async (sessionId, patch) => {
        state = {
          ...state,
          sessions: state.sessions.map((session) => {
            if (session.id !== sessionId) return session;
            const nextSession = { ...session, ...patch };
            for (const [key, value] of Object.entries(patch)) {
              if (value === undefined) delete nextSession[key];
            }
            return nextSession;
          })
        };
        return state;
      },
      update: async (next) => {
        state = next;
        return state;
      }
    };

    const manager = createSessionServices({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore,
      worktreeService: {}
    }).sessionApi;

    await manager.restoreHookStatus();

    expect(manager.getSessionStatus()['session-1']).toBeUndefined();
    expect(state.sessions[0].hookStatus).toBeNull();
  });

  it('restoreHookStatus_keeps_recent_explicit_done', async () => {
    const now = Date.now();
    let state = {
      sessions: [{
        id: 'session-1',
        hookStatus: {
          status: 'done',
          timestamp: now,
          lastWorkingAt: now - 1000,
          lastDoneAt: now,
          lastActivityAt: now,
          activeTurnIds: []
        }
      }]
    };

    const stateStore = {
      get: () => state,
      patchSession: async (sessionId, patch) => {
        state = {
          ...state,
          sessions: state.sessions.map((session) => session.id === sessionId ? { ...session, ...patch } : session)
        };
        return state;
      },
      update: async (next) => {
        state = next;
        return state;
      }
    };

    const manager = createSessionServices({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore,
      worktreeService: {}
    }).sessionApi;

    await manager.restoreHookStatus();

    expect(manager.getSessionStatus()['session-1']).toMatchObject({
      isWorking: false,
      isDone: true
    });
  });

  it('restoreHookStatus_prunes_stale_codex_pty_turn_and_persists_clean_done', async () => {
    const now = Date.now();
    const staleSessionId = `session-${now - 31 * 60 * 1000}`;
    let state = {
      sessions: [{
        id: staleSessionId,
        hookStatus: {
          status: 'working',
          timestamp: now - 30 * 60 * 1000,
          lastWorkingAt: now - 31 * 60 * 1000,
          lastDoneAt: now - 30 * 60 * 1000,
          lastActivityAt: now - 30 * 60 * 1000,
          lastEventType: 'agent-turn-complete',
          activeTurnIds: [`codex-pty-${staleSessionId}-12345`]
        }
      }]
    };

    const stateStore = {
      get: () => state,
      patchSession: async (sessionId, patch) => {
        state = {
          ...state,
          sessions: state.sessions.map((session) => session.id === sessionId ? { ...session, ...patch } : session)
        };
        return state;
      },
      update: async (next) => {
        state = next;
        return state;
      }
    };

    const manager = createSessionServices({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore,
      worktreeService: {}
    }).sessionApi;

    await manager.restoreHookStatus();

    expect(manager.getSessionStatus()[staleSessionId]).toMatchObject({
      isWorking: false,
      isDone: true,
      activeTurnCount: 0
    });
    expect(state.sessions[0].hookStatus.activeTurnIds).toEqual([]);
  });

  it('heartbeat_timeout_sets_isWorking_false_after_60m', () => {
    const manager = createManager();
    const now = Date.now();
    const staleTime = now - 60 * 60 * 1000 - 1000; // 60分+1秒前

    manager.reportActivity('session-1', 'working', staleTime);

    const status = manager.getSessionStatus()['session-1'];
    expect(status).toBeUndefined();
  });

  // Phase 2: working報告優先化のテスト
  it('working報告受信時_lastDoneAtを保持したままworkingへ戻る', () => {
    const manager = createManager();
    const now = Date.now();

    // done報告を先に送る（Hook報告の順序が逆転するケース）
    manager.reportActivity('session-1', 'done', now - 2000);
    manager.reportActivity('session-1', 'working', now - 1000);

    const status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(true);
    expect(status.isDone).toBe(false);
    expect(status.lastDoneAt).toBe(now - 2000);
  });

  it('clearWorking関数_working状態をクリアする', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'working', now);
    manager.clearWorking('session-1');

    const status = manager.getSessionStatus()['session-1'];
    expect(status).toBeUndefined(); // working状態がクリアされている
  });

  it('clearWorking関数_done状態は維持する', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'working', now - 2000);
    manager.reportActivity('session-1', 'done', now - 1000);
    manager.clearWorking('session-1');

    const status = manager.getSessionStatus()['session-1'];
    expect(status.isDone).toBe(true); // done状態は維持される
    expect(status.isWorking).toBe(false);
  });

  it('turn_started後_assistant_message_heartbeatではworkingを維持する', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'working', now, {
      lifecycle: 'turn_started',
      eventType: 'agent-turn-start',
      turnId: 'turn-1'
    });
    manager.reportActivity('session-1', 'working', now + 1000, {
      lifecycle: 'heartbeat',
      eventType: 'assistant-message',
      turnId: 'turn-1'
    });

    const status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(true);
    expect(status.isDone).toBe(false);
    expect(status.activeTurnCount).toBe(1);
  });

  it('done後_active_turnなしheartbeat受信時_workingへ戻さない', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'done', now, {
      lifecycle: 'turn_completed',
      eventType: 'agent-turn-complete'
    });
    manager.reportActivity('session-1', 'working', now + 1000, {
      lifecycle: 'heartbeat',
      eventType: 'codex/pty-shim-heartbeat',
      turnId: 'codex-pty-session-1-12345'
    });

    const status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(false);
    expect(status.isDone).toBe(true);
    expect(status.activeTurnCount).toBe(0);
  });

  it('codex_hook_heartbeat_after_done_revives_working_without_turn_id', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'done', now, {
      lifecycle: 'turn_completed',
      eventType: 'codex/hook/Stop',
      activityKind: 'task_completed'
    });
    manager.reportActivity('session-1', 'working', now + 1000, {
      lifecycle: 'heartbeat',
      eventType: 'codex/hook/PreToolUse',
      activityKind: 'running_command',
      currentStep: 'コマンドを実行中',
      latestEvidence: 'npm run test'
    });

    const status = manager.getSessionStatus()['session-1'];
    expect(status).toMatchObject({
      isWorking: true,
      isDone: false,
      activeTurnCount: 0,
      lastEventType: 'codex/hook/PreToolUse',
      liveActivity: expect.objectContaining({
        activityKind: 'running_command',
        statusTone: 'working',
        currentStep: 'コマンドを実行中',
        latestEvidence: 'npm run test'
      })
    });
  });

  it('stale_legacy_codex_pty_heartbeat_does_not_demote_recent_codex_hook_working', () => {
    const manager = createManager();
    const now = Date.now();
    const staleSessionTimestamp = now - 60 * 60 * 1000;
    const staleTurnId = `codex-pty-session-${staleSessionTimestamp}-12345`;

    manager.reportActivity('session-1', 'done', now, {
      lifecycle: 'turn_completed',
      eventType: 'codex/hook/Stop',
      activityKind: 'task_completed'
    });
    manager.reportActivity('session-1', 'working', now + 1000, {
      lifecycle: 'heartbeat',
      eventType: 'codex/hook/PostToolUse',
      activityKind: 'running_command',
      latestEvidence: 'npm run test'
    });
    manager.reportActivity('session-1', 'working', now + 2000, {
      lifecycle: 'heartbeat',
      eventType: 'codex/pty-shim-heartbeat',
      turnId: staleTurnId,
      activityKind: 'reasoning',
      currentStep: '処理中'
    });

    const status = manager.getSessionStatus()['session-1'];
    expect(status).toMatchObject({
      isWorking: true,
      isDone: false,
      activeTurnCount: 0,
      lastEventType: 'codex/pty-shim-heartbeat',
      liveActivity: expect.objectContaining({
        statusTone: 'working',
        latestEvidence: 'npm run test'
      })
    });
  });

  it('stale_legacy_codex_pty_heartbeat_after_done_does_not_revive_with_old_evidence', () => {
    const manager = createManager();
    const now = Date.now();
    const staleSessionTimestamp = now - 60 * 60 * 1000;
    const staleTurnId = `codex-pty-session-${staleSessionTimestamp}-12345`;

    manager.hookStatus.set('session-1', {
      status: 'done',
      timestamp: now,
      lastWorkingAt: 0,
      lastDoneAt: now,
      lastActivityAt: now,
      lastEventType: 'codex/pty-shim-heartbeat',
      activeTurnIds: [],
      liveActivity: {
        activityKind: 'reasoning',
        currentStep: '処理中',
        latestEvidence: 'npm run test',
        statusTone: 'done',
        updatedAt: now,
        assistantSnippetUpdatedAt: 0
      }
    });

    manager.reportActivity('session-1', 'working', now + 1000, {
      lifecycle: 'heartbeat',
      eventType: 'codex/pty-shim-heartbeat',
      turnId: staleTurnId,
      activityKind: 'reasoning',
      currentStep: '処理中'
    });

    const status = manager.getSessionStatus()['session-1'];
    expect(status).toMatchObject({
      isWorking: false,
      isDone: true,
      activeTurnCount: 0,
      lastEventType: 'codex/pty-shim-heartbeat',
      liveActivity: expect.objectContaining({
        activityKind: 'done',
        statusTone: 'done',
        currentStep: '完了'
      })
    });
  });

  it('stale_legacy_codex_pty_heartbeat_clamps_previous_false_working_back_to_done', () => {
    const manager = createManager();
    const now = Date.now();
    const staleSessionTimestamp = now - 60 * 60 * 1000;
    const staleTurnId = `codex-pty-session-${staleSessionTimestamp}-12345`;

    manager.hookStatus.set('session-1', {
      status: 'working',
      timestamp: now,
      lastWorkingAt: now,
      lastDoneAt: now - 1000,
      lastActivityAt: now,
      lastEventType: 'codex/pty-shim-heartbeat',
      activeTurnIds: [],
      liveActivity: {
        activityKind: 'done',
        currentStep: '完了',
        latestEvidence: 'old command',
        statusTone: 'done',
        updatedAt: now,
        assistantSnippetUpdatedAt: 0
      }
    });

    manager.reportActivity('session-1', 'working', now + 1000, {
      lifecycle: 'heartbeat',
      eventType: 'codex/pty-shim-heartbeat',
      turnId: staleTurnId,
      activityKind: 'reasoning',
      currentStep: '処理中'
    });

    const status = manager.getSessionStatus()['session-1'];
    expect(status).toMatchObject({
      isWorking: false,
      isDone: true,
      activeTurnCount: 0,
      liveActivity: expect.objectContaining({
        activityKind: 'done',
        statusTone: 'done',
        currentStep: '完了'
      })
    });
  });

  it('turn_completed_with_timestamp_clears_unmatched_non_comparable_active_turn', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'working', now, {
      lifecycle: 'turn_started',
      eventType: 'agent-turn-start',
      turnId: '019e00b4-a724-7d73-a377-a1673c153bdc'
    });
    manager.reportActivity('session-1', 'done', now + 1000, {
      lifecycle: 'turn_completed',
      eventType: 'agent-turn-complete',
      turnId: `codex-pty-turn-${now + 1000}-12345`
    });

    const status = manager.getSessionStatus()['session-1'];
    expect(status).toMatchObject({
      isWorking: false,
      isDone: true,
      activeTurnCount: 0,
      lastEventType: 'agent-turn-complete'
    });
  });

  it('stale_legacy_codex_pty_turn_started_after_done_does_not_revive_working', () => {
    const manager = createManager();
    const now = Date.now();
    const staleSessionTimestamp = now - 60 * 60 * 1000;
    const staleTurnId = `codex-pty-session-${staleSessionTimestamp}-12345`;

    manager.reportActivity('session-1', 'working', now - 2000, {
      lifecycle: 'turn_started',
      eventType: 'codex/pty-shim-start',
      turnId: `codex-pty-turn-${now - 2000}-12345`
    });
    manager.reportActivity('session-1', 'done', now, {
      lifecycle: 'turn_completed',
      eventType: 'codex/pty-shim-ready',
      turnId: `codex-pty-turn-${now - 2000}-12345`
    });
    manager.reportActivity('session-1', 'working', now + 1000, {
      lifecycle: 'turn_started',
      eventType: 'codex/pty-shim-start',
      turnId: staleTurnId
    });
    manager.reportActivity('session-1', 'working', now + 2000, {
      lifecycle: 'heartbeat',
      eventType: 'codex/pty-shim-heartbeat',
      turnId: staleTurnId
    });

    expect(manager.getSessionStatus()['session-1']).toMatchObject({
      isWorking: false,
      isDone: true,
      activeTurnCount: 0
    });
  });

  it('turn_started後_turn_completedまではassistant_response_completeでもdoneに倒れない', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'working', now, {
      lifecycle: 'turn_started',
      eventType: 'agent-turn-start',
      turnId: 'turn-1'
    });
    manager.reportActivity('session-1', 'working', now + 1000, {
      lifecycle: 'heartbeat',
      eventType: 'assistant-response-complete',
      turnId: 'turn-1'
    });

    let status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(true);
    expect(status.isDone).toBe(false);

    manager.reportActivity('session-1', 'done', now + 2000, {
      lifecycle: 'turn_completed',
      eventType: 'agent-turn-complete',
      turnId: 'turn-1'
    });

    status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(false);
    expect(status.isDone).toBe(true);
    expect(status.activeTurnCount).toBe(0);
  });

  it('複数turnのうち1つだけ完了しても残りがあればworkingを維持する', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'working', now, {
      lifecycle: 'turn_started',
      eventType: 'agent-turn-start',
      turnId: 'turn-1'
    });
    manager.reportActivity('session-1', 'working', now + 100, {
      lifecycle: 'turn_started',
      eventType: 'agent-turn-start',
      turnId: 'turn-2'
    });
    manager.reportActivity('session-1', 'done', now + 200, {
      lifecycle: 'turn_completed',
      eventType: 'agent-turn-complete',
      turnId: 'turn-1'
    });

    let status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(true);
    expect(status.activeTurnCount).toBe(1);

    manager.reportActivity('session-1', 'done', now + 300, {
      lifecycle: 'turn_completed',
      eventType: 'agent-turn-complete',
      turnId: 'turn-2'
    });

    status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(false);
    expect(status.isDone).toBe(true);
    expect(status.activeTurnCount).toBe(0);
  });

  it('active turn中に_turnIdなしturn_completedを受けてもworkingを維持する', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'working', now, {
      lifecycle: 'turn_started',
      eventType: 'agent-turn-start',
      turnId: 'turn-1'
    });
    manager.reportActivity('session-1', 'working', now + 100, {
      lifecycle: 'turn_started',
      eventType: 'agent-turn-start',
      turnId: 'turn-2'
    });
    manager.reportActivity('session-1', 'done', now + 200, {
      lifecycle: 'turn_completed',
      eventType: 'turn/completed'
    });

    const status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(true);
    expect(status.isDone).toBe(false);
    expect(status.activeTurnCount).toBe(2);
  });

  it('turnIdなしturn_completed受信時_codex_pty_fallback_turnはクリアする', () => {
    const manager = createManager();
    const now = Date.now();
    const turnId = `codex-pty-session-${now}-12345`;

    manager.reportActivity('session-1', 'working', now, {
      lifecycle: 'turn_started',
      eventType: 'codex/pty-shim-start',
      turnId
    });
    manager.reportActivity('session-1', 'done', now + 1000, {
      lifecycle: 'turn_completed',
      eventType: 'agent-turn-complete'
    });

    const status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(false);
    expect(status.isDone).toBe(true);
    expect(status.activeTurnCount).toBe(0);
  });

  it('reportActivity呼び出し時_live feed向けの作業要約を保持する', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'working', now, {
      eventType: 'item/commandExecution/outputDelta',
      activityKind: 'running_command',
      assistantSnippet: '右パネルの表示ノイズを取り除いています',
      currentStep: 'テストを実行中',
      latestEvidence: 'npx vitest run tests/unit/live-feed-service.test.js'
    });

    const status = manager.getSessionStatus()['session-1'];
    expect(status.liveActivity).toEqual({
      activityKind: 'running_command',
      taskBrief: null,
      assistantSnippet: '右パネルの表示ノイズを取り除いています',
      currentStep: 'テストを実行中',
      latestEvidence: 'npx vitest run tests/unit/live-feed-service.test.js',
      statusTone: 'working',
      updatedAt: now,
      assistantSnippetUpdatedAt: now
    });
  });

  it('resolveSessionWorkspacePath_tmuxのcurrent_pathでstale pathを補正する', async () => {
    const resolvedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-session-'));
    let state = {
      sessions: [{
        id: 'session-1',
        path: '/stale/worktree/path',
        worktree: {
          repo: '/repo/project-a',
          path: '/stale/worktree/path'
        }
      }]
    };

    const stateStore = {
      get: () => state,
      update: async (next) => {
        state = next;
        return state;
      }
    };

    const manager = createSessionServices({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: `${resolvedDir}\n` }),
      stateStore,
      worktreeService: { worktreesDir: '/unused' }
    }).sessionApi;

    const resolvedPath = await manager.resolveSessionWorkspacePath('session-1');

    expect(resolvedPath).toBe(resolvedDir);
    expect(state.sessions[0].path).toBe(resolvedDir);
    expect(state.sessions[0].worktree.path).toBe(resolvedDir);

    fs.rmSync(resolvedDir, { recursive: true, force: true });
  });

  it('resolveSessionWorkspacePath_tmuxがprivate_tmpでも永続pathを汚染しない', async () => {
    const durableDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-durable-'));
    let state = {
      sessions: [{
        id: 'session-1',
        path: durableDir,
        lastKnownGoodPath: durableDir,
        worktree: {
          repo: '/repo/project-a',
          path: durableDir
        }
      }]
    };

    const stateStore = {
      get: () => state,
      update: async (next) => {
        state = next;
        return state;
      }
    };

    const manager = createSessionServices({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: `/private/tmp\n${durableDir}\n` }),
      stateStore,
      worktreeService: { worktreesDir: '/unused' }
    }).sessionApi;

    const resolvedPath = await manager.resolveSessionWorkspacePath('session-1');

    expect(resolvedPath).toBe(durableDir);
    expect(state.sessions[0].path).toBe(durableDir);
    expect(state.sessions[0].worktree.path).toBe(durableDir);
    expect(state.sessions[0].lastKnownGoodPath).toBe(durableDir);

    fs.rmSync(durableDir, { recursive: true, force: true });
  });

  it('resolveSessionWorkspacePath_tmuxがprivate_tmpしか返さない場合も永続pathへフォールバックする', async () => {
    const durableDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brainbase-durable-'));
    let state = {
      sessions: [{
        id: 'session-1',
        path: durableDir,
        lastKnownGoodPath: durableDir,
        worktree: {
          repo: '/repo/project-a',
          path: durableDir
        }
      }]
    };

    const stateStore = {
      get: () => state,
      update: async (next) => {
        state = next;
        return state;
      }
    };

    const manager = createSessionServices({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: `/private/tmp\n` }),
      stateStore,
      worktreeService: { worktreesDir: '/unused' }
    }).sessionApi;

    const resolvedPath = await manager.resolveSessionWorkspacePath('session-1');

    expect(resolvedPath).toBe(durableDir);
    expect(state.sessions[0].path).toBe(durableDir);
    expect(state.sessions[0].worktree.path).toBe(durableDir);
    expect(state.sessions[0].lastKnownGoodPath).toBe(durableDir);

    fs.rmSync(durableDir, { recursive: true, force: true });
  });

  it('sendInput呼び出し時_短文テキストはliteral send-keysで送信する', async () => {
    const manager = createSessionServices({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore: createStateStore(),
      worktreeService: {}
    }).sessionApi;
    const runTmuxSpy = vi.spyOn(manager, '_runTmux').mockResolvedValue({ stdout: '', stderr: '' });

    await manager.sendInput('session-1', 'hello world', 'text');

    expect(runTmuxSpy).toHaveBeenCalledWith(['send-keys', '-t', 'session-1', '-l', '--', 'hello world']);
  });

  it('sendInput呼び出し時_中長文テキストはtyping simulationで送信する', async () => {
    const manager = createSessionServices({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore: createStateStore(),
      worktreeService: {}
    }).sessionApi;
    const typingSpy = vi.spyOn(manager, '_sendSimulatedTyping').mockResolvedValue();
    const literalSpy = vi.spyOn(manager, '_sendLiteralText').mockResolvedValue();
    const text = 'Codexに長文を一括投入せず、人間が入力したように少しずつ送信するためのテキストです。';

    await manager.sendInput('session-1', text, 'text');

    expect(typingSpy).toHaveBeenCalledWith('session-1', text, expect.objectContaining({
      delayMs: undefined
    }));
    expect(literalSpy).not.toHaveBeenCalled();
  });

  it('sendInput呼び出し時_長文テキストはtemp file経由でpaste-bufferする', async () => {
    const manager = createSessionServices({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore: createStateStore(),
      worktreeService: {}
    }).sessionApi;
    const runTmuxSpy = vi.spyOn(manager, '_runTmux').mockResolvedValue({ stdout: '', stderr: '' });
    const mkdtempSpy = vi.spyOn(fs.promises, 'mkdtemp').mockResolvedValue('/tmp/brainbase-input-test');
    const writeFileSpy = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    const rmSpy = vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);

    await manager.sendInput('session-1', 'a'.repeat(20000), 'text');

    expect(mkdtempSpy).toHaveBeenCalled();
    expect(writeFileSpy).toHaveBeenCalledWith('/tmp/brainbase-input-test/paste.txt', 'a'.repeat(20000), 'utf8');
    expect(runTmuxSpy).toHaveBeenCalledWith(['load-buffer', '-b', expect.stringContaining('brainbase-session-1-'), '/tmp/brainbase-input-test/paste.txt']);
    expect(runTmuxSpy).toHaveBeenCalledWith(['paste-buffer', '-d', '-b', expect.stringContaining('brainbase-session-1-'), '-t', 'session-1']);
    expect(runTmuxSpy).toHaveBeenCalledWith(['delete-buffer', '-b', expect.stringContaining('brainbase-session-1-')]);
    expect(rmSpy).toHaveBeenCalledWith('/tmp/brainbase-input-test', { recursive: true, force: true });
  });

  it('sendInput呼び出し時_shell展開文字を含んでもそのままwriteFileされる', async () => {
    const manager = createSessionServices({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore: createStateStore(),
      worktreeService: {}
    }).sessionApi;
    vi.spyOn(manager, '_runTmux').mockResolvedValue({ stdout: '', stderr: '' });
    vi.spyOn(fs.promises, 'mkdtemp').mockResolvedValue('/tmp/brainbase-input-test-literal');
    const writeFileSpy = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);
    writeFileSpy.mockClear();

    await manager.sendInput('session-1', 'alpha $HOME `echo hi`', 'text');

    expect(writeFileSpy).not.toHaveBeenCalled();
  });

  it('sendInput呼び出し時_入力確定でtaskBriefを更新する', async () => {
    let state = { sessions: [{ id: 'session-1' }, { id: 'session-2' }] };
    const stateStore = {
      get: () => state,
      update: async (next) => {
        state = next;
        return state;
      }
    };
    const manager = createSessionServices({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore,
      worktreeService: {}
    }).sessionApi;
    vi.spyOn(manager, '_runTmux').mockResolvedValue({ stdout: '', stderr: '' });
    vi.spyOn(fs.promises, 'mkdtemp').mockResolvedValue('/tmp/brainbase-input-test-taskbrief');
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);

    await manager.sendInput('session-1', 'Live Feedで何の作業をしているか分かるようにして', 'text');
    await manager.sendInput('session-1', 'Enter', 'key');

    expect(state.sessions[0].taskBrief).toBe('Live Feedで何の作業をしているか分かるようにして');
    expect(state.sessions[0].taskBriefUpdatedAt).toBeTruthy();
  });

  it('reportActivity呼び出し時_assistantSnippetをsessionに保存する', () => {
    let state = { sessions: [{ id: 'session-1' }] };
    const stateStore = {
      get: () => state,
      update: async (next) => {
        state = next;
        return state;
      }
    };
    const manager = createSessionServices({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore,
      worktreeService: {}
    }).sessionApi;
    const now = Date.now();

    manager.reportActivity('session-1', 'working', now, {
      eventType: 'assistant-message',
      activityKind: 'reasoning',
      assistantSnippet: 'この表示から transport ノイズを外します'
    });

    expect(state.sessions[0].lastAssistantSnippet).toBe('この表示から transport ノイズを外します');
    expect(state.sessions[0].lastAssistantSnippetAt).toBeTruthy();
  });

  it('sendInput呼び出し時_shellっぽい短文では既存taskBriefを上書きしない', async () => {
    let state = {
      sessions: [{
        id: 'session-1',
        taskBrief: 'サーバが落ちる原因を調べる',
        taskBriefUpdatedAt: '2026-03-27T00:00:00.000Z'
      }, { id: 'session-2' }]
    };
    const stateStore = {
      get: () => state,
      update: async (next) => {
        state = next;
        return state;
      }
    };
    const manager = createSessionServices({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore,
      worktreeService: {}
    }).sessionApi;
    vi.spyOn(manager, '_runTmux').mockResolvedValue({ stdout: '', stderr: '' });
    vi.spyOn(fs.promises, 'mkdtemp').mockResolvedValue('/tmp/brainbase-input-test-command');
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);

    await manager.sendInput('session-1', 'git status', 'text');
    await manager.sendInput('session-1', 'Enter', 'key');

    expect(state.sessions[0].taskBrief).toBe('サーバが落ちる原因を調べる');
  });
});
