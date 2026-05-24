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

    beforeEach(() => {
        container = document.createElement('div');
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
        view = new LiveFeedView({ liveFeedService: service });
    });

    afterEach(() => {
        view.destroy();
    });

    it('Live Feedをタイムライン行として描画する', () => {
        view.mount(container);

        expect(container.querySelector('.live-feed-status')?.textContent).toContain('LIVE');
        expect(container.querySelector('.live-feed-filter-group')?.textContent).toContain('Wiki');
        expect(container.querySelector('.feed-filter-btn[data-filter="task"] .feed-filter-count')?.textContent).toBe('2');
        expect(container.querySelector('.feed-section-label')?.textContent).toBe('NOW');
        expect(container.querySelector('.feed-item')).toBeTruthy();
        expect(container.querySelector('.feed-item-rail')).toBeTruthy();
        expect(container.querySelector('.feed-item-dot.working')).toBeTruthy();
        expect(container.querySelector('.feed-item-actions')).toBeTruthy();
        expect(Array.from(container.querySelectorAll('.feed-item-action')).every((button) => button.disabled)).toBe(true);
        expect(container.querySelector('.live-feed-footer')?.textContent).toContain('表示: すべて');
    });

    it('フィルタボタン押下時_該当カテゴリだけに絞り込まれる', () => {
        view.mount(container);

        container.querySelector('.feed-filter-btn[data-filter="system"]').click();

        expect(container.querySelector('.feed-filter-btn[data-filter="system"]').classList.contains('active')).toBe(true);
        expect(container.querySelector('.feed-filter-btn[data-filter="system"]').getAttribute('aria-pressed')).toBe('true');
        expect(container.querySelectorAll('.feed-item')).toHaveLength(1);
        expect(container.querySelector('.feed-item-label')?.textContent).toBe('システムイベント');
        expect(container.querySelector('.live-feed-footer')?.textContent).toContain('表示: システム');
    });

    it('該当なしフィルタ押下時_カテゴリ別の空状態を表示する', () => {
        service.getEntries = vi.fn(() => [
            {
                id: 'session-1',
                sessionId: 'session-1',
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

        container.querySelector('.feed-filter-btn[data-filter="wiki"]').click();

        expect(container.querySelectorAll('.feed-item')).toHaveLength(0);
        expect(container.querySelector('.live-feed-empty')?.textContent).toContain('Wikiの更新はありません');
    });

    it('S-5/S-6: activity historyを主表示しsession-focused filterで履歴を絞り込む', () => {
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

        expect(Array.from(container.querySelectorAll('.feed-item-history-text')).some((node) => node.textContent.includes('実装ファイルを確認中'))).toBe(true);
        expect(Array.from(container.querySelectorAll('.feed-item-source')).some((node) => node.textContent.includes('structured activity'))).toBe(true);
        expect(container.querySelector('.live-feed-session-scope')?.textContent).toContain('Alpha');

        container.querySelector('.feed-session-chip[data-session-scope="session-alpha"]').click();

        expect(container.querySelectorAll('.feed-item')).toHaveLength(1);
        expect(container.querySelector('.feed-item-history-text')?.textContent).toContain('Live Feedで過去の依頼を出して');
        expect(container.querySelector('.live-feed-footer')?.textContent).toContain('表示: セッション履歴');
    });

    it('INV-11/S-9: default表示はセッションごとの複数行履歴グループを安定順で描画する', () => {
        service.getHistoryEntries = vi.fn(() => [
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
        ]);
        service.getSessionHistoryGroups = vi.fn(() => [
            {
                sessionId: 'session-alpha',
                label: 'Alpha',
                latestTimestamp: new Date('2026-05-07T11:31:00.000Z'),
                entries: [
                    {
                        id: 'alpha-startup',
                        sessionId: 'session-alpha',
                        timestamp: new Date('2026-05-07T11:29:00.000Z'),
                        label: 'Alpha',
                        icon: 'message-square',
                        statusTone: 'prompt',
                        statusText: '初回依頼',
                        text: 'Live Feedを直して',
                        provenanceLabel: 'raw prompt',
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
                ],
            },
            {
                sessionId: 'session-beta',
                label: 'Beta',
                latestTimestamp: new Date('2026-05-07T11:35:00.000Z'),
                entries: [
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
                ],
            },
        ]);

        view.mount(container);

        const sections = Array.from(container.querySelectorAll('.feed-session-section'));
        expect(sections).toHaveLength(2);
        expect(sections[0].getAttribute('data-session-id')).toBe('session-alpha');
        expect(sections[0].querySelectorAll('.feed-item')).toHaveLength(2);
        expect(sections[1].getAttribute('data-session-id')).toBe('session-beta');
        expect(container.querySelector('.feed-section-label')?.textContent).toContain('Alpha');

        container.querySelector('.feed-view-mode-btn[data-feed-mode="log"]').click();

        expect(container.querySelector('.feed-view-mode-btn[data-feed-mode="log"]').classList.contains('active')).toBe(true);
        expect(container.querySelectorAll('.feed-session-section')).toHaveLength(0);
        expect(Array.from(container.querySelectorAll('.feed-item-label')).map((node) => node.textContent)).toEqual(['Beta', 'Alpha']);
    });
});
