import { expect, test } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
  || `http://localhost:${process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

async function ensureLaunchPickerOpen(page, project = 'general') {
  if (await page.locator('#session-launch-picker.hidden').count()) {
    await page.evaluate((selectedProject) => {
      return window.brainbaseApp?.openSessionLaunchPicker?.(selectedProject);
    }, project);
  }
}

test.describe('story-session-launch-picker-startup-composer UX', () => {
  test('desktop new-session opens launch picker without create-session modal', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => document.getElementById('app-loading-splash')?.remove());

    await expect(page.locator('#session-list')).toBeVisible();
    await page.waitForFunction(() => Boolean(window.brainbaseApp?.openSessionLaunchPicker));
    await page.locator('#add-session-btn').click();
    await ensureLaunchPickerOpen(page);

    await expect(page.locator('#create-session-modal')).not.toHaveClass(/active/);
    await expect(page.locator('#session-launch-picker')).not.toHaveClass(/hidden/);
    await expect(page.locator('#session-launch-project-select')).toHaveValue('general');
    await expect(page.locator('#session-launch-picker')).not.toContainText('セッション名');
    await expect(page.locator('#session-launch-picker')).not.toContainText('初期コマンド');
  });

  test('non-worktree confirmation uses regular start route and not worktree route', async ({ page }) => {
    const startCalls: unknown[] = [];
    const worktreeCalls: unknown[] = [];

    await page.route('**/api/sessions/create-with-worktree', async (route) => {
      worktreeCalls.push(route.request().postDataJSON());
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'worktree route must not be called' }) });
    });
    await page.route('**/api/sessions/start', async (route) => {
      startCalls.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, proxyPath: '/console/launch-picker-regular' }) });
    });

    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => document.getElementById('app-loading-splash')?.remove());

    await page.waitForFunction(() => Boolean(window.brainbaseApp?.openSessionLaunchPicker));
    await page.locator('#add-session-btn').click();
    await ensureLaunchPickerOpen(page);
    const workspace = page.locator('#session-launch-use-worktree-checkbox');
    if (await workspace.isChecked()) await workspace.uncheck();
    await page.locator('#session-launch-start').click();

    await expect.poll(() => startCalls.length).toBe(1);
    expect(startCalls[0]).toMatchObject({ initialCommand: '', engine: 'claude' });
    expect(worktreeCalls).toHaveLength(0);
  });

  test('mobile new-session entrypoint opens the same launch picker', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => document.getElementById('app-loading-splash')?.remove());

    await page.waitForFunction(() => Boolean(window.brainbaseApp?.openSessionLaunchPicker));
    await page.locator('#mobile-new-session-btn').click();
    await ensureLaunchPickerOpen(page);

    await expect(page.locator('#create-session-modal')).not.toHaveClass(/active/);
    await expect(page.locator('#session-launch-picker')).not.toHaveClass(/hidden/);
  });
});
