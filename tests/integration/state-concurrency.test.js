/**
 * State Concurrency - Integration Test
 * SqliteStoreとSessionControllerの統合テスト（並行API呼び出し）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteStore } from '../../lib/sqlite-store.js';
import { SessionController } from '../../server/controllers/session-controller.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('State Concurrency - Integration', () => {
    let stateStore;
    let sessionController;
    let tempDir;
    let stateFilePath;

    const buildControllerDeps = () => ({
        activity: {
            reportActivity: mockSessionManager.reportActivity,
            getSessionStatus: mockSessionManager.getSessionStatus,
            clearDoneStatus: mockSessionManager.clearDoneStatus
        },
        ownership: {
            ensureTerminalOwnership: mockSessionManager.ensureTerminalOwnership,
            forceTerminalOwnership: mockSessionManager.forceTerminalOwnership || vi.fn(),
            getTerminalAccessState: mockSessionManager.getTerminalAccessState || vi.fn(),
            releaseTerminalOwnership: mockSessionManager.releaseTerminalOwnership || vi.fn()
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
            ensureSessionRuntime: mockSessionManager.ensureSessionRuntime || vi.fn()
        },
        runtimeRegistry: {
            activeSessions: mockSessionManager.activeSessions
        },
        terminalIo: {
            sendInput: mockSessionManager.sendInput || vi.fn(),
            scrollSession: mockSessionManager.scrollSession || vi.fn(),
            selectPane: mockSessionManager.selectPane || vi.fn(),
            exitCopyMode: mockSessionManager.exitCopyMode || vi.fn()
        },
        snapshot: {
            getContent: mockSessionManager.getContent || vi.fn(),
            getContentWithColors: mockSessionManager.getContentWithColors || vi.fn(),
            getPaneMode: mockSessionManager.getPaneMode || vi.fn(),
            getOutput: mockSessionManager.getOutput || vi.fn()
        },
        worktreeService: mockWorktreeService,
        stateStore
    });

    const mockSessionManager = {
        startTtyd: vi.fn().mockResolvedValue({ port: 8080, proxyPath: '/proxy' }),
        stopTtyd: vi.fn().mockResolvedValue(true),
        reportActivity: vi.fn(),
        getSessionStatus: vi.fn().mockReturnValue([]),
        getRuntimeStatus: vi.fn().mockReturnValue({ status: 'stopped' }),
        getSessionById: vi.fn().mockReturnValue(null),
        clearDoneStatus: vi.fn(),
        activeSessions: new Map(),
        _isXtermOnlyMode: vi.fn().mockReturnValue(false),
        _isProcessRunning: vi.fn().mockReturnValue(false),
        resolveSessionWorkspacePath: vi.fn(async (sessionOrId) => typeof sessionOrId === 'string' ? null : sessionOrId?.path || null),
        ensureTerminalOwnership: vi.fn().mockImplementation((sessionId, viewerId) => ({
            allowed: true,
            terminalAccess: {
                state: 'owner',
                ownerViewerLabel: 'Local / Desktop',
                ownerLastSeenAt: null,
                canTakeover: false
            }
        }))
    };

    const mockWorktreeService = {
        create: vi.fn().mockResolvedValue({
            worktreePath: '/tmp/worktree',
            branchName: 'session-branch',
            startCommit: 'abc123'
        }),
        remove: vi.fn().mockResolvedValue(true),
        getStatus: vi.fn().mockResolvedValue({
            needsIntegration: false,
            needsMerge: false
        }),
        merge: vi.fn().mockResolvedValue({
            success: true,
            mergedAt: new Date().toISOString()
        })
    };

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-integration-test-'));
        stateFilePath = path.join(tempDir, 'state.json');

        // SqliteStore初期化（state.jsonがないのでデフォルトから開始）
        stateStore = new SqliteStore(stateFilePath, '/test/workspace');
        await stateStore.init();

        // テストセッションを追加
        await stateStore.mutateSessions(() => [
            {
                id: 'test-session-1',
                name: 'Test Session 1',
                path: '/test1',
                intendedState: 'active',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            },
            {
                id: 'test-session-2',
                name: 'Test Session 2',
                path: '/test2',
                intendedState: 'active',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        ]);

        sessionController = new SessionController(buildControllerDeps());
        vi.clearAllMocks();
    });

    afterEach(async () => {
        if (stateStore.db) {
            stateStore.db.close();
        }
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('並行API呼び出し', () => {
        it('並行archive呼び出しが成功する', async () => {
            const req1 = { params: { id: 'test-session-1' }, body: {} };
            const res1 = { json: vi.fn(), status: vi.fn().mockReturnThis() };

            const req2 = { params: { id: 'test-session-2' }, body: {} };
            const res2 = { json: vi.fn(), status: vi.fn().mockReturnThis() };

            await Promise.all([
                sessionController.archive(req1, res1),
                sessionController.archive(req2, res2)
            ]);

            const state = stateStore.get();
            const session1 = state.sessions.find(s => s.id === 'test-session-1');
            const session2 = state.sessions.find(s => s.id === 'test-session-2');

            expect(session1.intendedState).toBe('archived');
            expect(session2.intendedState).toBe('archived');
            expect(session1.archivedAt).toBeDefined();
            expect(session2.archivedAt).toBeDefined();

            expect(res1.json).toHaveBeenCalledWith({ success: true });
            expect(res2.json).toHaveBeenCalledWith({ success: true });
        });

        it('並行stop呼び出しが成功する', async () => {
            const req1 = { params: { id: 'test-session-1' }, body: {} };
            const res1 = { json: vi.fn(), status: vi.fn().mockReturnThis() };

            const req2 = { params: { id: 'test-session-2' }, body: {} };
            const res2 = { json: vi.fn(), status: vi.fn().mockReturnThis() };

            await Promise.all([
                sessionController.stop(req1, res1),
                sessionController.stop(req2, res2)
            ]);

            const state = stateStore.get();
            const session1 = state.sessions.find(s => s.id === 'test-session-1');
            const session2 = state.sessions.find(s => s.id === 'test-session-2');

            expect(session1.intendedState).toBe('paused');
            expect(session2.intendedState).toBe('paused');
            expect(session1.pausedAt).toBeDefined();
            expect(session2.pausedAt).toBeDefined();

            expect(res1.json).toHaveBeenCalledWith({ success: true });
            expect(res2.json).toHaveBeenCalledWith({ success: true });
        });

        it('並行start呼び出しが成功する', async () => {
            const req1 = {
                body: { sessionId: 'test-session-1', engine: 'claude', viewerId: 'viewer-1' },
                headers: {}
            };
            const res1 = { json: vi.fn(), status: vi.fn().mockReturnThis() };

            const req2 = {
                body: { sessionId: 'test-session-2', engine: 'codex', viewerId: 'viewer-2' },
                headers: {}
            };
            const res2 = { json: vi.fn(), status: vi.fn().mockReturnThis() };

            await Promise.all([
                sessionController.start(req1, res1),
                sessionController.start(req2, res2)
            ]);

            const state = stateStore.get();
            const session1 = state.sessions.find(s => s.id === 'test-session-1');
            const session2 = state.sessions.find(s => s.id === 'test-session-2');

            expect(session1.intendedState).toBe('active');
            expect(session2.intendedState).toBe('active');

            expect(res1.json).toHaveBeenCalledWith(expect.objectContaining({ port: 8080, proxyPath: '/proxy?viewerId=viewer-1' }));
            expect(res2.json).toHaveBeenCalledWith(expect.objectContaining({ port: 8080, proxyPath: '/proxy?viewerId=viewer-2' }));
        });

        it('多数の並行mutation後もデータが失われない', async () => {
            // 10並行mutationでデータ整合性を確認
            const mutations = Array.from({ length: 10 }, (_, i) =>
                stateStore.patchSession('test-session-1', { [`field${i}`]: `value${i}` })
            );
            await Promise.all(mutations);

            const state = stateStore.get();
            const session = state.sessions.find(s => s.id === 'test-session-1');
            expect(session).toBeDefined();
            // 全mutationが適用されている（最後の書き込みが勝つ方式のため、直列化されて全て適用される）
            for (let i = 0; i < 10; i++) {
                expect(session[`field${i}`]).toBe(`value${i}`);
            }
        });
    });

    describe('エラーハンドリング', () => {
        it('非競合エラーは即座に投げる', async () => {
            const req = { params: { id: 'test-session-1' }, body: {} };
            const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };

            // DBを閉じてエラーを引き起こす
            vi.spyOn(stateStore, '_runMutation').mockRejectedValueOnce(new Error('Disk full'));

            await sessionController.archive(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({ error: 'Failed to archive session' })
            );

            stateStore._runMutation.mockRestore();
        });
    });

    describe('JSONからの移行', () => {
        it('state.jsonが存在すればSQLiteに移行される', async () => {
            const migrationDir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-migration-test-'));
            const migrationStatePath = path.join(migrationDir, 'state.json');

            // state.jsonを作成
            const jsonState = {
                schemaVersion: 3,
                lastOpenTaskId: null,
                filters: {},
                readNotifications: [],
                focusSession: null,
                sessions: [
                    { id: 'migrated-session-1', name: 'Migrated 1', path: '/m1', intendedState: 'active', createdAt: new Date().toISOString() },
                    { id: 'migrated-session-2', name: 'Migrated 2', path: '/m2', intendedState: 'paused', createdAt: new Date().toISOString() }
                ]
            };
            await fs.writeFile(migrationStatePath, JSON.stringify(jsonState, null, 2));

            const migratedStore = new SqliteStore(migrationStatePath, '/test/workspace');
            await migratedStore.init();

            try {
                const state = migratedStore.get();
                expect(state.sessions.some(s => s.id === 'migrated-session-1')).toBe(true);
                expect(state.sessions.some(s => s.id === 'migrated-session-2')).toBe(true);

                // バックアップが作成されている
                const bakPath = migrationStatePath + '.bak-before-sqlite';
                const bakExists = await fs.access(bakPath).then(() => true).catch(() => false);
                expect(bakExists).toBe(true);
            } finally {
                migratedStore.db?.close();
                await fs.rm(migrationDir, { recursive: true, force: true });
            }
        });
    });
});
