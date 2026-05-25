import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerActivityBridge } from '../../../server/services/codex-app-server-activity-bridge.js';
import { createSessionServices } from '../../../server/services/create-session-services.js';

function createStateStore() {
    let state = {
        sessions: [{
            id: 'session-codex',
            engine: 'codex',
            intendedState: 'active'
        }]
    };
    return {
        get: () => state,
        update: vi.fn(async (next) => {
            state = next;
            return state;
        }),
        patchSession: vi.fn(async (sessionId, updates) => {
            state = {
                ...state,
                sessions: state.sessions.map((session) =>
                    session.id === sessionId ? { ...session, ...updates } : session
                )
            };
            return state.sessions.find((session) => session.id === sessionId);
        })
    };
}

function createHarness() {
    const adapter = new EventEmitter();
    const stateStore = createStateStore();
    const services = createSessionServices({ stateStore });
    services.shared._listTmuxPaneTitles = () => [];
    const broadcasts = [];
    services.shared._activityWsBroadcast = (sessionId, hookStatus) => {
        broadcasts.push({ sessionId, hookStatus });
    };
    return { adapter, stateStore, services, broadcasts };
}

describe('CodexAppServerActivityBridge', () => {
    it('maps turn/started notifications to working hook status with app-server turn id', () => {
        const { adapter, stateStore, services, broadcasts } = createHarness();
        const bridge = new CodexAppServerActivityBridge({
            adapter,
            activityService: services.activity,
            stateStore,
            now: () => Date.now()
        }).attach();

        const result = bridge.handleNotification({
            method: 'turn/started',
            params: {
                thread: { id: 'thread_app_1' },
                turn: {
                    id: 'turn_app_1',
                    metadata: { sessionId: 'session-codex' }
                }
            }
        });
        return result.stateUpdate.then(() => {
            expect(stateStore.get().sessions[0].codexAppServer).toMatchObject({
                threadId: 'thread_app_1',
                activeTurnId: 'turn_app_1',
                lifecycle: 'turn_started',
                status: 'working',
                source: 'codex_app_server'
            });

            const status = services.activity.getSessionStatus()['session-codex'];
            expect(status).toMatchObject({
                state: 'starting',
                isWorking: true,
                isDone: false,
                activeTurnCount: 1,
                lastEventType: 'turn/started',
                liveActivity: {
                    activityKind: 'task_started',
                    currentStep: 'Codex App Serverで作業開始',
                    latestEvidence: 'codex app-server notification',
                    statusTone: 'working'
                }
            });
            expect(services.shared.hookStatus.get('session-codex').activeTurnIds).toEqual(['turn_app_1']);
            expect(broadcasts).toHaveLength(1);
            expect(broadcasts[0]).toMatchObject({
                sessionId: 'session-codex',
                hookStatus: { isWorking: true, activeTurnCount: 1 }
            });
            bridge.detach();
        });
    });

    it('maps turn/completed notifications to done-unread and clears the matching turn id', () => {
        const { adapter, services } = createHarness();
        const now = Date.now();
        const bridge = new CodexAppServerActivityBridge({
            adapter,
            activityService: services.activity,
            sessionId: 'session-codex',
            now: () => now
        }).attach();

        adapter.emit('notification', {
            method: 'turn/started',
            params: { turn: { id: 'turn_app_2' }, reportedAt: now }
        });
        adapter.emit('notification', {
            method: 'turn/completed',
            params: { turn: { id: 'turn_app_2' }, reportedAt: now + 1 }
        });

        const status = services.activity.getSessionStatus()['session-codex'];
        expect(status).toMatchObject({
            state: 'done-unread',
            isWorking: false,
            isDone: true,
            activeTurnCount: 0,
            lastEventType: 'turn/completed',
            liveActivity: {
                activityKind: 'task_completed',
                currentStep: 'Codex App Serverのターンが完了',
                latestEvidence: 'codex app-server notification',
                statusTone: 'done'
            }
        });
        expect(services.shared.hookStatus.get('session-codex').activeTurnIds).toEqual([]);
        bridge.detach();
    });

    it('ignores supported notifications when no session id can be resolved', () => {
        const { adapter, services } = createHarness();
        const bridge = new CodexAppServerActivityBridge({
            adapter,
            activityService: services.activity,
            now: () => Date.now()
        });

        const result = bridge.handleNotification({
            method: 'turn/started',
            params: { turn: { id: 'turn_without_session' } }
        });

        expect(result).toEqual({
            handled: false,
            reason: 'missing_session_id',
            method: 'turn/started'
        });
        expect(services.activity.getSessionStatus()).toEqual({});
    });

    it('attach is idempotent and detach removes the notification listener', () => {
        const { adapter, services } = createHarness();
        const bridge = new CodexAppServerActivityBridge({
            adapter,
            activityService: services.activity,
            sessionId: 'session-codex',
            now: () => Date.now()
        });

        bridge.attach();
        bridge.attach();
        expect(adapter.listenerCount('notification')).toBe(1);

        bridge.detach();
        expect(adapter.listenerCount('notification')).toBe(0);

        adapter.emit('notification', {
            method: 'turn/started',
            params: { turn: { id: 'turn_after_detach' } }
        });
        expect(services.activity.getSessionStatus()).toEqual({});
    });

    it('accepts task_complete style notifications as completion events', () => {
        const { adapter, services } = createHarness();
        const reportActivity = vi.spyOn(services.activity, 'reportActivity');
        const bridge = new CodexAppServerActivityBridge({
            adapter,
            activityService: services.activity,
            sessionIdResolver: () => 'session-codex',
            now: () => 1779635400000
        });

        const result = bridge.handleNotification({
            method: 'codex/event/task_complete',
            params: { turnId: 'turn_app_3' }
        });

        expect(result).toMatchObject({
            handled: true,
            sessionId: 'session-codex',
            status: 'done',
            lifecycle: 'turn_completed',
            turnId: 'turn_app_3'
        });
        expect(reportActivity).toHaveBeenCalledWith('session-codex', 'done', 1779635400000, expect.objectContaining({
            lifecycle: 'turn_completed',
            eventType: 'codex/event/task_complete',
            activityKind: 'task_completed',
            latestEvidence: 'codex app-server notification'
        }));
    });

    it('accepts task_started and task_complete aliases as structured turn lifecycle events', () => {
        const { adapter, services } = createHarness();
        const now = Date.now();
        const bridge = new CodexAppServerActivityBridge({
            adapter,
            activityService: services.activity,
            sessionId: 'session-codex',
            now: () => now
        });

        expect(bridge.handleNotification({
            method: 'task_started',
            params: { turnId: 'turn_alias_1', reportedAt: now }
        })).toMatchObject({
            handled: true,
            status: 'working',
            lifecycle: 'turn_started',
            turnId: 'turn_alias_1'
        });
        expect(services.activity.getSessionStatus()['session-codex']).toMatchObject({
            isWorking: true,
            activeTurnCount: 1,
            lastEventType: 'task_started'
        });

        expect(bridge.handleNotification({
            method: 'task_complete',
            params: { turnId: 'turn_alias_1', reportedAt: now + 1 }
        })).toMatchObject({
            handled: true,
            status: 'done',
            lifecycle: 'turn_completed',
            turnId: 'turn_alias_1'
        });
        expect(services.activity.getSessionStatus()['session-codex']).toMatchObject({
            state: 'done-unread',
            isWorking: false,
            activeTurnCount: 0,
            lastEventType: 'task_complete'
        });
    });
});
