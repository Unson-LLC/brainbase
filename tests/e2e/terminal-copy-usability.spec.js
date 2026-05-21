import { test, expect } from '@playwright/test';

test.describe('terminal-copy-usability', () => {
  test('terminal-copy-usability ac:1 ac:2 ac:3 file-link click activation keeps drag selection safe', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const { shouldActivateTerminalFileLinkClick } = await import('/modules/iframe-contextmenu-handler.js');
      const link = { text: 'public/app.js' };

      return {
        shortClick: shouldActivateTerminalFileLinkClick({
          pointerDown: { clientX: 100, clientY: 40, startedAt: 1000, link },
          event: { button: 0, clientX: 102, clientY: 42, link },
          now: 1100
        }),
        dragSelection: shouldActivateTerminalFileLinkClick({
          pointerDown: { clientX: 100, clientY: 40, startedAt: 1000, link },
          event: { button: 0, clientX: 122, clientY: 40, link },
          now: 1100
        }),
        activeSelection: shouldActivateTerminalFileLinkClick({
          pointerDown: { clientX: 100, clientY: 40, startedAt: 1000, link },
          event: { button: 0, clientX: 101, clientY: 40, link },
          selectedText: 'selected terminal text',
          now: 1100
        })
      };
    });

    expect(result).toEqual({
      shortClick: true,
      dragSelection: false,
      activeSelection: false
    });
  });

  test('terminal-copy-usability ac:4 ac:5 ac:6 ac:7 ac:8 terminal copy modal exposes larger copy ranges', async ({ page }) => {
    const contentRequests = [];
    await page.route('**/api/sessions/session-copy/content**', async (route) => {
      const url = new URL(route.request().url());
      const lines = url.searchParams.get('lines') || '500';
      contentRequests.push(lines);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ content: `terminal content ${lines}` })
      });
    });

    await page.goto('/');
    await page.waitForFunction(() => typeof document.getElementById('copy-terminal-btn')?.onclick === 'function');

    await page.evaluate(async () => {
      const { appStore } = await import('/modules/core/store.js');
      appStore.setState({ currentSessionId: 'session-copy' });
      document.getElementById('copy-terminal-btn')?.click();
    });

    const rangeSelect = page.locator('#terminal-copy-lines');
    await expect(rangeSelect).toBeVisible();
    await expect(rangeSelect.locator('option')).toHaveText(['500行', '2000行', '5000行']);
    await expect(page.locator('#terminal-content-display')).toHaveText('terminal content 500');

    await rangeSelect.selectOption('5000');
    await expect(rangeSelect).toHaveValue('5000');
    await expect(page.locator('#terminal-content-display')).toHaveText('terminal content 5000');
    expect(contentRequests).toEqual(['500', '5000']);
  });
});
