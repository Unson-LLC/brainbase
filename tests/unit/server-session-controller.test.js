import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { SessionController } from '../../server/controllers/session-controller.js';

describe('SessionController (Server)', () => {
  let sessionController;
  let mockSessionManager;
  let mockStateStore;
  let mockWorktreeService;
  let mockRes;
  let execPromiseMock;
  let tempDir;

  beforeEach(async () => {
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

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-folder-tree-'));
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
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

  describe('getFolderTree', () => {
    it('ルートフォルダ取得時_nodesを返す', async () => {
      await fs.mkdir(path.join(tempDir, 'src', 'ui'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'README.md'), '# test');

      mockStateStore.get.mockReturnValue({
        sessions: [{ id: 'session-tree', path: tempDir }]
      });

      const req = {
        params: { id: 'session-tree' },
        query: {}
      };

      await sessionController.getFolderTree(req, mockRes);

      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'session-tree',
        rootPath: tempDir,
        baseRelativePath: '',
        nodes: expect.arrayContaining([
          expect.objectContaining({ name: 'src', type: 'directory' }),
          expect.objectContaining({ name: 'README.md', type: 'file' })
        ])
      }));
    });

    it('相対パス指定時_配下ノードを返す', async () => {
      await fs.mkdir(path.join(tempDir, 'src', 'ui'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'src', 'index.js'), 'console.log(1);');

      mockStateStore.get.mockReturnValue({
        sessions: [{ id: 'session-tree', path: tempDir }]
      });

      const req = {
        params: { id: 'session-tree' },
        query: { path: 'src', depth: '1' }
      };

      await sessionController.getFolderTree(req, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        baseRelativePath: 'src',
        nodes: expect.arrayContaining([
          expect.objectContaining({ name: 'ui', type: 'directory', relativePath: 'src/ui' }),
          expect.objectContaining({ name: 'index.js', type: 'file', relativePath: 'src/index.js' })
        ])
      }));
    });

    it('path traversal時_400を返す', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{ id: 'session-tree', path: tempDir }]
      });

      const req = {
        params: { id: 'session-tree' },
        query: { path: '../etc' }
      };

      await sessionController.getFolderTree(req, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Invalid path'
      }));
    });

    it('存在しないセッション時_404を返す', async () => {
      mockStateStore.get.mockReturnValue({ sessions: [] });

      const req = {
        params: { id: 'missing-session' },
        query: {}
      };

      await sessionController.getFolderTree(req, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Session not found'
      }));
    });
  });
});
