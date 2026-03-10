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
      clearDoneStatus: vi.fn(),
      reportActivity: vi.fn(),
      resolveSessionWorkspacePath: vi.fn(async (sessionOrId) => {
        if (typeof sessionOrId === 'string') {
          const state = mockStateStore.get();
          const session = state.sessions?.find(s => s.id === sessionOrId);
          return session?.worktree?.path || session?.path || null;
        }
        return sessionOrId?.worktree?.path || sessionOrId?.path || null;
      }),
      activeSessions: new Map()
    };

    // Mock StateStore
    mockStateStore = {
      get: vi.fn(),
      update: vi.fn()
    };

    // Mock WorktreeService
    mockWorktreeService = {
      getStatus: vi.fn(),
      autoHealArchiveState: vi.fn()
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

    it('safeなself-heal後は確認なしでarchiveを続行する', async () => {
      const sessionId = 'session-safe-heal';
      const mockState = {
        sessions: [
          {
            id: sessionId,
            intendedState: 'active',
            worktree: {
              repo: '/tmp/repo',
              path: '/tmp/worktrees/session-safe-heal-repo',
              startCommit: 'abc123'
            }
          }
        ]
      };
      mockStateStore.get.mockReturnValue(mockState);
      mockStateStore.update.mockResolvedValue(mockState);
      mockSessionManager.stopTtyd.mockResolvedValue(true);
      mockWorktreeService.getStatus.mockResolvedValue({
        needsIntegration: true,
        needsMerge: true,
        changesNotPushed: 0,
        hasWorkingCopyChanges: true
      });
      mockWorktreeService.autoHealArchiveState.mockResolvedValue({
        attempted: true,
        healed: true,
        reason: 'healed',
        actions: ['reset-working-copy:session/session-safe-heal'],
        statusAfter: {
          needsIntegration: false,
          needsMerge: false,
          changesNotPushed: 0,
          hasWorkingCopyChanges: false
        }
      });

      const req = {
        params: { id: sessionId },
        body: {}
      };

      await sessionController.archive(req, mockRes);

      expect(mockWorktreeService.autoHealArchiveState).toHaveBeenCalledWith(
        sessionId,
        '/tmp/repo',
        '/tmp/worktrees/session-safe-heal-repo',
        'abc123'
      );
      expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    });

    it('self-healで解消できない場合は従来どおり確認レスポンスを返す', async () => {
      const sessionId = 'session-unsafe-heal';
      mockStateStore.get.mockReturnValue({
        sessions: [
          {
            id: sessionId,
            intendedState: 'active',
            worktree: {
              repo: '/tmp/repo',
              path: '/tmp/worktrees/session-unsafe-heal-repo',
              startCommit: 'abc123'
            }
          }
        ]
      });
      mockWorktreeService.getStatus.mockResolvedValue({
        needsIntegration: true,
        needsMerge: true,
        changesNotPushed: 0,
        hasWorkingCopyChanges: true,
        bookmarkName: sessionId,
        bookmarkPushed: false
      });
      mockWorktreeService.autoHealArchiveState.mockResolvedValue({
        attempted: false,
        healed: false,
        reason: 'working_copy_differs',
        actions: [],
        statusAfter: {
          needsIntegration: true,
          needsMerge: true,
          changesNotPushed: 0,
          hasWorkingCopyChanges: true,
          bookmarkName: sessionId,
          bookmarkPushed: false
        }
      });

      const req = {
        params: { id: sessionId },
        body: {}
      };

      await sessionController.archive(req, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        needsConfirmation: true,
        status: expect.objectContaining({
          autoHealApplied: false,
          autoHealReason: 'working_copy_differs'
        })
      }));
      expect(mockSessionManager.stopTtyd).not.toHaveBeenCalled();
    });
  });

  describe('clearDone', () => {
    it('clearDone呼び出し時_clearDoneStatusが実行される', async () => {
      const req = {
        params: { id: 'session-1' }
      };

      await sessionController.clearDone(req, mockRes);

      expect(mockSessionManager.clearDoneStatus).toHaveBeenCalledWith('session-1');
      expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    });

    it('clearDone呼び出し時_id未指定_400を返す', async () => {
      const req = {
        params: { id: '' }
      };

      await sessionController.clearDone(req, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Session ID is required' });
      expect(mockSessionManager.clearDoneStatus).not.toHaveBeenCalled();
    });
  });

  describe('reportActivity', () => {
    it('reportActivity呼び出し時_lifecycle関連フィールドをSessionManagerへ渡す', async () => {
      const req = {
        body: {
          sessionId: 'session-1',
          status: 'working',
          reportedAt: 1234567890,
          lifecycle: 'turn_started',
          eventType: 'agent-turn-start',
          turnId: 'turn-1'
        }
      };

      await sessionController.reportActivity(req, mockRes);

      expect(mockSessionManager.reportActivity).toHaveBeenCalledWith(
        'session-1',
        'working',
        1234567890,
        {
          lifecycle: 'turn_started',
          eventType: 'agent-turn-start',
          turnId: 'turn-1'
        }
      );
      expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('getContext', () => {
    it('worktreeセッション時_currentDirectoryを含むコンテキストを返す', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-ctx',
          name: 'Context Session',
          engine: 'codex',
          cwd: '/tmp/worktrees/session-ctx/project/src',
          worktree: {
            repo: '/Users/ksato/workspace/code/brainbase',
            path: '/tmp/worktrees/session-ctx/project',
            startCommit: 'abc123'
          }
        }]
      });

      mockWorktreeService.getStatus.mockResolvedValue({
        repoName: 'brainbase',
        bookmarkName: 'session-ctx',
        changesNotPushed: 2,
        hasWorkingCopyChanges: false,
        bookmarkPushed: true,
        mainBranch: 'develop',
        worktreePath: '/tmp/worktrees/session-ctx/project'
      });

      const req = {
        params: { id: 'session-ctx' }
      };

      await sessionController.getContext(req, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'session-ctx',
        repoPath: '/Users/ksato/workspace/code/brainbase',
        workspacePath: '/tmp/worktrees/session-ctx/project',
        currentDirectory: '/tmp/worktrees/session-ctx/project/src',
        dirty: true,
        prStatus: 'open_or_pending',
        baseBranch: 'develop'
      }));
    });

    it('通常セッション時_currentDirectoryはworkspacePathへフォールバックする', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-plain',
          name: 'Plain Session',
          path: '/Users/ksato/workspace/code/brainbase'
        }]
      });

      const req = {
        params: { id: 'session-plain' }
      };

      await sessionController.getContext(req, mockRes);

      expect(mockWorktreeService.getStatus).not.toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'session-plain',
        repoPath: null,
        workspacePath: '/Users/ksato/workspace/code/brainbase',
        currentDirectory: '/Users/ksato/workspace/code/brainbase'
      }));
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
