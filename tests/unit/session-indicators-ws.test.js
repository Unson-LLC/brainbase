import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const wsMock = vi.hoisted(() => ({
    instances: []
}));

vi.mock('../../public/modules/core/session-activity-ws-client.js', () => ({
    SessionActivityWsClient: vi.fn().mockImplementation(function MockSessionActivityWsClient(options) {
        this.options = options;
        this.connect = vi.fn();
        this.close = vi.fn();
        wsMock.instances.push(this);
    })
}));

vi.mock('../../public/modules/core/event-bus.js', () => ({
    eventBus: {
        emit: vi.fn().mockResolvedValue({ success: true, errors: [] })
    },
    EVENTS: {
        SESSION_UI_STATE_CHANGED: 'session:ui-state-changed'
    }
}));

vi.mock('../../public/modules/toast.js', () => ({
    showError: vi.fn(),
    showInfo: vi.fn()
}));

vi.mock('../../public/modules/core/http-client.js', () => ({
    httpClient: {
        post: vi.fn().mockResolvedValue({ success: true })
    }
}));

import { eventBus, EVENTS } from '../../public/modules/core/event-bus.js';
import { appStore } from '../../public/modules/core/store.js';
import {
    __resetSessionIndicatorStateForTests,
    markDoneAsRead,
    startActivityWs
} from '../../public/modules/session-indicators.js';
import { getSessionStatus } from '../../public/modules/session-ui-state.js';

describe('session-indicators WebSocket sync', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-19T00:00:00.000Z'));
        vi.clearAllMocks();
        wsMock.instances.length = 0;
        __resetSessionIndicatorStateForTests();
        appStore.setState({
            sessionUi: { byId: {} },
            currentSessionId: null
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('status-full受信時_消えたsessionもUI更新対象に含める', () => {
        appStore.setState({
            sessionUi: {
                byId: {
                    'session-cleared': {
                        hookStatus: {
                            isWorking: true,
                            isDone: false,
                            lastWorkingAt: 100,
                            lastDoneAt: 0,
                            timestamp: 100
                        }
                    },
                    'session-kept': {
                        hookStatus: {
                            isWorking: true,
                            isDone: false,
                            lastWorkingAt: 100,
                            lastDoneAt: 0,
                            timestamp: 100
                        }
                    }
                }
            }
        });

        startActivityWs(() => null);

        wsMock.instances[0].options.onStatusFull({
            'session-kept': {
                isWorking: false,
                isDone: true,
                lastWorkingAt: 100,
                lastDoneAt: 200,
                timestamp: 200
            }
        });

        expect(getSessionStatus('session-cleared')).toBeNull();
        expect(getSessionStatus('session-kept').isDone).toBe(true);

        const uiEventCall = eventBus.emit.mock.calls.find(
            ([eventName]) => eventName === EVENTS.SESSION_UI_STATE_CHANGED
        );
        expect(uiEventCall).toBeTruthy();
        expect([...uiEventCall[1].sessionIds].sort()).toEqual(['session-cleared', 'session-kept']);
    });

    it('markDoneAsRead後_抑制期限を過ぎたstatus-updateは反映する', async () => {
        appStore.setState({
            sessionUi: {
                byId: {
                    'session-1': {
                        hookStatus: {
                            isWorking: false,
                            isDone: true,
                            lastWorkingAt: 0,
                            lastDoneAt: 100,
                            timestamp: 100
                        }
                    }
                }
            }
        });

        startActivityWs(() => null);
        await markDoneAsRead('session-1', null);
        vi.clearAllMocks();

        vi.advanceTimersByTime(5001);
        wsMock.instances[0].options.onStatusUpdate('session-1', {
            isWorking: true,
            isDone: false,
            lastWorkingAt: Date.now(),
            lastDoneAt: 0,
            timestamp: Date.now()
        });

        expect(getSessionStatus('session-1').isWorking).toBe(true);
        expect(eventBus.emit).toHaveBeenCalledWith(
            EVENTS.SESSION_UI_STATE_CHANGED,
            { sessionIds: ['session-1'] }
        );
    });

    it('status-update受信時_status文字列payloadをclient状態に正規化する', () => {
        startActivityWs(() => null);

        wsMock.instances[0].options.onStatusUpdate('session-1', {
            status: 'working',
            lastWorkingAt: 300,
            timestamp: 300
        });

        expect(getSessionStatus('session-1')).toEqual(expect.objectContaining({
            status: 'working',
            isWorking: true,
            isDone: false
        }));
        expect(eventBus.emit).toHaveBeenCalledWith(
            EVENTS.SESSION_UI_STATE_CHANGED,
            { sessionIds: ['session-1'] }
        );
    });
});
