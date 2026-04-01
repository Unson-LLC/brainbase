import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, vi } from 'vitest';

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
  it('getRuntimeStatus_paused_session_does_not_probe_tmux', () => {
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

  it('getRuntimeStatus_active_session_without_ttyd_probes_tmux', () => {
    const manager = createManager();
    const tmuxSpy = vi.spyOn(manager, '_isTmuxSessionRunningSync').mockReturnValue(true);
    vi.spyOn(manager, '_isProcessRunning').mockReturnValue(false);

    const runtimeStatus = manager.getRuntimeStatus({
      id: 'session-1',
      intendedState: 'active',
      ttydProcess: { pid: 12345 }
    });

    expect(tmuxSpy).toHaveBeenCalledWith('session-1');
    expect(runtimeStatus.interactiveTransport).toBe('xterm');
    expect(runtimeStatus.needsRestart).toBe(false);
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

  it('sendInput呼び出し時_短文テキストはtemp file経由でpaste-bufferする', async () => {
    const manager = new SessionManager({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore: createStateStore(),
      worktreeService: {}
    });
    const runTmuxSpy = vi.spyOn(manager, '_runTmux').mockResolvedValue({ stdout: '', stderr: '' });
    const mkdtempSpy = vi.spyOn(fs.promises, 'mkdtemp').mockResolvedValue('/tmp/brainbase-input-test-short');
    const writeFileSpy = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    const rmSpy = vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);

    await manager.sendInput('session-1', 'hello world', 'text');

    expect(mkdtempSpy).toHaveBeenCalled();
    expect(writeFileSpy).toHaveBeenCalledWith('/tmp/brainbase-input-test-short/paste.txt', 'hello world', 'utf8');
    expect(runTmuxSpy).toHaveBeenCalledWith(['load-buffer', '-b', expect.stringContaining('brainbase-session-1-'), '/tmp/brainbase-input-test-short/paste.txt']);
    expect(runTmuxSpy).toHaveBeenCalledWith(['paste-buffer', '-d', '-b', expect.stringContaining('brainbase-session-1-'), '-t', 'session-1']);
    expect(runTmuxSpy).toHaveBeenCalledWith(['delete-buffer', '-b', expect.stringContaining('brainbase-session-1-')]);
    expect(rmSpy).toHaveBeenCalledWith('/tmp/brainbase-input-test-short', { recursive: true, force: true });
  });

  it('sendInput呼び出し時_長文テキストはtemp file経由でpaste-bufferする', async () => {
    const manager = new SessionManager({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore: createStateStore(),
      worktreeService: {}
    });
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
    const manager = new SessionManager({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore: createStateStore(),
      worktreeService: {}
    });
    vi.spyOn(manager, '_runTmux').mockResolvedValue({ stdout: '', stderr: '' });
    vi.spyOn(fs.promises, 'mkdtemp').mockResolvedValue('/tmp/brainbase-input-test-literal');
    const writeFileSpy = vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);

    await manager.sendInput('session-1', 'alpha $HOME `echo hi`', 'text');

    expect(writeFileSpy).toHaveBeenCalledWith('/tmp/brainbase-input-test-literal/paste.txt', 'alpha $HOME `echo hi`', 'utf8');
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
    const manager = new SessionManager({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore,
      worktreeService: {}
    });
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
    const manager = new SessionManager({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore,
      worktreeService: {}
    });
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
    const manager = new SessionManager({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore,
      worktreeService: {}
    });
    vi.spyOn(manager, '_runTmux').mockResolvedValue({ stdout: '', stderr: '' });
    vi.spyOn(fs.promises, 'mkdtemp').mockResolvedValue('/tmp/brainbase-input-test-command');
    vi.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);
    vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);

    await manager.sendInput('session-1', 'git status', 'text');
    await manager.sendInput('session-1', 'Enter', 'key');

    expect(state.sessions[0].taskBrief).toBe('サーバが落ちる原因を調べる');
  });
});
