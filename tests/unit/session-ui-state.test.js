import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appStore } from '../../public/modules/core/store.js';
import {
    deriveSessionUiState,
    getSessionStatus,
    hydrateSessionRecentFiles,
    mergeSessionUiEntry,
    recordRecentFileOpen,
    replaceSessionHookStatuses,
    setSessionSummaryMap
} from '../../public/modules/session-ui-state.js';

describe('session-ui-state', () => {
    beforeEach(() => {
        const storage = new Map();
        globalThis.localStorage = {
            getItem: vi.fn((key) => storage.has(key) ? storage.get(key) : null),
            setItem: vi.fn((key, value) => storage.set(key, value)),
            clear: vi.fn(() => storage.clear()),
            removeItem: vi.fn((key) => storage.delete(key))
        };
        localStorage.clear();
        appStore.setState({
            sessions: [{
                id: 'session-1',
                intendedState: 'active',
                runtimeStatus: { ttydRunning: true }
            }],
            currentSessionId: 'session-1',
            sessionUi: {
                byId: {}
            }
        });
    });

    it('hook status と summary を合成して ui state を返す', () => {
        replaceSessionHookStatuses({
            'session-1': {
                isWorking: true,
                isDone: false
            }
        });
        setSessionSummaryMap({
            'session-1': {
                repo: 'brainbase',
                baseBranch: 'develop',
                dirty: true,
                changesNotPushed: 2,
                prStatus: 'open_or_pending'
            }
        });
        mergeSessionUiEntry('session-1', {
            transport: 'connected',
            attention: 'needs-focus'
        });

        const uiState = deriveSessionUiState('session-1');

        expect(uiState.activity).toBe('working');
        expect(uiState.transport).toBe('connected');
        expect(uiState.attention).toBe('needs-focus');
        expect(uiState.summary.repo).toBe('brainbase');
        expect(getSessionStatus('session-1')).toEqual(expect.objectContaining({
            isWorking: true
        }));
    });

    it('recent file を記録して localStorage に保持する', () => {
        recordRecentFileOpen('session-1', 'src/app.js');
        recordRecentFileOpen('session-1', 'README.md');

        const uiState = deriveSessionUiState('session-1');
        expect(uiState.recentFile).toEqual(expect.objectContaining({
            path: 'README.md'
        }));

        const persisted = JSON.parse(localStorage.getItem('bb:session-recent-files:v1'));
        expect(persisted['session-1'][0]).toEqual(expect.objectContaining({
            path: 'README.md'
        }));
    });

    it('hydrateSessionRecentFiles で保存済み recent file を復元する', () => {
        localStorage.setItem('bb:session-recent-files:v1', JSON.stringify({
            'session-1': [{
                path: 'docs/spec.md',
                label: 'spec.md',
                openedAt: '2026-03-14T00:00:00.000Z'
            }]
        }));

        hydrateSessionRecentFiles();

        const uiState = deriveSessionUiState('session-1');
        expect(uiState.recentFile).toEqual(expect.objectContaining({
            path: 'docs/spec.md'
        }));
    });
});
