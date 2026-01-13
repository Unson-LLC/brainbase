import { describe, it, expect } from 'vitest';

import { SessionManager } from '../../server/services/session-manager.js';

const createStateStore = () => {
  let state = {
    sessions: [{ id: 'session-1' }, { id: 'session-2' }]
  };

  return {
    get: () => state,
    update: async (next) => {
      state = next;
      return state;
    }
  };
};

const createManager = () => new SessionManager({
  serverDir: '/tmp',
  execPromise: async () => ({ stdout: '' }),
  stateStore: createStateStore(),
  worktreeService: {}
});

describe('SessionManager', () => {
  it('reportActivity_working_latest_sets_isWorking_true', () => {
    const manager = createManager();

    manager.reportActivity('session-1', 'working', 1000);

    const status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(true);
    expect(status.isDone).toBe(false);
  });

  it('reportActivity_done_latest_sets_isDone_true', () => {
    const manager = createManager();

    manager.reportActivity('session-1', 'done', 2000);

    const status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(false);
    expect(status.isDone).toBe(true);
  });

  it('done_then_working_sets_isWorking_true', () => {
    const manager = createManager();

    manager.reportActivity('session-1', 'done', 1000);
    manager.reportActivity('session-1', 'working', 2000);

    const status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(true);
    expect(status.isDone).toBe(false);
  });

  it('working_then_done_sets_isDone_true', () => {
    const manager = createManager();

    manager.reportActivity('session-1', 'working', 1000);
    manager.reportActivity('session-1', 'done', 2000);

    const status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(false);
    expect(status.isDone).toBe(true);
  });

  it('clearDoneStatus_removes_done_state', () => {
    const manager = createManager();

    manager.reportActivity('session-1', 'done', 1000);
    manager.clearDoneStatus('session-1');

    const status = manager.getSessionStatus()['session-1'];
    expect(status).toBeUndefined();
  });
});
