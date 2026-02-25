/**
 * State Concurrency - Integration Test
 * SessionControllerとStateStoreの統合テスト（並行API呼び出し、リトライロジック）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StateStore } from '../../lib/state-store.js';
import { SessionController } from '../../server/controllers/session-controller.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('State Concurrency - Integration', () => {
    let stateStore;
    let sessionController;
    let tempDir;
    let stateFilePath;

    // Mock SessionManager and WorktreeService
    const mockSessionManager = {
        startTtyd: vi.fn().mockResolvedValue({ port: 8080, proxyPath: '/proxy' }),
        stopTtyd: vi.fn().mockResolvedValue(true),
        reportActivity: vi.fn(),
        getSessionStatus: vi.fn().mockReturnValue([]),
        getRuntimeStatus: vi.fn().mockReturnValue({ status: 'stopped' }),
        clearDoneStatus: vi.fn()
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
        // 一時ディレクトリ作成
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-integration-test-'));
        stateFilePath = path.join(tempDir, 'state.json');

        // StateStore初期化
        stateStore = new StateStore(stateFilePath, '/test/workspace');
        await stateStore.init();

        // テストセッションを追加
        stateStore.state.sessions = [
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
        ];
        await stateStore.persist();

        // SessionController初期化
        sessionController = new SessionController(
            mockSessionManager,
            mockWorktreeService,
            stateStore
        );

        // Mock reset
        vi.clearAllMocks();
    });

    afterEach(async () => {
        // watcher停止
        if (stateStore._watcher) {
            await stateStore._watcher.close();
        }

        // 一時ディレクトリ削除
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('並行API呼び出し', () => {
        it('並行archive呼び出しが成功する', async () => {
            // Mock request/response
            const req1 = { params: { id: 'test-session-1' }, body: {} };
            const res1 = {
                json: vi.fn(),
                status: vi.fn().mockReturnThis()
            };

            const req2 = { params: { id: 'test-session-2' }, body: {} };
            const res2 = {
                json: vi.fn(),
                status: vi.fn().mockReturnThis()
            };

            // 並行実行
            await Promise.all([
                sessionController.archive(req1, res1),
                sessionController.archive(req2, res2)
            ]);

            // 両方のセッションがアーカイブされたことを確認
            const state = stateStore.get();
            const session1 = state.sessions.find(s => s.id === 'test-session-1');
            const session2 = state.sessions.find(s => s.id === 'test-session-2');

            expect(session1.intendedState).toBe('archived');
            expect(session2.intendedState).toBe('archived');
            expect(session1.archivedAt).toBeDefined();
            expect(session2.archivedAt).toBeDefined();

            // レスポンスが成功したことを確認
            expect(res1.json).toHaveBeenCalledWith({ success: true });
            expect(res2.json).toHaveBeenCalledWith({ success: true });
        });

        it('並行stop呼び出しが成功する', async () => {
            // Mock request/response
            const req1 = { params: { id: 'test-session-1' }, body: {} };
            const res1 = {
                json: vi.fn(),
                status: vi.fn().mockReturnThis()
            };

            const req2 = { params: { id: 'test-session-2' }, body: {} };
            const res2 = {
                json: vi.fn(),
                status: vi.fn().mockReturnThis()
            };

            // 並行実行
            await Promise.all([
                sessionController.stop(req1, res1),
                sessionController.stop(req2, res2)
            ]);

            // 両方のセッションが停止したことを確認
            const state = stateStore.get();
            const session1 = state.sessions.find(s => s.id === 'test-session-1');
            const session2 = state.sessions.find(s => s.id === 'test-session-2');

            expect(session1.intendedState).toBe('paused');
            expect(session2.intendedState).toBe('paused');
            expect(session1.pausedAt).toBeDefined();
            expect(session2.pausedAt).toBeDefined();

            // レスポンスが成功したことを確認
            expect(res1.json).toHaveBeenCalledWith({ success: true });
            expect(res2.json).toHaveBeenCalledWith({ success: true });
        });

        it('並行start呼び出しが成功する', async () => {
            // Mock request/response
            const req1 = {
                body: { sessionId: 'test-session-1', engine: 'claude' },
                headers: {}
            };
            const res1 = {
                json: vi.fn(),
                status: vi.fn().mockReturnThis()
            };

            const req2 = {
                body: { sessionId: 'test-session-2', engine: 'codex' },
                headers: {}
            };
            const res2 = {
                json: vi.fn(),
                status: vi.fn().mockReturnThis()
            };

            // 並行実行
            await Promise.all([
                sessionController.start(req1, res1),
                sessionController.start(req2, res2)
            ]);

            // 両方のセッションがactiveになったことを確認
            const state = stateStore.get();
            const session1 = state.sessions.find(s => s.id === 'test-session-1');
            const session2 = state.sessions.find(s => s.id === 'test-session-2');

            expect(session1.intendedState).toBe('active');
            expect(session2.intendedState).toBe('active');
            expect(session1.engine).toBe('claude');
            expect(session2.engine).toBe('codex');

            // レスポンスが成功したことを確認
            expect(res1.json).toHaveBeenCalledWith({ port: 8080, proxyPath: '/proxy' });
            expect(res2.json).toHaveBeenCalledWith({ port: 8080, proxyPath: '/proxy' });
        });
    });

    describe('リトライロジック', () => {
        it('競合時にリトライして成功する', async () => {
            // 外部編集をシミュレート（persist()直前にファイルを書き換える）
            let attemptCount = 0;
            const originalUpdate = stateStore.update.bind(stateStore);
            vi.spyOn(stateStore, 'update').mockImplementation(async function(newState) {
                attemptCount++;
                if (attemptCount === 1) {
                    // 1回目: 外部編集をシミュレート（ファイルを直接書き換え）
                    const externalState = {
                        ...stateStore.state,
                        _externalEdit: true // マーカー
                    };
                    await fs.writeFile(stateFilePath, JSON.stringify(externalState, null, 2));
                    await new Promise(resolve => setTimeout(resolve, 10)); // mtimeが変わるのを待つ
                }
                // 実際のupdate()を実行
                return originalUpdate.call(this, newState);
            });

            // Mock request/response
            const req = { params: { id: 'test-session-1' }, body: {} };
            const res = {
                json: vi.fn(),
                status: vi.fn().mockReturnThis()
            };

            // archive実行（リトライが発生するべき）
            await sessionController.archive(req, res);

            // リトライが2回以上実行されたことを確認
            expect(attemptCount).toBeGreaterThanOrEqual(2);

            // セッションがアーカイブされたことを確認
            const state = stateStore.get();
            const session = state.sessions.find(s => s.id === 'test-session-1');
            expect(session.intendedState).toBe('archived');

            // レスポンスが成功したことを確認
            expect(res.json).toHaveBeenCalledWith({ success: true });

            stateStore.update.mockRestore();
        });

        it('最大リトライ回数を超えた場合はエラーを投げる', async () => {
            // persist()を常に失敗させるようにmock
            vi.spyOn(stateStore, 'persist').mockRejectedValue(
                new Error('State conflict detected, please retry')
            );

            // Mock request/response
            const req = { params: { id: 'test-session-1' }, body: {} };
            const res = {
                json: vi.fn(),
                status: vi.fn().mockReturnThis()
            };

            // archive実行（エラーが投げられるべき）
            await sessionController.archive(req, res);

            // エラーレスポンスが返されたことを確認
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Failed to archive session'
                })
            );

            stateStore.persist.mockRestore();
        });

        it('競合以外のエラーは即座に投げる', async () => {
            // persist()で別のエラーを投げる
            vi.spyOn(stateStore, 'persist').mockRejectedValue(
                new Error('Disk full')
            );

            // Mock request/response
            const req = { params: { id: 'test-session-1' }, body: {} };
            const res = {
                json: vi.fn(),
                status: vi.fn().mockReturnThis()
            };

            // archive実行（即座にエラーが投げられるべき）
            await sessionController.archive(req, res);

            // エラーレスポンスが返されたことを確認
            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: 'Failed to archive session',
                    detail: 'Disk full'
                })
            );

            stateStore.persist.mockRestore();
        });
    });

    describe('外部編集との統合', () => {
        it('API実行中に外部編集があった場合、リロードして再実行する', async () => {
            // Mock request/response
            const req = { params: { id: 'test-session-1' }, body: {} };
            const res = {
                json: vi.fn(),
                status: vi.fn().mockReturnThis()
            };

            // API実行前に外部編集をシミュレート
            const externalState = {
                ...stateStore.state,
                sessions: [
                    ...stateStore.state.sessions,
                    {
                        id: 'external-session',
                        name: 'External Session',
                        path: '/external',
                        intendedState: 'active'
                    }
                ]
            };
            await fs.writeFile(stateFilePath, JSON.stringify(externalState, null, 2));

            // chokidarのawaitWriteFinishを待つ
            await new Promise(resolve => setTimeout(resolve, 200));

            // archive実行
            await sessionController.archive(req, res);

            // 外部編集されたセッションが残っていることを確認
            const state = stateStore.get();
            const externalSession = state.sessions.find(s => s.id === 'external-session');
            expect(externalSession).toBeDefined();

            // test-session-1がアーカイブされたことを確認
            const session1 = state.sessions.find(s => s.id === 'test-session-1');
            expect(session1.intendedState).toBe('archived');

            // レスポンスが成功したことを確認
            expect(res.json).toHaveBeenCalledWith({ success: true });
        });
    });
});
