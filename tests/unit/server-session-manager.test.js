import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSessionServices } from '../../server/services/create-session-services.js';

describe('SessionManager (Server)', () => {
  let sessionManager;
  let execPromiseMock;

  beforeEach(() => {
    execPromiseMock = vi.fn().mockResolvedValue({ stdout: '' });
    sessionManager = createSessionServices({ execPromise: execPromiseMock }).sessionApi;
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

  describe('cleanupArchivedSessions', () => {
    it('finalizer未完了のarchived sessionはTTLを過ぎても削除しない', async () => {
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      const update = vi.fn();
      const remove = vi.fn(async () => true);
      sessionManager.stateStore = {
        get: vi.fn().mockReturnValue({
          sessions: [
            {
              id: 'session-queued',
              intendedState: 'archived',
              archivedAt: oldDate,
              archive: { status: 'queued' },
              worktree: { repo: '/repo' }
            },
            {
              id: 'session-blocked',
              intendedState: 'archived',
              archivedAt: oldDate,
              archive: { status: 'blocked' },
              worktree: { repo: '/repo' }
            }
          ]
        }),
        update
      };
      sessionManager.worktreeService = { remove };

      await sessionManager.cleanupArchivedSessions();

      expect(update).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    });

    it('cleanedのarchived sessionだけTTL削除する', async () => {
      const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
      const update = vi.fn();
      const remove = vi.fn(async () => true);
      sessionManager.stateStore = {
        get: vi.fn().mockReturnValue({
          sessions: [
            {
              id: 'session-cleaned',
              intendedState: 'archived',
              archivedAt: oldDate,
              archive: { status: 'cleaned' },
              worktree: { repo: '/repo' }
            },
            {
              id: 'session-active',
              intendedState: 'active'
            }
          ]
        }),
        update
      };
      sessionManager.worktreeService = { remove };

      await sessionManager.cleanupArchivedSessions();

      expect(remove).toHaveBeenCalledWith('session-cleaned', '/repo');
      expect(update).toHaveBeenCalledWith({
        sessions: [{ id: 'session-active', intendedState: 'active' }]
      });
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
user     44444  0.0  0.1  ttyd -p 3003 -b /console/session-12345
      `.trim();

      // 動的にコマンドを判定してmock結果を返す
      execPromiseMock.mockImplementation((cmd) => {
        if (cmd.includes('ps aux')) {
          return Promise.resolve({ stdout: psOutput });
        } else if (cmd.includes('kill')) {
          return Promise.resolve({ stdout: '' });
        }
        return Promise.reject(new Error('Unexpected command'));
      });

      await sessionManager.cleanupOrphans();

      expect(execPromiseMock).toHaveBeenCalledWith(expect.stringContaining('kill 44444'));
    });
  });

  describe('sendInput', () => {
    it('allowlisted key は named key 経路で送信する', async () => {
      const sendNamedKeySpy = vi.spyOn(sessionManager, '_sendNamedKey').mockResolvedValue();
      const literalSpy = vi.spyOn(sessionManager, '_sendLiteralText').mockResolvedValue();
      const pasteSpy = vi.spyOn(sessionManager, '_pasteInputFromTempFile').mockResolvedValue();

      await sessionManager.sendInput('session-1', 'Enter', 'key');

      expect(sendNamedKeySpy).toHaveBeenCalledWith('session-1', 'Enter');
      expect(literalSpy).not.toHaveBeenCalled();
      expect(pasteSpy).not.toHaveBeenCalled();
    });

    it('xtermのtext改行はpasteせずEnterキーとして送信する', async () => {
      const sendNamedKeySpy = vi.spyOn(sessionManager, '_sendNamedKey').mockResolvedValue();
      const literalSpy = vi.spyOn(sessionManager, '_sendLiteralText').mockResolvedValue();
      const pasteSpy = vi.spyOn(sessionManager, '_pasteInputFromTempFile').mockResolvedValue();

      await sessionManager.sendInput('session-1', '\r', 'text');

      expect(sendNamedKeySpy).toHaveBeenCalledWith('session-1', 'Enter');
      expect(literalSpy).not.toHaveBeenCalled();
      expect(pasteSpy).not.toHaveBeenCalled();
    });

    it('xtermのtext BackspaceはpasteせずBSpaceキーとして送信する', async () => {
      const sendNamedKeySpy = vi.spyOn(sessionManager, '_sendNamedKey').mockResolvedValue();
      const pasteSpy = vi.spyOn(sessionManager, '_pasteInputFromTempFile').mockResolvedValue();

      await sessionManager.sendInput('session-1', '\x7f', 'text');

      expect(sendNamedKeySpy).toHaveBeenCalledWith('session-1', 'BSpace');
      expect(pasteSpy).not.toHaveBeenCalled();
    });

    it('xtermのtext矢印シーケンスはpasteせずnamed keyとして送信する', async () => {
      const sendNamedKeySpy = vi.spyOn(sessionManager, '_sendNamedKey').mockResolvedValue();
      const pasteSpy = vi.spyOn(sessionManager, '_pasteInputFromTempFile').mockResolvedValue();

      await sessionManager.sendInput('session-1', '\x1b[A', 'text');

      expect(sendNamedKeySpy).toHaveBeenCalledWith('session-1', 'Up');
      expect(pasteSpy).not.toHaveBeenCalled();
    });

    it('allowlist外の key payload は text として扱う', async () => {
      const sendNamedKeySpy = vi.spyOn(sessionManager, '_sendNamedKey').mockResolvedValue();
      const literalSpy = vi.spyOn(sessionManager, '_sendLiteralText').mockResolvedValue();
      const pasteSpy = vi.spyOn(sessionManager, '_pasteInputFromTempFile').mockResolvedValue();
      const oscPayload = '\u001b]11;rgb:0000/0000/0000\u001b\\';

      await sessionManager.sendInput('session-1', oscPayload, 'key');

      expect(sendNamedKeySpy).not.toHaveBeenCalled();
      expect(literalSpy).not.toHaveBeenCalled();
      expect(pasteSpy).toHaveBeenCalledWith('session-1', oscPayload);
    });

    it('短い1行テキストは literal send-keys 経路で送信する', async () => {
      const literalSpy = vi.spyOn(sessionManager, '_sendLiteralText').mockResolvedValue();
      const pasteSpy = vi.spyOn(sessionManager, '_pasteInputFromTempFile').mockResolvedValue();

      await sessionManager.sendInput('session-1', 'hello', 'text');

      expect(literalSpy).toHaveBeenCalledWith('session-1', 'hello');
      expect(pasteSpy).not.toHaveBeenCalled();
    });

    it('codexセッションで1文字ずつ入力されたproject slash commandはEnter時に通常プロンプトへ差し替える', async () => {
      sessionManager.stateStore = {
        get: vi.fn(() => ({
          sessions: [{ id: 'session-1', engine: 'codex' }]
        })),
        update: vi.fn(async (next) => next)
      };
      const sendNamedKeySpy = vi.spyOn(sessionManager, '_sendNamedKey').mockResolvedValue();
      const literalSpy = vi.spyOn(sessionManager, '_sendLiteralText').mockResolvedValue();
      const pasteSpy = vi.spyOn(sessionManager, '_pasteInputFromTempFile').mockResolvedValue();

      for (const char of '/ohayo') {
        await sessionManager.sendInput('session-1', char, 'text');
      }
      sendNamedKeySpy.mockClear();
      literalSpy.mockClear();

      await sessionManager.sendInput('session-1', 'Enter', 'key');

      expect(sendNamedKeySpy).toHaveBeenNthCalledWith(1, 'session-1', 'C-u');
      expect(literalSpy).toHaveBeenCalledWith(
        'session-1',
        'Run the project command /ohayo by following .claude/commands/ohayo.md.'
      );
      expect(sendNamedKeySpy).toHaveBeenNthCalledWith(2, 'session-1', 'Enter');
      expect(pasteSpy).not.toHaveBeenCalled();
    });

    it('codexセッションで1文字ずつ入力されたproject slash commandの引数も通常プロンプトへ渡す', async () => {
      sessionManager.stateStore = {
        get: vi.fn(() => ({
          sessions: [{ id: 'session-1', engine: 'codex' }]
        })),
        update: vi.fn(async (next) => next)
      };
      const sendNamedKeySpy = vi.spyOn(sessionManager, '_sendNamedKey').mockResolvedValue();
      const literalSpy = vi.spyOn(sessionManager, '_sendLiteralText').mockResolvedValue();

      for (const char of '/ohayo --include-calendar') {
        await sessionManager.sendInput('session-1', char, 'text');
      }
      sendNamedKeySpy.mockClear();
      literalSpy.mockClear();

      await sessionManager.sendInput('session-1', '\r', 'text');

      expect(sendNamedKeySpy).toHaveBeenNthCalledWith(1, 'session-1', 'C-u');
      expect(literalSpy).toHaveBeenCalledWith(
        'session-1',
        'Run the project command /ohayo by following .claude/commands/ohayo.md. Arguments: --include-calendar'
      );
      expect(sendNamedKeySpy).toHaveBeenNthCalledWith(2, 'session-1', 'Enter');
    });

    it('codexセッションで1文字ずつ入力されたohayo綴り揺れを通常プロンプトへ正規化する', async () => {
      sessionManager.stateStore = {
        get: vi.fn(() => ({
          sessions: [{ id: 'session-1', engine: 'codex' }]
        })),
        update: vi.fn(async (next) => next)
      };
      const sendNamedKeySpy = vi.spyOn(sessionManager, '_sendNamedKey').mockResolvedValue();
      const literalSpy = vi.spyOn(sessionManager, '_sendLiteralText').mockResolvedValue();

      for (const char of '/oyaho') {
        await sessionManager.sendInput('session-1', char, 'text');
      }
      sendNamedKeySpy.mockClear();
      literalSpy.mockClear();

      await sessionManager.sendInput('session-1', 'Enter', 'key');

      expect(sendNamedKeySpy).toHaveBeenNthCalledWith(1, 'session-1', 'C-u');
      expect(literalSpy).toHaveBeenCalledWith(
        'session-1',
        'Run the project command /ohayo by following .claude/commands/ohayo.md.'
      );
      expect(sendNamedKeySpy).toHaveBeenNthCalledWith(2, 'session-1', 'Enter');
    });

    it('claudeセッションで1文字ずつ入力されたproject slash commandは差し替えない', async () => {
      sessionManager.stateStore = {
        get: vi.fn(() => ({
          sessions: [{ id: 'session-1', engine: 'claude' }]
        })),
        update: vi.fn(async (next) => next)
      };
      const sendNamedKeySpy = vi.spyOn(sessionManager, '_sendNamedKey').mockResolvedValue();
      const literalSpy = vi.spyOn(sessionManager, '_sendLiteralText').mockResolvedValue();

      for (const char of '/ohayo') {
        await sessionManager.sendInput('session-1', char, 'text');
      }
      sendNamedKeySpy.mockClear();
      literalSpy.mockClear();

      await sessionManager.sendInput('session-1', 'Enter', 'key');

      expect(sendNamedKeySpy).toHaveBeenCalledWith('session-1', 'Enter');
      expect(sendNamedKeySpy).not.toHaveBeenCalledWith('session-1', 'C-u');
      expect(literalSpy).not.toHaveBeenCalledWith(
        'session-1',
        'Run the project command /ohayo by following .claude/commands/ohayo.md.'
      );
    });

    it('codexセッションで改行付き一括入力されたproject slash commandも通常プロンプトへ差し替える', async () => {
      sessionManager.stateStore = {
        get: vi.fn(() => ({
          sessions: [{ id: 'session-1', engine: 'codex' }]
        })),
        update: vi.fn(async (next) => next)
      };
      const sendNamedKeySpy = vi.spyOn(sessionManager, '_sendNamedKey').mockResolvedValue();
      const literalSpy = vi.spyOn(sessionManager, '_sendLiteralText').mockResolvedValue();
      const pasteSpy = vi.spyOn(sessionManager, '_pasteInputFromTempFile').mockResolvedValue();

      await sessionManager.sendInput('session-1', '/oyasumi\n', 'text');

      expect(literalSpy).toHaveBeenCalledWith(
        'session-1',
        'Run the project command /oyasumi by following .claude/commands/oyasumi.md.'
      );
      expect(sendNamedKeySpy).toHaveBeenCalledWith('session-1', 'Enter');
      expect(sendNamedKeySpy).not.toHaveBeenCalledWith('session-1', 'C-u');
      expect(pasteSpy).not.toHaveBeenCalled();
    });

    it('フォーカスイベントのみの text 入力はtmuxに送信せず早期returnする', async () => {
      const literalSpy = vi.spyOn(sessionManager, '_sendLiteralText').mockResolvedValue();
      const pasteSpy = vi.spyOn(sessionManager, '_pasteInputFromTempFile').mockResolvedValue();

      await sessionManager.sendInput('session-1', '\x1b[I', 'text');

      expect(literalSpy).not.toHaveBeenCalled();
      expect(pasteSpy).not.toHaveBeenCalled();
    });

    it('フォーカスイベント混入テキストからフォーカス部分を除去して送信する', async () => {
      const literalSpy = vi.spyOn(sessionManager, '_sendLiteralText').mockResolvedValue();

      await sessionManager.sendInput('session-1', 'hello\x1b[Iworld', 'text');

      expect(literalSpy).toHaveBeenCalledWith('session-1', 'helloworld');
    });

    it('bare [I/[O はフォーカスイベントとして除去しない', async () => {
      const literalSpy = vi.spyOn(sessionManager, '_sendLiteralText').mockResolvedValue();
      const pasteSpy = vi.spyOn(sessionManager, '_pasteInputFromTempFile').mockResolvedValue();

      await sessionManager.sendInput('session-1', '[I', 'text');
      await sessionManager.sendInput('session-1', 'hello[Iworld[O', 'text');

      expect(pasteSpy).not.toHaveBeenCalled();
      expect(literalSpy).toHaveBeenCalledTimes(2);
      expect(literalSpy).toHaveBeenCalledWith('session-1', '[I');
      expect(literalSpy).toHaveBeenCalledWith('session-1', 'hello[Iworld[O');
    });

    it('中長文の1行テキストは typing simulation せず即時literal送信する', async () => {
      const typingSpy = vi.spyOn(sessionManager, '_sendSimulatedTyping').mockResolvedValue();
      const literalSpy = vi.spyOn(sessionManager, '_sendLiteralText').mockResolvedValue();
      const pasteSpy = vi.spyOn(sessionManager, '_pasteInputFromTempFile').mockResolvedValue();
      const text = 'CodexやClaude Codeに長文を貼り付けた時も、少しずつではなく即時に送信するためのテキストです。';

      await sessionManager.sendInput('session-1', text, 'text');

      expect(typingSpy).not.toHaveBeenCalled();
      expect(literalSpy).toHaveBeenCalledWith('session-1', text);
      expect(pasteSpy).not.toHaveBeenCalled();
    });

    it('同一sessionの text 入力は並列呼び出しでも FIFO で処理する', async () => {
      const order = [];
      vi.spyOn(sessionManager, '_sendLiteralText').mockImplementation(async (_sessionId, input) => {
        order.push(`start:${input}`);
        if (input === 'a') {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        order.push(`end:${input}`);
      });

      await Promise.all([
        sessionManager.sendInput('session-1', 'a', 'text'),
        sessionManager.sendInput('session-1', 'b', 'text')
      ]);

      expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
    });
  });
});
