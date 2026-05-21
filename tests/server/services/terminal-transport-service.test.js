import { describe, expect, it, vi } from 'vitest';
import { TerminalTransportService } from '../../../server/services/terminal-transport-service.js';

function buildService() {
    const captureCache = {
        getSnapshot: vi.fn(async () => ({
            text: 'snapshot',
            colorText: null,
            copyMode: false,
            cursor: null,
            capturedAt: '2026-03-23T00:00:00.000Z'
        })),
        invalidate: vi.fn()
    };
    const controlClient = {
        on: vi.fn(),
        off: vi.fn(),
        resize: vi.fn(),
        touch: vi.fn(),
        sendLiteralText: vi.fn(() => true),
        sendKey: vi.fn(() => true)
    };
    const controlRegistry = {
        acquire: vi.fn(() => controlClient),
        release: vi.fn()
    };
    const sessionManager = {
        sendInput: vi.fn(async () => {}),
        resizeSessionWindow: vi.fn(async () => {}),
        scrollSession: vi.fn(async () => {}),
        exitCopyMode: vi.fn(async () => {}),
        touchTerminalOwnership: vi.fn(),
        releaseTerminalOwnership: vi.fn(() => true),
        ensureTerminalOwnership: vi.fn(() => ({ allowed: true })),
        getTerminalAccessState: vi.fn(() => ({ state: 'owner' })),
        getSessionById: vi.fn(() => ({ id: 'session-1', startupStatus: 'ready' })),
        getSession: vi.fn(() => ({
            runtimeState: 'interactive_ready',
            observed: { inputProbe: { status: 'passed' } }
        })),
        setCliState: vi.fn(),
        setInputProbe: vi.fn(),
        isTmuxSessionRunning: vi.fn(async () => true),
        getContent: vi.fn(async () => 'snapshot'),
        getContentWithColors: vi.fn(async () => null),
        getPaneMode: vi.fn(async () => false)
    };

    const service = new TerminalTransportService({ sessionManager, captureCache, controlRegistry });
    return { service, sessionManager, captureCache, controlClient, controlRegistry };
}

function buildMockWs() {
    const listeners = {};
    return {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn(() => {
            if (listeners.close) listeners.close();
        }),
        on: vi.fn((event, handler) => {
            listeners[event] = handler;
        }),
        _listeners: listeners
    };
}

