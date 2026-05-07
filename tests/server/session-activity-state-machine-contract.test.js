import { describe, expect, it } from 'vitest';

import { createSessionServices } from '../../server/services/create-session-services.js';
import { deriveActivityState, ActivityState } from '../../public/modules/core/session-activity-state.js';

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

const getStatus = (manager, sessionId = 'session-1') => manager.getSessionStatus()[sessionId];

describe('session activity state machine contract', () => {
  it('prompt_submit_after_done_is_a_strong_working_signal_before_codex_hooks_arrive', async () => {
    const manager = createManager();
    const now = Date.now();
    manager._now = () => now + 1000;

    manager.reportActivity('session-1', 'done', now, {
      lifecycle: 'turn_completed',
      eventType: 'agent-turn-complete'
    });

    await manager._capturePromptInput('session-1', 'VibeProで解析して', 'text');
    await manager._capturePromptInput('session-1', 'Enter', 'key');

    const status = getStatus(manager);
    expect(status).toMatchObject({
      isWorking: true,
      isDone: false,
      activeTurnCount: 0,
      lastEventType: 'brainbase/input-submit',
      liveActivity: expect.objectContaining({
        activityKind: 'task_started',
        statusTone: 'working',
        currentStep: '依頼を送信済み',
        latestEvidence: 'terminal input submitted'
      })
    });
    expect(deriveActivityState(status)).toBe(ActivityState.WORKING);
  });

  it('stale_pane_title_spinner_does_not_override_explicit_done_without_new_input', () => {
    const manager = createManager();
    const now = Date.now();
    manager._now = () => now + 1000;

    manager.reportActivity('session-1', 'done', now, {
      lifecycle: 'turn_completed',
      eventType: 'agent-turn-complete'
    });
    manager._listTmuxPaneTitles = () => ['session-1\t⠹ session-1...'];

    const status = getStatus(manager);
    expect(status).toMatchObject({
      isWorking: false,
      isDone: true,
      activeTurnCount: 0,
      lastEventType: 'agent-turn-complete'
    });
    expect(deriveActivityState(status)).toBe(ActivityState.DONE_UNREAD);
  });

  it('codex_hook_heartbeat_after_done_is_a_strong_working_signal_without_turn_id', () => {
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

    const status = getStatus(manager);
    expect(status).toMatchObject({
      isWorking: true,
      isDone: false,
      activeTurnCount: 0,
      lastEventType: 'codex/hook/PreToolUse'
    });
    expect(deriveActivityState(status)).toBe(ActivityState.WORKING);
  });

  it('assistant_message_complete_during_active_turn_does_not_turn_green', () => {
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

    const status = getStatus(manager);
    expect(status).toMatchObject({
      isWorking: true,
      isDone: false,
      activeTurnCount: 1
    });
    expect(deriveActivityState(status)).toBe(ActivityState.THINKING);
  });

  it('one_completed_turn_does_not_turn_green_while_another_turn_is_active', () => {
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

    const status = getStatus(manager);
    expect(status).toMatchObject({
      isWorking: true,
      isDone: false,
      activeTurnCount: 1
    });
    expect(deriveActivityState(status)).toBe(ActivityState.THINKING);
  });
});
