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
});
