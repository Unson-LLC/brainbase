import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

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
  let SessionManager;
  let manager;

  beforeEach(async () => {
    spawnMock.mockReset();

    ({ SessionManager } = await import('../../server/services/session-manager.js'));

    manager = new SessionManager({
      serverDir: '/tmp',
      execPromise: async () => ({ stdout: '' }),
      stateStore: createStateStore(),
      worktreeService: {},
      uiPort: 3000
    });

    manager.findFreePort = vi.fn().mockResolvedValue(40000);
    manager._saveTtydProcessInfo = vi.fn().mockResolvedValue();
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

    vi.useFakeTimers();

    const startPromise = manager.startTtyd({
      sessionId: 'session-1',
      cwd: '/tmp',
      initialCommand: '',
      engine: 'claude'
    });

    await vi.runAllTimersAsync();
    await startPromise;

    vi.useRealTimers();

    const [, , spawnOptions] = spawnMock.mock.calls[0];
    expect(spawnOptions.env.BRAINBASE_PORT).toBe('3000');
  });
});
