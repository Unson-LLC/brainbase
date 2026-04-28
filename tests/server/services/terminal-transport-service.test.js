import { describe, expect, it, vi } from 'vitest';
import { TerminalTransportService } from '../../../server/services/terminal-transport-service.js';

function buildService() {
    const captureCache = {
        getSnapshot: vi.fn(async () => ({
            text: 'snapshot',
            colorText: null,
            copyMode: false,
            capturedAt: '2026-03-23T00:00:00.000Z'
        })),
        invalidate: vi.fn()
    };
    const controlClient = {
        on: vi.fn(),
        off: vi.fn(),
        resize: vi.fn(),
        touch: vi.fn()
    };
    const controlRegistry = {
        acquire: vi.fn(() => controlClient),
        release: vi.fn()
    };
    const sessionManager = {
        sendInput: vi.fn(async () => {}),
        resizeSessionWindow: vi.fn(async () => {}),
        exitCopyMode: vi.fn(async () => {}),
        touchTerminalOwnership: vi.fn(),
        ensureTerminalOwnership: vi.fn(() => ({ allowed: true })),
        getTerminalAccessState: vi.fn(() => ({ state: 'owner' })),
        getSession: vi.fn(() => ({
            runtimeState: 'interactive_ready',
            observed: { inputProbe: { status: 'passed' } }
        })),
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

    it('ready送信時_eager snapshotも送る', async () => {
        const { service, captureCache } = buildService();
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

        const sentTypes = ws.send.mock.calls.map(call => JSON.parse(call[0]).type);
        expect(sentTypes).toEqual(['ready', 'snapshot']);
        expect(captureCache.getSnapshot).toHaveBeenCalledWith('session-1', {
            lines: 400,
            includeColors: true,
            includeCopyMode: true
        });
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

    it('message handler は sendInput 失敗時も error を返して接続を維持する', async () => {
        const { service, sessionManager } = buildService();
        sessionManager.ensureTerminalOwnership.mockReturnValue({ allowed: true });
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

    it('初回streaming output受信時_initial snapshot fallbackをキャンセルする', async () => {
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
        expect(sentTypes).toEqual(['output']);
        expect(captureCache.getSnapshot).not.toHaveBeenCalled();

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
        expect(captureCache.invalidate).toHaveBeenCalledWith('session-1');
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
