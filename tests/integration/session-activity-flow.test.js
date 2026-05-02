import { describe, it, expect, beforeEach, vi } from 'vitest';
import { activityServiceMethods } from '../../server/services/session-core/activity-service-methods.js';
import { SessionActivityWsService } from '../../server/services/session-activity-ws-service.js';

/**
 * Integration: reportActivity → ws.broadcast → client receive の連鎖
 *
 * NocoDB課題#5「Activeインジケーター不安定」 の修正が、
 * - reportActivity (server) で hookStatus を正しく更新し
 * - _activityWsBroadcast 経由で ws.broadcast を呼び
 * - SessionActivityWsService.broadcast が clients に正しい payload を送る
 * 一連のフローで動くことを検証。
 */

function createSvc(activityWsBroadcast) {
    const svc = {
        hookStatus: new Map(),
        promptBuffers: new Map(),
        sessions: [],
        _activityWsBroadcast: activityWsBroadcast,
        _persistHookStatus: () => Promise.resolve(),
        _persistSessionLiveSummary: () => Promise.resolve()
    };
    for (const [name, fn] of Object.entries(activityServiceMethods)) {
        svc[name] = fn.bind(svc);
    }
    return svc;
}

function createMockWs(readyState = 1) {
    return { readyState, send: vi.fn(), on: vi.fn(), close: vi.fn() };
}

describe('session activity flow integration', () => {
    let svc;
    let ws;
    let activityWs;
    let broadcastCalls;

    beforeEach(() => {
        broadcastCalls = [];
        activityWs = new SessionActivityWsService({
            activityService: { getSessionStatus: () => ({}) }
        });
        ws = createMockWs(1);
        activityWs.clients.add(ws);

        svc = createSvc((sessionId, hookStatus) => {
            broadcastCalls.push({ sessionId, hookStatus });
            activityWs.broadcast(sessionId, hookStatus);
        });
    });

    const NOW = Date.now();

    it('turn_started受信時_isWorkingでwsへbroadcastされる', () => {
        svc.reportActivity('s1', 'working', NOW, { lifecycle: 'turn_started', turnId: 't1' });

        expect(broadcastCalls).toHaveLength(1);
        expect(broadcastCalls[0].sessionId).toBe('s1');
        expect(broadcastCalls[0].hookStatus.isWorking).toBe(true);

        expect(ws.send).toHaveBeenCalledTimes(1);
        const msg = JSON.parse(ws.send.mock.calls[0][0]);
        expect(msg.type).toBe('status-update');
        expect(msg.sessionId).toBe('s1');
        expect(msg.data.isWorking).toBe(true);
    });

    it('turn_completed受信時_isDoneでwsへbroadcastされる', () => {
        svc.reportActivity('s1', 'working', NOW, { lifecycle: 'turn_started', turnId: 't1' });
        ws.send.mockClear();

        svc.reportActivity('s1', 'done', NOW + 1000, { lifecycle: 'turn_completed', turnId: 't1' });

        expect(ws.send).toHaveBeenCalledTimes(1);
        const msg = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0]);
        expect(msg.data.isDone).toBe(true);
        expect(msg.data.isWorking).toBe(false);
    });

    it('legacy lifecycle無しworking_lastDoneAtが破壊されずdoneがbroadcastされる', () => {
        // 課題#5の memory gotcha: 「turn_started で前回 done を消すと復元不能」
        svc.reportActivity('s1', 'done', NOW);
        const afterDone = svc.hookStatus.get('s1');
        expect(afterDone.lastDoneAt).toBe(NOW);

        // legacy hook が status='working' を送ってくる
        svc.reportActivity('s1', 'working', NOW + 1000);
        const afterWorking = svc.hookStatus.get('s1');

        // Fix A: lastDoneAt が破壊的にリセットされない
        expect(afterWorking.lastDoneAt).toBe(NOW);
        expect(afterWorking.lastWorkingAt).toBe(NOW + 1000);

        // status='working' で broadcast に isWorking=true が乗る
        const lastSend = ws.send.mock.calls[ws.send.mock.calls.length - 1][0];
        const msg = JSON.parse(lastSend);
        expect(msg.data.isWorking).toBe(true);
    });

    it('heartbeat_done状態_lastWorkingAtが更新されずworkingにならない', () => {
        // Fix B: heartbeat 分岐 (`>`) と effectiveStatus 計算 (`>`) の統一
        svc.reportActivity('s1', 'working', NOW);
        svc.reportActivity('s1', 'done', NOW);
        ws.send.mockClear();

        svc.reportActivity('s1', 'working', NOW + 1000, { lifecycle: 'heartbeat' });

        const status = svc.hookStatus.get('s1');
        expect(status.lastWorkingAt).toBe(NOW);
        expect(status.status).toBe('done');

        // broadcast されるが isDone のまま
        if (ws.send.mock.calls.length > 0) {
            const msg = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0]);
            // null送信 (status消失) または isDone なら OK
            expect(msg.data === null || msg.data.isDone === true).toBe(true);
        }
    });
});
