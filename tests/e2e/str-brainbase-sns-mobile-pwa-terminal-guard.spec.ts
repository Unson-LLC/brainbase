import { test, expect, devices } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const PORT = process.env.BRAINBASE_E2E_PORT || (isWorktree ? DEFAULT_PORT : (process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT));
const BASE_URL = process.env.BRAINBASE_BASE_URL || `http://localhost:${PORT}`;

function todayJst() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

async function csrfHeaders(request, sessionId) {
  const response = await request.get(`${BASE_URL}/api/csrf-token`, {
    headers: { 'X-Session-Id': sessionId }
  });
  expect(response.ok()).toBe(true);
  const { token } = await response.json();
  return {
    'X-Session-Id': sessionId,
    'X-CSRF-Token': token
  };
}

test.describe('str.brainbase.sns-mobile-pwa-terminal-guard', () => {
  const { defaultBrowserType: _defaultBrowserType, ...iphone12Pro } = devices['iPhone 12 Pro'];
  test.use(iphone12Pro);

  test('ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 mobile SNS tap keeps detail open and preserves session terminal behavior', async ({ page, request }) => {
    const runtimeErrors: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('/api/auth/verify') && message.text().includes('401')) return;
      if (message.text() === 'Failed to load resource: the server responded with a status of 401 (Unauthorized)') return;
      if (message.type() === 'error') {
        runtimeErrors.push(`console:${message.text()}`);
      }
    });
    page.on('pageerror', (error) => {
      runtimeErrors.push(`pageerror:${error.message}`);
    });
    page.on('requestfailed', (failedRequest) => {
      runtimeErrors.push(`requestfailed:${failedRequest.method()} ${failedRequest.url()} ${failedRequest.failure()?.errorText || ''}`.trim());
    });
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/api/auth/verify') && response.status() === 401) return;
      if (response.status() >= 400 && !url.includes('/favicon.ico')) {
        runtimeErrors.push(`response:${response.status()} ${url}`);
      }
    });

    const lane = `mobile_story_guard_${Date.now()}`;
    const accountId = `acc_x_sato_${lane}`;
    const headers = await csrfHeaders(request, lane);
    const date = todayJst();
    const body = `SNS mobile PWA guard ${Date.now()}`;

    const pack = await request.post(`${BASE_URL}/api/sns-growth/review-pack`, {
      headers,
      data: {
        account_id: accountId,
        account_handle: '@AIBizNavigator',
        drafts: [{
          date,
          slot_index: 5,
          lane,
          body,
          source_url: 'https://x.com/example/status/mobile-story-guard',
          persona_brain: { target_person: 'AI導入を任されたPM' },
          quality_gate: { status: 'pass' }
        }]
      }
    });
    expect(pack.ok()).toBe(true);
    const packJson = await pack.json();
    const post = (packJson.created || [])[0] || (packJson.updated || [])[0];
    expect(post).toBeTruthy();

    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => Boolean(window.brainbaseApp));
    await page.evaluate(() => {
      window.__snsLiveTerminalOpens = 0;
      const app = window.brainbaseApp;
      if (app?.openMobileLiveTerminal) {
        const original = app.openMobileLiveTerminal.bind(app);
        app.openMobileLiveTerminal = async (...args) => {
          window.__snsLiveTerminalOpens += 1;
          return original(...args);
        };
      }
    });

    await page.locator('#mobile-sns-growth-btn').tap();
    await expect(page.locator('#sns-growth-overlay.open')).toBeVisible();

    const backBox = await page.locator('#sns-growth-back-terminal').boundingBox();
    expect(backBox?.height).toBeGreaterThanOrEqual(44);
    expect(backBox?.y).toBeGreaterThanOrEqual(0);

    await page.locator(`.sns-mobile-decision-card[data-post-id="${post.id}"]`).tap();

    await expect(page.locator('.sns-growth-detail')).toContainText(body);
    await expect(page.locator('#sns-growth-overlay.open')).toBeVisible();
    await expect(page.locator('#terminal-stage')).toBeHidden();
    await expect(page.locator('#mobile-live-terminal-modal')).not.toHaveClass(/active/);
    await expect.poll(() => page.evaluate(() => window.__snsLiveTerminalOpens || 0)).toBe(0);

    await page.evaluate(() => {
      const snapshot = document.querySelector('#terminal-snapshot-panel');
      snapshot?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    });
    await expect.poll(() => page.evaluate(() => window.__snsLiveTerminalOpens || 0)).toBe(0);
    await expect(page.locator('#mobile-live-terminal-modal')).not.toHaveClass(/active/);

    await page.locator('#sns-growth-back-terminal').tap();
    await expect(page.locator('#sns-growth-overlay.open')).toHaveCount(0);
    await expect(page.locator('#terminal-stage')).toBeVisible();
    await page.evaluate(() => {
      window.__snsLiveTerminalOpens = 0;
    });
    await page.locator('#terminal-snapshot-panel').tap({ position: { x: 80, y: 80 } });
    await expect.poll(() => page.evaluate(() => window.__snsLiveTerminalOpens || 0)).toBeGreaterThan(0);
    expect(runtimeErrors).toEqual([]);
  });
});