describe('TerminalTransportService', () => {
    it('pending startup shellのWebSocket接続を拒否する', async () => {
        const { service, sessionManager } = buildService();
        sessionManager.getSessionById.mockReturnValue({
            id: 'session-pending',
            startupStatus: 'pending',
            startupPhase: 'worktree',
            startupMessage: 'ワークスペースを準備中...'
        });
        const ws = buildMockWs();

        await service._handleConnection(ws, {}, {
            sessionId: 'session-pending',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac'
        });

        expect(sessionManager.ensureTerminalOwnership).not.toHaveBeenCalled();
        expect(sessionManager.isTmuxSessionRunning).not.toHaveBeenCalled();
        expect(ws.send).toHaveBeenCalledWith(expect.stringContaining('SESSION_STARTUP_NOT_READY'));
        expect(ws.close).toHaveBeenCalledWith(4009, 'session_startup_not_ready');
    });

    it('input message で tmux sendInput を呼ぶ', async () => {
        const { service, sessionManager, captureCache } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() },
            transport: 'snapshot'
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: 'hello'
        }));

        expect(sessionManager.sendInput).toHaveBeenCalledWith('session-1', 'hello', 'text');
        expect(sessionManager.touchTerminalOwnership).toHaveBeenCalledWith('session-1', 'viewer-1', 'Local / Mac');
        expect(captureCache.invalidate).toHaveBeenCalledWith('session-1');
    });

    it('inputProbe passedが古くてもinput messageをdropしない', async () => {
        const { service, sessionManager } = buildService();
        sessionManager.getSession.mockReturnValue({
            runtimeState: 'interactive_ready',
            observed: {
                inputProbe: {
                    status: 'passed',
                    lastPassedAt: '2026-01-01T00:00:00.000Z'
                }
            }
        });
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() },
            transport: 'snapshot'
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: '生成して'
        }));

        expect(sessionManager.sendInput).toHaveBeenCalledWith('session-1', '生成して', 'text');
        expect(connection.ws.send).not.toHaveBeenCalledWith(expect.stringContaining('INPUT_NOT_READY'));
    });

    it('inputProbe failedならinput messageをdropする', async () => {
        const { service, sessionManager } = buildService();
        sessionManager.getSession.mockReturnValue({
            runtimeState: 'degraded',
            observed: {
                inputProbe: {
                    status: 'failed',
                    lastFailedAt: '2026-01-01T00:00:00.000Z',
                    reason: 'CLI_NOT_IDLE'
                }
            }
        });
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() },
            transport: 'snapshot'
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: '生成して'
        }));

        expect(sessionManager.sendInput).not.toHaveBeenCalled();
        expect(connection.ws.send).toHaveBeenCalledWith(expect.stringContaining('INPUT_NOT_READY'));
    });

    it('inputProbe failedでもEnter textはClaude/Codex共通でdropせず送る', async () => {
        const { service, sessionManager } = buildService();
        sessionManager.getSession.mockReturnValue({
            runtimeState: 'degraded',
            observed: {
                inputProbe: {
                    status: 'failed',
                    lastFailedAt: '2026-01-01T00:00:00.000Z',
                    reason: 'CLI_NOT_IDLE'
                }
            }
        });
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() },
            transport: 'snapshot'
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: '\r'
        }));

        expect(sessionManager.sendInput).toHaveBeenCalledWith('session-1', '\r', 'text');
        expect(connection.ws.send).not.toHaveBeenCalledWith(expect.stringContaining('INPUT_NOT_READY'));
    });

    it('inputProbe failedでもShift+EnterのS-Enter keyはdropせずterminalIoへ送る', async () => {
        const { service, sessionManager, captureCache, controlClient } = buildService();
        sessionManager.getSession.mockReturnValue({
            runtimeState: 'degraded',
            observed: {
                inputProbe: {
                    status: 'failed',
                    lastFailedAt: '2026-01-01T00:00:00.000Z',
                    reason: 'CLI_NOT_IDLE'
                }
            }
        });
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() },
            transport: 'streaming',
            controlClient
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'key',
            value: 'S-Enter'
        }));

        expect(captureCache.getSnapshot).not.toHaveBeenCalled();
        expect(controlClient.sendKey).not.toHaveBeenCalled();
        expect(sessionManager.sendInput).toHaveBeenCalledWith('session-1', 'S-Enter', 'key');
        expect(connection.ws.send).not.toHaveBeenCalledWith(expect.stringContaining('INPUT_NOT_READY'));
    });

    it('OSC制御応答だけのinput messageはtmuxへ送らず無視する', async () => {
        const { service, sessionManager, captureCache } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() },
            transport: 'streaming'
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: '\x1b]10;rgb:e2e2/e8e8/f0f0\x1b\\'
        }));

        expect(sessionManager.sendInput).not.toHaveBeenCalled();
        expect(captureCache.invalidate).not.toHaveBeenCalled();
    });

    it('OSC color response断片だけのinput messageはtmuxへ送らず無視する', async () => {
        const { service, sessionManager, captureCache } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() },
            transport: 'streaming'
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: ']10;rgb:0000/0000/0000'
        }));

        expect(sessionManager.sendInput).not.toHaveBeenCalled();
        expect(captureCache.invalidate).not.toHaveBeenCalled();
    });

    it('focus report断片だけのinput messageはtmuxへ送らず無視する', async () => {
        const { service, sessionManager, captureCache } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() },
            transport: 'streaming'
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: '[I'
        }));

        expect(sessionManager.sendInput).not.toHaveBeenCalled();
        expect(captureCache.invalidate).not.toHaveBeenCalled();
    });

    it('focus report混入input messageは断片を除去してtmuxへ送る', async () => {
        const { service, sessionManager } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() },
            transport: 'snapshot'
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: 'hello[Iworld\x1b[O'
        }));

        expect(sessionManager.sendInput).toHaveBeenCalledWith('session-1', 'helloworld', 'text');
    });

    it('inputReady が false でも snapshot が ready なら probe を回復して送信する', async () => {
        const { service, sessionManager, captureCache, controlClient } = buildService();
        sessionManager.getSession.mockReturnValue({
            runtimeState: 'transport_connected',
            observed: {
                inputProbe: {
                    status: 'failed',
                    lastFailedAt: '2026-01-01T00:00:00.000Z',
                    reason: 'CLI_NOT_IDLE'
                }
            }
        });
        captureCache.getSnapshot.mockResolvedValue({
            text: '› ',
            colorText: null,
            copyMode: false,
            capturedAt: '2026-03-23T00:00:00.000Z'
        });
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() },
            transport: 'streaming',
            controlClient
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: 'hello'
        }));

        expect(captureCache.getSnapshot).toHaveBeenCalledWith('session-1', expect.objectContaining({
            includeColors: true,
            includeCopyMode: true
        }));
        expect(sessionManager.setInputProbe).toHaveBeenCalledWith('session-1', expect.objectContaining({
            status: 'passed',
            mode: 'snapshot_recovery',
            cliReason: 'codex_prompt'
        }));
        expect(controlClient.sendLiteralText).not.toHaveBeenCalled();
        expect(sessionManager.sendInput).toHaveBeenCalledWith('session-1', 'hello', 'text');
    });

    it('snapshot-polling input は同期pollせず短時間でまとめてrefreshする', async () => {
        vi.useFakeTimers();

        const { service, sessionManager } = buildService();
        service._pollConnection = vi.fn(async () => {});
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() },
            transport: 'snapshot-polling',
            closed: false,
            inputSnapshotRefreshTimer: null,
            inputSnapshotRefreshInFlight: false,
            inputSnapshotRefreshRequested: false
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: 'a'
        }));
        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: '\x7f'
        }));

        expect(sessionManager.sendInput).toHaveBeenCalledTimes(2);
        expect(service._pollConnection).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(100);

        expect(service._pollConnection).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });

    it('単一行submitはpasted text overlay検出を走らせない', () => {
        const { service } = buildService();

        expect(service._shouldCheckPastedTextOverlay('/tmp/uploads/image.png\n')).toBe(false);
        expect(service._shouldCheckPastedTextOverlay('/tmp/uploads/image.png\r')).toBe(false);
    });

    it('複数行pasteはpasted text overlay検出対象にする', () => {
        const { service } = buildService();

        expect(service._shouldCheckPastedTextOverlay('line one\nline two\n')).toBe(true);
    });

    it('ready送信時_履歴付きeager snapshotを送らずxterm接続を先に返す', async () => {
        const { service, captureCache } = buildService();
        captureCache.getSnapshot.mockResolvedValueOnce({
            text: 'history\nsnapshot',
            colorText: '\x1b[32mhistory\x1b[0m\n\x1b[32msnapshot\x1b[0m',
            copyMode: false,
            cursor: { x: 2, y: 12 },
            capturedAt: '2026-03-23T00:00:01.000Z'
        });
        const ws = { readyState: 1, send: vi.fn() };
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            cols: 80,
            rows: 24,
            ws,
            closed: false,
            lastSnapshot: null,
            lastCopyMode: null,
            lastCliState: null,
            transport: 'streaming'
        };

        await service._sendReady(connection);

        const sent = ws.send.mock.calls.map(call => JSON.parse(call[0]));
        const sentTypes = sent.map(message => message.type);
        expect(sentTypes).toEqual(['ready']);
        expect(captureCache.getSnapshot).not.toHaveBeenCalled();
        expect(captureCache.invalidate).not.toHaveBeenCalled();
    });

    it('steady-state polling snapshotにcolorTextを含める', async () => {
        const { service, captureCache } = buildService();
        captureCache.getSnapshot.mockResolvedValue({
            text: 'snapshot-next',
            colorText: '\x1b[32msnapshot-next\x1b[0m',
            copyMode: false,
            capturedAt: '2026-03-23T00:00:00.000Z'
        });
        const ws = { readyState: 1, send: vi.fn() };
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            cols: 80,
            rows: 24,
            ws,
            lastSnapshot: 'snapshot-prev',
            lastCopyMode: null,
            lastCliState: null,
            transport: 'snapshot'
        };

        await service._pollConnection(connection);

        const snapshotCall = ws.send.mock.calls.find(call => {
            const msg = JSON.parse(call[0]);
            return msg.type === 'snapshot';
        });
        expect(snapshotCall).toBeTruthy();
        const msg = JSON.parse(snapshotCall[0]);
        expect(msg).toHaveProperty('colorText');
    });

    it('snapshot-polling transportではscrollback混在を避けるためfull history snapshotを送る', async () => {
        const { service, captureCache } = buildService();
        captureCache.getSnapshot.mockResolvedValueOnce({
            text: 'history-prev\nhistory-next',
            colorText: '\x1b[36mhistory-prev\x1b[0m\n\x1b[36mhistory-next\x1b[0m',
            copyMode: false,
            cursor: { x: 3, y: 12 },
            capturedAt: '2026-03-23T00:00:00.000Z'
        });
        const ws = { readyState: 1, send: vi.fn() };
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            cols: 80,
            rows: 24,
            ws,
            lastSnapshot: 'snapshot-prev',
            lastCopyMode: null,
            lastCliState: null,
            transport: 'snapshot-polling'
        };

        await service._pollConnection(connection);

        expect(captureCache.getSnapshot).toHaveBeenCalledWith('session-1', {
            lines: 5000,
            includeColors: true,
            includeCopyMode: true,
            visibleOnly: false
        });
        const snapshotCall = ws.send.mock.calls.find(call => {
            const msg = JSON.parse(call[0]);
            return msg.type === 'snapshot';
        });
        expect(snapshotCall).toBeTruthy();
        expect(JSON.parse(snapshotCall[0])).toMatchObject({
            type: 'snapshot',
            text: 'history-prev\nhistory-next',
            colorText: '\x1b[36mhistory-prev\x1b[0m\n\x1b[36mhistory-next\x1b[0m',
            cursor: { x: 3, y: 12 },
            screenOnly: false
        });
    });

    it('ready直後のsnapshot-pollingでは初回full history snapshotを送る', async () => {
        const { service, captureCache } = buildService();
        captureCache.getSnapshot.mockResolvedValue({
            text: 'same-history',
            colorText: '\x1b[32msame-history\x1b[0m',
            copyMode: false,
            cursor: { x: 1, y: 2 },
            capturedAt: '2026-03-23T00:00:00.000Z'
        });
        const ws = { readyState: 1, send: vi.fn() };
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            cols: 80,
            rows: 24,
            ws,
            closed: false,
            lastSnapshot: null,
            lastCopyMode: null,
            lastCliState: null,
            transport: 'snapshot-polling'
        };

        await service._sendReady(connection);
        ws.send.mockClear();

        await service._pollConnection(connection);

        const snapshotCall = ws.send.mock.calls.find(call => {
            const msg = JSON.parse(call[0]);
            return msg.type === 'snapshot';
        });
        expect(snapshotCall).toBeTruthy();
        expect(JSON.parse(snapshotCall[0])).toMatchObject({
            type: 'snapshot',
            text: 'same-history',
            colorText: '\x1b[32msame-history\x1b[0m',
            screenOnly: false
        });
    });

    it('connection開始時_control-mode streamingを使い初回snapshot fallbackを予約する', async () => {
        vi.useFakeTimers();

        const { service, controlRegistry } = buildService();
        const ws = buildMockWs();

        await service._handleConnection(ws, {}, {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Mac'
        });

        const sent = ws.send.mock.calls.map(call => JSON.parse(call[0]));
        expect(sent.some(message => message.type === 'ready')).toBe(true);
        expect(sent.some(message => message.type === 'status' && message.transport === 'snapshot-polling')).toBe(false);
        expect(controlRegistry.acquire).toHaveBeenCalledWith('session-1');
        expect(service.activeConnections.get('session-1').connection.transport).toBe('streaming');
        expect(service.activeConnections.get('session-1').connection.initialSnapshotTimer).toBeTruthy();

        ws._listeners.close();
        vi.useRealTimers();
    });

    it('connection開始時_control-mode取得に失敗したらsnapshot pollingへfallbackする', async () => {
        vi.useFakeTimers();

        const { service, controlRegistry } = buildService();
        service._pollConnection = vi.fn(async () => {});
        controlRegistry.acquire.mockImplementation(() => {
            throw new Error('control unavailable');
        });
        const ws = buildMockWs();

        await service._handleConnection(ws, {}, {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Mac'
        });

        const connection = service.activeConnections.get('session-1').connection;
        const sent = ws.send.mock.calls.map(call => JSON.parse(call[0]));
        expect(sent.some(message => message.type === 'status' && message.transport === 'snapshot')).toBe(true);
        expect(connection.transport).toBe('snapshot');
        expect(connection.pollTimer).toBeTruthy();
        expect(service._pollConnection).toHaveBeenCalledWith(connection);

        ws._listeners.close();
        vi.useRealTimers();
    });

    describe('explicit takeover: 既存接続の保護', () => {
        it('同一セッションに別viewerIdで接続時_新しい接続をblocked送信+closeする', async () => {
            const { service, sessionManager } = buildService();
            const terminalAccess = { owner: 'viewer-2' };
            sessionManager.ensureTerminalOwnership
                .mockReturnValueOnce({ allowed: true, terminalAccess: { state: 'owner' } })
                .mockReturnValueOnce({ allowed: false, terminalAccess });

            const ws1 = buildMockWs();
            const ws2 = buildMockWs();

            // 1つ目の接続
            await service._handleConnection(ws1, {}, {
                sessionId: 'session-1', viewerId: 'viewer-1', viewerLabel: 'Mac'
            });

            expect(service.activeConnections.has('session-1')).toBe(true);
            expect(service.activeConnections.get('session-1').viewerId).toBe('viewer-1');

            // 2つ目の接続（別viewer）
            await service._handleConnection(ws2, {}, {
                sessionId: 'session-1', viewerId: 'viewer-2', viewerLabel: 'iPhone'
            });

            // 新しい接続がblocked送信+close(4001)される
            const blockedCall = ws2.send.mock.calls.find(call => {
                const msg = JSON.parse(call[0]);
                return msg.type === 'blocked';
            });
            expect(blockedCall).toBeTruthy();
            expect(ws2.close).toHaveBeenCalledWith(4001, 'session_owned_by_other_viewer');

            // activeConnectionsは元のviewerのまま
            expect(service.activeConnections.get('session-1').viewerId).toBe('viewer-1');
        });

        it('同一viewerIdで再接続時_既存接続はcloseされない', async () => {
            const { service, sessionManager } = buildService();
            sessionManager.ensureTerminalOwnership.mockReturnValue({ allowed: true });

            const ws1 = buildMockWs();
            const ws2 = buildMockWs();

            await service._handleConnection(ws1, {}, {
                sessionId: 'session-1', viewerId: 'viewer-1', viewerLabel: 'Mac'
            });
            await service._handleConnection(ws2, {}, {
                sessionId: 'session-1', viewerId: 'viewer-1', viewerLabel: 'Mac'
            });

            // 同一viewerなのでblocked送信されない
            const blockedCall = ws1.send.mock.calls.find(call => {
                const msg = JSON.parse(call[0]);
                return msg.type === 'blocked';
            });
            expect(blockedCall).toBeUndefined();
        });

        it('接続close時にactiveConnectionsから削除される', async () => {
            const { service, sessionManager } = buildService();
            sessionManager.ensureTerminalOwnership.mockReturnValue({ allowed: true });

            const ws = buildMockWs();

            await service._handleConnection(ws, {}, {
                sessionId: 'session-1', viewerId: 'viewer-1', viewerLabel: 'Mac'
            });

            expect(service.activeConnections.has('session-1')).toBe(true);

            // closeイベント発火
            ws._listeners.close();

            expect(service.activeConnections.has('session-1')).toBe(false);
        });

        it('takeover後に古いactive connectionが残っている場合_古い接続を閉じて新ownerを通す', async () => {
            const { service, sessionManager } = buildService();
            sessionManager.ensureTerminalOwnership.mockReturnValue({ allowed: true, terminalAccess: { state: 'owner' } });
            const oldWs = buildMockWs();
            const newWs = buildMockWs();
            service.activeConnections.set('session-1', {
                viewerId: 'viewer-old',
                ws: oldWs,
                connection: { sessionId: 'session-1', viewerId: 'viewer-old' }
            });

            await service._handleConnection(newWs, {}, {
                sessionId: 'session-1',
                viewerId: 'viewer-new',
                viewerLabel: 'Mac',
                cols: 120,
                rows: 40
            });

            expect(oldWs.send).toHaveBeenCalledWith(expect.stringContaining('session_taken_over'));
            expect(oldWs.close).toHaveBeenCalledWith(4001, 'session_taken_over');
            expect(newWs.close).not.toHaveBeenCalled();
            expect(service.activeConnections.get('session-1').viewerId).toBe('viewer-new');

            newWs._listeners.close();
        });

        it('current owner connection close時にownershipを解放する', async () => {
            const { service, sessionManager } = buildService();
            sessionManager.ensureTerminalOwnership.mockReturnValue({ allowed: true });
            const ws = buildMockWs();

            await service._handleConnection(ws, {}, {
                sessionId: 'session-1',
                viewerId: 'viewer-1',
                viewerLabel: 'Mac'
            });

            ws._listeners.close();

            expect(sessionManager.releaseTerminalOwnership).toHaveBeenCalledWith('session-1', 'viewer-1');
        });
    });

    it('exit_copy_mode message で exitCopyMode を呼ぶ', async () => {
        const { service, sessionManager, captureCache } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() },
            transport: 'streaming'
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'exit_copy_mode'
        }));

        expect(sessionManager.exitCopyMode).toHaveBeenCalledWith('session-1');
        expect(captureCache.invalidate).toHaveBeenCalledWith('session-1');
    });

    it('INV-4/S-3 alternate buffer scroll message はtmux scrollSessionへ送る', async () => {
        const { service, sessionManager, captureCache } = buildService();
        const ws = { readyState: 1, send: vi.fn() };
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws,
            transport: 'streaming',
            inputReady: true
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'scroll',
            direction: 'up',
            steps: 20
        }));

        expect(sessionManager.scrollSession).toHaveBeenCalledWith('session-1', 'up', 8);
        expect(captureCache.invalidate).toHaveBeenCalledWith('session-1');
        expect(captureCache.getSnapshot).toHaveBeenCalledWith('session-1', {
            lines: 5000,
            includeColors: true,
            includeCopyMode: true,
            visibleOnly: false
        });
        expect(sessionManager.touchTerminalOwnership).toHaveBeenCalledWith('session-1', 'viewer-1', 'Local / Mac');
        const snapshotCall = ws.send.mock.calls.find((call) => JSON.parse(call[0]).type === 'snapshot');
        expect(JSON.parse(snapshotCall[0])).toMatchObject({
            type: 'snapshot',
            text: 'snapshot',
            screenOnly: false
        });
        const statusCalls = ws.send.mock.calls.filter((call) => JSON.parse(call[0]).type === 'status');
        const statusCall = statusCalls[statusCalls.length - 1];
        expect(JSON.parse(statusCall[0])).toMatchObject({
            type: 'status',
            mode: 'live',
            copyMode: true,
            transport: 'streaming'
        });
    });

    it('streaming resize message で tmux pane をリサイズしてから control client をrefreshする', async () => {
        const { service, sessionManager, controlClient } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            cols: 80,
            rows: 24,
            ws: { readyState: 1, send: vi.fn() },
            transport: 'streaming',
            controlClient
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'resize',
            cols: 120,
            rows: 40
        }));

        expect(sessionManager.resizeSessionWindow).toHaveBeenCalledWith('session-1', 120, 40);
        expect(controlClient.resize).toHaveBeenCalledWith(120, 40);
        expect(sessionManager.resizeSessionWindow.mock.invocationCallOrder[0])
            .toBeLessThan(controlClient.resize.mock.invocationCallOrder[0]);
    });

    it('resize message が極小寸法の場合_tmux/control clientへ安全な最小寸法で渡す', async () => {
        const { service, sessionManager, controlClient } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            cols: 80,
            rows: 24,
            ws: { readyState: 1, send: vi.fn() },
            transport: 'streaming',
            controlClient
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'resize',
            cols: 2,
            rows: 1
        }));

        expect(sessionManager.resizeSessionWindow).toHaveBeenCalledWith('session-1', 40, 12);
        expect(controlClient.resize).toHaveBeenCalledWith(40, 12);
        expect(connection.cols).toBe(40);
        expect(connection.rows).toBe(12);
    });

    it('streaming input はterminal-io経路へfallbackする', async () => {
        const { service, sessionManager, controlClient, captureCache } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() },
            transport: 'streaming',
            controlClient
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: 'hello'
        }));

        expect(controlClient.sendLiteralText).not.toHaveBeenCalled();
        expect(sessionManager.sendInput).toHaveBeenCalledWith('session-1', 'hello', 'text');
        expect(captureCache.invalidate).toHaveBeenCalledWith('session-1');
        expect(sessionManager.touchTerminalOwnership).toHaveBeenCalledWith('session-1', 'viewer-1', 'Local / Mac');
    });

    it('streaming Backspace text はterminal-io経路へfallbackする', async () => {
        const { service, sessionManager, controlClient } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() },
            transport: 'streaming',
            controlClient
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: '\x7f'
        }));

        expect(controlClient.sendKey).not.toHaveBeenCalled();
        expect(sessionManager.sendInput).toHaveBeenCalledWith('session-1', '\x7f', 'text');
    });

    it('streaming multiline paste は既存のterminalIo経路にfallbackする', async () => {
        const { service, sessionManager, controlClient } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() },
            transport: 'streaming',
            controlClient
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: 'hello\nworld'
        }));

        expect(controlClient.sendLiteralText).not.toHaveBeenCalled();
        expect(controlClient.sendKey).not.toHaveBeenCalled();
        expect(sessionManager.sendInput).toHaveBeenCalledWith('session-1', 'hello\nworld', 'text');
    });

    it('paste message はterminalIoのbracketed paste経路へ一括送信する', async () => {
        const { service, sessionManager, controlClient } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() },
            transport: 'streaming',
            controlClient
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'paste',
            value: 'hello\nworld'
        }));

        expect(controlClient.sendLiteralText).not.toHaveBeenCalled();
        expect(controlClient.sendKey).not.toHaveBeenCalled();
        expect(sessionManager.sendInput).toHaveBeenCalledWith('session-1', 'hello\nworld', 'text', {
            forcePaste: true,
            bracketedPaste: true,
            preserveLineFeed: true
        });
    });

    it('message handler は sendInput 失敗時も error を返して接続を維持する', async () => {
        const { service, sessionManager, controlClient } = buildService();
        sessionManager.ensureTerminalOwnership.mockReturnValue({ allowed: true });
        controlClient.sendLiteralText.mockReturnValue(false);
        sessionManager.sendInput.mockRejectedValue(new Error('tmux send failed'));

        const ws = buildMockWs();

        await service._handleConnection(ws, {}, {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Mac'
        });

        ws._listeners.message(Buffer.from(JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: 'hello'
        })));
        await new Promise(resolve => setTimeout(resolve, 0));

        const errorCall = ws.send.mock.calls.find((call) => {
            const message = JSON.parse(call[0]);
            return message.type === 'error' && message.code === 'INPUT_ERROR';
        });

        expect(errorCall).toBeTruthy();
        expect(ws.close).not.toHaveBeenCalled();
    });

    it('streaming outputをそのままoutputメッセージで転送する', async () => {
        vi.useFakeTimers();

        const { service, controlClient } = buildService();
        const ws = { readyState: 1, send: vi.fn() };
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            cols: 80,
            rows: 24,
            ws,
            transport: 'snapshot',
            closed: false
        };

        await service._startStreaming(connection);

        const outputHandler = controlClient.on.mock.calls.find(([event]) => event === 'output')[1];
        outputHandler('\u001b[32mhello\u001b[0m');
        await vi.advanceTimersByTimeAsync(8);

        expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
            type: 'output',
            data: '\u001b[32mhello\u001b[0m'
        }));

        vi.useRealTimers();
    });

    it('初回streaming output受信時も_initial snapshot fallbackをキャンセルしない', async () => {
        vi.useFakeTimers();

        const { service, controlClient, captureCache } = buildService();
        const ws = { readyState: 1, send: vi.fn() };
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            cols: 80,
            rows: 24,
            ws,
            transport: 'snapshot',
            closed: false,
            initialFrameDelivered: false,
            initialSnapshotTimer: null
        };

        await service._startStreaming(connection);
        service._scheduleInitialSnapshotFallback(connection);

        const outputHandler = controlClient.on.mock.calls.find(([event]) => event === 'output')[1];
        outputHandler('live frame');

        await vi.advanceTimersByTimeAsync(200);

        const sentTypes = ws.send.mock.calls.map(call => JSON.parse(call[0]).type);
        expect(sentTypes).toEqual(['output', 'snapshot', 'status']);
        expect(captureCache.getSnapshot).toHaveBeenCalledWith('session-1', {
            lines: 5000,
            includeColors: true,
            includeCopyMode: true,
            visibleOnly: false
        });

        vi.useRealTimers();
    });

    it('初回streaming outputが来ない場合_fallback snapshotを1回送る', async () => {
        vi.useFakeTimers();

        const { service, captureCache } = buildService();
        const ws = { readyState: 1, send: vi.fn() };
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            cols: 80,
            rows: 24,
            ws,
            transport: 'streaming',
            closed: false,
            initialFrameDelivered: false,
            initialSnapshotTimer: null,
            lastSnapshot: null,
            lastCopyMode: null,
            lastCliState: null
        };

        service._scheduleInitialSnapshotFallback(connection);
        await vi.advanceTimersByTimeAsync(200);

        const sentTypes = ws.send.mock.calls.map(call => JSON.parse(call[0]).type);
        expect(sentTypes).toContain('snapshot');
        const snapshotMessage = ws.send.mock.calls
            .map(call => JSON.parse(call[0]))
            .find(message => message.type === 'snapshot');
        expect(snapshotMessage.screenOnly).toBe(false);
        expect(captureCache.invalidate).toHaveBeenCalledWith('session-1');
        expect(captureCache.getSnapshot).toHaveBeenCalledWith('session-1', {
            lines: 5000,
            includeColors: true,
            includeCopyMode: true,
            visibleOnly: false
        });
        expect(connection.initialFrameDelivered).toBe(true);

        vi.useRealTimers();
    });

    it('transportがstreamingでない場合_initial snapshot fallbackをスケジュールしない', () => {
        vi.useFakeTimers();

        const { service } = buildService();
        const connection = {
            closed: false,
            transport: 'snapshot',
            initialSnapshotTimer: null
        };

        service._scheduleInitialSnapshotFallback(connection);

        expect(connection.initialSnapshotTimer).toBeNull();

        vi.useRealTimers();
    });
});
