import { test, expect } from '@playwright/test';

test('dashboard layout and basic interactions', async ({ page }) => {
    // Go to the dashboard
    await page.goto('http://localhost:3000');

    // Verify Page Title
    await expect(page).toHaveTitle('brainbase UI');

    // Verify 3-Pane Layout
    await expect(page.locator('#sidebar')).toBeVisible();
    await expect(page.locator('.main-content')).toBeVisible();
    await expect(page.locator('#schedule-sidebar')).toBeVisible();

    // Verify Task List in Left Sidebar
    const sidebar = page.locator('#sidebar');
    await expect(sidebar.locator('.task-controls')).toBeVisible();
    await expect(sidebar.locator('.tabs')).toBeVisible();
    await expect(sidebar.locator('#task-list')).toBeVisible();

    // Verify Tabs
    const inProgressTab = sidebar.locator('button[data-filter="in-progress"]');
    const todoTab = sidebar.locator('button[data-filter="todo"]');

    await expect(inProgressTab).toHaveClass(/active/);
    await todoTab.click();
    await expect(todoTab).toHaveClass(/active/);
    await expect(inProgressTab).not.toHaveClass(/active/);

    // Verify Console Area in Main Content
    const mainContent = page.locator('.main-content');
    await expect(mainContent.locator('.console-area')).toBeVisible();
    await expect(mainContent.locator('.console-placeholder')).toContainText('Console Area');

    // Verify Schedule in Right Sidebar
    const scheduleSidebar = page.locator('#schedule-sidebar');
    await expect(scheduleSidebar.locator('h3', { hasText: "Today's Schedule" })).toBeVisible();
});
