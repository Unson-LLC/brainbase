import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveFeedService } from '../../public/modules/domain/live-feed/live-feed-service.js';
import { appStore } from '../../public/modules/core/store.js';
import {
    mergeSessionUiEntry,
    recordRecentFileOpen,
    replaceSessionHookStatuses,
    setSessionSummaryMap
} from '../../public/modules/session-ui-state.js';

describe('LiveFeedService', () => {
    let service;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-03-25T10:00:00.000Z'));
        appStore.setState({
            sessions: [
                {
                    id: 'session-1',
                    name: 'Alpha',
                    intendedState: 'active',
                    runtimeStatus: { ttydRunning: true }
                },
                {
                    id: 'session-2',
                    name: 'Beta',
                    intendedState: 'active',
                    taskBrief: 'サーバが落ちる原因を調べる',
                    taskBriefUpdatedAt: '2026-03-25T09:55:00.000Z',
                    runtimeStatus: { ttydRunning: true }
                },
                {
                    id: 'session-3',
                    name: 'Archived',
                    intendedState: 'archived',
                    runtimeStatus: { ttydRunning: false }
                }
            ],
            currentSessionId: 'session-1',
            sessionUi: {
                byId: {}
            }
        });

        replaceSessionHookStatuses({
            'session-1': {
                isWorking: true,
                isDone: false,
                lastWorkingAt: Date.parse('2026-03-25T09:59:00.000Z'),
                lastActivityAt: Date.parse('2026-03-25T09:59:00.000Z'),
                lastDoneAt: 0,
                activeTurnCount: 1,
                liveActivity: {
                    activityKind: 'running_command',
                    assistantSnippet: '右パネルで何をしているか一目で分かるように寄せています',
                    assistantSnippetUpdatedAt: Date.parse('2026-03-25T09:59:00.000Z'),
                    updatedAt: Date.parse('2026-03-25T09:59:00.000Z'),
                    statusTone: 'working'
                }
            },
            'session-2': {
                isWorking: false,
                isDone: false,
                lastWorkingAt: 0,
                lastActivityAt: 0,
                lastDoneAt: 0,
                activeTurnCount: 0,
                liveActivity: {
                    activityKind: 'waiting_input',
                    assistantSnippet: null,
                    assistantSnippetUpdatedAt: 0,
                    currentStep: '入力待ち',
                    latestEvidence: '',
                    updatedAt: Date.parse('2026-03-25T09:55:00.000Z'),
                    statusTone: 'waiting'
                }
            }
        });

        setSessionSummaryMap({
            'session-1': { repo: 'brainbase', baseBranch: 'develop' },
            'session-2': { repo: 'brainbase', baseBranch: 'develop' }
        });

        service = new LiveFeedService();
    });

    afterEach(() => {
        service.stop();
        vi.useRealTimers();
    });

    it('active sessions の現在状態をセッション単位で初期表示する', () => {
        service.start();

        const entries = service.getEntries();

        expect(entries).toHaveLength(2);
        expect(entries[0].label).toBe('Alpha');
        expect(entries[0].currentStep).toContain('右パネルで何をしているか一目で分かるように寄せています');
        expect(entries[0].latestEvidence).toBe('');
        expect(entries[1].label).toBe('Beta');
        expect(entries[1].taskBrief).toBe('サーバが落ちる原因を調べる');
        expect(entries[1].currentStep).toBe('');
    });

    it('INV-1/S-3: activityHistoryとstructured activityからモデル呼び出しなしで履歴を投影する', () => {
        appStore.setState({
            sessions: appStore.getState().sessions.map((session) => session.id === 'session-1'
                ? {
                    ...session,
                    activityHistory: [
                        {
                            id: 'startup-1',
                            actor: 'user',
                            kind: 'startup_prompt',
                            text: 'Live Feedで過去の依頼を見られるようにして',
                            textSource: 'raw_prompt',
                            evidenceSource: 'session_initial_command',
                            occurredAt: '2026-03-25T09:58:00.000Z',
                            dedupeKey: 'startup-1'
                        },
                        {
                            id: 'prompt-1',
                            actor: 'user',
                            kind: 'user_prompt',
                            text: 'コストをかけずに活動履歴を出して',
                            textSource: 'raw_prompt',
                            evidenceSource: 'terminal_input',
                            occurredAt: '2026-03-25T09:59:30.000Z',
                            dedupeKey: 'prompt-1'
                        }
                    ]
                }
                : session)
        });

        service.start();
        const history = service.getHistoryEntries({ mode: 'all' });

        expect(history.map((entry) => entry.text)).toContain('Live Feedで過去の依頼を見られるようにして');
        expect(history.map((entry) => entry.text)).toContain('コストをかけずに活動履歴を出して');
        expect(history.some((entry) => entry.actor === 'agent' && entry.evidenceSource === 'activity_report')).toBe(true);
        expect(history.every((entry) => entry.textSource !== 'model_summary')).toBe(true);
    });

    it('既存status rowだけのセッションもhistory projectionで空にしない', () => {
        replaceSessionHookStatuses({
            'session-1': {
                isWorking: false,
                isDone: false,
                lastWorkingAt: 0,
                lastActivityAt: 0,
                lastDoneAt: 0,
                activeTurnCount: 0,
                liveActivity: null
            },
            'session-2': {
                isWorking: false,
                isDone: false,
                lastWorkingAt: 0,
                lastActivityAt: 0,
                lastDoneAt: 0,
                activeTurnCount: 0,
                liveActivity: null
            }
        });

        service.start();
        const history = service.getHistoryEntries({ mode: 'all' });

        expect(history.some((entry) => entry.sessionId === 'session-2')).toBe(true);
        expect(history.map((entry) => entry.text)).toContain('サーバが落ちる原因を調べる');
        expect(history.find((entry) => entry.sessionId === 'session-2')?.evidenceSource).toBe('session_state');
    });

    it('C-5/S-4: session-focused履歴は指定セッションだけを時系列に返し重複を除外する', () => {
        appStore.setState({
            sessions: appStore.getState().sessions.map((session) => session.id === 'session-1'
                ? {
                    ...session,
                    activityHistory: [
                        {
                            id: 'duplicate-a',
                            actor: 'user',
                            kind: 'user_prompt',
                            text: '同じ依頼',
                            textSource: 'raw_prompt',
                            evidenceSource: 'terminal_input',
                            occurredAt: '2026-03-25T09:57:00.000Z',
                            dedupeKey: 'same-prompt'
                        },
                        {
                            id: 'duplicate-b',
                            actor: 'user',
                            kind: 'user_prompt',
                            text: '同じ依頼',
                            textSource: 'raw_prompt',
                            evidenceSource: 'terminal_input',
                            occurredAt: '2026-03-25T09:58:00.000Z',
                            dedupeKey: 'same-prompt'
                        }
                    ]
                }
                : session)
        });

        service.start();
        const history = service.getHistoryEntries({ mode: 'session', sessionId: 'session-1' });

        expect(history.filter((entry) => entry.dedupeKey === 'same-prompt')).toHaveLength(1);
        expect(history.every((entry) => entry.sessionId === 'session-1')).toBe(true);
        expect(history[0].timestamp.getTime()).toBeLessThanOrEqual(history[history.length - 1].timestamp.getTime());
    });

    it('INV-11/C-7: default用のセッショングループはheartbeat更新で並び替えない', () => {
        appStore.setState({
            sessions: appStore.getState().sessions.map((session) => {
                if (session.id === 'session-1') {
                    return {
                        ...session,
                        activityHistory: [
                            {
                                id: 'alpha-startup',
                                actor: 'user',
                                kind: 'startup_prompt',
                                text: 'Alphaの初回依頼',
                                textSource: 'raw_prompt',
                                evidenceSource: 'session_initial_command',
                                occurredAt: '2026-03-25T09:50:00.000Z',
                                dedupeKey: 'alpha-startup'
                            },
                            {
                                id: 'alpha-prompt',
                                actor: 'user',
                                kind: 'user_prompt',
                                text: 'Alphaの追加依頼',
                                textSource: 'raw_prompt',
                                evidenceSource: 'terminal_input',
                                occurredAt: '2026-03-25T09:51:00.000Z',
                                dedupeKey: 'alpha-prompt'
                            }
                        ]
                    };
                }
                if (session.id === 'session-2') {
                    return {
                        ...session,
                        activityHistory: [
                            {
                                id: 'beta-startup',
                                actor: 'user',
                                kind: 'startup_prompt',
                                text: 'Betaの初回依頼',
                                textSource: 'raw_prompt',
                                evidenceSource: 'session_initial_command',
                                occurredAt: '2026-03-25T09:52:00.000Z',
                                dedupeKey: 'beta-startup'
                            }
                        ]
                    };
                }
                return session;
            })
        });

        service.start();
        const before = service.getSessionHistoryGroups({ limitPerSession: 5 });
        expect(before.map((group) => group.label)).toEqual(['Alpha', 'Beta']);
        expect(before[0].entries.map((entry) => entry.text)).toContain('Alphaの初回依頼');
        expect(before[0].entries.map((entry) => entry.text)).toContain('Alphaの追加依頼');

        replaceSessionHookStatuses({
            'session-1': appStore.getState().sessionUi.byId['session-1']?.hookStatus,
            'session-2': {
                ...appStore.getState().sessionUi.byId['session-2']?.hookStatus,
                liveActivity: {
                    ...appStore.getState().sessionUi.byId['session-2']?.hookStatus?.liveActivity,
                    updatedAt: Date.parse('2026-03-25T10:08:00.000Z')
                }
            }
        });

        const after = service.getSessionHistoryGroups({ limitPerSession: 5 });
        expect(after.map((group) => group.label)).toEqual(['Alpha', 'Beta']);
    });

    it('C-8: liveActivity heartbeatだけではsynthetic history eventを別event化しない', () => {
        service.start();
        const before = service.getHistoryEntries({ mode: 'session', sessionId: 'session-1' })
            .find((entry) => entry.evidenceSource === 'activity_report');

        replaceSessionHookStatuses({
            'session-1': {
                ...appStore.getState().sessionUi.byId['session-1']?.hookStatus,
                liveActivity: {
                    ...appStore.getState().sessionUi.byId['session-1']?.hookStatus?.liveActivity,
                    updatedAt: Date.parse('2026-03-25T10:08:00.000Z')
                }
            },
            'session-2': appStore.getState().sessionUi.byId['session-2']?.hookStatus
        });

        const after = service.getHistoryEntries({ mode: 'session', sessionId: 'session-1' })
            .find((entry) => entry.evidenceSource === 'activity_report');

        expect(after?.id).toBe(before?.id);
        expect(after?.timestamp.toISOString()).toBe(before?.timestamp.toISOString());
    });

    it('状態変化が起きたセッションを先頭に積む', () => {
        service.start();
        vi.setSystemTime(new Date('2026-03-25T10:01:00.000Z'));

        recordRecentFileOpen('session-2', 'docs/spec.md');
        replaceSessionHookStatuses({
            'session-1': appStore.getState().sessionUi.byId['session-1']?.hookStatus,
            'session-2': {
                isWorking: true,
                isDone: false,
                lastWorkingAt: Date.parse('2026-03-25T10:01:00.000Z'),
                lastActivityAt: Date.parse('2026-03-25T10:01:00.000Z'),
                lastDoneAt: 0,
                activeTurnCount: 1,
                liveActivity: {
                    activityKind: 'editing_file',
                    assistantSnippet: '何の作業かが一目で分かる文面に寄せています',
                    assistantSnippetUpdatedAt: Date.parse('2026-03-25T10:01:00.000Z'),
                    updatedAt: Date.parse('2026-03-25T10:01:00.000Z'),
                    statusTone: 'working'
                }
            }
        });
        mergeSessionUiEntry('session-2', { attention: 'needs-input' });

        const entries = service.getEntries();

        expect(entries[0].label).toBe('Beta');
        expect(entries[0].currentStep).toContain('何の作業かが一目で分かる文面に寄せています');
        expect(entries[0].latestEvidence).toBe('');
        expect(entries[1].label).toBe('Alpha');
    });

    it('無関係な更新では重複エントリを増やさない', () => {
        service.start();
        const beforeCount = service.getEntries().length;

        appStore.setState({
            ui: {
                ...appStore.getState().ui,
                dashboardOpen: true
            }
        });

        expect(service.getEntries()).toHaveLength(beforeCount);
    });

    it('同じセッションはカードを更新しつつ1件に保つ', () => {
        service.start();

        replaceSessionHookStatuses({
            'session-1': {
                isWorking: true,
                isDone: false,
                lastWorkingAt: Date.parse('2026-03-25T10:02:00.000Z'),
                lastActivityAt: Date.parse('2026-03-25T10:02:00.000Z'),
                lastDoneAt: 0,
                activeTurnCount: 1,
                liveActivity: {
                    activityKind: 'running_command',
                    assistantSnippet: '抽象的な状態語ではなく回答断片だけを出す形に見直しています',
                    assistantSnippetUpdatedAt: Date.parse('2026-03-25T10:02:00.000Z'),
                    updatedAt: Date.parse('2026-03-25T10:02:00.000Z'),
                    statusTone: 'working'
                }
            },
            'session-2': appStore.getState().sessionUi.byId['session-2']?.hookStatus
        });

        const entries = service.getEntries();
        expect(entries).toHaveLength(2);
        expect(entries.filter((entry) => entry.sessionId === 'session-1')).toHaveLength(1);
        expect(entries[0].currentStep).toContain('抽象的な状態語ではなく回答断片だけを出す形に見直しています');
    });

    it('heartbeatだけの更新では行順を変えず内容だけ更新する', () => {
        service.start();

        replaceSessionHookStatuses({
            'session-1': appStore.getState().sessionUi.byId['session-1']?.hookStatus,
            'session-2': {
                ...appStore.getState().sessionUi.byId['session-2']?.hookStatus,
                lastActivityAt: Date.parse('2026-03-25T10:04:00.000Z'),
                liveActivity: {
                    ...appStore.getState().sessionUi.byId['session-2']?.hookStatus?.liveActivity,
                    updatedAt: Date.parse('2026-03-25T10:04:00.000Z')
                }
            }
        });

        const entries = service.getEntries();
        expect(entries.map((entry) => entry.label)).toEqual(['Alpha', 'Beta']);
        expect(entries[1].timestamp.toISOString()).toBe('2026-03-25T10:04:00.000Z');
    });

    it('assistant snippetだけの更新では行順を変えず本文だけ更新する', () => {
        service.start();

        replaceSessionHookStatuses({
            'session-1': appStore.getState().sessionUi.byId['session-1']?.hookStatus,
            'session-2': {
                ...appStore.getState().sessionUi.byId['session-2']?.hookStatus,
                liveActivity: {
                    ...appStore.getState().sessionUi.byId['session-2']?.hookStatus?.liveActivity,
                    assistantSnippet: '入力待ちのまま補足文だけを更新しています',
                    assistantSnippetUpdatedAt: Date.parse('2026-03-25T10:05:00.000Z')
                }
            }
        });

        const entries = service.getEntries();
        expect(entries.map((entry) => entry.label)).toEqual(['Alpha', 'Beta']);
        expect(entries[1].currentStep).toContain('入力待ちのまま補足文だけを更新しています');
    });

    it('複数セッションが同時更新されても通知は1回にまとめる', () => {
        service.start();
        const listener = vi.fn();
        service.onEntry(listener);

        replaceSessionHookStatuses({
            'session-1': {
                ...appStore.getState().sessionUi.byId['session-1']?.hookStatus,
                liveActivity: {
                    ...appStore.getState().sessionUi.byId['session-1']?.hookStatus?.liveActivity,
                    assistantSnippet: 'Alphaの本文だけを更新しています',
                    assistantSnippetUpdatedAt: Date.parse('2026-03-25T10:06:00.000Z')
                }
            },
            'session-2': {
                ...appStore.getState().sessionUi.byId['session-2']?.hookStatus,
                liveActivity: {
                    ...appStore.getState().sessionUi.byId['session-2']?.hookStatus?.liveActivity,
                    assistantSnippet: 'Betaの本文だけを更新しています',
                    assistantSnippetUpdatedAt: Date.parse('2026-03-25T10:06:00.000Z')
                }
            }
        });

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('同一timestampの同時moveではセッション相対順を保つ', () => {
        appStore.setState({
            sessions: [
                { id: 'session-a', name: 'A', intendedState: 'active', runtimeStatus: { ttydRunning: true } },
                { id: 'session-b', name: 'B', intendedState: 'active', runtimeStatus: { ttydRunning: true } },
                { id: 'session-c', name: 'C', intendedState: 'active', runtimeStatus: { ttydRunning: true } }
            ],
            currentSessionId: 'session-a',
            sessionUi: { byId: {} }
        });
        const sameTimestamp = Date.parse('2026-03-25T10:07:00.000Z');
        replaceSessionHookStatuses({
            'session-a': {
                isWorking: true,
                isDone: false,
                lastWorkingAt: sameTimestamp,
                lastActivityAt: sameTimestamp,
                lastDoneAt: 0,
                activeTurnCount: 1,
                liveActivity: { activityKind: 'running_command', updatedAt: sameTimestamp, statusTone: 'working' }
            },
            'session-b': {
                isWorking: true,
                isDone: false,
                lastWorkingAt: sameTimestamp,
                lastActivityAt: sameTimestamp,
                lastDoneAt: 0,
                activeTurnCount: 1,
                liveActivity: { activityKind: 'running_command', updatedAt: sameTimestamp, statusTone: 'working' }
            },
            'session-c': {
                isWorking: true,
                isDone: false,
                lastWorkingAt: sameTimestamp,
                lastActivityAt: sameTimestamp,
                lastDoneAt: 0,
                activeTurnCount: 1,
                liveActivity: { activityKind: 'running_command', updatedAt: sameTimestamp, statusTone: 'working' }
            }
        });

        service.start();

        expect(service.getEntries().map((entry) => entry.label)).toEqual(['A', 'B', 'C']);
    });

    it('stale判定は明示timerで更新し行をblockedへ遷移させる', () => {
        service.start();

        expect(service.getEntries()[0].statusTone).toBe('working');

        vi.advanceTimersByTime(3 * 60 * 1000);
        expect(service.getEntries()[0].statusTone).toBe('blocked');
        expect(service.getEntries()[0].statusText).toBe('4分更新なし');
    });

    it('stale判定の分数表示はmovementKey不変でもforce refreshで更新する', () => {
        service.start();

        vi.advanceTimersByTime(3 * 60 * 1000);
        expect(service.getEntries()[0].statusText).toBe('4分更新なし');

        vi.advanceTimersByTime(2 * 60 * 1000);

        expect(service.getEntries()[0].statusTone).toBe('blocked');
        expect(service.getEntries()[0].statusText).toBe('6分更新なし');
    });

    it('liveActivityにassistantSnippetがなくてもsession.lastAssistantSnippetを表示する', () => {
        replaceSessionHookStatuses({
            'session-1': {
                isWorking: false,
                isDone: false,
                lastWorkingAt: 0,
                lastActivityAt: 0,
                lastDoneAt: 0,
                activeTurnCount: 0,
                liveActivity: null
            },
            'session-2': appStore.getState().sessionUi.byId['session-2']?.hookStatus
        });
        appStore.setState({
            sessions: appStore.getState().sessions.map((session) => session.id === 'session-1'
                ? {
                    ...session,
                    taskBrief: 'Live Feedを仕事一覧として見えるようにする',
                    taskBriefUpdatedAt: '2026-03-25T10:03:00.000Z',
                    lastAssistantSnippet: 'このセッションでは AI の日本語断片だけを出すように変えます',
                    lastAssistantSnippetAt: '2026-03-25T10:03:00.000Z'
                }
                : session)
        });

        service.start();
        const entries = service.getEntries();

        expect(entries[0].label).toBe('Alpha');
        expect(entries[0].taskBrief).toBe('Live Feedを仕事一覧として見えるようにする');
        expect(entries[0].currentStep).toContain('AI の日本語断片だけを出すように変えます');
    });
});
