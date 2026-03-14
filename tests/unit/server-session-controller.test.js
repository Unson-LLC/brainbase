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
    vi.useRealTimers();

    // Mock SessionManager
    mockSessionManager = {
      stopTtyd: vi.fn(),
      startTtyd: vi.fn(),
      cleanupSessionResources: vi.fn(),
      clearDoneStatus: vi.fn(),
      reportActivity: vi.fn(),
      getSessionById: vi.fn(),
      ensureTerminalOwnership: vi.fn(),
      forceTerminalOwnership: vi.fn(),
      getTerminalAccessState: vi.fn(),
      releaseTerminalOwnership: vi.fn(),
      _isProcessRunning: vi.fn(),
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
      create: vi.fn(),
      remove: vi.fn(),
      getStatus: vi.fn(),
      autoHealArchiveState: vi.fn(),
      _isJujutsuRepo: vi.fn()
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
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('start', () => {
    it('短時間の連続start呼び出し時_takeoverせず既存proxyを返す', async () => {
      const sessionId = 'session-hot';
      mockStateStore.get.mockReturnValue({
        sessions: [{ id: sessionId, path: '/tmp/session-hot', intendedState: 'active' }]
      });
      mockSessionManager._isProcessRunning.mockReturnValue(true);
      mockSessionManager.startTtyd.mockResolvedValue({
        port: 40100,
        proxyPath: `/console/${sessionId}`
      });
      mockSessionManager.ensureTerminalOwnership.mockReturnValue({
        allowed: true,
        terminalAccess: {
          state: 'owner',
          ownerViewerLabel: 'Local / Mac',
          ownerLastSeenAt: null,
          canTakeover: false
        }
      });
      mockSessionManager.forceTerminalOwnership.mockReturnValue({
        allowed: true,
        terminalAccess: {
          state: 'owner',
          ownerViewerLabel: 'Local / Mac',
          ownerLastSeenAt: null,
          canTakeover: false
        }
      });
      mockSessionManager.activeSessions.set(sessionId, {
        port: 40100,
        pid: 99999,
        process: { pid: 99999 }
      });
      sessionController._recentSessionStarts.set(sessionId, Date.now() - 1000);

      const req = {
        body: { sessionId, viewerId: 'viewer-1' },
        headers: { referer: 'https://brain-base.work/', 'user-agent': 'Mozilla/5.0' }
      };

      await sessionController.start(req, mockRes);

      expect(mockSessionManager.stopTtyd).not.toHaveBeenCalled();
      expect(mockSessionManager.startTtyd).not.toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        port: 40100,
        proxyPath: `/console/${sessionId}/?viewerId=viewer-1`,
        startedExisting: true,
        takeoverSkipped: true,
        terminalAccess: {
          state: 'owner',
          ownerViewerLabel: 'Local / Mac',
          ownerLastSeenAt: null,
          canTakeover: false
        }
      });
    });

    it('cooldown経過後のstart呼び出し時_takeoverして再起動する', async () => {
      const sessionId = 'session-restart';
      mockStateStore.get.mockReturnValue({
        sessions: [{ id: sessionId, path: '/tmp/session-restart', intendedState: 'active', engine: 'codex' }]
      });
      mockStateStore.update.mockResolvedValue({ sessions: [{ id: sessionId, intendedState: 'active', engine: 'codex' }] });
      mockSessionManager._isProcessRunning.mockReturnValue(true);
      mockSessionManager.stopTtyd.mockResolvedValue(true);
      mockSessionManager.startTtyd.mockResolvedValue({
        port: 40101,
        proxyPath: `/console/${sessionId}`
      });
      mockSessionManager.ensureTerminalOwnership.mockReturnValue({
        allowed: true,
        terminalAccess: {
          state: 'owner',
          ownerViewerLabel: 'Local / Mac',
          ownerLastSeenAt: null,
          canTakeover: false
        }
      });
      mockSessionManager.forceTerminalOwnership.mockReturnValue({
        allowed: true,
        terminalAccess: {
          state: 'owner',
          ownerViewerLabel: 'Local / Mac',
          ownerLastSeenAt: null,
          canTakeover: false
        }
      });
      mockSessionManager.activeSessions.set(sessionId, {
        port: 40100,
        pid: 99998,
        process: { pid: 99998 }
      });
      sessionController._recentSessionStarts.set(sessionId, Date.now() - 6000);

      const req = {
        body: { sessionId, engine: 'codex', viewerId: 'viewer-1', forceTakeover: true },
        headers: { referer: 'http://localhost:31013/', 'user-agent': 'Mozilla/5.0' }
      };

      await sessionController.start(req, mockRes);

      expect(mockSessionManager.stopTtyd).toHaveBeenCalledWith(sessionId, { preserveTmux: true });
      expect(mockSessionManager.startTtyd).toHaveBeenCalledWith(expect.objectContaining({
        sessionId,
        cwd: '/tmp/session-restart',
        engine: 'codex'
      }));
      expect(mockRes.json).toHaveBeenCalledWith({
        port: 40101,
        proxyPath: `/console/${sessionId}/?viewerId=viewer-1`,
        terminalAccess: {
          state: 'owner',
          ownerViewerLabel: 'Local / Mac',
          ownerLastSeenAt: null,
          canTakeover: false
        }
      });
    });

    it('別viewerのstart呼び出し時_409 blockedを返す', async () => {
      const sessionId = 'session-blocked';
      mockStateStore.get.mockReturnValue({
        sessions: [{ id: sessionId, path: '/tmp/session-blocked', intendedState: 'active' }]
      });
      mockSessionManager.ensureTerminalOwnership.mockReturnValue({
        allowed: false,
        terminalAccess: {
          state: 'blocked',
          ownerViewerLabel: 'Cloudflare / Mac',
          ownerLastSeenAt: '2026-03-11T00:00:00.000Z',
          canTakeover: true
        }
      });

      const req = {
        body: { sessionId, viewerId: 'viewer-2' },
        headers: { referer: 'http://localhost:31013/', 'user-agent': 'Mozilla/5.0' }
      };

      await sessionController.start(req, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockSessionManager.startTtyd).not.toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Session is already open in another viewer',
        code: 'SESSION_OWNED_BY_OTHER_VIEWER',
        terminalAccess: {
          state: 'blocked',
          ownerViewerLabel: 'Cloudflare / Mac',
          ownerLastSeenAt: '2026-03-11T00:00:00.000Z',
          canTakeover: true
        }
      });
    });
  });

  describe('getRuntime', () => {
    it('稼働中セッションのruntimeStatusを返す', async () => {
      const sessionId = 'session-runtime';
      mockSessionManager.getSessionById.mockReturnValue({
        id: sessionId,
        runtimeStatus: {
          ttydRunning: true,
          needsRestart: false,
          proxyPath: `/console/${sessionId}`,
          port: 40123
        }
      });
      mockSessionManager.ensureTerminalOwnership.mockReturnValue({
        allowed: true,
        terminalAccess: {
          state: 'owner',
          ownerViewerLabel: 'Local / Mac',
          ownerLastSeenAt: null,
          canTakeover: false
        }
      });

      await sessionController.getRuntime({
        params: { id: sessionId },
        query: { viewerId: 'viewer-1', viewerLabel: 'Local / Mac' },
        headers: {}
      }, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        sessionId,
        runtimeStatus: {
          ttydRunning: true,
          needsRestart: false,
          proxyPath: `/console/${sessionId}/?viewerId=viewer-1`,
          port: 40123
        },
        terminalAccess: {
          state: 'owner',
          ownerViewerLabel: 'Local / Mac',
          ownerLastSeenAt: null,
          canTakeover: false
        }
      });
    });

    it('存在しないセッションのruntime取得時_404を返す', async () => {
      mockSessionManager.getSessionById.mockReturnValue(null);

      await sessionController.getRuntime({ params: { id: 'missing' }, query: { viewerId: 'viewer-1' }, headers: {} }, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Session not found' });
    });

    it('viewerIdなしのruntime取得時_400を返す', async () => {
      await sessionController.getRuntime({ params: { id: 'session-1' }, query: {}, headers: {} }, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'viewerId is required' });
    });
  });

  describe('createWithWorktree', () => {
    it('staleなrepoPath時_jj repoを優先してfallbackする', async () => {
      const projectsRoot = path.join(tempDir, 'projects');
      const codeProjectsRoot = path.join(tempDir, 'code');
      const staleRepoPath = path.join(projectsRoot, 'tech-knight');
      const fallbackRepoPath = path.join(projectsRoot, 'techknight');
      const gitOnlyRepoPath = path.join(codeProjectsRoot, 'tech-knight');
      const controller = new SessionController(
        mockSessionManager,
        mockWorktreeService,
        mockStateStore,
        { projectsRoot, codeProjectsRoot }
      );

      await fs.mkdir(fallbackRepoPath, { recursive: true });
      await fs.mkdir(gitOnlyRepoPath, { recursive: true });

      mockStateStore.get.mockReturnValue({ sessions: [] });
      mockStateStore.update.mockResolvedValue({ sessions: [] });
      mockSessionManager.startTtyd.mockResolvedValue({
        port: 40124,
        proxyPath: '/console/session-new'
      });
      mockSessionManager.forceTerminalOwnership.mockReturnValue({
        terminalAccess: {
          state: 'owner',
          ownerViewerLabel: 'Local / Mac',
          ownerLastSeenAt: null,
          canTakeover: false
        }
      });
      mockWorktreeService._isJujutsuRepo.mockImplementation(async (candidate) => candidate === fallbackRepoPath);
      mockWorktreeService.create.mockResolvedValue({
        worktreePath: '/tmp/worktrees/session-new-techknight',
        branchName: 'session/session-new',
        startCommit: 'abc123'
      });

      const req = {
        body: {
          sessionId: 'session-new',
          repoPath: staleRepoPath,
          name: 'New Session',
          engine: 'codex',
          project: 'tech-knight',
          viewerId: 'viewer-1'
        },
        headers: {
          referer: 'http://localhost:31013/',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
        }
      };

      await controller.createWithWorktree(req, mockRes);

      expect(mockWorktreeService.create).toHaveBeenCalledWith(
        'session-new',
        fallbackRepoPath,
        { skipFetch: true }
      );
      expect(mockSessionManager.startTtyd).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'session-new',
        cwd: '/tmp/worktrees/session-new-techknight',
        engine: 'codex'
      }));
      expect(mockStateStore.update).toHaveBeenCalledWith(expect.objectContaining({
        sessions: expect.arrayContaining([
          expect.objectContaining({
            id: 'session-new',
            worktree: expect.objectContaining({
              repo: fallbackRepoPath,
              path: '/tmp/worktrees/session-new-techknight'
            })
          })
        ])
      }));
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        proxyPath: '/console/session-new/?viewerId=viewer-1'
      }));
    });
  });

  describe('releaseTerminal', () => {
    it('viewerId一致時_releaseTerminalOwnershipを呼ぶ', async () => {
      mockSessionManager.releaseTerminalOwnership.mockReturnValue(true);
      mockSessionManager.getTerminalAccessState.mockReturnValue({
        state: 'available',
        ownerViewerLabel: null,
        ownerLastSeenAt: null,
        canTakeover: false
      });

      await sessionController.releaseTerminal({
        params: { id: 'session-1' },
        body: { viewerId: 'viewer-1' }
      }, mockRes);

      expect(mockSessionManager.releaseTerminalOwnership).toHaveBeenCalledWith('session-1', 'viewer-1');
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        terminalAccess: {
          state: 'available',
          ownerViewerLabel: null,
          ownerLastSeenAt: null,
          canTakeover: false
        }
      });
    });
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

  describe('restore', () => {
    it('repo再作成に失敗しても既存workspaceが残っていれば復元を継続する', async () => {
      const sessionId = 'session-restore-fallback';
      const workspacePath = path.join(tempDir, 'restore-workspace');
      await fs.mkdir(workspacePath, { recursive: true });

      mockStateStore.get.mockReturnValue({
        sessions: [
          {
            id: sessionId,
            path: workspacePath,
            initialCommand: 'echo hi',
            engine: 'claude',
            intendedState: 'archived',
            worktree: {
              repo: '/missing/repo',
              path: workspacePath
            }
          }
        ]
      });
      mockWorktreeService.create = vi.fn().mockRejectedValue(new Error('Directory does not exist: /missing/repo'));
      mockSessionManager.startTtyd.mockResolvedValue({
        port: 40100,
        proxyPath: `/console/${sessionId}`
      });
      mockStateStore.update.mockResolvedValue({
        sessions: [
          {
            id: sessionId,
            path: workspacePath,
            intendedState: 'active'
          }
        ]
      });

      await sessionController.restore({
        params: { id: sessionId },
        body: {}
      }, mockRes);

      expect(mockSessionManager.startTtyd).toHaveBeenCalledWith({
        sessionId,
        cwd: workspacePath,
        initialCommand: 'echo hi',
        engine: 'claude'
      });
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        port: 40100,
        proxyPath: `/console/${sessionId}`
      });
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

  describe('getUiSummaries', () => {
    it('session ごとの lightweight summary map を返す', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-ui',
          cwd: '/tmp/worktrees/session-ui/project/src',
          worktree: {
            repo: '/tmp/repo',
            path: '/tmp/worktrees/session-ui/project',
            startCommit: 'abc123'
          }
        }]
      });
      mockWorktreeService.getStatus.mockResolvedValue({
        repoName: 'brainbase',
        changesNotPushed: 3,
        hasWorkingCopyChanges: true,
        bookmarkPushed: true,
        mainBranch: 'develop',
        worktreePath: '/tmp/worktrees/session-ui/project'
      });

      const req = {
        query: {}
      };

      await sessionController.getUiSummaries(req, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        'session-ui': expect.objectContaining({
          repo: 'brainbase',
          baseBranch: 'develop',
          dirty: true,
          changesNotPushed: 3,
          prStatus: 'open_or_pending',
          currentDirectory: '/tmp/worktrees/session-ui/project/src'
        })
      });
    });

    it('TTL 内は cached summary を再利用する', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-ui',
          path: '/tmp/project'
        }]
      });

      const req = { query: {} };

      await sessionController.getUiSummaries(req, mockRes);
      await sessionController.getUiSummaries(req, mockRes);

      expect(mockSessionManager.resolveSessionWorkspacePath).toHaveBeenCalledTimes(1);
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
