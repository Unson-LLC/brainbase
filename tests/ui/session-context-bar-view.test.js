import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionContextBarView } from '../../public/modules/ui/views/session-context-bar-view.js';

vi.mock('../../public/modules/core/store.js', () => ({
    appStore: {
        subscribeToSelector: vi.fn(() => () => {}),
        getState: vi.fn(() => ({ currentSessionId: 'session-1' }))
    }
}));

vi.mock('../../public/modules/core/event-bus.js', () => ({
    eventBus: {
        on: vi.fn(() => () => {})
    },
    EVENTS: {
        SESSION_LOADED: 'session:loaded',
        SESSION_UPDATED: 'session:updated',
        SESSION_ARCHIVED: 'session:archived',
        SESSION_CREATED: 'session:created'
    }
}));

describe('SessionContextBarView', () => {
    let view;
    let container;

    const createContext = (overrides = {}) => ({
        sessionId: 'session-1',
        sessionName: 'Test Session',
        engine: 'claude',
        repo: 'brainbase',
        baseBranch: 'develop',
        repoPath: '/Users/ksato/workspace/code/brainbase',
        workspacePath: '/Users/ksato/workspace/.worktrees/session-1-brainbase',
        currentDirectory: '/Users/ksato/workspace/.worktrees/session-1-brainbase',
        dirty: false,
        changesNotPushed: 0,
        prStatus: 'none',
        ...overrides
    });

    beforeEach(() => {
        vi.useFakeTimers();
        view = new SessionContextBarView({
            sessionService: { getSessionContext: vi.fn() }
        });
        container = document.createElement('div');
        view.container = container;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('workspaceとcurrentが不一致のとき_常時警告バッジを表示する', () => {
        view._renderContext(createContext({
            currentDirectory: '/Users/ksato/workspace/.worktrees/session-1-brainbase/subdir'
        }));

        expect(container.innerHTML).toContain('cwd!=workspace');
    });

    it('workspaceとcurrentが一致のとき_警告バッジを表示しない', () => {
        view._renderContext(createContext());

        expect(container.innerHTML).not.toContain('cwd!=workspace');
    });

    it('末尾スラッシュ差分のみのとき_警告バッジを表示しない', () => {
        view._renderContext(createContext({
            workspacePath: '/Users/ksato/workspace/.worktrees/session-1-brainbase/',
            currentDirectory: '/Users/ksato/workspace/.worktrees/session-1-brainbase'
        }));

        expect(container.innerHTML).not.toContain('cwd!=workspace');
    });

    it('session切替時_context取得を即時実行せず短く遅延させる', async () => {
        const getSessionContext = vi.fn().mockResolvedValue(createContext());
        view = new SessionContextBarView({ sessionService: { getSessionContext } });
        view.container = container;

        view._scheduleRefresh({ forceLoading: false, delayMs: view.switchDelayMs });
        expect(getSessionContext).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(view.switchDelayMs - 1);
        expect(getSessionContext).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(getSessionContext).toHaveBeenCalledWith('session-1');
    });
});
