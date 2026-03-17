import { describe, expect, it, vi } from 'vitest';
import { TerminalTransportService } from '../../../server/services/terminal-transport-service.js';

function buildService() {
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

    const service = new TerminalTransportService({ sessionManager });
    return { service, sessionManager };
}

describe('TerminalTransportService', () => {
    it('input message で tmux sendInput を呼ぶ', async () => {
        const { service, sessionManager } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            ws: { readyState: 1, send: vi.fn() }
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'input',
            inputType: 'text',
            value: 'hello'
        }));

        expect(sessionManager.sendInput).toHaveBeenCalledWith('session-1', 'hello', 'text');
        expect(sessionManager.touchTerminalOwnership).toHaveBeenCalledWith('session-1', 'viewer-1', 'Local / Mac');
    });

    it('snapshotメッセージにcolorTextフィールドが含まれる', async () => {
        const { service, sessionManager } = buildService();
        sessionManager.getContentWithColors.mockResolvedValue('\x1b[32mgreen\x1b[0m');
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
            lastCliState: null
        };

        await service._pollConnection(connection);

        const snapshotCall = ws.send.mock.calls.find(call => {
            const msg = JSON.parse(call[0]);
            return msg.type === 'snapshot';
        });
        expect(snapshotCall).toBeTruthy();
        const msg = JSON.parse(snapshotCall[0]);
        expect(msg.colorText).toBe('\x1b[32mgreen\x1b[0m');
        expect(msg.text).toBe('snapshot');
    });

    it('colorTextがnullの場合snapshotにcolorTextフィールドを含めない', async () => {
        const { service, sessionManager } = buildService();
        sessionManager.getContentWithColors.mockResolvedValue(null);
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
            lastCliState: null
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
        function buildMockWs() {
            const listeners = {};
            return {
                readyState: 1,
                send: vi.fn(),
                close: vi.fn(() => {
                    // close時にcloseリスナーを呼ぶ
                    if (listeners.close) listeners.close();
                }),
                on: vi.fn((event, handler) => {
                    listeners[event] = handler;
                }),
                _listeners: listeners
            };
        }

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
        const { service, sessionManager } = buildService();
        const connection = {
            sessionId: 'session-1',
            viewerId: 'viewer-1',
            viewerLabel: 'Local / Mac',
            cols: 80,
            rows: 24,
            ws: { readyState: 1, send: vi.fn() }
        };

        await service._handleMessage(connection, JSON.stringify({
            type: 'resize',
            cols: 120,
            rows: 40
        }));

        expect(sessionManager.resizeSessionWindow).toHaveBeenCalledWith('session-1', 120, 40);
    });
});
