/**
 * ProjectDetailsModal Tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

// LineChartをモック化
vi.mock('../../../public/modules/components/line-chart.js', () => ({
    LineChart: class MockLineChart {
        constructor(container, options) {
            this.container = container;
            this.options = options;
            container.innerHTML = '<canvas class="mock-chart"></canvas>';
        }
    }
}));

describe('ProjectDetailsModal', () => {
    let dom;
    let document;
    let window;
    let ProjectDetailsModal;

    beforeEach(async () => {
        dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
                <body>
                    <div id="project-details-modal" style="display: none;">
                        <button class="close-modal-btn">×</button>
                        <h2 id="project-modal-title"></h2>
                        <span id="project-modal-badge"></span>
                        <span id="modal-overdue"></span>
                        <span id="modal-blocked"></span>
                        <span id="modal-completion"></span>
                        <span id="modal-mana"></span>
                        <div id="modal-trend-graph"></div>
                        <ul id="modal-task-list"></ul>
                        <ul id="modal-action-list"></ul>
                        <button id="open-project-btn">Open</button>
                        <button id="nav-console-btn">Console</button>
                    </div>
                </body>
            </html>
        `, { runScripts: 'dangerously' });

        document = dom.window.document;
        window = dom.window;
        global.document = document;
        global.window = window;

        // ProjectDetailsModalをダイナミックインポート
        const module = await import('../../../public/modules/ui/modals/project-details-modal.js');
        ProjectDetailsModal = module.ProjectDetailsModal;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('initialization', () => {
        it('初期化時_モーダル要素が正しく取得される', () => {
            const modal = new ProjectDetailsModal();

            expect(modal.modal).not.toBeNull();
            expect(modal.modal.id).toBe('project-details-modal');
        });

        it('初期化時_closeBtns要素が取得される', () => {
            const modal = new ProjectDetailsModal();

            expect(modal.closeBtns).toBeDefined();
            expect(modal.closeBtns.length).toBeGreaterThanOrEqual(1);
        });

        it('初期化時_openBtn要素が取得される', () => {
            const modal = new ProjectDetailsModal();

            expect(modal.openBtn).not.toBeNull();
            expect(modal.openBtn.id).toBe('open-project-btn');
        });
    });

    describe('open', () => {
        it('open呼び出し時_モーダルが表示される', () => {
            const modal = new ProjectDetailsModal();
            const project = {
                name: 'Test Project',
                healthScore: 85,
                overdue: 2,
                blocked: 1,
                completionRate: 75
            };

            modal.open(project);

            expect(modal.modal.style.display).toBe('flex');
        });

        it('open呼び出し時_プロジェクト名が表示される', () => {
            const modal = new ProjectDetailsModal();
            const project = {
                name: 'Test Project',
                healthScore: 85,
                overdue: 2,
                blocked: 1,
                completionRate: 75
            };

            modal.open(project);

            const title = document.getElementById('project-modal-title');
            expect(title.textContent).toBe('Test Project');
        });

        it('open呼び出し時_ヘルススコアが表示される', () => {
            const modal = new ProjectDetailsModal();
            const project = {
                name: 'Test Project',
                healthScore: 85,
                overdue: 2,
                blocked: 1,
                completionRate: 75
            };

            modal.open(project);

            const badge = document.getElementById('project-modal-badge');
            expect(badge.textContent).toBe('Health: 85%');
        });

        it('open呼び出し時_スコア詳細が表示される', () => {
            const modal = new ProjectDetailsModal();
            const project = {
                name: 'Test Project',
                healthScore: 85,
                overdue: 3,
                blocked: 2,
                completionRate: 80
            };

            modal.open(project);

            expect(document.getElementById('modal-overdue').textContent).toBe('3');
            expect(document.getElementById('modal-blocked').textContent).toBe('2');
            expect(document.getElementById('modal-completion').textContent).toBe('80%');
        });

        it('open呼び出し時_LineChartがレンダリングされる', () => {
            const modal = new ProjectDetailsModal();
            const project = {
                name: 'Test Project',
                healthScore: 85,
                overdue: 2,
                blocked: 1,
                completionRate: 75
            };

            modal.open(project);

            const graphContainer = document.getElementById('modal-trend-graph');
            expect(graphContainer.innerHTML).toContain('mock-chart');
        });

        it('open呼び出し時_currentProjectが設定される', () => {
            const modal = new ProjectDetailsModal();
            const project = {
                name: 'Test Project',
                healthScore: 85,
                overdue: 2,
                blocked: 1,
                completionRate: 75
            };

            modal.open(project);

            expect(modal.currentProject).toBe(project);
        });
    });

    describe('close', () => {
        it('close呼び出し時_モーダルが非表示になる', () => {
            const modal = new ProjectDetailsModal();
            const project = {
                name: 'Test Project',
                healthScore: 85,
                overdue: 2,
                blocked: 1,
                completionRate: 75
            };

            modal.open(project);
            modal.close();

            expect(modal.modal.style.display).toBe('none');
        });

        it('close呼び出し時_グラフコンテナがクリアされる', () => {
            const modal = new ProjectDetailsModal();
            const project = {
                name: 'Test Project',
                healthScore: 85,
                overdue: 2,
                blocked: 1,
                completionRate: 75
            };

            modal.open(project);
            modal.close();

            const graphContainer = document.getElementById('modal-trend-graph');
            expect(graphContainer.innerHTML).toBe('');
        });

        it('Xボタンクリック時_モーダルが閉じる', () => {
            const modal = new ProjectDetailsModal();
            const project = {
                name: 'Test Project',
                healthScore: 85,
                overdue: 2,
                blocked: 1,
                completionRate: 75
            };

            modal.open(project);

            const closeBtn = modal.closeBtns[0];
            closeBtn.onclick();

            expect(modal.modal.style.display).toBe('none');
        });

        it('背景クリック時_モーダルが閉じる', () => {
            const modal = new ProjectDetailsModal();
            const project = {
                name: 'Test Project',
                healthScore: 85,
                overdue: 2,
                blocked: 1,
                completionRate: 75
            };

            modal.open(project);

            // 背景クリックをシミュレート（e.target === this.modal）
            const event = new window.MouseEvent('click', {
                bubbles: true,
                cancelable: true
            });
            Object.defineProperty(event, 'target', { value: modal.modal });
            modal.modal.onclick(event);

            expect(modal.modal.style.display).toBe('none');
        });
    });

    describe('getHealthColor', () => {
        it('getHealthColor呼び出し時_score70以上_成功色が返される', () => {
            const modal = new ProjectDetailsModal();

            expect(modal.getHealthColor(70)).toBe('var(--success-color)');
            expect(modal.getHealthColor(85)).toBe('var(--success-color)');
            expect(modal.getHealthColor(100)).toBe('var(--success-color)');
        });

        it('getHealthColor呼び出し時_score50-69_警告色が返される', () => {
            const modal = new ProjectDetailsModal();

            expect(modal.getHealthColor(50)).toBe('var(--warning-color)');
            expect(modal.getHealthColor(65)).toBe('var(--warning-color)');
            expect(modal.getHealthColor(69)).toBe('var(--warning-color)');
        });

        it('getHealthColor呼び出し時_score50未満_危険色が返される', () => {
            const modal = new ProjectDetailsModal();

            expect(modal.getHealthColor(0)).toBe('var(--danger-color)');
            expect(modal.getHealthColor(25)).toBe('var(--danger-color)');
            expect(modal.getHealthColor(49)).toBe('var(--danger-color)');
        });
    });

    describe('renderTaskList', () => {
        it('overdue > 0の場合_Overdueタスクがリストに表示される', () => {
            const modal = new ProjectDetailsModal();
            const project = {
                name: 'Test',
                healthScore: 85,
                overdue: 1,
                blocked: 0,
                completionRate: 75
            };

            modal.open(project);

            const taskList = document.getElementById('modal-task-list');
            expect(taskList.innerHTML).toContain('Overdue');
        });

        it('blocked > 0の場合_Blockedタスクがリストに表示される', () => {
            const modal = new ProjectDetailsModal();
            const project = {
                name: 'Test',
                healthScore: 85,
                overdue: 0,
                blocked: 1,
                completionRate: 75
            };

            modal.open(project);

            const taskList = document.getElementById('modal-task-list');
            expect(taskList.innerHTML).toContain('Blocked');
        });
    });

    describe('renderActionList', () => {
        it('healthScore < 50の場合_緊急レビューアクションが表示される', () => {
            const modal = new ProjectDetailsModal();
            const project = {
                name: 'Test',
                healthScore: 40,
                overdue: 0,
                blocked: 0,
                completionRate: 50
            };

            modal.open(project);

            const actionList = document.getElementById('modal-action-list');
            expect(actionList.innerHTML).toContain('Schedule emergency review meeting');
        });

        it('overdue > 2の場合_タスク再割り当てアクションが表示される', () => {
            const modal = new ProjectDetailsModal();
            const project = {
                name: 'Test',
                healthScore: 85,
                overdue: 3,
                blocked: 0,
                completionRate: 50
            };

            modal.open(project);

            const actionList = document.getElementById('modal-action-list');
            expect(actionList.innerHTML).toContain('Reassign overdue tasks');
        });
    });
});
