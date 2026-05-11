import { readFileSync } from 'fs';

import { describe, expect, it } from 'vitest';

import { createSessionServices } from '../../server/services/create-session-services.js';
import { createBrainbaseActivityRawLedgerRecord } from '../../server/services/session-core/activity-raw-ledger-adapter.js';
import { buildScopedMemoryResult } from '../../server/services/memory-scope-policy.js';

const memoryCandidateFixture = JSON.parse(readFileSync('tests/fixtures/memory-promotion/memory-candidate.fixture.json', 'utf-8'));
const accessContextFixture = JSON.parse(readFileSync('tests/fixtures/memory-promotion/access-contexts.fixture.json', 'utf-8'));

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
  it('memory retrieval is scoped by person role project channel and sensitivity', () => {
    const candidates = memoryCandidateFixture.candidates;

    for (const context of accessContextFixture.contexts) {
      const result = buildScopedMemoryResult(candidates, context);
      const allowedIds = result.records.map(candidate => candidate.candidate_id).sort();
      const expectedIds = [...context.expected_memory].sort();
      const deniedIds = result.denied.map(item => item.id);

      expect(allowedIds, context.context_id).toEqual(expectedIds);
      for (const id of context.denied_memory) {
        expect(deniedIds, `${context.context_id}:${id}`).toContain(id);
      }
    }
  });

  it('brainbase activity is mapped to raw ledger envelope without raw transcript', () => {
    const record = createBrainbaseActivityRawLedgerRecord({
      sessionId: 'session-1778219472083',
      status: 'done',
      reportedAt: Date.parse('2026-05-08T10:00:00.000Z'),
      capturedAt: Date.parse('2026-05-08T10:00:03.000Z'),
      metadata: {
        lifecycle: 'turn_completed',
        eventType: 'agent-turn-complete',
        turnId: 'turn-1',
        actorPersonId: 'per_keigo_sato',
        workspace: 'unson',
        projectCode: 'brainbase',
        permissionSnapshot: {
          roles: ['gm'],
          channelMembership: null,
          projectMembership: true,
          clearance: ['internal', 'restricted']
        },
        taskBrief: 'raw prompt text must not be copied',
        assistantSnippet: 'raw assistant text must not be copied',
        currentStep: 'raw step text must not be copied',
        latestEvidence: 'raw command output must not be copied'
      }
    });

    expect(record).toMatchObject({
      source_system: 'brainbase',
      source_event_id: 'session:session-1778219472083:activity:agent-turn-complete:turn:turn-1',
      occurred_at: '2026-05-08T10:00:00.000Z',
      captured_at: '2026-05-08T10:00:03.000Z',
      actor_external_id: 'brainbase:user:per_keigo_sato',
      actor_person_id: 'per_keigo_sato',
      workspace: 'unson',
      channel_id: null,
      project_code: 'brainbase',
      permission_snapshot: {
        roles: ['gm'],
        channel_membership: null,
        project_membership: true,
        clearance: ['internal', 'restricted']
      },
      evidence_ref: {
        kind: 'source_pointer',
        uri: 'brainbase:session:session-1778219472083:activity:agent-turn-complete'
      },
      retention_policy: 'envelope_only',
      redaction_status: 'none'
    });
    expect(record.raw_event_id).toMatch(/^raw_brainbase_[a-f0-9]{16}$/);
    expect(record.evidence_ref.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(record).not.toHaveProperty('taskBrief');
    expect(record).not.toHaveProperty('assistantSnippet');
    expect(JSON.stringify(record)).not.toContain('raw assistant text');
  });

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
