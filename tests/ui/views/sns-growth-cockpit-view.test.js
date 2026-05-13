import { beforeEach, describe, expect, it } from 'vitest';

import { SnsGrowthCockpitView } from '../../../public/modules/ui/views/sns-growth-cockpit-view.js';

describe('SnsGrowthCockpitView', () => {
    let container;

    beforeEach(() => {
        document.body.innerHTML = '<main id="root"></main>';
        container = document.getElementById('root');
    });

    it('Brainbase loop navigation and Ship Calendar surface are rendered', () => {
        const view = new SnsGrowthCockpitView();
        view.mount(container);

        expect(container.textContent).toContain('今日');
        expect(container.textContent).toContain('脳');
        expect(container.textContent).toContain('作る');
        expect(container.textContent).toContain('動かす');
        expect(container.textContent).toContain('学ぶ');
        expect(container.querySelector('.sns-growth-brand')?.getAttribute('href')).toBe('/');
        expect(container.querySelector('[data-nav-item="sns-growth"]')?.classList.contains('active')).toBe(true);
        expect(container.querySelector('.sns-growth-calendar-grid')).toBeTruthy();
        expect(container.textContent).toContain('今週はX運用の話に寄りすぎ');
    });

    it('INV-1: mobile decision inbox renders before the weekly calendar surface', () => {
        const view = new SnsGrowthCockpitView();
        view.mount(container);

        const inbox = container.querySelector('.sns-mobile-review-flow');
        const calendar = container.querySelector('.sns-growth-calendar-grid');

        expect(inbox).toBeTruthy();
        expect(inbox.compareDocumentPosition(calendar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(inbox?.textContent).toContain('今日のSNS判断');
        expect(inbox?.textContent).toContain('レビュー');
        expect(inbox?.textContent).toContain('予約済み');
        expect(inbox?.textContent).toContain('投稿済み');
        expect(container.querySelectorAll('.sns-mobile-decision-card').length).toBeGreaterThan(0);
    });

    it('status summary cards and post status badges match the Ship Calendar contract', () => {
        const view = new SnsGrowthCockpitView();
        view.mount(container);

        expect(container.querySelector('[data-summary-status="review_needed"]')?.textContent).toContain('3');
        expect(container.querySelector('[data-summary-status="scheduled"]')?.textContent).toContain('8');
        expect(container.querySelector('[data-summary-status="posted"]')?.textContent).toContain('12');
        expect(container.querySelector('[data-summary-status="learning_ready"]')?.textContent).toContain('2');
        expect(container.querySelector('.sns-status-chip.status-review-needed')).toBeTruthy();
        expect(container.querySelector('.sns-status-chip.status-scheduled')).toBeTruthy();
        expect(container.querySelector('.sns-status-chip.status-posted')).toBeTruthy();
        expect(container.querySelector('.sns-status-chip.status-learning-ready')).toBeTruthy();
    });

    it('selected post detail panel shows editable operational fields and collapsed evidence rows', () => {
        const view = new SnsGrowthCockpitView();
        view.mount(container);

        expect(container.textContent).toContain('ポストの詳細');
        expect(container.textContent).toContain('bb_x_20250522_0900');
        expect(container.querySelector('[data-detail-field="body"]')?.textContent).toContain('情報の流れ');
        expect(container.textContent).toContain('スケジュール日時');
        expect(container.textContent).toContain('承認する');
        expect(container.textContent).toContain('Persona Brain');
        expect(container.textContent).toContain('Graph Check');
        expect(container.textContent).toContain('Quality Gate');
        expect(container.textContent).toContain('Reader affect');
        expect(container.querySelectorAll('.sns-evidence-row')).toHaveLength(4);
    });

    it('clicking a calendar post updates the selected detail panel', () => {
        const view = new SnsGrowthCockpitView();
        view.mount(container);

        container.querySelector('[data-post-id="bb_x_20250521_1200"]')?.click();

        expect(container.querySelector('.sns-calendar-post.selected')?.getAttribute('data-post-id')).toBe('bb_x_20250521_1200');
        expect(container.textContent).toContain('Personal KGの活用事例');
        expect(container.textContent).toContain('bb_x_20250521_1200');
    });

    it('S-2: clicking a mobile decision card updates the selected detail panel', () => {
        const view = new SnsGrowthCockpitView();
        view.mount(container);

        container.querySelector('[data-post-id="bb_x_20250522_1500"]')?.click();

        expect(container.querySelector('.sns-mobile-decision-card.selected')?.getAttribute('data-post-id')).toBe('bb_x_20250522_1500');
        expect(container.querySelector('.sns-calendar-post.selected')?.getAttribute('data-post-id')).toBe('bb_x_20250522_1500');
        expect(container.textContent).toContain('プロジェクトの成功率を上げる');
        expect(container.textContent).toContain('bb_x_20250522_1500');
    });
});
