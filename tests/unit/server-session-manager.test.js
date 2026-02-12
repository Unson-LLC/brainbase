import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../server/services/session-manager.js';

describe('SessionManager (Server)', () => {
  let sessionManager;
  let execPromiseMock;

  beforeEach(() => {
    execPromiseMock = vi.fn().mockResolvedValue({ stdout: '' });
    sessionManager = new SessionManager({});
    sessionManager.execPromise = execPromiseMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('cleanupSessionResources', () => {
    it('存在しないTMUXセッションでもエラーなく完了する', async () => {
      execPromiseMock.mockImplementation((cmd) => {
        if (cmd.includes('tmux list-panes')) return Promise.resolve({ stdout: '' });
        if (cmd.includes('tmux kill-session')) return Promise.reject(new Error('no such session'));
        return Promise.resolve({ stdout: '' });
      });

      await expect(
        sessionManager.cleanupSessionResources('non-existent-session')
      ).resolves.not.toThrow();
    });

    it('TMUXセッション削除時にpane PIDと子プロセスへTERMを送る', async () => {
      execPromiseMock.mockImplementation((cmd) => {
        if (cmd.includes('tmux list-panes')) return Promise.resolve({ stdout: '12345\n12346\n' });
        if (cmd.includes('pgrep -P 12345')) return Promise.resolve({ stdout: '20001\n' });
        if (cmd.includes('pgrep -P 12346')) return Promise.resolve({ stdout: '' });
        return Promise.resolve({ stdout: '' });
      });
      vi.spyOn(sessionManager, '_isProcessRunning').mockReturnValue(false);

      await sessionManager.cleanupSessionResources('test-session-with-mcp');

      expect(execPromiseMock).toHaveBeenCalledWith(
        expect.stringContaining('tmux kill-session -t "test-session-with-mcp"')
      );
      expect(execPromiseMock).toHaveBeenCalledWith(expect.stringContaining('kill -TERM 12345'));
      expect(execPromiseMock).toHaveBeenCalledWith(expect.stringContaining('kill -TERM 12346'));
      expect(execPromiseMock).toHaveBeenCalledWith(expect.stringContaining('kill -TERM 20001'));
    });
  });

  describe('stopTtyd', () => {
    it('stopTtyd呼び出し後_cleanupSessionResourcesが実行される', async () => {
      const sessionId = 'active-session';
      const mockProcess = {
        kill: vi.fn(),
        killed: true
      };
      sessionManager.activeSessions.set(sessionId, {
        port: 3001,
        process: mockProcess
      });

      const cleanupSpy = vi.spyOn(sessionManager, 'cleanupSessionResources').mockResolvedValue();
      await sessionManager.stopTtyd(sessionId);

      expect(cleanupSpy).toHaveBeenCalledWith(sessionId);
      expect(sessionManager.activeSessions.has(sessionId)).toBe(false);
    });
  });

  describe('cleanupOrphans', () => {
    it('state.jsonのactive/pausedセッションは保護される', async () => {
      sessionManager.stateStore = {
        get: vi.fn().mockReturnValue({
          sessions: [
            { id: 'session-12345', intendedState: 'active' },
            { id: 'session-67890', intendedState: 'paused' }
          ]
        })
      };

      const psOutput = `
user     11111  0.0  0.1  ttyd -p 3001 -b /console/session-12345
user     22222  0.0  0.1  ttyd -p 3002 -b /console/session-67890
      `.trim();
      execPromiseMock.mockResolvedValueOnce({ stdout: psOutput });

      await sessionManager.cleanupOrphans();

      expect(execPromiseMock).not.toHaveBeenCalledWith(expect.stringContaining('kill 11111'));
      expect(execPromiseMock).not.toHaveBeenCalledWith(expect.stringContaining('kill 22222'));
    });

    it('active/paused以外の孤立ttydプロセスは削除される', async () => {
      sessionManager.stateStore = {
        get: vi.fn().mockReturnValue({
          sessions: [{ id: 'session-archived', intendedState: 'archived' }]
        })
      };
      sessionManager.activeSessions.clear();

      const psOutput = `
user     44444  0.0  0.1  ttyd -p 3003 -b /console/session-orphan
      `.trim();
      execPromiseMock.mockResolvedValueOnce({ stdout: psOutput });

      await sessionManager.cleanupOrphans();

      expect(execPromiseMock).toHaveBeenCalledWith(expect.stringContaining('kill 44444'));
    });
  });
});
