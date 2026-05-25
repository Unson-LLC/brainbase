import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveFeedView } from '../../../public/modules/ui/views/live-feed-view.js';

vi.mock('../../../public/modules/ui-helpers.js', () => ({
    escapeHtml: vi.fn((s) => s),
    refreshIcons: vi.fn(),
}));

describe('LiveFeedView', () => {
    let service;
    let view;
    let container;
    let store;

    beforeEach(() => {
        container = document.createElement('div');
        store = {
            getState: vi.fn(() => ({ currentSessionId: 'session-1' })),
            subscribeToSelector: vi.fn(() => vi.fn()),
        };
        service = {
            start: vi.fn(),
            stop: vi.fn(),
            onEntry: vi.fn(() => vi.fn()),
            getEntries: vi.fn(() => [
                {
                    id: 'session-1',
                    sessionId: 'session-1',
                    timestamp: new Date('2026-05-07T11:34:52.000Z'),
                    label: 'ターミナル出力',
                    icon: 'terminal',
                    statusTone: 'working',
                    statusText: 'stdout',
                    taskBrief: '#P1 VibePro component replacement',
                    currentStep: 'Wiki と Live Feed の見た目を合わせています',
                    latestEvidence: '',
                },
                {
                    id: 'session-2',
                    sessionId: 'session-2',
                    timestamp: new Date('2026-05-07T11:33:21.000Z'),
                    label: 'タスク完了',
                    icon: 'check-circle',
                    statusTone: 'done',
                    statusText: '完了',
                    taskBrief: '',
                    currentStep: '',
                    latestEvidence: '',
                },
                {
                    id: 'session-3',
                    sessionId: 'session-3',
                    timestamp: new Date('2026-05-07T11:30:00.000Z'),
                    label: 'システムイベント',
                    icon: 'square',
                    statusTone: 'blocked',
                    statusText: '停止中',
                    taskBrief: '',
                    currentStep: 'Auto-update failed',
                    latestEvidence: '',
                },
            ]),
        };
        view = new LiveFeedView({ liveFeedService: service, store });
    });

    afterEach(() => {
        view.destroy();
    });

    it('Live Feedをタイムライン行として描画する', () => {
        view.mount(container);

        expect(container.querySelector('.live-feed-status')?.textContent).toContain('LIVE');
        expect(container.querySelector('.live-feed-scope-group')?.textContent).toContain('このセッション');
        expect(container.querySelector('.feed-scope-btn[data-scope="current"] .feed-scope-count')?.textContent).toBe('1');
        expect(container.querySelector('.feed-section-label')?.textContent).toBe('新しい更新');
        expect(container.querySelector('.feed-item')).toBeTruthy();
        expect(container.querySelector('.feed-item-rail')).toBeTruthy();
        expect(container.querySelector('.feed-item-dot.working')).toBeTruthy();
        expect(container.querySelector('.feed-item-actions')).toBeNull();
        expect(container.querySelectorAll('.feed-item')).toHaveLength(1);
        expect(container.querySelector('.live-feed-footer')?.textContent).toContain('表示: 時系列 / 範囲: このセッション');
        expect(store.subscribeToSelector).toHaveBeenCalled();
    });

    it('全体ボタン押下時_全セッションの更新に切り替わる', () => {
        view.mount(container);

        container.querySelector('.feed-scope-btn[data-scope="all"]').click();

        expect(container.querySelector('.feed-scope-btn[data-scope="all"]').classList.contains('active')).toBe(true);
        expect(container.querySelector('.feed-scope-btn[data-scope="all"]').getAttribute('aria-pressed')).toBe('true');
        expect(container.querySelectorAll('.feed-item')).toHaveLength(3);
        expect(container.querySelector('.live-feed-footer')?.textContent).toContain('表示: 時系列 / 範囲: 全体');
    });

    it('現在セッションに更新がない場合_全体への切り替えを案内する', () => {
        service.getEntries = vi.fn(() => [
            {
                id: 'session-2',
                sessionId: 'session-2',
                timestamp: new Date('2026-05-07T11:34:52.000Z'),
                label: 'タスク完了',
                icon: 'check-circle',
                statusTone: 'done',
                statusText: '完了',
                taskBrief: '#P1 VibePro component replacement',
                currentStep: '',
                latestEvidence: '',
            },
        ]);
        view.mount(container);

        expect(container.querySelectorAll('.feed-item')).toHaveLength(0);
        expect(container.querySelector('.live-feed-empty')?.textContent).toContain('このセッションの更新はありません');
    });

    it('currentSessionIdがない場合_全体表示としてscope controlを選択する', () => {
        store.getState = vi.fn(() => ({ currentSessionId: null }));

        view.mount(container);

        expect(container.querySelector('.feed-scope-btn[data-scope="current"]')?.disabled).toBe(true);
        expect(container.querySelector('.feed-scope-btn[data-scope="current"]')?.getAttribute('aria-pressed')).toBe('false');
        expect(container.querySelector('.feed-scope-btn[data-scope="all"]')?.classList.contains('active')).toBe(true);
        expect(container.querySelector('.feed-scope-btn[data-scope="all"]')?.getAttribute('aria-pressed')).toBe('true');
        expect(container.querySelectorAll('.feed-item')).toHaveLength(3);
        expect(container.querySelector('.live-feed-footer')?.textContent).toContain('表示: 時系列 / 範囲: 全体');
    });

    it('S-5/S-6: activity historyを主表示し現在セッション範囲で履歴を絞り込む', () => {
        store.getState = vi.fn(() => ({ currentSessionId: 'session-alpha' }));
        service.getHistoryEntries = vi.fn((options = {}) => {
            const entries = [
                {
                    id: 'prompt-alpha',
                    sessionId: 'session-alpha',
                    timestamp: new Date('2026-05-07T11:30:00.000Z'),
                    label: 'Alpha',
                    icon: 'message-square',
                    statusTone: 'prompt',
                    statusText: 'ユーザー入力',
                    actor: 'user',
                    kind: 'user_prompt',
                    text: 'Live Feedで過去の依頼を出して',
                    textSource: 'raw_prompt',
                    evidenceSource: 'terminal_input',
                    provenanceLabel: 'raw prompt',
                },
                {
                    id: 'activity-beta',
                    sessionId: 'session-beta',
                    timestamp: new Date('2026-05-07T11:31:00.000Z'),
                    label: 'Beta',
                    icon: 'activity',
                    statusTone: 'working',
                    statusText: 'エージェント活動',
                    actor: 'agent',
                    kind: 'agent_working',
                    text: '実装ファイルを確認中',
                    textSource: 'structured_field',
                    evidenceSource: 'activity_report',
                    provenanceLabel: 'structured activity',
                },
            ];
            if (options.mode === 'session' && options.sessionId) {
                return entries.filter((entry) => entry.sessionId === options.sessionId);
            }
            return entries;
        });

        view.mount(container);

        expect(container.querySelectorAll('.feed-item')).toHaveLength(1);
        expect(container.querySelector('.feed-item-history-text')?.textContent).toContain('Live Feedで過去の依頼を出して');
        expect(container.querySelector('.feed-item-session')).toBeNull();
        expect(container.querySelector('.feed-item-source')).toBeNull();
        expect(container.querySelector('.live-feed-footer')?.textContent).toContain('表示: 時系列 / 範囲: このセッション');
        expect(service.getHistoryEntries).toHaveBeenCalledWith({ mode: 'session', sessionId: 'session-alpha' });

        container.querySelector('.feed-scope-btn[data-scope="all"]').click();

        expect(Array.from(container.querySelectorAll('.feed-item-history-text')).some((node) => node.textContent.includes('実装ファイルを確認中'))).toBe(true);
        expect(Array.from(container.querySelectorAll('.feed-item-source')).some((node) => node.textContent.includes('活動報告'))).toBe(true);
        expect(Array.from(container.querySelectorAll('.feed-item-session')).map((node) => node.textContent)).toEqual(['session-alpha', 'session-beta']);
    });

    it('S-9/S-10: default表示は現在セッションで、全体ボタンで同じ時系列を横断表示する', () => {
        store.getState = vi.fn(() => ({ currentSessionId: 'session-alpha' }));
        service.getHistoryEntries = vi.fn((options = {}) => {
            const entries = [
            {
                id: 'beta-activity',
                sessionId: 'session-beta',
                timestamp: new Date('2026-05-07T11:35:00.000Z'),
                label: 'Beta',
                icon: 'activity',
                statusTone: 'working',
                statusText: 'エージェント活動',
                text: 'heartbeatで更新中',
                provenanceLabel: 'structured activity',
            },
            {
                id: 'alpha-prompt',
                sessionId: 'session-alpha',
                timestamp: new Date('2026-05-07T11:30:00.000Z'),
                label: 'Alpha',
                icon: 'message-square',
                statusTone: 'prompt',
                statusText: 'ユーザー入力',
                text: 'UIを確認して',
                provenanceLabel: 'raw prompt',
            },
            ];
            if (options.mode === 'session' && options.sessionId) {
                return entries.filter((entry) => entry.sessionId === options.sessionId);
            }
            return entries;
        });

        view.mount(container);

        expect(container.querySelector('.feed-view-mode-btn')).toBeNull();
        expect(container.querySelectorAll('.feed-session-section')).toHaveLength(0);
        expect(Array.from(container.querySelectorAll('.feed-item-label')).map((node) => node.textContent)).toEqual(['Alpha']);
        expect(container.querySelector('.live-feed-footer')?.textContent).toContain('表示: 時系列 / 範囲: このセッション');

        container.querySelector('.feed-scope-btn[data-scope="all"]').click();

        expect(Array.from(container.querySelectorAll('.feed-item-label')).map((node) => node.textContent)).toEqual(['Beta', 'Alpha']);
    });

    it('currentSessionId変更時_現在セッション範囲を再描画する', () => {
        let currentSessionId = 'session-alpha';
        let selectorCallback;
        store.getState = vi.fn(() => ({ currentSessionId }));
        store.subscribeToSelector = vi.fn((selector, callback) => {
            selectorCallback = callback;
            return vi.fn();
        });
        service.getHistoryEntries = vi.fn((options = {}) => {
            const entries = [
                {
                    id: 'alpha-prompt',
                    sessionId: 'session-alpha',
                    timestamp: new Date('2026-05-07T11:30:00.000Z'),
                    label: 'Alpha',
                    icon: 'message-square',
                    statusTone: 'prompt',
                    statusText: 'ユーザー入力',
                    text: 'Alphaの依頼履歴',
                    provenanceLabel: 'raw prompt',
                },
                {
                    id: 'beta-prompt',
                    sessionId: 'session-beta',
                    timestamp: new Date('2026-05-07T11:31:00.000Z'),
                    label: 'Beta',
                    icon: 'message-square',
                    statusTone: 'prompt',
                    statusText: 'ユーザー入力',
                    text: 'Betaの依頼履歴',
                    provenanceLabel: 'raw prompt',
                },
            ];
            if (options.mode === 'session' && options.sessionId) {
                return entries.filter((entry) => entry.sessionId === options.sessionId);
            }
            return entries;
        });

        view.mount(container);

        expect(Array.from(container.querySelectorAll('.feed-item-label')).map((node) => node.textContent)).toEqual(['Alpha']);

        currentSessionId = 'session-beta';
        selectorCallback?.({ value: 'session-beta', oldValue: 'session-alpha' });

        expect(service.getHistoryEntries).toHaveBeenLastCalledWith({ mode: 'session', sessionId: 'session-beta' });
        expect(Array.from(container.querySelectorAll('.feed-item-label')).map((node) => node.textContent)).toEqual(['Beta']);
        expect(container.querySelector('.feed-item-history-text')?.textContent).toContain('Betaの依頼履歴');
        expect(container.querySelector('.live-feed-footer')?.textContent).toContain('表示: 時系列 / 範囲: このセッション');
    });
});
