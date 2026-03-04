import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionController } from '../../server/controllers/session-controller.js';

describe('SessionController (Server)', () => {
  let sessionController;
  let mockSessionManager;
  let mockStateStore;
  let mockWorktreeService;
  let mockRes;
  let execPromiseMock;

  beforeEach(() => {
    // Mock SessionManager
    mockSessionManager = {
      stopTtyd: vi.fn(),
      cleanupSessionResources: vi.fn(),
      activeSessions: new Map()
    };

    // Mock StateStore
    mockStateStore = {
      get: vi.fn(),
      update: vi.fn()
    };

    // Mock WorktreeService
    mockWorktreeService = {
      getStatus: vi.fn()
    };

    // Create SessionController instance
    sessionController = new SessionController(
      mockSessionManager,
      mockWorktreeService,
      mockStateStore
    );

    // Mock execPromise
    execPromiseMock = vi.fn();
    sessionController.execPromise = execPromiseMock;

    // Mock response object
    mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis()
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('archive', () => {
    it('archive呼び出し後_stopTtydが実行される', async () => {
      const sessionId = 'session-to-archive';

      // Setup state
      const mockState = {
        sessions: [
          { id: sessionId, intendedState: 'active', worktree: null }
        ]
      };
      mockStateStore.get.mockReturnValue(mockState);
      mockStateStore.update.mockResolvedValue({
        ...mockState,
        sessions: [
          { id: sessionId, intendedState: 'archived', archivedAt: expect.any(String) }
        ]
      });

      // Mock stopTtyd
      mockSessionManager.stopTtyd.mockResolvedValue(true);

      const req = {
        params: { id: sessionId },
        body: {}
      };

      await sessionController.archive(req, mockRes);

      // Verify stopTtyd was called (which includes cleanup)
      expect(mockSessionManager.stopTtyd).toHaveBeenCalledWith(sessionId);

      // Verify state was updated to archived
      const updateCall = mockStateStore.update.mock.calls[0][0];
      expect(updateCall.sessions[0].intendedState).toBe('archived');
    });

    it('archive呼び出し時_直接tmux kill-sessionを呼び出さない', async () => {
      const sessionId = 'session-to-archive-2';

      // Setup state
      const mockState = {
        sessions: [
          { id: sessionId, intendedState: 'active' }
        ]
      };
      mockStateStore.get.mockReturnValue(mockState);
      mockStateStore.update.mockResolvedValue({
        ...mockState,
        sessions: [
          { id: sessionId, intendedState: 'archived', archivedAt: expect.any(String) }
        ]
      });

      // Mock stopTtyd
      mockSessionManager.stopTtyd.mockResolvedValue(true);

      const req = {
        params: { id: sessionId },
        body: {}
      };

      await sessionController.archive(req, mockRes);

      // Verify archive() doesn't call execPromise directly (tmux cleanup is delegated to stopTtyd)
      expect(execPromiseMock).not.toHaveBeenCalled();
    });
  });
});
