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

  const buildControllerDeps = (overrides = {}) => ({
    activity: {
      reportActivity: mockSessionManager.reportActivity,
      getSessionStatus: mockSessionManager.getSessionStatus,
      clearDoneStatus: mockSessionManager.clearDoneStatus
    },
    ownership: {
      ensureTerminalOwnership: mockSessionManager.ensureTerminalOwnership,
      forceTerminalOwnership: mockSessionManager.forceTerminalOwnership,
      getTerminalAccessState: mockSessionManager.getTerminalAccessState,
      releaseTerminalOwnership: mockSessionManager.releaseTerminalOwnership
    },
    workspace: {
      resolveSessionWorkspacePath: mockSessionManager.resolveSessionWorkspacePath
    },
    runtimeQuery: {
      getRuntimeStatus: mockSessionManager.getRuntimeStatus,
      getSessionById: mockSessionManager.getSessionById,
      _isXtermOnlyMode: mockSessionManager._isXtermOnlyMode,
      _isProcessRunning: mockSessionManager._isProcessRunning
    },
    runtimeLifecycle: {
      startTtyd: mockSessionManager.startTtyd,
      stopTtyd: mockSessionManager.stopTtyd,
      ensureSessionRuntime: mockSessionManager.ensureSessionRuntime,
      ensureTtydForActiveSession: mockSessionManager.ensureTtydForActiveSession
    },
    runtimeRegistry: {
      activeSessions: mockSessionManager.activeSessions,
      getSession: mockSessionManager.getObservedRuntime
    },
    runtimeReconciler: {
      reconcile: mockSessionManager.reconcileTerminalRuntime
    },
    terminalIo: {
      sendInput: mockSessionManager.sendInput,
      repairCollapsedSessionWindow: mockSessionManager.repairCollapsedSessionWindow,
      scrollSession: mockSessionManager.scrollSession,
      selectPane: mockSessionManager.selectPane,
      exitCopyMode: mockSessionManager.exitCopyMode
    },
    terminalInputProbe: {
      probe: mockSessionManager.probeTerminalInput
    },
    snapshot: {
      getContent: mockSessionManager.getContent,
      getVisibleContent: mockSessionManager.getVisibleContent,
      getContentWithColors: mockSessionManager.getContentWithColors,
      getVisibleContentWithColors: mockSessionManager.getVisibleContentWithColors,
      getCursorPosition: mockSessionManager.getCursorPosition,
      getPaneMode: mockSessionManager.getPaneMode,
      getOutput: mockSessionManager.getOutput
    },
    worktreeService: mockWorktreeService,
    stateStore: mockStateStore,
    ...overrides
  });

  beforeEach(async () => {
    vi.useRealTimers();

    // Mock SessionManager
    mockSessionManager = {
      stopTtyd: vi.fn(),
      startTtyd: vi.fn(),
      ensureSessionRuntime: vi.fn(),
      ensureTtydForActiveSession: vi.fn(),
      cleanupSessionResources: vi.fn(),
      clearDoneStatus: vi.fn(),
      reportActivity: vi.fn(),
      getSessionById: vi.fn(),
      ensureTerminalOwnership: vi.fn(),
      forceTerminalOwnership: vi.fn(),
      getTerminalAccessState: vi.fn(),
      getObservedRuntime: vi.fn(),
      reconcileTerminalRuntime: vi.fn(),
      probeTerminalInput: vi.fn(),
      releaseTerminalOwnership: vi.fn(),
      sendInput: vi.fn(),
      repairCollapsedSessionWindow: vi.fn(async () => ({
        repaired: false,
        paneSize: { cols: 80, rows: 24 },
        reason: 'pane-size-ok'
      })),
      scrollSession: vi.fn(),
      selectPane: vi.fn(),
      exitCopyMode: vi.fn(),
      getContent: vi.fn(),
      getVisibleContent: vi.fn(),
      getContentWithColors: vi.fn(async () => null),
      getVisibleContentWithColors: vi.fn(async () => null),
      getCursorPosition: vi.fn(async () => null),
      getPaneMode: vi.fn(),
      getOutput: vi.fn(),
      isTmuxSessionRunning: vi.fn(),
      _isXtermOnlyMode: vi.fn(() => false),
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
      merge: vi.fn(),
      getStatus: vi.fn(),
      getMergeDeploymentGuardStatus: vi.fn(async () => ({ ready: true })),
      autoHealArchiveState: vi.fn(),
      _isJujutsuRepo: vi.fn()
    };

    // Create SessionController instance
    sessionController = new SessionController(buildControllerDeps());

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
      mockSessionManager.getTerminalAccessState.mockReturnValue({
        state: 'owner',
        ownerViewerLabel: 'Local / Mac',
        ownerLastSeenAt: null,
        canTakeover: false
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
        engine: 'codex'
      }));
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        port: 40101,
        proxyPath: `/console/${sessionId}/?viewerId=viewer-1`,
        terminalAccess: {
          state: 'owner',
          ownerViewerLabel: 'Local / Mac',
          ownerLastSeenAt: null,
          canTakeover: false
        }
      }));
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

    it('pending startup shellのstart時_409を返しttydを起動しない', async () => {
      const sessionId = 'session-start-pending-shell';
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: sessionId,
          path: '/tmp/canonical-repo',
          intendedState: 'active',
          startupStatus: 'pending',
          startupPhase: 'worktree',
          startupMessage: 'ワークスペースを準備中...'
        }]
      });

      await sessionController.start({
        body: { sessionId, viewerId: 'viewer-1' },
        headers: { referer: 'http://localhost:31013/', 'user-agent': 'Mozilla/5.0' }
      }, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockSessionManager.ensureTerminalOwnership).not.toHaveBeenCalled();
      expect(mockSessionManager.resolveSessionWorkspacePath).not.toHaveBeenCalled();
      expect(mockSessionManager.startTtyd).not.toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Session startup is not ready for terminal runtime.',
        startupStatus: 'pending',
        startupPhase: 'worktree',
        startupMessage: 'ワークスペースを準備中...'
      });
    });
  });

  describe('merge', () => {
    it('INV-1/S-1: merge後も同じsessionを維持してactive workspace generationへruntimeを切り替える', async () => {
      const sessionId = 'session-rotate';
      const originalSession = {
        id: sessionId,
        name: 'Rotate session',
        path: '/tmp/worktrees/session-rotate-g1-brainbase',
        initialCommand: 'continue work',
        engine: 'codex',
        intendedState: 'active',
        activeWorkspaceId: 'session-rotate-g1',
        conversationSummary: {
          codexThreadId: '019e2e89-b776-71f1-9a5a-c3ecacd0c24a',
          lastConversation: {
            engine: 'codex',
            conversationId: '2026-05-16T11-07-17-019e2e89-b776-71f1-9a5a-c3ecacd0c24a'
          }
        },
        worktree: {
          repo: '/tmp/repo',
          path: '/tmp/worktrees/session-rotate-g1-brainbase',
          branch: 'session/session-rotate-g1',
          workspaceId: 'session-rotate-g1',
          generation: 1,
          startCommit: 'base1'
        },
        workspaceHistory: []
      };
      mockStateStore.get.mockReturnValue({ sessions: [originalSession] });
      mockStateStore.update.mockImplementation(async (nextState) => {
        mockStateStore.get.mockReturnValue(nextState);
        return nextState;
      });
      mockWorktreeService.merge.mockResolvedValue({
        success: true,
        prUrl: 'https://github.com/Unson-LLC/brainbase-unson/pull/999',
        mergedAt: '2026-05-16T08:00:00Z',
        mergeCommit: 'merge123',
        rotation: {
          retired: {
            workspaceId: 'session-rotate-g1',
            generation: 1,
            path: '/tmp/worktrees/session-rotate-g1-brainbase',
            branch: 'session/session-rotate-g1',
            mergedPrUrl: 'https://github.com/Unson-LLC/brainbase-unson/pull/999',
            mergedAt: '2026-05-16T08:00:00Z',
            mergeCommit: 'merge123',
            retiredAt: '2026-05-16T08:00:01Z'
          },
          active: {
            workspaceId: 'session-rotate-g2',
            generation: 2,
            repo: '/tmp/repo',
            path: '/tmp/worktrees/session-rotate-g2-brainbase',
            branch: 'session/session-rotate-g2',
            startCommit: 'base2'
          }
        }
      });
      mockSessionManager.stopTtyd.mockResolvedValue(true);
      mockSessionManager.startTtyd.mockResolvedValue({
        port: 40123,
        proxyPath: `/console/${sessionId}`
      });

      await sessionController.merge({ params: { id: sessionId } }, mockRes);

      expect(mockWorktreeService.merge).toHaveBeenCalledWith(
        sessionId,
        '/tmp/repo',
        'Rotate session',
        {
          workspaceId: 'session-rotate-g1',
          generation: 1,
          workspacePath: '/tmp/worktrees/session-rotate-g1-brainbase',
          rotateAfterMerge: true
        }
      );
      const finalState = mockStateStore.get();
      expect(finalState.sessions[0]).toMatchObject({
        id: sessionId,
        intendedState: 'active',
        activeWorkspaceId: 'session-rotate-g2',
        workspaceRotationStatus: 'ready',
        merged: true,
        mergedPrUrl: 'https://github.com/Unson-LLC/brainbase-unson/pull/999',
        codexThreadId: '019e2e89-b776-71f1-9a5a-c3ecacd0c24a',
        bindingSource: 'workspace-rotation',
        worktree: {
          workspaceId: 'session-rotate-g2',
          generation: 2,
          path: '/tmp/worktrees/session-rotate-g2-brainbase',
          branch: 'session/session-rotate-g2'
        }
      });
      expect(finalState.sessions[0].workspaceHistory).toHaveLength(1);
      expect(mockSessionManager.startTtyd).toHaveBeenCalledWith({
        sessionId,
        cwd: '/tmp/worktrees/session-rotate-g2-brainbase',
        initialCommand: 'continue work',
        engine: 'codex',
        codexResumeId: '019e2e89-b776-71f1-9a5a-c3ecacd0c24a'
      });
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        port: 40123,
        proxyPath: `/console/${sessionId}`
      }));
    });
  });

  describe('sendInput', () => {
    it('INV-3: workspace generation切替中はterminal入力をruntimeへ送らない', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-rotating',
          workspaceRotationStatus: 'rotating'
        }]
      });

      await sessionController.sendInput({
        params: { id: 'session-rotating' },
        body: { input: 'echo stale', type: 'text' }
      }, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Session workspace generation is rotating',
        rotating: true
      });
      expect(mockSessionManager.sendInput).not.toHaveBeenCalled();
    });

    it('INV-3: workspace generation切替失敗でblockedの場合もterminal入力をruntimeへ送らない', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-blocked',
          workspaceRotationStatus: 'blocked',
          workspaceRotationError: 'Merged PR but workspace generation rotation failed'
        }]
      });

      await sessionController.sendInput({
        params: { id: 'session-blocked' },
        body: { input: 'echo blocked', type: 'text' }
      }, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Merged PR but workspace generation rotation failed',
        rotationBlocked: true
      });
      expect(mockSessionManager.sendInput).not.toHaveBeenCalled();
    });

    it('pending startup shellのsendInput時_409を返しterminalへ送らない', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-input-pending',
          startupStatus: 'pending',
          startupPhase: 'worktree',
          startupMessage: 'ワークスペースを準備中...'
        }]
      });

      await sessionController.sendInput({
        params: { id: 'session-input-pending' },
        body: { input: 'echo pending', type: 'text' }
      }, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Session startup is not ready for terminal input.',
        startupStatus: 'pending',
        startupPhase: 'worktree',
        startupMessage: 'ワークスペースを準備中...'
      });
      expect(mockSessionManager.sendInput).not.toHaveBeenCalled();
    });

    it('pending startup shellのprobeInput時_409を返しprobeを実行しない', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-probe-pending',
          startupStatus: 'pending',
          startupPhase: 'worktree',
          startupMessage: 'ワークスペースを準備中...'
        }]
      });

      await sessionController.probeTerminalInput({
        params: { id: 'session-probe-pending' },
        body: { viewerId: 'viewer-1' }
      }, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Session startup is not ready for terminal input probe.',
        startupStatus: 'pending',
        startupPhase: 'worktree',
        startupMessage: 'ワークスペースを準備中...'
      });
      expect(mockSessionManager.probeTerminalInput).not.toHaveBeenCalled();
    });
  });

  describe('legacy terminal IO startup shell guards', () => {
    it('pending startup shellのrepair geometry時_409を返しtmux修復しない', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-repair-pending',
          startupStatus: 'pending',
          startupPhase: 'worktree',
          startupMessage: 'ワークスペースを準備中...'
        }]
      });

      await sessionController.repairTerminalGeometry({
        params: { id: 'session-repair-pending' },
        body: { reason: 'test' }
      }, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockSessionManager.repairCollapsedSessionWindow).not.toHaveBeenCalled();
    });

    it('pending startup shellのgetContent時_409を返しsnapshotを取得しない', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-content-pending',
          startupStatus: 'pending',
          startupPhase: 'worktree',
          startupMessage: 'ワークスペースを準備中...'
        }]
      });

      await sessionController.getContent({
        params: { id: 'session-content-pending' },
        query: { lines: '120' }
      }, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Session startup is not ready for terminal content.',
        startupStatus: 'pending',
        startupPhase: 'worktree',
        startupMessage: 'ワークスペースを準備中...'
      });
      expect(mockSessionManager.getContent).not.toHaveBeenCalled();
    });

    it('failed startup shellのgetOutput時_409を返しsnapshotを取得しない', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-output-failed',
          startupStatus: 'failed',
          startupPhase: 'error',
          startupMessage: '起動失敗'
        }]
      });

      await sessionController.getOutput({
        params: { id: 'session-output-failed' }
      }, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Session startup is not ready for terminal output.',
        startupStatus: 'failed',
        startupPhase: 'error',
        startupMessage: '起動失敗'
      });
      expect(mockSessionManager.getOutput).not.toHaveBeenCalled();
    });

    it('pending startup shellのscroll時_409を返しtmux scrollしない', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-scroll-pending',
          startupStatus: 'pending',
          startupPhase: 'worktree',
          startupMessage: 'ワークスペースを準備中...'
        }]
      });

      await sessionController.scroll({
        params: { id: 'session-scroll-pending' },
        body: { direction: 'up', steps: 1 }
      }, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockSessionManager.scrollSession).not.toHaveBeenCalled();
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
      mockSessionManager.getTerminalAccessState.mockReturnValue({
        state: 'owner',
        ownerViewerLabel: 'Local / Mac',
        ownerLastSeenAt: null,
        canTakeover: false
      });

      await sessionController.getRuntime({
        params: { id: sessionId },
        query: { viewerId: 'viewer-1', viewerLabel: 'Local / Mac' },
        headers: {}
      }, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        sessionId,
        runtimeStatus: {
          interactiveUrl: `/console/${sessionId}/?viewerId=viewer-1`,
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

    it('activeセッションでttyd停止中のruntime取得時_ttydを自動復旧しない', async () => {
      const sessionId = 'session-runtime-repair';
      const staleSession = {
        id: sessionId,
        intendedState: 'active',
        engine: 'claude',
        runtimeStatus: {
          ttydRunning: false,
          needsRestart: true,
          proxyPath: null,
          port: 40123
        }
      };
      mockSessionManager.getSessionById.mockReturnValue(staleSession);
      mockSessionManager.getTerminalAccessState.mockReturnValue({
        state: 'owner',
        ownerViewerLabel: 'Local / Mac',
        ownerLastSeenAt: null,
        canTakeover: false
      });

      await sessionController.getRuntime({
        params: { id: sessionId },
        query: { viewerId: 'viewer-1', viewerLabel: 'Local / Mac' },
        headers: {}
      }, mockRes);

      expect(mockSessionManager.ensureTtydForActiveSession).not.toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        sessionId,
        runtimeStatus: {
          interactiveUrl: null,
          ttydRunning: false,
          needsRestart: true,
          proxyPath: null,
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

    it('CON-7 runtime取得時_observedRuntimeのstale issueとttyd観測を返す', async () => {
      const sessionId = 'session-runtime-stale-ttyd';
      mockSessionManager.getSessionById.mockReturnValue({
        id: sessionId,
        runtimeStatus: {
          ttydRunning: false,
          needsRestart: true,
          proxyPath: null,
          port: 40123
        }
      });
      mockSessionManager.getObservedRuntime.mockReturnValue({
        runtimeState: 'degraded',
        issues: [{
          type: 'stale_ttyd_process',
          severity: 'critical',
          reason: 'active tmux has no observed ttyd process'
        }],
        observed: {
          ttyd: {
            running: false,
            expectedPort: 40123
          },
          inputProbe: {
            status: 'failed',
            error: 'ttyd process missing'
          }
        }
      });
      mockSessionManager.getTerminalAccessState.mockReturnValue({
        state: 'owner',
        ownerViewerLabel: 'Local / Mac',
        ownerLastSeenAt: null,
        canTakeover: false
      });

      await sessionController.getRuntime({
        params: { id: sessionId },
        query: { viewerId: 'viewer-1', viewerLabel: 'Local / Mac' },
        headers: {}
      }, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        sessionId,
        runtimeStatus: {
          interactiveUrl: null,
          ttydRunning: false,
          needsRestart: true,
          proxyPath: null,
          port: 40123,
          runtimeState: 'degraded',
          issues: [{
            type: 'stale_ttyd_process',
            severity: 'critical',
            reason: 'active tmux has no observed ttyd process'
          }],
          observedTtyd: {
            running: false,
            expectedPort: 40123
          },
          inputProbe: {
            status: 'failed',
            error: 'ttyd process missing'
          },
          inputReady: false
        },
        terminalAccess: {
          state: 'owner',
          ownerViewerLabel: 'Local / Mac',
          ownerLastSeenAt: null,
          canTakeover: false
        }
      });
    });

    it('CON-7 cold registryのruntime取得時_dry-run reconcileでstale issueを返す', async () => {
      const sessionId = 'session-runtime-cold-stale-ttyd';
      mockSessionManager.getSessionById.mockReturnValue({
        id: sessionId,
        intendedState: 'active',
        ttydProcess: {
          pid: 12345,
          port: 40123,
          engine: 'codex'
        },
        runtimeStatus: {
          ttydRunning: false,
          needsRestart: true,
          proxyPath: null,
          port: 40123
        }
      });
      mockSessionManager.getObservedRuntime.mockReturnValue(null);
      mockSessionManager.reconcileTerminalRuntime.mockResolvedValue({
        health: {
          sessionHealth: [{
            sessionId,
            runtimeState: 'degraded',
            issues: [{
              type: 'stale_ttyd_process',
              severity: 'critical',
              reason: 'active tmux has no observed ttyd process'
            }],
            observed: {
              ttyd: {
                running: false,
                expectedPort: 40123
              },
              inputProbe: {
                status: 'failed',
                error: 'ttyd process missing'
              }
            }
          }]
        }
      });
      mockSessionManager.getTerminalAccessState.mockReturnValue({
        state: 'owner',
        ownerViewerLabel: 'Local / Mac',
        ownerLastSeenAt: null,
        canTakeover: false
      });

      await sessionController.getRuntime({
        params: { id: sessionId },
        query: { viewerId: 'viewer-1', viewerLabel: 'Local / Mac' },
        headers: {}
      }, mockRes);

      expect(mockSessionManager.reconcileTerminalRuntime).toHaveBeenCalledWith({
        sessionId,
        dryRun: true,
        recover: false
      });
      expect(mockRes.json).toHaveBeenCalledWith({
        sessionId,
        runtimeStatus: expect.objectContaining({
          runtimeState: 'degraded',
          issues: [expect.objectContaining({
            type: 'stale_ttyd_process',
            severity: 'critical'
          })],
          observedTtyd: {
            running: false,
            expectedPort: 40123
          },
          inputProbe: {
            status: 'failed',
            error: 'ttyd process missing'
          },
          inputReady: false
        }),
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

  describe('ensureTerminalRuntime', () => {
    it('forceTtyd時はttydを起動してproxyPathを返す', async () => {
      const sessionId = 'session-ensure-ttyd';
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: sessionId,
          path: '/tmp/session-ensure-ttyd',
          initialCommand: 'npm run dev',
          engine: 'codex',
          intendedState: 'active',
          runtimeStatus: {
            ttydRunning: true,
            proxyPath: `/console/${sessionId}`,
            port: 40123
          }
        }]
      });
      mockSessionManager.resolveSessionWorkspacePath.mockResolvedValue('/tmp/session-ensure-ttyd');
      mockSessionManager.startTtyd.mockResolvedValue({
        port: 40123,
        proxyPath: `/console/${sessionId}`
      });
      mockSessionManager.getSessionById.mockReturnValue({
        id: sessionId,
        runtimeStatus: {
          ttydRunning: true,
          proxyPath: `/console/${sessionId}`,
          port: 40123
        }
      });
      mockSessionManager.getTerminalAccessState.mockReturnValue({
        state: 'owner',
        ownerViewerLabel: 'Local / Mac',
        ownerLastSeenAt: null,
        canTakeover: false
      });

      await sessionController.ensureTerminalRuntime({
        params: { id: sessionId },
        body: {
          viewerId: 'viewer-1',
          forceTtyd: true
        }
      }, mockRes);

      expect(mockSessionManager.ensureSessionRuntime).not.toHaveBeenCalled();
      expect(mockSessionManager.startTtyd).toHaveBeenCalledWith({
        sessionId,
        cwd: '/tmp/session-ensure-ttyd',
        initialCommand: 'npm run dev',
        engine: 'codex',
        forceTtyd: true
      });
      expect(mockRes.json).toHaveBeenCalledWith({
        sessionId,
        port: 40123,
        proxyPath: `/console/${sessionId}/?viewerId=viewer-1`,
        runtimeStatus: {
          ttydRunning: true,
          proxyPath: `/console/${sessionId}/?viewerId=viewer-1`,
          interactiveUrl: `/console/${sessionId}/?viewerId=viewer-1`,
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

    it('forceTtydなしではruntimeだけをensureする', async () => {
      const sessionId = 'session-ensure-runtime';
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: sessionId,
          path: '/tmp/session-ensure-runtime',
          initialCommand: 'npm run dev',
          engine: 'codex',
          intendedState: 'active',
          runtimeStatus: {
            ttydRunning: false,
            proxyPath: null,
            recoveryState: 'ok'
          }
        }]
      });
      mockSessionManager.resolveSessionWorkspacePath.mockResolvedValue('/tmp/session-ensure-runtime');
      mockSessionManager.getSessionById.mockReturnValue({
        id: sessionId,
        runtimeStatus: {
          ttydRunning: false,
          proxyPath: null,
          recoveryState: 'ok'
        }
      });
      mockSessionManager.getTerminalAccessState.mockReturnValue({
        state: 'owner',
        ownerViewerLabel: 'Local / Mac',
        ownerLastSeenAt: null,
        canTakeover: false
      });

      await sessionController.ensureTerminalRuntime({
        params: { id: sessionId },
        body: {
          viewerId: 'viewer-1'
        }
      }, mockRes);

      expect(mockSessionManager.ensureSessionRuntime).toHaveBeenCalledWith({
        sessionId,
        cwd: '/tmp/session-ensure-runtime',
        initialCommand: 'npm run dev',
        engine: 'codex'
      });
      expect(mockSessionManager.startTtyd).not.toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        sessionId,
        runtimeStatus: {
          ttydRunning: false,
          proxyPath: null,
          interactiveUrl: null,
          recoveryState: 'ok'
        },
        terminalAccess: {
          state: 'owner',
          ownerViewerLabel: 'Local / Mac',
          ownerLastSeenAt: null,
          canTakeover: false
        }
      });
    });

    it('pending startup shellのterminal ensure時_409を返しruntimeを起動しない', async () => {
      const sessionId = 'session-pending-shell';
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: sessionId,
          path: '/tmp/canonical-repo',
          engine: 'codex',
          intendedState: 'active',
          startupStatus: 'pending',
          startupPhase: 'worktree',
          startupMessage: 'ワークスペースを準備中...'
        }]
      });

      await sessionController.ensureTerminalRuntime({
        params: { id: sessionId },
        body: {
          viewerId: 'viewer-1'
        }
      }, mockRes);

      expect(mockSessionManager.resolveSessionWorkspacePath).not.toHaveBeenCalled();
      expect(mockSessionManager.ensureSessionRuntime).not.toHaveBeenCalled();
      expect(mockSessionManager.startTtyd).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Session startup is not ready for terminal runtime.',
        startupStatus: 'pending',
        startupPhase: 'worktree',
        startupMessage: 'ワークスペースを準備中...'
      });
    });

    it('runtimeが既にinteractive_readyならensureとworkspace解決をスキップする', async () => {
      const sessionId = 'session-ready-runtime';
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: sessionId,
          path: '/tmp/session-ready-runtime',
          initialCommand: 'npm run dev',
          engine: 'codex',
          intendedState: 'active',
          runtimeStatus: {
            ttydRunning: false,
            proxyPath: null,
            runtimeState: 'interactive_ready',
            inputReady: true,
            recoveryState: 'ok'
          }
        }]
      });
      mockSessionManager.getObservedRuntime.mockReturnValue({
        runtimeState: 'interactive_ready',
        observed: {
          inputProbe: {
            status: 'passed',
            lastPassedAt: '2026-05-16T00:00:00.000Z'
          }
        }
      });
      mockSessionManager.getTerminalAccessState.mockReturnValue({
        state: 'owner',
        ownerViewerLabel: 'Local / Mac',
        ownerLastSeenAt: null,
        canTakeover: false
      });

      await sessionController.ensureTerminalRuntime({
        params: { id: sessionId },
        body: {
          viewerId: 'viewer-1'
        }
      }, mockRes);

      expect(mockSessionManager.resolveSessionWorkspacePath).not.toHaveBeenCalled();
      expect(mockSessionManager.ensureSessionRuntime).not.toHaveBeenCalled();
      expect(mockSessionManager.startTtyd).not.toHaveBeenCalled();
      expect(mockSessionManager.repairCollapsedSessionWindow).not.toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({
        sessionId,
        runtimeStatus: {
          ttydRunning: false,
          proxyPath: null,
          interactiveUrl: null,
          runtimeState: 'interactive_ready',
          inputReady: true,
          inputProbe: {
            status: 'passed',
            lastPassedAt: '2026-05-16T00:00:00.000Z'
          },
          recoveryState: 'ok'
        },
        terminalAccess: {
          state: 'owner',
          ownerViewerLabel: 'Local / Mac',
          ownerLastSeenAt: null,
          canTakeover: false
        },
        fastPath: true
      });
    });
  });

  describe('getTerminalSnapshot', () => {
    it('owner viewerのsnapshot取得時_terminal snapshotを返す', async () => {
      const sessionId = 'session-snapshot';
      mockSessionManager.getSessionById.mockReturnValue({ id: sessionId });
      mockSessionManager.getTerminalAccessState.mockReturnValue({
        state: 'owner',
        ownerViewerLabel: 'Local / Mac',
        ownerLastSeenAt: null,
        canTakeover: false
      });
      mockSessionManager.getContent.mockResolvedValue('hello\nworld');
      mockSessionManager.getPaneMode.mockResolvedValue(true);
      mockSessionManager.getCursorPosition.mockResolvedValue({ x: 2, y: 5 });

      await sessionController.getTerminalSnapshot({
        params: { id: sessionId },
        query: { viewerId: 'viewer-1', viewerLabel: 'Local / Mac', lines: '120' },
        headers: {}
      }, mockRes);

      expect(mockSessionManager.getContent).toHaveBeenCalledWith(sessionId, 120);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        sessionId,
        text: 'hello\nworld',
        copyMode: true,
        cursor: { x: 2, y: 5 },
        terminalAccess: {
          state: 'owner',
          ownerViewerLabel: 'Local / Mac',
          ownerLastSeenAt: null,
          canTakeover: false
        }
      }));
    });

    it('visibleOnly指定時_visible pane snapshotを返す', async () => {
      const sessionId = 'session-snapshot-visible';
      mockSessionManager.getSessionById.mockReturnValue({ id: sessionId });
      mockSessionManager.getTerminalAccessState.mockReturnValue({
        state: 'owner',
        ownerViewerLabel: 'Local / Mac',
        ownerLastSeenAt: null,
        canTakeover: false
      });
      mockSessionManager.getVisibleContent.mockResolvedValue('visible');
      mockSessionManager.getVisibleContentWithColors.mockResolvedValue('\x1b[32mvisible\x1b[0m');
      mockSessionManager.getPaneMode.mockResolvedValue(false);
      mockSessionManager.getCursorPosition.mockResolvedValue({ x: 4, y: 10 });

      await sessionController.getTerminalSnapshot({
        params: { id: sessionId },
        query: { viewerId: 'viewer-1', viewerLabel: 'Local / Mac', visibleOnly: '1' },
        headers: {}
      }, mockRes);

      expect(mockSessionManager.getVisibleContent).toHaveBeenCalledWith(sessionId);
      expect(mockSessionManager.getVisibleContentWithColors).toHaveBeenCalledWith(sessionId);
      expect(mockSessionManager.getContent).not.toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        sessionId,
        text: 'visible',
        colorText: '\x1b[32mvisible\x1b[0m',
        cursor: { x: 4, y: 10 }
      }));
    });

    it('blocked viewerのsnapshot取得時_readonly snapshotを返す', async () => {
      const sessionId = 'session-snapshot-blocked';
      mockSessionManager.getSessionById.mockReturnValue({ id: sessionId });
      mockSessionManager.getTerminalAccessState.mockReturnValue({
        state: 'blocked',
        ownerViewerLabel: 'Cloudflare / Mac',
        ownerLastSeenAt: '2026-03-14T14:00:00.000Z',
        canTakeover: true
      });
      mockSessionManager.getContent.mockResolvedValue('readonly');
      mockSessionManager.getPaneMode.mockResolvedValue(false);

      await sessionController.getTerminalSnapshot({
        params: { id: sessionId },
        query: { viewerId: 'viewer-2' },
        headers: {}
      }, mockRes);

      expect(mockSessionManager.ensureTerminalOwnership).not.toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        sessionId,
        text: 'readonly',
        terminalAccess: {
          state: 'blocked',
          ownerViewerLabel: 'Cloudflare / Mac',
          ownerLastSeenAt: '2026-03-14T14:00:00.000Z',
          canTakeover: true
        }
      }));
    });

    it('pending startup shellのsnapshot取得時_409を返しtmux captureを実行しない', async () => {
      const sessionId = 'session-snapshot-pending-shell';
      mockSessionManager.getSessionById.mockReturnValue({
        id: sessionId,
        startupStatus: 'pending',
        startupPhase: 'worktree',
        startupMessage: 'ワークスペースを準備中...'
      });

      await sessionController.getTerminalSnapshot({
        params: { id: sessionId },
        query: { viewerId: 'viewer-1' },
        headers: {}
      }, mockRes);

      expect(mockSessionManager.getTerminalAccessState).not.toHaveBeenCalled();
      expect(mockSessionManager.repairCollapsedSessionWindow).not.toHaveBeenCalled();
      expect(mockSessionManager.getContent).not.toHaveBeenCalled();
      expect(mockSessionManager.getContentWithColors).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Session startup is not ready for terminal snapshot.',
        startupStatus: 'pending',
        startupPhase: 'worktree',
        startupMessage: 'ワークスペースを準備中...'
      });
    });

    it('snapshot取得時_collapsed paneを先に修復してcacheをinvalidateする', async () => {
      const sessionId = 'session-snapshot-collapsed';
      const invalidate = vi.fn();
      sessionController.captureCache = {
        invalidate,
        getSnapshot: vi.fn(async () => ({
          text: 'repaired snapshot',
          colorText: null,
          copyMode: false,
          cursor: null,
          capturedAt: '2026-05-10T00:00:00.000Z'
        }))
      };
      mockSessionManager.getSessionById.mockReturnValue({ id: sessionId });
      mockSessionManager.getTerminalAccessState.mockReturnValue({
        state: 'owner',
        ownerViewerLabel: 'Local / Mac',
        ownerLastSeenAt: null,
        canTakeover: false
      });
      mockSessionManager.repairCollapsedSessionWindow.mockResolvedValue({
        repaired: true,
        paneSize: { cols: 2, rows: 1 },
        repairedPaneSize: { cols: 80, rows: 24 },
        target: { cols: 80, rows: 24 },
        reason: 'terminal-snapshot'
      });
      mockSessionManager.getContent.mockResolvedValue('repaired snapshot');
      mockSessionManager.getPaneMode.mockResolvedValue(false);

      await sessionController.getTerminalSnapshot({
        params: { id: sessionId },
        query: { viewerId: 'viewer-1' },
        headers: {}
      }, mockRes);

      expect(mockSessionManager.repairCollapsedSessionWindow).toHaveBeenCalledWith(sessionId, {
        reason: 'terminal-snapshot'
      });
      expect(invalidate).toHaveBeenCalledWith(sessionId);
      expect(sessionController.captureCache.getSnapshot).toHaveBeenCalledWith(sessionId, expect.objectContaining({
        lines: 200,
        includeColors: true,
        includeCopyMode: true
      }));
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        sessionId,
        text: 'repaired snapshot',
        geometryRepair: expect.objectContaining({
          repaired: true,
          paneSize: { cols: 2, rows: 1 },
          repairedPaneSize: { cols: 80, rows: 24 }
        })
      }));
    });
  });

  describe('createWithWorktree', () => {
    it('staleなrepoPath時_jj repoを優先してfallbackする', async () => {
      const projectsRoot = path.join(tempDir, 'projects');
      const codeProjectsRoot = path.join(tempDir, 'code');
      const staleRepoPath = path.join(projectsRoot, 'tech-knight');
      const fallbackRepoPath = path.join(projectsRoot, 'techknight');
      const gitOnlyRepoPath = path.join(codeProjectsRoot, 'tech-knight');
      const controller = new SessionController(buildControllerDeps({
        projectsRoot,
        codeProjectsRoot
      }));

      await fs.mkdir(fallbackRepoPath, { recursive: true });
      await fs.mkdir(gitOnlyRepoPath, { recursive: true });
      const worktreePath = path.join(tempDir, 'worktrees', 'session-new-techknight');
      await fs.mkdir(worktreePath, { recursive: true });

      let mockState = { sessions: [] };
      mockStateStore.get.mockImplementation(() => mockState);
      mockStateStore.update.mockImplementation(async (nextState) => {
        mockState = nextState;
        return mockState;
      });
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
        worktreePath,
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
        {
          workspaceId: 'session-new-g1',
          generation: 1,
          skipFetch: true
        }
      );
      expect(mockSessionManager.startTtyd).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'session-new',
        cwd: worktreePath,
        engine: 'codex'
      }));
      expect(mockStateStore.update).toHaveBeenCalledWith(expect.objectContaining({
        sessions: expect.arrayContaining([
          expect.objectContaining({
            id: 'session-new',
            startupStatus: 'pending',
            startupPhase: 'ttyd',
            worktree: expect.objectContaining({
              repo: fallbackRepoPath,
              path: worktreePath
            })
          })
        ])
      }));
      expect(mockStateStore.update).toHaveBeenCalledWith(expect.objectContaining({
        sessions: expect.arrayContaining([
          expect.objectContaining({
            id: 'session-new',
            startupStatus: 'ready',
            startupPhase: 'done',
            worktree: expect.objectContaining({
              repo: fallbackRepoPath,
              path: worktreePath
            })
          })
        ])
      }));
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        proxyPath: '/console/session-new/?viewerId=viewer-1'
      }));
    });

    it('state永続化後にworktree.pathが欠ける場合_runtimeを起動しない', async () => {
      const repoPath = path.join(tempDir, 'repo');
      const worktreePath = path.join(tempDir, 'worktrees', 'session-bad-repo');
      const controller = new SessionController(buildControllerDeps());

      await fs.mkdir(repoPath, { recursive: true });
      await fs.mkdir(worktreePath, { recursive: true });

      mockWorktreeService.create.mockResolvedValue({
        worktreePath,
        branchName: 'session/session-bad',
        startCommit: 'abc123'
      });
      mockWorktreeService._isJujutsuRepo.mockResolvedValue(true);
      controller._updateStateWithRetry = vi.fn(async () => ({
        sessions: [{
          id: 'session-bad',
          path: worktreePath,
          worktree: { repo: repoPath }
        }]
      }));

      await controller.createWithWorktree({
        body: {
          sessionId: 'session-bad',
          repoPath,
          name: 'Bad Session',
          engine: 'codex',
          viewerId: 'viewer-1'
        },
        headers: {}
      }, mockRes);

      expect(mockSessionManager.startTtyd).not.toHaveBeenCalled();
      expect(mockWorktreeService.remove).toHaveBeenCalledWith('session-bad', repoPath);
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Session state missing persisted worktree.path'
      }));
    });

    it('ttyd起動失敗時_pending shellをfailedとして残す', async () => {
      const repoPath = path.join(tempDir, 'repo-runtime-fail');
      const worktreePath = path.join(tempDir, 'worktrees', 'session-runtime-fail');
      const controller = new SessionController(buildControllerDeps());
      let state = { sessions: [] };
      let resolveCleanup;

      await fs.mkdir(repoPath, { recursive: true });
      await fs.mkdir(worktreePath, { recursive: true });

      mockWorktreeService.create.mockResolvedValue({
        worktreePath,
        branchName: 'session/session-runtime-fail',
        startCommit: 'abc123'
      });
      mockWorktreeService._isJujutsuRepo.mockResolvedValue(true);
      mockSessionManager.startTtyd.mockRejectedValue(new Error('ttyd failed'));
      mockWorktreeService.remove.mockImplementation(() => new Promise((resolve) => {
        resolveCleanup = resolve;
      }));
      controller._updateStateWithRetry = vi.fn(async (mutator) => {
        state = mutator(state);
        return state;
      });

      const createPromise = controller.createWithWorktree({
        body: {
          sessionId: 'session-runtime-fail',
          repoPath,
          name: 'Runtime Fail',
          engine: 'codex',
          viewerId: 'viewer-1'
        },
        headers: {}
      }, mockRes);

      await vi.waitFor(() => {
        expect(mockWorktreeService.remove).toHaveBeenCalledWith('session-runtime-fail', repoPath);
      });
      expect(mockRes.status).not.toHaveBeenCalled();
      resolveCleanup(true);
      await createPromise;

      expect(state.sessions).toEqual([
        expect.objectContaining({
          id: 'session-runtime-fail',
          startupStatus: 'failed',
          startupPhase: 'error',
          startupMessage: 'ttyd failed'
        })
      ]);
      expect(mockRes.status).toHaveBeenCalledWith(500);
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
      expect(updateCall.sessions[0].archive.status).toBe('queued');
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

    it('worktreeに変更があってもarchiveはqueuedにしてfinalizerへ渡す', async () => {
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
      const archiveFinalizer = { enqueue: vi.fn(async () => ({ success: true })) };
      sessionController = new SessionController(buildControllerDeps({ archiveFinalizer }));

      const req = {
        params: { id: sessionId },
        body: {}
      };

      await sessionController.archive(req, mockRes);

      expect(mockWorktreeService.getStatus).not.toHaveBeenCalled();
      expect(mockWorktreeService.autoHealArchiveState).not.toHaveBeenCalled();
      expect(mockSessionManager.stopTtyd).toHaveBeenCalledWith(sessionId);
      expect(archiveFinalizer.enqueue).toHaveBeenCalledWith(sessionId);
      expect(mockRes.json).toHaveBeenCalledWith({ success: true, archive: { status: 'queued' } });
    });

    it('dirty worktreeでも確認レスポンスを返さずarchiveを完了する', async () => {
      const sessionId = 'session-unsafe-heal';
      const mockState = {
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
      };
      mockStateStore.get.mockReturnValue(mockState);
      mockStateStore.update.mockResolvedValue(mockState);
      mockSessionManager.stopTtyd.mockResolvedValue(true);

      const req = {
        params: { id: sessionId },
        body: {}
      };

      await sessionController.archive(req, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({ success: true, archive: { status: 'queued' } });
      expect(mockSessionManager.stopTtyd).toHaveBeenCalledWith(sessionId);
    });

    it('working copyがcleanでも未マージcommitがあればqueuedにする', async () => {
      const sessionId = 'session-unmerged-only';
      const mockState = {
        sessions: [
          {
            id: sessionId,
            intendedState: 'active',
            worktree: {
              repo: '/tmp/repo',
              path: '/tmp/worktrees/session-unmerged-only-repo',
              startCommit: 'abc123'
            }
          }
        ]
      };
      mockStateStore.get.mockReturnValue(mockState);
      mockStateStore.update.mockResolvedValue(mockState);
      mockSessionManager.stopTtyd.mockResolvedValue(true);

      const req = {
        params: { id: sessionId },
        body: {}
      };

      await sessionController.archive(req, mockRes);

      expect(mockWorktreeService.getStatus).not.toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith({ success: true, archive: { status: 'queued' } });
      expect(mockSessionManager.stopTtyd).toHaveBeenCalledWith(sessionId);
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
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
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
          turnId: 'turn-1',
          activityKind: 'running_command',
          assistantSnippet: 'いま表示のノイズを切り分けています',
          currentStep: 'テストを実行中',
          latestEvidence: 'npx vitest run'
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
          turnId: 'turn-1',
          activityKind: 'running_command',
          taskBrief: undefined,
          assistantSnippet: 'いま表示のノイズを切り分けています',
          currentStep: 'テストを実行中',
          latestEvidence: 'npx vitest run'
        }
      );
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
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
        needsMerge: true,
        hasConflicts: true,
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
        dirty: false,
        unpushed: true,
        unmerged: true,
        conflict: true,
        hasWorkingCopyChanges: false,
        needsMerge: true,
        hasConflicts: true,
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

    it('ephemeral cwd のとき_currentDirectory は workspacePath を優先する', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-ephemeral',
          name: 'Ephemeral Session',
          cwd: '/private/tmp',
          worktree: {
            repo: '/Users/ksato/workspace/code/brainbase',
            path: '/Volumes/UNSON-DRIVE/brainbase-worktrees/session-ephemeral-brainbase',
            startCommit: 'abc123'
          }
        }]
      });

      mockWorktreeService.getStatus.mockResolvedValue({
        repoName: 'brainbase',
        bookmarkName: 'session-ephemeral',
        changesNotPushed: 0,
        hasWorkingCopyChanges: false,
        bookmarkPushed: false,
        mainBranch: 'develop',
        worktreePath: '/Volumes/UNSON-DRIVE/brainbase-worktrees/session-ephemeral-brainbase'
      });

      const req = {
        params: { id: 'session-ephemeral' }
      };

      await sessionController.getContext(req, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'session-ephemeral',
        workspacePath: '/Volumes/UNSON-DRIVE/brainbase-worktrees/session-ephemeral-brainbase',
        currentDirectory: '/Volumes/UNSON-DRIVE/brainbase-worktrees/session-ephemeral-brainbase'
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
        needsMerge: true,
        hasConflicts: true,
        bookmarkPushed: true,
        mainBranch: 'develop',
        worktreePath: '/tmp/worktrees/session-ui/project'
      });

      const req = {
        query: {}
      };

      await sessionController.getUiSummaries(req, mockRes);

      expect(mockWorktreeService.getStatus).toHaveBeenCalledWith(
        'session-ui',
        '/tmp/repo',
        'abc123',
        {
          fetchRemote: false,
          workspaceId: 'session-ui',
          generation: undefined
        }
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        'session-ui': expect.objectContaining({
          repo: 'brainbase',
          baseBranch: 'develop',
          dirty: true,
          unpushed: true,
          unmerged: true,
          conflict: true,
          hasWorkingCopyChanges: true,
          needsMerge: true,
          hasConflicts: true,
          changesNotPushed: 3,
          prStatus: 'open_or_pending',
          currentDirectory: '/tmp/worktrees/session-ui/project/src'
        })
      });
    });

    it('ui summary は未push commitだけならdirtyを立てずunpushedだけを返す', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-ui-unpushed',
          worktree: {
            repo: '/tmp/repo',
            path: '/tmp/worktrees/session-ui-unpushed/project',
            startCommit: 'abc123'
          }
        }]
      });
      mockWorktreeService.getStatus.mockResolvedValue({
        repoName: 'brainbase',
        changesNotPushed: 1,
        hasWorkingCopyChanges: false,
        needsMerge: false,
        bookmarkPushed: true,
        mainBranch: 'develop',
        worktreePath: '/tmp/worktrees/session-ui-unpushed/project'
      });

      await sessionController.getUiSummaries({ query: {} }, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        'session-ui-unpushed': expect.objectContaining({
          dirty: false,
          unpushed: true,
          unmerged: false,
          hasWorkingCopyChanges: false,
          changesNotPushed: 1
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

    it('ui summary でも ephemeral cwd は workspacePath に丸める', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-ui-ephemeral',
          cwd: '/private/tmp',
          worktree: {
            repo: '/tmp/repo',
            path: '/Volumes/UNSON-DRIVE/brainbase-worktrees/session-ui-ephemeral',
            startCommit: 'abc123'
          }
        }]
      });
      mockWorktreeService.getStatus.mockResolvedValue({
        repoName: 'brainbase',
        changesNotPushed: 0,
        hasWorkingCopyChanges: false,
        bookmarkPushed: false,
        mainBranch: 'develop',
        worktreePath: '/Volumes/UNSON-DRIVE/brainbase-worktrees/session-ui-ephemeral'
      });

      const req = {
        query: { ids: 'session-ui-ephemeral' }
      };

      await sessionController.getUiSummaries(req, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        'session-ui-ephemeral': expect.objectContaining({
          workspacePath: '/Volumes/UNSON-DRIVE/brainbase-worktrees/session-ui-ephemeral',
          currentDirectory: '/Volumes/UNSON-DRIVE/brainbase-worktrees/session-ui-ephemeral'
        })
      });
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

    it('レビュー対象のdot directoryは返し、内部管理用dot directoryは隠す', async () => {
      await fs.mkdir(path.join(tempDir, '.vibepro', 'diagnostics'), { recursive: true });
      await fs.mkdir(path.join(tempDir, '.claude', 'commands'), { recursive: true });
      await fs.mkdir(path.join(tempDir, '.git', 'objects'), { recursive: true });
      await fs.writeFile(path.join(tempDir, '.vibepro', 'diagnostics', 'summary.md'), '# summary');
      await fs.writeFile(path.join(tempDir, '.claude', 'commands', 'ohayo.md'), '# ohayo');
      await fs.writeFile(path.join(tempDir, '.env'), 'SECRET=value');

      mockStateStore.get.mockReturnValue({
        sessions: [{ id: 'session-tree', path: tempDir }]
      });

      const req = {
        params: { id: 'session-tree' },
        query: { depth: '1' }
      };

      await sessionController.getFolderTree(req, mockRes);

      const response = mockRes.json.mock.calls[0][0];
      expect(response.nodes).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: '.claude', type: 'directory', relativePath: '.claude' }),
        expect.objectContaining({ name: '.vibepro', type: 'directory', relativePath: '.vibepro' })
      ]));
      expect(response.nodes).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: '.git' }),
        expect.objectContaining({ name: '.env' })
      ]));
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

  describe('getFileContent', () => {
    it('workspace root relative path を開ける', async () => {
      const workspaceRoot = path.join(tempDir, 'workspace');
      const filePath = path.join(workspaceRoot, 'tests/unit/iframe-contextmenu-handler.test.js');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, 'export const ok = true;\n');

      mockStateStore.get.mockReturnValue({
        sessions: [{ id: 'session-1', path: workspaceRoot, intendedState: 'active' }]
      });

      await sessionController.getFileContent({
        params: { id: 'session-1' },
        query: { path: 'tests/unit/iframe-contextmenu-handler.test.js' }
      }, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'session-1',
        relativePath: 'tests/unit/iframe-contextmenu-handler.test.js',
        fileName: 'iframe-contextmenu-handler.test.js',
        content: 'export const ok = true;\n',
        isMarkdown: false
      }));
    });

    it('repo名つきの workspace 相対パスも開ける', async () => {
      const workspaceRoot = path.join(tempDir, 'brainbase');
      const filePath = path.join(workspaceRoot, 'scripts/ensure_session_runtime.sh');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, '#!/usr/bin/env bash\n');

      mockStateStore.get.mockReturnValue({
        sessions: [{ id: 'session-1', path: workspaceRoot, intendedState: 'active' }]
      });

      await sessionController.getFileContent({
        params: { id: 'session-1' },
        query: { path: 'brainbase/scripts/ensure_session_runtime.sh' }
      }, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'session-1',
        relativePath: 'scripts/ensure_session_runtime.sh',
        fileName: 'ensure_session_runtime.sh',
        content: '#!/usr/bin/env bash\n',
        isMarkdown: false
      }));
    });

    it('workspace 内の絶対パスとホーム相対パスを開ける', async () => {
      const homeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bb-home-'));
      const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeRoot);
      const workspaceRoot = path.join(homeRoot, 'workspace');
      const filePath = path.join(workspaceRoot, 'public/modules/iframe-contextmenu-handler.js');
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, 'export const linked = true;\n');

      mockStateStore.get.mockReturnValue({
        sessions: [{ id: 'session-1', path: workspaceRoot, intendedState: 'active' }]
      });

      await sessionController.getFileContent({
        params: { id: 'session-1' },
        query: { path: filePath }
      }, mockRes);

      expect(mockRes.json).toHaveBeenLastCalledWith(expect.objectContaining({
        relativePath: 'public/modules/iframe-contextmenu-handler.js',
        fileName: 'iframe-contextmenu-handler.js'
      }));

      mockRes.json.mockClear();
      mockRes.status.mockClear();

      await sessionController.getFileContent({
        params: { id: 'session-1' },
        query: { path: '~/workspace/public/modules/iframe-contextmenu-handler.js' }
      }, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        relativePath: 'public/modules/iframe-contextmenu-handler.js',
        fileName: 'iframe-contextmenu-handler.js'
      }));

      homeSpy.mockRestore();
      await fs.rm(homeRoot, { recursive: true, force: true });
    });

    it('workspace に無い場合_repo candidate にフォールバックして開ける', async () => {
      const projectsRoot = path.join(tempDir, 'projects');
      const codeProjectsRoot = path.join(tempDir, 'code');
      const workspaceRoot = path.join(tempDir, 'worktrees', 'session-1-brainbase');
      const fallbackRepoPath = path.join(codeProjectsRoot, 'brainbase');
      const filePath = path.join(fallbackRepoPath, 'tests/unit/iframe-contextmenu-handler.test.js');
      const controller = new SessionController(buildControllerDeps({
        projectsRoot,
        codeProjectsRoot
      }));

      await fs.mkdir(workspaceRoot, { recursive: true });
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, 'export const fallback = true;\n');

      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-1',
          path: workspaceRoot,
          worktree: {
            path: workspaceRoot,
            repo: path.join(projectsRoot, 'brainbase')
          },
          intendedState: 'active'
        }]
      });
      mockWorktreeService._isJujutsuRepo.mockResolvedValue(false);

      await controller.getFileContent({
        params: { id: 'session-1' },
        query: { path: 'tests/unit/iframe-contextmenu-handler.test.js' }
      }, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        sessionId: 'session-1',
        relativePath: 'tests/unit/iframe-contextmenu-handler.test.js',
        fileName: 'iframe-contextmenu-handler.test.js',
        content: 'export const fallback = true;\n',
        isMarkdown: false
      }));
    });
  });

  describe('askAiIntegration', () => {
    it('server側clipboard成功時_copiedByServerとclipboardMethodを返す', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-ai',
          name: 'AI Session',
          path: tempDir,
          intendedState: 'active'
        }]
      });
      vi.spyOn(sessionController, '_copyToSystemClipboard').mockResolvedValue({
        success: true,
        method: 'osascript'
      });

      await sessionController.askAiIntegration({
        params: { id: 'session-ai' },
        body: {
          status: {
            changesNotPushed: 1,
            hasWorkingCopyChanges: true,
            bookmarkPushed: false,
            bookmarkName: 'bookmark-a'
          }
        }
      }, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        copiedByServer: true,
        clipboardMethod: 'osascript',
        clipboardContent: expect.stringContaining('session-id: session-ai')
      }));
      expect(mockRes.json.mock.calls[0][0].clipboardContent).toContain(
        'POST http://localhost:31013/api/sessions/session-ai/merge'
      );
      expect(mockRes.json.mock.calls[0][0].clipboardContent).toContain(
        'raw gh/jj を組み合わせず'
      );
    });

    it('server側clipboard失敗時_browser fallback用メッセージを返す', async () => {
      mockStateStore.get.mockReturnValue({
        sessions: [{
          id: 'session-ai',
          name: 'AI Session',
          path: tempDir,
          intendedState: 'active'
        }]
      });
      vi.spyOn(sessionController, '_copyToSystemClipboard').mockResolvedValue({
        success: false,
        method: null
      });

      await sessionController.askAiIntegration({
        params: { id: 'session-ai' },
        body: { status: {} }
      }, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        copiedByServer: false,
        clipboardMethod: null,
        message: 'AIへの依頼内容を生成しました。ブラウザ側でコピーして送信してください。'
      }));
    });
  });
});
