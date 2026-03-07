import fs from 'fs';
import os from 'os';
import path from 'path';
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

  it('heartbeat_timeout_sets_isWorking_false_after_60m', () => {
    const manager = createManager();
    const now = Date.now();
    const staleTime = now - 60 * 60 * 1000 - 1000; // 60分+1秒前

    manager.reportActivity('session-1', 'working', staleTime);

    const status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(false);
    expect(status.isDone).toBe(true); // タイムアウト時はisDone: true
  });

  // Phase 2: working報告優先化のテスト
  it('working報告受信時_lastDoneAtがリセットされる', () => {
    const manager = createManager();
    const now = Date.now();

    // done報告を先に送る（Hook報告の順序が逆転するケース）
    manager.reportActivity('session-1', 'done', now - 2000);
    manager.reportActivity('session-1', 'working', now - 1000);

    const status = manager.getSessionStatus()['session-1'];
    expect(status.isWorking).toBe(true);
    expect(status.isDone).toBe(false);
    expect(status.lastDoneAt).toBe(0); // lastDoneAtがリセットされていることを確認
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

    const manager = new SessionManager({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: `${resolvedDir}\n` }),
      stateStore,
      worktreeService: { worktreesDir: '/unused' }
    });

    const resolvedPath = await manager.resolveSessionWorkspacePath('session-1');

    expect(resolvedPath).toBe(resolvedDir);
    expect(state.sessions[0].path).toBe(resolvedDir);
    expect(state.sessions[0].worktree.path).toBe(resolvedDir);

    fs.rmSync(resolvedDir, { recursive: true, force: true });
  });
});
