import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../server/services/session-manager.js';

describe('SessionManager (Server)', () => {
  let sessionManager;
  let execPromiseMock;

  beforeEach(() => {
    // Mock execPromise
    execPromiseMock = vi.fn();

    // Create SessionManager instance with mocked execPromise
    sessionManager = new SessionManager({});
    sessionManager.execPromise = execPromiseMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('cleanupSessionResources', () => {
    it('同じsessionIdで2回呼び出し_エラーが発生しない', async () => {
      const sessionId = 'test-session-123';

      // First call: TMUX session exists, cleanup succeeds
      execPromiseMock.mockResolvedValueOnce({ stdout: '' }); // tmux kill-session
      execPromiseMock.mockResolvedValueOnce({ stdout: '' }); // tmux list-panes

      await sessionManager.cleanupSessionResources(sessionId);

      // Second call: TMUX session already deleted, should not throw
      execPromiseMock.mockRejectedValueOnce(new Error('session not found')); // tmux kill-session fails
      execPromiseMock.mockResolvedValueOnce({ stdout: '' }); // tmux list-panes

      await expect(
        sessionManager.cleanupSessionResources(sessionId)
      ).resolves.not.toThrow();
    });

    it('存在しないTMUXセッション_エラーを無視してクリーンアップ完了', async () => {
      const sessionId = 'non-existent-session';

      // TMUX session doesn't exist
      execPromiseMock.mockRejectedValueOnce(new Error('no such session')); // tmux kill-session fails
      execPromiseMock.mockResolvedValueOnce({ stdout: '' }); // tmux list-panes returns empty

      await expect(
        sessionManager.cleanupSessionResources(sessionId)
      ).resolves.not.toThrow();
    });

    it('TMUXセッション削除後_MCPプロセスが終了される', async () => {
      const sessionId = 'test-session-with-mcp';

      // TMUX session has 2 panes with PIDs 12345 and 12346
      execPromiseMock.mockResolvedValueOnce({ stdout: '' }); // tmux kill-session
      execPromiseMock.mockResolvedValueOnce({ stdout: '12345\n12346\n' }); // tmux list-panes
      execPromiseMock.mockResolvedValue({ stdout: '' }); // pkill/kill commands

      await sessionManager.cleanupSessionResources(sessionId);

      // Verify pkill was called for each PID's children
      expect(execPromiseMock).toHaveBeenCalledWith(
        expect.stringContaining('pkill -TERM -P 12345')
      );
      expect(execPromiseMock).toHaveBeenCalledWith(
        expect.stringContaining('pkill -TERM -P 12346')
      );

      // Verify kill was called for each PID
      expect(execPromiseMock).toHaveBeenCalledWith(
        expect.stringContaining('kill -TERM 12345')
      );
      expect(execPromiseMock).toHaveBeenCalledWith(
        expect.stringContaining('kill -TERM 12346')
      );
    });
  });

  describe('stopTtyd', () => {
    it('stopTtyd呼び出し後_cleanupSessionResourcesが実行される', async () => {
      const sessionId = 'active-session';

      // Mock active session with ttyd process
      const mockProcess = {
        kill: vi.fn(),
        killed: true
      };
      sessionManager.activeSessions.set(sessionId, {
        port: 3001,
        process: mockProcess
      });

      // Spy on cleanupSessionResources
      const cleanupSpy = vi.spyOn(sessionManager, 'cleanupSessionResources').mockResolvedValue();

      await sessionManager.stopTtyd(sessionId);

      expect(cleanupSpy).toHaveBeenCalledWith(sessionId);
      expect(sessionManager.activeSessions.has(sessionId)).toBe(false);
    });

    it('stopTtyd呼び出し後_TMUXとMCPプロセスが削除される', async () => {
      const sessionId = 'active-session-with-mcp';

      // Mock active session with ttyd process
      const mockProcess = {
        kill: vi.fn(),
        killed: true
      };
      sessionManager.activeSessions.set(sessionId, {
        port: 3001,
        process: mockProcess
      });

      // Mock cleanupSessionResources calls
      execPromiseMock.mockResolvedValueOnce({ stdout: '' }); // tmux kill-session
      execPromiseMock.mockResolvedValueOnce({ stdout: '99999\n' }); // tmux list-panes

      await sessionManager.stopTtyd(sessionId);

      // Verify tmux kill-session was called
      expect(execPromiseMock).toHaveBeenCalledWith(
        expect.stringContaining('tmux kill-session')
      );

      // Verify MCP processes were killed
      expect(execPromiseMock).toHaveBeenCalledWith(
        expect.stringContaining('pkill -TERM -P 99999')
      );
    });
  });

  describe('cleanupOrphans', () => {
    it('activeSessions Mapが空でもstate.jsonのintendedState=activeなセッションを保護する', async () => {
      // BUG FIX検証: TEST_MODEでrestoreActiveSessions()がスキップされた場合でも、
      // state.jsonの情報を使ってアクティブセッションを保護する

      // Mock state.json with active session
      const mockStateStore = {
        get: vi.fn().mockReturnValue({
          sessions: [
            { id: 'session-12345', intendedState: 'active' },
            { id: 'session-67890', intendedState: 'paused' }
          ]
        })
      };
      sessionManager.stateStore = mockStateStore;

      // activeSessions Map is empty (TEST_MODE scenario)
      sessionManager.activeSessions.clear();

      // Mock ps aux output: 2 ttyd processes running
      const psOutput = `
user     11111  0.0  0.1  ttyd -p 3001 -b /console/session-12345
user     22222  0.0  0.1  ttyd -p 3002 -b /console/session-67890
      `.trim();
      execPromiseMock.mockResolvedValueOnce({ stdout: psOutput });

      await sessionManager.cleanupOrphans();

      // Verify: session-12345 is protected (intendedState='active')
      expect(execPromiseMock).not.toHaveBeenCalledWith(
        expect.stringContaining('kill 11111')
      );

      // Verify: session-67890 is killed (intendedState='paused')
      expect(execPromiseMock).toHaveBeenCalledWith(
        expect.stringContaining('kill 22222')
      );
    });

    it('activePidsに登録されているプロセスは保護される', async () => {
      // Mock state.json (empty)
      const mockStateStore = {
        get: vi.fn().mockReturnValue({ sessions: [] })
      };
      sessionManager.stateStore = mockStateStore;

      // Mock activeSessions with PID
      sessionManager.activeSessions.set('session-99999', {
        port: 3001,
        process: { pid: 33333 }
      });

      // Mock ps aux output
      const psOutput = `
user     33333  0.0  0.1  ttyd -p 3001 -b /console/session-99999
      `.trim();
      execPromiseMock.mockResolvedValueOnce({ stdout: psOutput });

      await sessionManager.cleanupOrphans();

      // Verify: PID 33333 is protected (in activePids)
      expect(execPromiseMock).not.toHaveBeenCalledWith(
        expect.stringContaining('kill 33333')
      );
    });

    it('activePidsにもactiveSessionIdsにもないプロセスは削除される', async () => {
      // Mock state.json (no active sessions)
      const mockStateStore = {
        get: vi.fn().mockReturnValue({
          sessions: [
            { id: 'session-archived', intendedState: 'archived' }
          ]
        })
      };
      sessionManager.stateStore = mockStateStore;

      // activeSessions Map is empty
      sessionManager.activeSessions.clear();

      // Mock ps aux output: orphaned ttyd process
      const psOutput = `
user     44444  0.0  0.1  ttyd -p 3003 -b /console/session-orphan
      `.trim();
      execPromiseMock.mockResolvedValueOnce({ stdout: psOutput });

      await sessionManager.cleanupOrphans();

      // Verify: orphaned process is killed
      expect(execPromiseMock).toHaveBeenCalledWith(
        expect.stringContaining('kill 44444')
      );
    });

    it('ttydプロセスが存在しない場合_エラーなく完了する', async () => {
      // Mock state.json
      const mockStateStore = {
        get: vi.fn().mockReturnValue({ sessions: [] })
      };
      sessionManager.stateStore = mockStateStore;

      // Mock ps aux output (no ttyd processes)
      execPromiseMock.mockResolvedValueOnce({ stdout: '' });

      await expect(sessionManager.cleanupOrphans()).resolves.not.toThrow();

      // Verify: no kill commands were executed
      expect(execPromiseMock).toHaveBeenCalledTimes(1); // Only ps aux
    });
  });
});
