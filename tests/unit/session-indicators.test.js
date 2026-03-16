import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../public/modules/core/event-bus.js', () => ({
    eventBus: {
        emit: vi.fn().mockResolvedValue({ success: true, errors: [] })
    },
    EVENTS: {
        SESSION_UPDATED: 'session:updated',
        SESSION_UI_STATE_CHANGED: 'session:ui-state-changed'
    }
}));

vi.mock('../../public/modules/toast.js', () => ({
    showError: vi.fn(),
    showInfo: vi.fn()
}));

vi.mock('../../public/modules/core/http-client.js', () => ({
    httpClient: {
        post: vi.fn()
    }
}));

import { eventBus, EVENTS } from '../../public/modules/core/event-bus.js';
import { httpClient } from '../../public/modules/core/http-client.js';
import { appStore } from '../../public/modules/core/store.js';
import { markDoneAsRead, pollSessionStatus } from '../../public/modules/session-indicators.js';
import { getSessionStatus, getSessionUiEntry } from '../../public/modules/session-ui-state.js';

describe('session-indicators', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        appStore.setState({ sessionUi: { byId: {} } });
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({})
        });
        httpClient.post.mockResolvedValue({ success: true });
    });

    it('markDoneAsRead呼び出し時_done状態が即時クリアされる', async () => {
        const fetchMock = vi.fn((input) => {
            const url = typeof input === 'string' ? input : input?.url;
            if (url === '/api/sessions/status') {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        'session-1': {
                            isWorking: false,
                            isDone: true,
                            lastWorkingAt: 0,
                            lastDoneAt: 100,
                            timestamp: 100
                        }
                    })
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        globalThis.fetch = fetchMock;

        await pollSessionStatus('session-2');
        expect(getSessionStatus('session-1').isDone).toBe(true);
        expect(getSessionUiEntry('session-1').hookStatus.isDone).toBe(true);

        await markDoneAsRead('session-1', 'session-2');

        expect(getSessionStatus('session-1').isDone).toBe(false);
        expect(getSessionUiEntry('session-1').hookStatus.isDone).toBe(false);
        expect(httpClient.post).toHaveBeenCalledWith('/api/sessions/session-1/clear-done', {});
        expect(eventBus.emit).toHaveBeenCalledWith(
            EVENTS.SESSION_UI_STATE_CHANGED,
            { sessionIds: ['session-1'], currentSessionId: 'session-2' }
        );
        expect(eventBus.emit).toHaveBeenCalledWith(
            EVENTS.SESSION_UPDATED,
            expect.objectContaining({ sessionId: 'session-1' })
        );
    });

    it('pollSessionStatus呼び出し時_done状態をsessionUiにも反映する', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                'session-1': {
                    isWorking: false,
                    isDone: true,
                    lastWorkingAt: 0,
                    lastDoneAt: 300,
                    timestamp: 300
                }
            })
        });

        await pollSessionStatus('session-1');

        expect(getSessionStatus('session-1').isDone).toBe(true);
        expect(getSessionUiEntry('session-1').hookStatus.isDone).toBe(true);
        expect(eventBus.emit).toHaveBeenCalledWith(
            EVENTS.SESSION_UI_STATE_CHANGED,
            { sessionIds: ['session-1'] }
        );
    });

    it('pollSessionStatus呼び出し時_statusから消えたsessionもUI更新対象に含める', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    'session-1': {
                        isWorking: true,
                        isDone: false,
                        lastWorkingAt: 100,
                        lastDoneAt: 0,
                        timestamp: 100
                    }
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({})
            });

        await pollSessionStatus('session-1');
        vi.clearAllMocks();

        await pollSessionStatus('session-1');

        expect(eventBus.emit).toHaveBeenCalledWith(
            EVENTS.SESSION_UI_STATE_CHANGED,
            { sessionIds: ['session-1'] }
        );
    });

    it('markDoneAsRead呼び出し時_API失敗しても例外を投げない', async () => {
        const fetchMock = vi.fn((input) => {
            const url = typeof input === 'string' ? input : input?.url;
            if (url === '/api/sessions/status') {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        'session-1': {
                            isWorking: false,
                            isDone: true,
                            lastWorkingAt: 0,
                            lastDoneAt: 200,
                            timestamp: 200
                        }
                    })
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
        globalThis.fetch = fetchMock;
        httpClient.post.mockRejectedValue(new Error('HTTP 500'));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await pollSessionStatus('session-2');

        await expect(markDoneAsRead('session-1', 'session-2')).resolves.toBeUndefined();

        expect(getSessionStatus('session-1').isDone).toBe(false);
        expect(getSessionUiEntry('session-1').hookStatus.isDone).toBe(false);
        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('pollSessionStatus呼び出し時_statusから消えたsessionはclient mapから除去される', async () => {
        globalThis.fetch = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    'session-1': {
                        isWorking: true,
                        isDone: false,
                        lastWorkingAt: 100,
                        lastDoneAt: 0,
                        timestamp: 100
                    }
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({})
            });

        await pollSessionStatus('session-1');
        expect(getSessionStatus('session-1').isWorking).toBe(true);
        expect(getSessionUiEntry('session-1').hookStatus.isWorking).toBe(true);

        await pollSessionStatus('session-1');
        expect(getSessionStatus('session-1')).toBeNull();
        expect(getSessionUiEntry('session-1')).toEqual({ hookStatus: null });
    });

    it('pollSessionStatus繰り返し時_working状態をsessionUiへ維持する', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                'session-1': {
                    isWorking: true,
                    isDone: false,
                    lastWorkingAt: 200,
                    lastDoneAt: 0,
                    timestamp: 200
                }
            })
        });

        await pollSessionStatus('session-1');
        expect(getSessionUiEntry('session-1').hookStatus.isWorking).toBe(true);

        appStore.setState({ sessionUi: { byId: appStore.getState().sessionUi.byId } });

        await pollSessionStatus('session-1');
        expect(getSessionUiEntry('session-1').hookStatus.isWorking).toBe(true);
    });
});
