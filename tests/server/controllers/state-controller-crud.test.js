import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StateController } from '../../../server/controllers/state-controller.js';

function createRes() {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis()
  };
}

describe('StateController CRUD session routes', () => {
  let stateStore;
  let sessionManager;
  let controller;

  beforeEach(() => {
    stateStore = {
      get: vi.fn(),
      update: vi.fn(),
      upsertSession: vi.fn(),
      patchSession: vi.fn(),
      deleteSession: vi.fn(),
      reorderSessions: vi.fn()
    };
    sessionManager = {
      waitUntilReady: vi.fn(async () => true),
      getRuntimeStatus: vi.fn(() => ({ ttydRunning: false }))
    };
    controller = new StateController(stateStore, sessionManager, false);
  });

  it('creates a session without replacing existing sessions', async () => {
    const existing = [{ id: 'session-1', name: 'existing', intendedState: 'active' }];
    const created = { id: 'session-2', name: 'created', project: 'salestailor-app', intendedState: 'active' };
    stateStore.get.mockReturnValue({ sessions: existing });
    stateStore.upsertSession.mockResolvedValue({ sessions: [...existing, created] });
    const res = createRes();
    const next = vi.fn();

    controller.createSession({
      body: created
    }, res, next);

    await Promise.resolve();
    await Promise.resolve();

    expect(stateStore.upsertSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'session-2', project: 'salestailor-app' })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(created);
    expect(next).not.toHaveBeenCalled();
  });

  it('deletes only the requested session', async () => {
    const sessions = [
      { id: 'session-1', name: 'keep' },
      { id: 'session-2', name: 'delete-me' }
    ];
    stateStore.get.mockReturnValue({ sessions });
    stateStore.deleteSession.mockResolvedValue({ sessions: [sessions[0]] });
    const res = createRes();
    const next = vi.fn();

    controller.deleteSession({
      params: { sessionId: 'session-2' }
    }, res, next);

    await Promise.resolve();
    await Promise.resolve();

    expect(stateStore.deleteSession).toHaveBeenCalledWith('session-2');
    expect(res.json).toHaveBeenCalledWith({ success: true, sessionId: 'session-2' });
    expect(next).not.toHaveBeenCalled();
  });

  it('reorders authoritative sessions and preserves unknown ids by appending', async () => {
    const sessions = [
      { id: 'session-a', name: 'A' },
      { id: 'session-b', name: 'B' },
      { id: 'session-c', name: 'C' }
    ];
    stateStore.get.mockReturnValue({ sessions });
    stateStore.reorderSessions.mockResolvedValue({ sessions: [sessions[2], sessions[0], sessions[1]] });
    const res = createRes();
    const next = vi.fn();

    controller.reorderSessions({
      body: { orderedIds: ['session-c', 'session-a'] }
    }, res, next);

    await Promise.resolve();
    await Promise.resolve();

    expect(stateStore.reorderSessions).toHaveBeenCalledWith(['session-c', 'session-a']);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      sessions: [sessions[2], sessions[0], sessions[1]]
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('ignores POST /api/state sessions payload so stale clients cannot drop sessions', async () => {
    const currentState = {
      sessions: [
        { id: 'session-1', name: 'keep-me', project: 'brainbase' },
        { id: 'session-2', name: 'update-me', project: 'old-project' }
      ],
      preferences: { theme: 'light' }
    };
    stateStore.get.mockReturnValue(currentState);
    stateStore.update.mockImplementation(async (nextState) => nextState);
    const res = createRes();
    const next = vi.fn();

    controller.update({
      body: {
        preferences: { theme: 'dark' },
        sessions: [
          { id: 'session-2', name: 'update-me', project: 'salestailor-app' }
        ]
      }
    }, res, next);

    await Promise.resolve();
    await Promise.resolve();

    expect(stateStore.update).toHaveBeenCalledWith({
      preferences: { theme: 'dark' },
      sessions: currentState.sessions
    });
    expect(res.json).toHaveBeenCalledWith({
      preferences: { theme: 'dark' },
      sessions: currentState.sessions
    });
    expect(next).not.toHaveBeenCalled();
  });
});
