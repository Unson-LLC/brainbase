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
                activeTurnCount: 1
            },
            'session-2': {
                isWorking: false,
                isDone: false,
                lastWorkingAt: 0,
                lastActivityAt: 0,
                lastDoneAt: 0,
                activeTurnCount: 0
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
        expect(entries[0].detail).toContain('応答を生成中');
        expect(entries[1].label).toBe('Beta');
        expect(entries[1].detail).toContain('待機中');
    });

    it('状態変化が起きたセッションを先頭に積む', () => {
        service.start();
        vi.setSystemTime(new Date('2026-03-25T10:01:00.000Z'));

        recordRecentFileOpen('session-2', 'docs/spec.md');
        mergeSessionUiEntry('session-2', { attention: 'needs-input' });

        const entries = service.getEntries();

        expect(entries[0].label).toBe('Beta');
        expect(entries[0].detail).toContain('spec.md について入力待ち');
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
});
