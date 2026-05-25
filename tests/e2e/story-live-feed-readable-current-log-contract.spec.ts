import { test, expect } from '@playwright/test';

test.describe('story-live-feed-readable-current-log', () => {
  const sessions = [
    {
      id: 'session-alpha',
      name: 'Alpha',
      intendedState: 'active',
      runtimeStatus: { ttydRunning: true },
      activityHistory: [
        {
          id: 'alpha-prompt',
          actor: 'user',
          kind: 'user_prompt',
          text: 'Live Feedでこのセッションの過去の依頼をすぐ見たい',
          textSource: 'raw_prompt',
          evidenceSource: 'terminal_input',
          occurredAt: '2026-05-07T11:30:00.000Z',
          dedupeKey: 'alpha-prompt',
        },
      ],
    },
    {
      id: 'session-beta',
      name: 'Beta',
      intendedState: 'active',
      runtimeStatus: { ttydRunning: true },
      activityHistory: [
        {
          id: 'beta-prompt',
          actor: 'user',
          kind: 'user_prompt',
          text: '全体ログで他セッションの作業状況も時系列で確認できる',
          textSource: 'raw_prompt',
          evidenceSource: 'terminal_input',
          occurredAt: '2026-05-07T11:35:00.000Z',
          dedupeKey: 'beta-prompt',
        },
      ],
    },
  ];

  test('current scope reads like a compact prompt log at drawer width', async ({ page }) => {
    // story-live-feed-readable-current-log ac:1
    // story-live-feed-readable-current-log ac:2
    // story-live-feed-readable-current-log ac:3
    // story-live-feed-readable-current-log ac:4
    // story-live-feed-readable-current-log ac:5
    // story-live-feed-readable-current-log ac:6
    await page.goto('/');
    await page.setContent(`
      <!doctype html>
      <html>
        <head>
          <link rel="stylesheet" href="/style.css">
          <style>
            html, body { margin: 0; width: 100%; height: 100%; background: #090c10; }
            #top-banner-stack { display: none !important; pointer-events: none !important; }
            #live-feed-panel { width: 430px; height: 720px; display: flex; }
          </style>
        </head>
        <body class="dark-theme command-center-theme">
          <div id="live-feed-panel"></div>
          <div class="mana-chat-widget" style="display: none;"></div>
          <script type="module">
            import { LiveFeedView } from '/modules/ui/views/live-feed-view.js';

            const entries = [
              {
                id: 'beta-activity',
                sessionId: 'session-beta',
                timestamp: new Date('2026-05-07T11:35:00.000Z'),
                label: 'Beta',
                icon: 'activity',
                statusTone: 'working',
                statusText: 'エージェント活動',
                text: '全体ログで他セッションの作業状況も時系列で確認できる',
                provenanceLabel: 'structured activity',
              },
              {
                id: 'alpha-prompt',
                sessionId: 'session-alpha',
                timestamp: new Date('2026-05-07T11:30:00.000Z'),
                label: 'Alpha',
                icon: 'message-square',
                statusTone: 'prompt',
                statusText: 'ユーザー入力',
                text: 'Live Feedでこのセッションの過去の依頼をすぐ見たい',
                provenanceLabel: 'raw prompt',
              },
            ];
            const service = {
              start() {},
              stop() {},
              onEntry() { return () => {}; },
              getEntries() { return entries; },
              getHistoryEntries(options = {}) {
                if (options.mode === 'session' && options.sessionId) {
                  return entries.filter((entry) => entry.sessionId === options.sessionId);
                }
                return entries;
              },
            };
            const store = {
              getState() { return { currentSessionId: 'session-alpha' }; },
              subscribeToSelector() { return () => {}; },
            };
            new LiveFeedView({ liveFeedService: service, store }).mount(document.getElementById('live-feed-panel'));
          </script>
        </body>
      </html>
    `);

    const currentScope = page.locator('.feed-scope-btn[data-scope="current"]');
    const allScope = page.locator('.feed-scope-btn[data-scope="all"]');
    await expect(currentScope).toHaveClass(/active/);
    await expect(currentScope).toContainText('このセッション');
    await expect(page.locator('.feed-item')).toHaveCount(1);
    await expect(page.locator('.feed-item-session')).toHaveCount(0);
    await expect(page.locator('.feed-item-source')).toHaveCount(0);
    await expect(page.locator('.feed-item-actions')).toHaveCount(0);
    await expect(page.locator('.feed-item-history-text')).toContainText('過去の依頼');

    const scopeMetrics = await page.evaluate(() => {
      const current = document.querySelector('.feed-scope-btn[data-scope="current"]');
      const all = document.querySelector('.feed-scope-btn[data-scope="all"]');
      const currentLabel = current?.querySelector('span:first-child');
      return {
        currentWidth: current?.getBoundingClientRect().width || 0,
        allWidth: all?.getBoundingClientRect().width || 0,
        labelHeight: currentLabel?.getBoundingClientRect().height || 0,
      };
    });
    expect(scopeMetrics.currentWidth).toBeGreaterThan(104);
    expect(scopeMetrics.allWidth).toBeGreaterThan(70);
    expect(scopeMetrics.labelHeight).toBeLessThan(20);
    await expect(page.locator('.live-feed-footer')).toHaveAttribute('style', /padding-right/);

    await page.locator('#live-feed-panel').screenshot({
      path: 'var/test-results/story-live-feed-readable-current-log-current.png',
    });

    await allScope.dispatchEvent('click');
    await expect(page.locator('.feed-item')).toHaveCount(2);
    await expect(page.locator('.feed-item-session')).toHaveText(['session-beta', 'session-alpha']);
    await expect(page.locator('.feed-item-label')).toHaveText(['Beta', 'Alpha']);

    await page.locator('#live-feed-panel').screenshot({
      path: 'var/test-results/story-live-feed-readable-current-log-all.png',
    });
  });

  test('real app live feed keeps readable current log without runtime errors', async ({ page }) => {
    // story-live-feed-readable-current-log ac:1
    // story-live-feed-readable-current-log ac:2
    // story-live-feed-readable-current-log ac:3
    // story-live-feed-readable-current-log ac:4
    // story-live-feed-readable-current-log ac:5
    // story-live-feed-readable-current-log ac:6
    const runtimeIssues: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeIssues.push(`console:${message.text()}`);
    });
    page.on('pageerror', (error) => runtimeIssues.push(`pageerror:${error.message}`));
    page.on('requestfailed', (request) => {
      runtimeIssues.push(`requestfailed:${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
    });
    page.on('response', (response) => {
      const url = response.url();
      if (response.status() >= 400 && !url.endsWith('/favicon.ico')) {
        runtimeIssues.push(`response:${response.status()} ${url}`);
      }
    });

    await page.route('**/api/auth/verify', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ authenticated: true }) });
    });
    await page.route('**/api/sessions/status', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });
    await page.route('**/api/sessions/*/runtime**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ port: 31991, proxyPath: '/console/mock-session/' }) });
    });
    await page.route('**/api/sessions/*/context**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ context: null }) });
    });
    await page.route('**/api/sessions/*/terminal/snapshot**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: '', lines: [], cursor: null }) });
    });
    await page.route('**/api/sessions/*/terminal/ensure**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, proxyPath: '/console/mock-session/' }) });
    });
    await page.route('**/api/state/sessions/*', async (route) => {
      if (route.request().method() === 'PATCH') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessions[0]) });
        return;
      }
      await route.fallback();
    });
    await page.route('**/api/state', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions, currentSessionId: 'session-alpha', preferences: {}, testMode: false }),
      });
    });
    await page.route('**/console/mock-session/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body>mock terminal</body></html>' });
    });

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.brainbaseApp !== undefined);
    await page.locator('.info-drawer-tab[data-tab="live-feed"]').click({ force: true });

    await expect(page.locator('#live-feed-panel .feed-scope-btn[data-scope="current"]')).toHaveClass(/active/);
    await expect(page.locator('#live-feed-panel .feed-item-label')).toHaveText(['Alpha']);
    await expect(page.locator('#live-feed-panel .feed-item-session')).toHaveCount(0);
    await expect(page.locator('#live-feed-panel .feed-item-source')).toHaveCount(0);
    await expect(page.locator('#live-feed-panel .feed-item-actions')).toHaveCount(0);
    await expect(page.locator('#live-feed-panel .feed-item-history-text')).toContainText('過去の依頼');

    await page.locator('#live-feed-panel .feed-scope-btn[data-scope="all"]').dispatchEvent('click');

    await expect(page.locator('#live-feed-panel .feed-item-session')).toHaveText(['session-beta', 'session-alpha']);
    await expect(page.locator('#live-feed-panel .feed-item-label')).toHaveText(['Beta', 'Alpha']);
    expect(runtimeIssues).toEqual([]);
  });
});
