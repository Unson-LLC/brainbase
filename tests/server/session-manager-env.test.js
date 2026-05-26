import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionServices } from '../../server/services/create-session-services.js';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn()
}));

vi.mock('child_process', () => ({
  spawn: spawnMock,
  default: { spawn: spawnMock }
}));

const createStateStore = () => {
  let state = {
    sessions: [{ id: 'session-1' }]
  };

  return {
    get: () => state,
    update: async (next) => {
      state = next;
      return state;
    }
  };
};

describe('SessionManager env', () => {
  let manager;

  beforeEach(async () => {
    spawnMock.mockReset();

    manager = createSessionServices({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore: createStateStore(),
      worktreeService: {},
      uiPort: 31013
    }).sessionApi;

    manager.findFreePort = vi.fn().mockResolvedValue(40000);
    manager._saveTtydProcessInfo = vi.fn().mockResolvedValue();
    manager.waitForTtydReady = vi.fn().mockResolvedValue();
  });

  it('startTtyd呼び出し時_BRAINBASE_PORTが環境変数に設定される', async () => {
    const mockProcess = {
      pid: 12345,
      unref: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn()
    };
    spawnMock.mockReturnValue(mockProcess);

    await manager.startTtyd({
      sessionId: 'session-1',
      cwd: '/tmp',
      initialCommand: '',
      engine: 'claude'
    });

    const [, , spawnOptions] = spawnMock.mock.calls[0];
    expect(spawnOptions.env.BRAINBASE_PORT).toBe('31013');
  });

  it('Codex App Server起動時_BRAINBASE_CODEX_APP_SERVERが環境変数に設定される', async () => {
    const mockProcess = {
      pid: 12345,
      unref: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn()
    };
    spawnMock.mockReturnValue(mockProcess);

    await manager.startTtyd({
      sessionId: 'session-1',
      cwd: '/tmp',
      initialCommand: '',
      engine: 'codex',
      codexAppServer: true
    });

    const [, , spawnOptions] = spawnMock.mock.calls[0];
    expect(spawnOptions.env.BRAINBASE_CODEX_APP_SERVER).toBe('1');
  });

  it('Claude Code起動時はCodex App Server要求があっても環境変数に設定しない', async () => {
    const mockProcess = {
      pid: 12345,
      unref: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn()
    };
    spawnMock.mockReturnValue(mockProcess);

    await manager.startTtyd({
      sessionId: 'session-1',
      cwd: '/tmp',
      initialCommand: '',
      engine: 'claude',
      codexAppServer: true
    });

    const [, , spawnOptions] = spawnMock.mock.calls[0];
    expect(spawnOptions.env.BRAINBASE_CODEX_APP_SERVER).toBeUndefined();
  });

  it('legacy Codex起動時は明示要求なしならCodex App Server環境変数に設定しない', async () => {
    const mockProcess = {
      pid: 12345,
      unref: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn()
    };
    spawnMock.mockReturnValue(mockProcess);

    await manager.startTtyd({
      sessionId: 'session-1',
      cwd: '/tmp',
      initialCommand: '',
      engine: 'codex',
      codexAppServer: false
    });

    const [, , spawnOptions] = spawnMock.mock.calls[0];
    expect(spawnOptions.env.BRAINBASE_CODEX_APP_SERVER).toBeUndefined();
  });
});
