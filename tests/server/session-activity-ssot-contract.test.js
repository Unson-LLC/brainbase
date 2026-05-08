import { describe, expect, it } from 'vitest';

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
};

const createManager = () => createSessionServices({
  serverDir: '/tmp',
  execPromise: async () => ({ stdout: '' }),
  stateStore: createStateStore(),
  worktreeService: {}
}).sessionApi;

const getStatus = (manager, sessionId = 'session-1') => manager.getSessionStatus()[sessionId] || null;

describe('session activity SSOT contract', () => {
  it('delayed_turn_started_older_than_terminal_done_does_not_reopen_blue', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'done', now, {
      lifecycle: 'terminal_done',
      eventType: 'agent-turn-complete'
    });
    manager.reportActivity('session-1', 'working', now - 1000, {
      lifecycle: 'turn_started',
      eventType: 'agent-turn-start',
      turnId: 'turn-delayed'
    });

    expect(getStatus(manager)).toMatchObject({
      state: 'done-unread',
      confidence: 'explicit',
      isWorking: false,
      isDone: true,
      activeTurnCount: 0
    });
  });

  it('terminal_done_closes_residual_active_turns_and_surfaces_done_unread', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'working', now - 1000, {
      lifecycle: 'turn_started',
      eventType: 'agent-turn-start',
      turnId: 'turn-1'
    });
    manager.reportActivity('session-1', 'done', now, {
      lifecycle: 'terminal_done',
      eventType: 'agent-turn-complete'
    });

    expect(getStatus(manager)).toMatchObject({
      state: 'done-unread',
      confidence: 'explicit',
      isWorking: false,
      isDone: true,
      activeTurnCount: 0
    });
  });

  it('clear_done_then_tmux_spinner_does_not_reopen_blue', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'done', now, {
      lifecycle: 'terminal_done',
      eventType: 'agent-turn-complete'
    });
    manager.clearDoneStatus('session-1');
    manager._listTmuxPaneTitles = () => ['session-1\t⠹ session-1...'];

    const status = getStatus(manager);
    expect(status === null || status.state === 'idle').toBe(true);
    expect(status?.isWorking || false).toBe(false);
    expect(status?.isDone || false).toBe(false);
  });

  it('submitted_input_after_done_read_reopens_activity_and_clears_spinner_suppression', async () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'done', now, {
      lifecycle: 'terminal_done',
      eventType: 'agent-turn-complete'
    });
    manager.clearDoneStatus('session-1');
    manager._listTmuxPaneTitles = () => ['session-1\t⠹ session-1...'];

    expect(getStatus(manager)).toBeNull();

    await manager._capturePromptInput('session-1', '相変わらず正しく動かない', 'text');
    await manager._capturePromptInput('session-1', 'Enter', 'key');

    expect(getStatus(manager)).toMatchObject({
      state: 'running',
      confidence: 'explicit',
      isWorking: true,
      isDone: false,
      lastEventType: 'brainbase/input-submit'
    });
  });

  it('transport_ready_done_is_not_user_visible_done_and_allows_tmux_fallback', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'done', now, {
      lifecycle: 'turn_completed',
      eventType: 'codex/pty-shim-ready',
      turnId: `codex-pty-turn-${now}-12345`
    });

    expect(getStatus(manager)).toBeNull();

    manager._listTmuxPaneTitles = () => ['session-1\t⠴ session-1...'];

    expect(getStatus(manager)).toMatchObject({
      state: 'running',
      confidence: 'fallback',
      isWorking: true,
      isDone: false,
      activeTurnCount: 1,
      lastEventType: 'tmux-pane-title-spinner'
    });
  });

  it('one_completed_turn_keeps_running_while_another_turn_is_active', () => {
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

    expect(getStatus(manager)).toMatchObject({
      state: 'running',
      confidence: 'explicit',
      isWorking: true,
      isDone: false,
      activeTurnCount: 1
    });
  });

  it('assistant_response_complete_during_active_turn_is_progress_not_done', () => {
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

    expect(getStatus(manager)).toMatchObject({
      state: 'running',
      confidence: 'explicit',
      isWorking: true,
      isDone: false,
      activeTurnCount: 1
    });
  });

  it('user_input_requested_is_waiting_not_done_unread', () => {
    const manager = createManager();
    const now = Date.now();

    manager.reportActivity('session-1', 'working', now, {
      lifecycle: 'turn_started',
      eventType: 'agent-turn-start',
      turnId: 'turn-1'
    });
    manager.reportActivity('session-1', 'working', now + 1000, {
      lifecycle: 'heartbeat',
      eventType: 'user-input-requested',
      activityKind: 'waiting_input',
      currentStep: '入力待ち',
      turnId: 'turn-1'
    });

    expect(getStatus(manager)).toMatchObject({
      state: 'waiting',
      confidence: 'explicit',
      isWorking: true,
      isDone: false,
      activeTurnCount: 1
    });
  });

  it('restore_done_with_residual_active_turns_normalizes_to_done_unread', async () => {
    const now = Date.now();
    let state = {
      sessions: [{
        id: 'session-1',
        hookStatus: {
          status: 'working',
          timestamp: now,
          lastWorkingAt: now - 1000,
          lastDoneAt: now,
          lastActivityAt: now,
          lastEventType: 'agent-turn-complete',
          activeTurnIds: ['turn-residual'],
          liveActivity: {
            activityKind: 'task_completed',
            currentStep: '作業が一区切り完了',
            statusTone: 'working',
            updatedAt: now,
            assistantSnippetUpdatedAt: 0
          }
        }
      }]
    };
    const stateStore = {
      get: () => state,
      patchSession: async (sessionId, patch) => {
        state = {
          ...state,
          sessions: state.sessions.map((session) => (
            session.id === sessionId ? { ...session, ...patch } : session
          ))
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

    expect(getStatus(manager)).toMatchObject({
      state: 'done-unread',
      confidence: 'explicit',
      isWorking: false,
      isDone: true,
      activeTurnCount: 0
    });
    expect(state.sessions[0].hookStatus.activeTurnIds).toEqual([]);
    expect(state.sessions[0].hookStatus.status).toBe('done');
  });
});
