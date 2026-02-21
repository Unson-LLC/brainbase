import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StateController } from '../../server/controllers/state-controller.js';

function createMockRes() {
    return {
        statusCode: 200,
        body: null,
        headers: {},
        set: vi.fn(function setHeader(key, value) {
            this.headers[key] = value;
            return this;
        }),
        status: vi.fn(function setStatus(code) {
            this.statusCode = code;
            return this;
        }),
        json: vi.fn(function sendJson(payload) {
            this.body = payload;
            return this;
        }),
        end: vi.fn(function end() {
            return this;
        })
    };
}

describe('StateController ETag', () => {
    let stateController;
    let mockStateStore;
    let mockSessionManager;

    beforeEach(() => {
        mockStateStore = {
            get: vi.fn(() => ({
                sessions: [
                    { id: 'session-1', intendedState: 'active', name: 'Session 1' }
                ],
                preferences: {}
            }))
        };

        mockSessionManager = {
            waitUntilReady: vi.fn(async () => true),
            getActiveSessions: vi.fn(() => new Map())
        };

        stateController = new StateController(mockStateStore, mockSessionManager, false);
    });

    it('GET /api/state 呼び出し時_ETag付きで状態を返す', async () => {
        const req = { headers: {} };
        const res = createMockRes();

        await stateController.get(req, res);

        expect(res.json).toHaveBeenCalled();
        expect(res.headers).toHaveProperty('ETag');
        expect(res.body).toHaveProperty('etag');
        expect(res.body.etag).toBe(res.headers.ETag);
    });

    it('GET /api/state 呼び出し時_If-None-Match一致なら304を返す', async () => {
        const firstReq = { headers: {} };
        const firstRes = createMockRes();
        await stateController.get(firstReq, firstRes);

        const secondReq = {
            headers: {
                'if-none-match': firstRes.headers.ETag
            }
        };
        const secondRes = createMockRes();

        await stateController.get(secondReq, secondRes);

        expect(secondRes.status).toHaveBeenCalledWith(304);
        expect(secondRes.end).toHaveBeenCalled();
        expect(secondRes.json).not.toHaveBeenCalled();
    });

    it('GET /api/state 呼び出し時_ランタイム変化でETagが変わる', async () => {
        const firstReq = { headers: {} };
        const firstRes = createMockRes();
        await stateController.get(firstReq, firstRes);

        mockSessionManager.getActiveSessions.mockReturnValue(new Map([
            ['session-1', { port: 9010 }]
        ]));
        const secondReq = { headers: {} };
        const secondRes = createMockRes();
        await stateController.get(secondReq, secondRes);

        expect(firstRes.headers.ETag).not.toBe(secondRes.headers.ETag);
    });
});
