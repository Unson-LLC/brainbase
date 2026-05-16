import { test, expect, devices } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const PORT = process.env.BRAINBASE_E2E_PORT || (isWorktree ? DEFAULT_PORT : (process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT));
const BASE_URL = process.env.BRAINBASE_BASE_URL
  || `http://localhost:${PORT}`;

test.use(devices['iPhone 12 Pro']);

async function waitForApp(page) {
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(window.brainbaseApp));
    await page.waitForTimeout(1500);
}

async function injectTopBanners(page) {
    await page.evaluate(() => {
        const app = window.brainbaseApp;
        const stack = document.getElementById('top-banner-stack');
        if (!stack) throw new Error('top-banner-stack not found');

        stack.innerHTML = `
            <div id="test-mode-banner" class="test-mode-banner">
                <div class="test-mode-banner-content">
                    <span><strong>テストモード:</strong> 読み取り専用です。</span>
                </div>
            </div>
            <div id="learning-health-banner" class="learning-health-banner">
                <div class="learning-health-banner-content">
                    <div class="learning-health-banner-copy">
                        <span>学習ジョブが遅延しています。</span>
                    </div>
                    <div class="learning-health-banner-actions">
                        <button class="learning-health-banner-btn" type="button">Bellで見る</button>
                        <button class="learning-health-banner-btn" type="button">閉じる</button>
                    </div>
                </div>
            </div>
        `;

        app?.requestAppTopOffsetSync?.();
    });

    await page.waitForFunction(() => {
        const stack = document.getElementById('top-banner-stack');
        const value = window.getComputedStyle(document.body).getPropertyValue('--app-top-offset').trim();
        const offset = Number.parseInt(value, 10);
        const stackHeight = stack ? Math.ceil(stack.getBoundingClientRect().height) : 0;
        return offset > 0 && offset >= stackHeight;
    });
}

test.describe('Mobile PWA layout', () => {
    test('keeps tab bar and content below the stacked top banners', async ({ page }) => {
        await waitForApp(page);
        await injectTopBanners(page);

        const metrics = await page.evaluate(() => {
            const stack = document.getElementById('top-banner-stack');
            const tabBar = document.getElementById('mobile-tab-bar');
            const appContainer = document.querySelector('.app-container');
            const mainContent = document.querySelector('.main-content');
            const consoleArea = document.getElementById('console-area');
            const bodyStyles = window.getComputedStyle(document.body);

            if (!stack || !tabBar || !appContainer || !mainContent || !consoleArea) {
                throw new Error('Required layout elements are missing');
            }

            const stackRect = stack.getBoundingClientRect();
            const tabBarRect = tabBar.getBoundingClientRect();
            const appRect = appContainer.getBoundingClientRect();
            const mainRect = mainContent.getBoundingClientRect();
            const consoleRect = consoleArea.getBoundingClientRect();

            return {
                appTopOffset: Number.parseInt(bodyStyles.getPropertyValue('--app-top-offset'), 10),
                stackBottom: stackRect.bottom,
                tabBarTop: tabBarRect.top,
                tabBarBottom: tabBarRect.bottom,
                appTop: appRect.top,
                mainHeight: mainRect.height,
                consoleHeight: consoleRect.height
            };
        });

        expect(metrics.appTopOffset).toBeGreaterThan(0);
        expect(metrics.tabBarTop).toBeGreaterThanOrEqual(metrics.stackBottom - 1);
        expect(metrics.appTop).toBeGreaterThanOrEqual(metrics.stackBottom - 1);
        expect(metrics.mainHeight).toBeGreaterThan(0);
        expect(metrics.consoleHeight).toBeGreaterThan(0);
    });

    test('keeps snapshot panel between the tab bar and bottom controls', async ({ page }) => {
        await waitForApp(page);
        await injectTopBanners(page);

        const metrics = await page.evaluate(() => {
            const app = window.brainbaseApp;
            const tabBar = document.getElementById('mobile-tab-bar');
            const snapshotPanel = document.getElementById('terminal-snapshot-panel');
            const consoleArea = document.getElementById('console-area');
            const dock = document.querySelector('.mobile-input-dock');
            const bottomNav = document.getElementById('mobile-bottom-nav');
            if (!tabBar || !snapshotPanel || !consoleArea) {
                throw new Error('Missing snapshot layout elements');
            }

            document.body.classList.remove('mobile-tab-active');
            app?._showSnapshotDisplay?.();
            consoleArea.classList.add('using-snapshot');
            snapshotPanel.classList.remove('hidden');

            document.body.style.setProperty('--mobile-tab-bar-height', `${tabBar.offsetHeight}px`);
            app?.requestAppTopOffsetSync?.();

            const visibleRects = [dock, bottomNav]
                .filter(Boolean)
                .filter((el) => window.getComputedStyle(el).display !== 'none')
                .map((el) => el.getBoundingClientRect())
                .filter((rect) => rect.height > 0);

            const tabBarRect = tabBar.getBoundingClientRect();
            const snapshotRect = snapshotPanel.getBoundingClientRect();
            const obstructionTop = visibleRects.length > 0
                ? Math.min(...visibleRects.map((rect) => rect.top))
                : window.innerHeight;

            return {
                tabBarBottom: tabBarRect.bottom,
                snapshotTop: snapshotRect.top,
                snapshotBottom: snapshotRect.bottom,
                snapshotHeight: snapshotRect.height,
                obstructionTop
            };
        });

        expect(metrics.snapshotTop).toBeGreaterThanOrEqual(metrics.tabBarBottom - 1);
        expect(metrics.snapshotBottom).toBeLessThanOrEqual(metrics.obstructionTop + 1);
        expect(metrics.snapshotHeight).toBeGreaterThan(100);
    });
});
