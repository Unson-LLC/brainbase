import { test, expect } from '@playwright/test';

test.describe('Dashboard Layout', () => {
    test('should display 3-pane layout correctly', async ({ page }) => {
        await page.goto('http://localhost:3000');

        // Verify Page Title
        await expect(page).toHaveTitle('brainbase UI');

        // Verify 3-Pane Layout
        await expect(page.locator('#sidebar')).toBeVisible();
        await expect(page.locator('.main-content')).toBeVisible();
        await expect(page.locator('#context-sidebar')).toBeVisible();
    });

    test('should display session list in left sidebar', async ({ page }) => {
        await page.goto('http://localhost:3000');

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
        await page.goto('http://localhost:3000');

        const mainContent = page.locator('.main-content');

        // Verify console area
        await expect(mainContent.locator('.console-area')).toBeVisible();
        await expect(mainContent.locator('#terminal-frame')).toBeVisible();

        // Verify console toolbar
        await expect(mainContent.locator('.console-toolbar')).toBeVisible();
        await expect(mainContent.locator('#copy-terminal-btn')).toBeVisible();
    });

    test('should display context sections in right sidebar', async ({ page }) => {
        await page.goto('http://localhost:3000');

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
        await page.goto('http://localhost:3000');

        const footer = page.locator('.app-footer');

        // Footer exists in DOM but is hidden (display: none) for clean console view
        await expect(footer).toHaveCount(1);
        await expect(footer).not.toBeVisible();
    });
});

test.describe('Settings View', () => {
    test('should open and close settings view', async ({ page }) => {
        await page.goto('http://localhost:3000');

        // Settings view should be hidden initially
        await expect(page.locator('#settings-view')).not.toBeVisible();

        // Click settings button to open
        await page.click('#settings-btn');
        await expect(page.locator('#settings-view')).toBeVisible();

        // Verify settings header
        await expect(page.locator('#settings-view .settings-header h2')).toContainText('Settings');

        // Close settings
        await page.click('#close-settings-btn');
        await expect(page.locator('#settings-view')).not.toBeVisible();
    });

    test('should display settings tabs', async ({ page }) => {
        await page.goto('http://localhost:3000');
        await page.click('#settings-btn');

        // Verify tabs exist
        const slackTab = page.locator('.settings-tab[data-tab="slack"]');
        const projectsTab = page.locator('.settings-tab[data-tab="projects"]');

        await expect(slackTab).toBeVisible();
        await expect(projectsTab).toBeVisible();

        // Slack tab should be active by default
        await expect(slackTab).toHaveClass(/active/);
        await expect(page.locator('#slack-panel')).toHaveClass(/active/);

        // Click projects tab
        await projectsTab.click();
        await expect(projectsTab).toHaveClass(/active/);
        await expect(slackTab).not.toHaveClass(/active/);
        await expect(page.locator('#projects-panel')).toHaveClass(/active/);
    });

    test('should display integrity summary', async ({ page }) => {
        await page.goto('http://localhost:3000');
        await page.click('#settings-btn');

        // Wait for integrity data to load
        const integritySummary = page.locator('#integrity-summary');
        await expect(integritySummary).toBeVisible();

        // Should eventually show stats (not loading)
        await expect(integritySummary.locator('.loading')).not.toBeVisible({ timeout: 5000 });
    });
});
