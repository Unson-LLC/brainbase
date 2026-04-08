import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionActivityWsClient } from '../../public/modules/core/session-activity-ws-client.js';

describe('SessionActivityWsClient', () => {
    let mockWs;
    let MockWebSocket;

    beforeEach(() => {
        vi.useFakeTimers();
        mockWs = {
            onopen: null,
            onmessage: null,
            onclose: null,
            onerror: null,
            close: vi.fn(),
            readyState: 1
        };
        MockWebSocket = vi.fn(function () {
            return mockWs;
        });
        vi.stubGlobal('WebSocket', MockWebSocket);
        vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:31013' });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('connect時_正しいURLでWebSocketが作成される', () => {
        const client = new SessionActivityWsClient({
            onStatusFull: vi.fn(),
            onStatusUpdate: vi.fn()
        });
        client.connect();

        expect(MockWebSocket).toHaveBeenCalledWith('ws://localhost:31013/api/sessions/activity/ws');
    });

    it('status-fullメッセージ受信時_onStatusFullが呼ばれる', () => {
        const onStatusFull = vi.fn();
        const client = new SessionActivityWsClient({
            onStatusFull,
            onStatusUpdate: vi.fn()
        });
        client.connect();

        const data = { 'session-1': { isWorking: true } };
        mockWs.onmessage({ data: JSON.stringify({ type: 'status-full', data }) });

        expect(onStatusFull).toHaveBeenCalledWith(data);
    });

    it('status-updateメッセージ受信時_onStatusUpdateが呼ばれる', () => {
        const onStatusUpdate = vi.fn();
        const client = new SessionActivityWsClient({
            onStatusFull: vi.fn(),
            onStatusUpdate
        });
        client.connect();

        const hookStatus = { isWorking: true, isDone: false };
        mockWs.onmessage({ data: JSON.stringify({
            type: 'status-update',
            sessionId: 'session-1',
            data: hookStatus
        }) });

        expect(onStatusUpdate).toHaveBeenCalledWith('session-1', hookStatus);
    });

    it('接続成功時_onConnectionChangeにtrueが渡される', () => {
        const onConnectionChange = vi.fn();
        const client = new SessionActivityWsClient({
            onStatusFull: vi.fn(),
            onStatusUpdate: vi.fn(),
            onConnectionChange
        });
        client.connect();
        mockWs.onopen();

        expect(onConnectionChange).toHaveBeenCalledWith(true);
    });

    it('切断時_再接続がスケジュールされる', () => {
        let wsCount = 0;
        const wsList = [];
        MockWebSocket.mockImplementation(function () {
            wsCount++;
            const ws = {
                onopen: null, onmessage: null, onclose: null, onerror: null,
                close: vi.fn(), readyState: 1
            };
            wsList.push(ws);
            return ws;
        });

        const client = new SessionActivityWsClient({
            onStatusFull: vi.fn(),
            onStatusUpdate: vi.fn(),
            onConnectionChange: vi.fn()
        });
        client.connect();
        expect(wsCount).toBe(1);

        wsList[0].onclose();

        vi.advanceTimersByTime(2000);

        expect(wsCount).toBe(2);
    });

    it('close呼び出し後_再接続しない', () => {
        const client = new SessionActivityWsClient({
            onStatusFull: vi.fn(),
            onStatusUpdate: vi.fn()
        });
        client.connect();
        client.close();

        mockWs.onclose?.();
        vi.advanceTimersByTime(60000);

        expect(MockWebSocket).toHaveBeenCalledTimes(1);
    });
});
