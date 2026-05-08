import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PortalOverlayView } from '../../../public/modules/ui/views/portal-overlay-view.js';

describe('PortalOverlayView', () => {
    let container;
    let portalService;

    beforeEach(() => {
        document.body.innerHTML = `
            <select id="portal-overlay-project-select"><option value="">Project</option></select>
            <button id="portal-overlay-refresh"></button>
            <div id="test-container"></div>
        `;
        container = document.getElementById('test-container');
        window.lucide = { createIcons: vi.fn() };
        portalService = {
            getOverlayData: vi.fn(() => createOverlayData()),
            getCurrentProject: vi.fn(() => 'brainbase'),
            loadPortalOverlay: vi.fn()
        };
        vi.clearAllMocks();
    });

    it('overlayデータ表示時_生成画像ベースのPortalコマンドレイアウトを描画する', () => {
        const view = new PortalOverlayView({
            portalService,
            configProjects: [{ id: 'brainbase', name: 'Brainbase' }]
        });

        view.mount(container);

        expect(container.querySelector('.portal-overlay-content')).toBeTruthy();
        expect(container.querySelector('.portal-kpi-bar')).toBeTruthy();
        expect(container.querySelectorAll('.portal-kpi-card')).toHaveLength(4);
        expect(container.textContent).toContain('Open Decisions');
        expect(container.textContent).toContain('Active Work');
        expect(container.textContent).toContain('Blocked');
        expect(container.textContent).toContain('Shipped');
        expect(container.querySelector('.portal-command-grid')).toBeTruthy();
        expect(container.querySelector('.portal-command-main .portal-ov-value-loop')).toBeTruthy();
        expect(container.querySelector('.portal-command-main .portal-ov-events')).toBeTruthy();
        expect(container.querySelector('.portal-command-side .portal-ov-story')).toBeTruthy();
        expect(container.querySelector('.portal-command-side .portal-ov-team')).toBeTruthy();
        expect(container.querySelector('.portal-command-side .portal-ov-frame')).toBeTruthy();
        expect(container.querySelectorAll('.portal-vl-column')).toHaveLength(4);
    });

    it('データ未選択時_空状態のみを表示する', () => {
        portalService.getOverlayData.mockReturnValue(null);
        const view = new PortalOverlayView({ portalService, configProjects: [] });

        view.mount(container);

        expect(container.querySelector('.portal-overlay-empty')?.textContent).toContain('プロジェクトを選択してください');
        expect(container.querySelector('.portal-command-grid')).toBeNull();
    });

    it('セクションヘッダークリック時_折りたたみ状態を切り替える', () => {
        const view = new PortalOverlayView({ portalService, configProjects: [] });
        view.mount(container);

        const header = container.querySelector('.portal-ov-value-loop .portal-ov-section-header');
        header.click();

        expect(container.querySelector('.portal-ov-value-loop')?.classList.contains('collapsed')).toBe(true);
    });
});

function createOverlayData() {
    return {
        tasks: {
            items: [
                { title: 'Blocked design decision', status: 'ブロック', assignee: 'Operator K' },
                { title: 'Portal implementation', status: '進行中', assignee: 'Lead H' }
            ]
        },
        valueLoop: {
            decision: {
                milestones: [{ name: 'Portal foundation', progress: 72, status: 'active' }],
                issues: [{ title: 'Navigation density', impact: 'high', assignee: 'Operator K' }],
                decisions: []
            },
            work: {
                tasks: [{ title: 'Replace Portal shell', status: '進行中', assignee: 'Lead H' }]
            },
            ship: {
                items: [{ title: 'Command center components', status: 'shipped', type: 'release' }]
            },
            learn: {
                retrospectives: [{ period: 'Sprint 14', learnings: 'Flat table rows scan faster than nested cards.' }]
            }
        },
        storyMap: {
            stories: [{ name: 'Portal becomes the project operating dashboard', horizon: 'quarter', status: 'active', progress: 68 }],
            milestones: [],
            sprints: []
        },
        events: {
            stats: { thisWeek: 3 },
            items: [{ eventType: 'ship', title: 'Portal reference implemented', occurredAt: '2026-05-08T01:00:00.000Z' }]
        },
        members: [{ name: 'Operator K', role: 'Owner', raciRoles: [{ roleCode: 'A' }] }],
        frame: { summary: 'A single operating surface for project state.' },
        direction: { content: 'Keep decisions, work, ship, and learn visible.' }
    };
}
