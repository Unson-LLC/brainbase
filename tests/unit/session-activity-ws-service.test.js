import { describe, it, expect, vi } from 'vitest';
import { SessionActivityWsService } from '../../server/services/session-activity-ws-service.js';

function createMockWs(readyState = 1) {
    return {
        readyState,
        send: vi.fn(),
        on: vi.fn(),
        close: vi.fn()
    };
}

describe('SessionActivityWsService', () => {
    it('broadcast呼び出し時_接続中のクライアントにメッセージが送信される', () => {
        const service = new SessionActivityWsService({
            activityService: { getSessionStatus: () => ({}) }
        });
        const ws = createMockWs(1);
        service.clients.add(ws);

        service.broadcast('session-1', { isWorking: true, isDone: false });

        expect(ws.send).toHaveBeenCalledTimes(1);
        const msg = JSON.parse(ws.send.mock.calls[0][0]);
        expect(msg).toEqual({
            type: 'status-update',
            sessionId: 'session-1',
            data: { isWorking: true, isDone: false }
        });
    });

    it('broadcast呼び出し時_切断済みクライアントはスキップされる', () => {
        const service = new SessionActivityWsService({
            activityService: { getSessionStatus: () => ({}) }
        });
        const wsOpen = createMockWs(1);
        const wsClosed = createMockWs(3);
        service.clients.add(wsOpen);
        service.clients.add(wsClosed);

        service.broadcast('session-1', { isWorking: true });

        expect(wsOpen.send).toHaveBeenCalledTimes(1);
        expect(wsClosed.send).not.toHaveBeenCalled();
    });

    it('broadcast呼び出し時_クライアントがいなければ何もしない', () => {
        const service = new SessionActivityWsService({
            activityService: { getSessionStatus: () => ({}) }
        });

        expect(() => service.broadcast('session-1', { isWorking: true })).not.toThrow();
    });

    it('isActivityWsRequest呼び出し時_正しいURLパスでtrueを返す', () => {
        const service = new SessionActivityWsService({
            activityService: { getSessionStatus: () => ({}) }
        });

        expect(service.isActivityWsRequest({ url: '/api/sessions/activity/ws' })).toBe(true);
        expect(service.isActivityWsRequest({ url: '/api/sessions/activity/ws?foo=bar' })).toBe(true);
        expect(service.isActivityWsRequest({ url: '/api/sessions/status' })).toBe(false);
        expect(service.isActivityWsRequest({ url: '/api/sessions/123/terminal/ws' })).toBe(false);
    });

    it('broadcast呼び出し時_nullデータも送信できる', () => {
        const service = new SessionActivityWsService({
            activityService: { getSessionStatus: () => ({}) }
        });
        const ws = createMockWs(1);
        service.clients.add(ws);

        service.broadcast('session-1', null);

        const msg = JSON.parse(ws.send.mock.calls[0][0]);
        expect(msg.data).toBeNull();
    });

    it('broadcastFullStatus呼び出し時_現在の全statusを送信する', () => {
        const service = new SessionActivityWsService({
            activityService: {
                getSessionStatus: () => ({
                    'session-kept': { isWorking: true },
                    'session-done': { isDone: true }
                })
            }
        });
        const ws = createMockWs(1);
        service.clients.add(ws);

        service.broadcastFullStatus();

        const msg = JSON.parse(ws.send.mock.calls[0][0]);
        expect(msg).toEqual({
            type: 'status-full',
            data: {
                'session-kept': { isWorking: true },
                'session-done': { isDone: true }
            }
        });
    });

    it('fullStatusIntervalMs指定時_定期的に全statusを送信する', () => {
        vi.useFakeTimers();
        try {
            const service = new SessionActivityWsService({
                activityService: { getSessionStatus: () => ({ 'session-1': { isDone: true } }) },
                fullStatusIntervalMs: 3000
            });
            const ws = createMockWs(1);
            service.clients.add(ws);

            vi.advanceTimersByTime(3000);

            expect(ws.send).toHaveBeenCalledTimes(1);
            const msg = JSON.parse(ws.send.mock.calls[0][0]);
            expect(msg.type).toBe('status-full');
            service.close();
        } finally {
            vi.useRealTimers();
        }
    });
});
