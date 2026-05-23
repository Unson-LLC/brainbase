import { expect, test } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
  || `http://localhost:${process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

test.describe('story-inline-session-creation inline UX', () => {
  test('ac:7 desktop new-session opens inline draft without activating the create-session modal', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      document.getElementById('app-loading-splash')?.remove();
    });

    await expect(page.locator('#session-list')).toBeVisible();
    await page.locator('#add-session-btn').click();

    await expect(page.locator('#create-session-modal')).not.toHaveClass(/active/);
    await expect(page.locator('#inline-session-draft')).not.toHaveClass(/hidden/);
    await expect(page.locator('#inline-session-name-input')).toHaveValue(/New general Session/);
    await expect(page.locator('#inline-session-project-select')).toHaveValue('general');

    await page.locator('#inline-session-name-input').fill('Discarded inline draft');
    await page.locator('#inline-session-command-input').fill('draft prompt');
    const draftName = 'Discarded inline draft';
    const beforeState = await page.evaluate(async () => {
      const { appStore } = await import('/modules/core/store.js');
      return {
        currentSessionId: appStore.getState().currentSessionId,
        matchingDrafts: (appStore.getState().sessions || [])
          .filter((session: { name?: string }) => session.name === 'Discarded inline draft')
          .length,
      };
    });
    await page.locator('#inline-session-discard').click();

    await expect(page.locator('#inline-session-draft')).toHaveClass(/hidden/);
    await expect(page.locator('#create-session-modal')).not.toHaveClass(/active/);
    const afterState = await page.evaluate(async () => {
      const { appStore } = await import('/modules/core/store.js');
      return {
        currentSessionId: appStore.getState().currentSessionId,
        matchingDrafts: (appStore.getState().sessions || [])
          .filter((session: { name?: string }) => session.name === 'Discarded inline draft')
          .length,
      };
    });
    expect(afterState.matchingDrafts).toBe(beforeState.matchingDrafts);
    expect(await page.locator('.session-name', { hasText: draftName }).count()).toBe(0);
  });

  test('ac:7 non-worktree confirmation uses regular start route and not worktree route', async ({ page }) => {
    const sessionName = `Inline regular ${Date.now()}`;
    const startCalls: unknown[] = [];
    const worktreeCalls: unknown[] = [];

    await page.route('**/api/sessions/create-with-worktree', async (route) => {
      worktreeCalls.push(route.request().postDataJSON());
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'worktree route must not be called' }),
      });
    });
    await page.route('**/api/sessions/start', async (route) => {
      startCalls.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, proxyPath: `/console/${sessionName}` }),
      });
    });

    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      document.getElementById('app-loading-splash')?.remove();
    });

    await page.locator('#add-session-btn').click();
    await page.locator('#inline-session-name-input').fill(sessionName);
    const workspace = page.locator('#inline-use-worktree-checkbox');
    if (await workspace.isChecked()) {
      await workspace.uncheck();
    }
    await page.locator('#inline-session-create').click();

    await expect.poll(() => startCalls.length).toBe(1);
    expect(worktreeCalls).toHaveLength(0);
  });

  test('ac:7 mobile new-session entrypoint opens the same inline draft', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      document.getElementById('app-loading-splash')?.remove();
    });

    await page.locator('#mobile-new-session-btn').click();

    await expect(page.locator('#create-session-modal')).not.toHaveClass(/active/);
    await expect(page.locator('#inline-session-draft')).not.toHaveClass(/hidden/);
  });
});
