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
        touchTerminalOwnership: vi.fn(),
        ensureTerminalOwnership: vi.fn(() => ({ allowed: true })),
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

    it('ready送信時のみcolorText付きsnapshotを返す', async () => {
        const { service, captureCache } = buildService();
        captureCache.getSnapshot.mockResolvedValue({
            text: 'snapshot',
            colorText: '\x1b[32mgreen\x1b[0m',
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
            lastSnapshot: null,
            lastCopyMode: null,
            lastCliState: null,
            transport: 'streaming'
        };

        await service._sendReady(connection);

        const snapshotCall = ws.send.mock.calls.find(call => {
            const msg = JSON.parse(call[0]);
            return msg.type === 'snapshot';
        });
        expect(snapshotCall).toBeTruthy();
        const msg = JSON.parse(snapshotCall[0]);
        expect(msg.colorText).toBe('\x1b[32mgreen\x1b[0m');
        expect(msg.text).toBe('snapshot');
    });

    it('steady-state polling snapshotにはcolorTextを含めない', async () => {
        const { service, captureCache } = buildService();
        captureCache.getSnapshot.mockResolvedValue({
            text: 'snapshot-next',
            colorText: null,
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
        expect(msg).not.toHaveProperty('colorText');
    });

    describe('auto-takeover: 既存接続の即切断', () => {
        it('同一セッションに別viewerIdで接続時_前の接続がblocked送信+closeされる', async () => {
            const { service, sessionManager } = buildService();
            const terminalAccess = { owner: 'viewer-2' };
            sessionManager.ensureTerminalOwnership.mockReturnValue({ allowed: true, terminalAccess });

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

            // 前の接続がblocked送信+close(4001)されている
            const blockedCall = ws1.send.mock.calls.find(call => {
                const msg = JSON.parse(call[0]);
                return msg.type === 'blocked';
            });
            expect(blockedCall).toBeTruthy();
            expect(ws1.close).toHaveBeenCalledWith(4001, 'ownership_taken_over');

            // activeConnectionsは新しいviewerに更新されている
            expect(service.activeConnections.get('session-1').viewerId).toBe('viewer-2');
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

    it('resize message で sessionManager.resizeSessionWindow を呼ぶ', async () => {
        const { service, controlClient } = buildService();
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

        expect(controlClient.resize).toHaveBeenCalledWith(120, 40);
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
            value: '\u001b]11;rgb:0000/0000/0000\u001b\\'
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

        expect(ws.send).toHaveBeenCalledWith(JSON.stringify({
            type: 'output',
            data: '\u001b[32mhello\u001b[0m'
        }));
    });
});
