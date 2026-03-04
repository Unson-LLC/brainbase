import { test, expect } from '@playwright/test';

const DEFAULT_PORT = process.cwd().includes('.worktrees') ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
  || `http://localhost:${process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

test.describe('Dashboard Layout', () => {
    test('should display 3-pane layout correctly', async ({ page }) => {
        await page.goto(BASE_URL);

        // Verify Page Title
        await expect(page).toHaveTitle('brainbase UI');

        // Verify 3-Pane Layout
        await expect(page.locator('#sidebar')).toBeVisible();
        await expect(page.locator('.main-content')).toBeVisible();
        await expect(page.locator('#context-sidebar')).toBeVisible();
    });

    test('should display session list in left sidebar', async ({ page }) => {
        await page.goto(BASE_URL);

        const sidebar = page.locator('#sidebar');

        // Verify sidebar header
        await expect(sidebar.locator('.sidebar-header h3')).toHaveText('Sessions');
        await expect(sidebar.locator('#add-session-btn')).toBeVisible();

        // Verify session list container
        await expect(sidebar.locator('#session-list')).toBeVisible();

        // Verify settings button in sidebar footer
        await expect(sidebar.locator('#settings-btn')).toBeVisible();
    });

    test('should display console area in main content', async ({ page }) => {
        await page.goto(BASE_URL);

        const mainContent = page.locator('.main-content');

        // Verify console area
        await expect(mainContent.locator('.console-area')).toBeVisible();
        await expect(mainContent.locator('#terminal-frame')).toBeVisible();

        // Verify console toolbar
        await expect(mainContent.locator('.console-toolbar')).toBeVisible();
        await expect(mainContent.locator('#copy-terminal-btn')).toBeVisible();
    });

    test('should display context sections in right sidebar', async ({ page }) => {
        await page.goto(BASE_URL);

        const contextSidebar = page.locator('#context-sidebar');

        // Verify focus section
        await expect(contextSidebar.locator('#focus-section')).toBeVisible();
        await expect(contextSidebar.locator('#focus-section .section-header h3')).toContainText('今日のフォーカス');

        // Verify timeline section
        await expect(contextSidebar.locator('#timeline-section')).toBeVisible();
        await expect(contextSidebar.locator('#timeline-section .section-header h3')).toContainText('タイムライン');

        // Verify next tasks section
        await expect(contextSidebar.locator('#next-tasks-section')).toBeVisible();
        await expect(contextSidebar.locator('#next-tasks-section .section-header h3')).toContainText('次にやること');
    });

    test('footer exists but is hidden for clean console view', async ({ page }) => {
        await page.goto(BASE_URL);

        const footer = page.locator('.app-footer');

        // Footer exists in DOM but is hidden (display: none) for clean console view
        await expect(footer).toHaveCount(1);
        await expect(footer).not.toBeVisible();
    });
});

test.describe('Settings View', () => {
    test('should open and close settings view', async ({ page }) => {
        await page.goto(BASE_URL);

        // Settings view should be hidden initially
        await expect(page.locator('#settings-view')).not.toBeVisible();

        // Click settings button to open
        await page.click('#settings-btn');
        await expect(page.locator('#settings-view')).toBeVisible();

        // Verify settings header
        await expect(page.locator('#settings-view .settings-header h3')).toContainText('Settings');

        // Close settings
        await page.click('#close-settings-btn');
        await expect(page.locator('#settings-view')).not.toBeVisible();
    });

    test('should display settings tabs', async ({ page }) => {
        await page.goto(BASE_URL);
        await page.click('#settings-btn');

        // Verify tabs exist
        const overviewTab = page.locator('.settings-tab[data-tab="overview"]');
        const integrationsTab = page.locator('.settings-tab[data-tab="integrations"]');

        await expect(overviewTab).toBeVisible();
        await expect(integrationsTab).toBeVisible();

        // Overview tab should be active by default
        await expect(overviewTab).toHaveClass(/active/);
        await expect(page.locator('#overview-panel')).toHaveClass(/active/);

        // Click integrations tab
        await integrationsTab.click();
        await expect(integrationsTab).toHaveClass(/active/);
        await expect(overviewTab).not.toHaveClass(/active/);
        await expect(page.locator('#integrations-panel')).toHaveClass(/active/);
    });

    test('should display integrity summary', async ({ page }) => {
        await page.goto(BASE_URL);
        await page.click('#settings-btn');

        // Wait for integrity data to load
        const integrityStats = page.locator('#overview-panel .integrity-stats');
        await expect(integrityStats).toBeVisible();
    });
});
