import { test, expect } from '@playwright/test';

test.describe('story-live-feed-current-session-scope', () => {
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

  test('current/all scope keeps one chronological feed and readable rows', async ({ page }) => {
    // story-live-feed-current-session-scope ac:1 ac:2 ac:3 ac:4 ac:5 ac:6
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

    await expect(page.locator('.feed-scope-btn[data-scope="current"]')).toHaveClass(/active/);
    await expect(page.locator('.feed-item')).toHaveCount(1);
    await expect(page.locator('.feed-item-history-text')).toContainText('過去の依頼');
    await expect(page.locator('.live-feed-footer')).toContainText('このセッション');

    const contentBox = await page.locator('.feed-item-content').boundingBox();
    const panelBox = await page.locator('#live-feed-panel').boundingBox();
    expect(contentBox?.width || 0).toBeGreaterThan((panelBox?.width || 0) * 0.5);

    await page.locator('.feed-scope-btn[data-scope="all"]').click({ force: true });
    await expect(page.locator('.feed-item')).toHaveCount(2);
    await expect(page.locator('.feed-item-label')).toHaveText(['Beta', 'Alpha']);
    await expect(page.locator('.live-feed-footer')).toContainText('全体');

    await page.screenshot({
      path: 'var/test-results/story-live-feed-current-session-scope.png',
      fullPage: true,
    });
  });

  test('real app live feed wiring switches current session without runtime errors', async ({ page }) => {
    // story-live-feed-current-session-scope ac:1
    // story-live-feed-current-session-scope ac:2
    // story-live-feed-current-session-scope ac:3
    // story-live-feed-current-session-scope ac:4
    // story-live-feed-current-session-scope ac:5
    // story-live-feed-current-session-scope ac:6
    const runtimeIssues = [];
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
    await expect(page.locator('#live-feed-panel .feed-item-history-text')).toContainText('過去の依頼');

    await page.evaluate(async () => {
      const { appStore } = await import('/modules/core/store.js');
      appStore.setState({ currentSessionId: 'session-beta' });
    });

    await expect(page.locator('#live-feed-panel .feed-item-label')).toHaveText(['Beta']);
    await expect(page.locator('#live-feed-panel .feed-item-history-text')).toContainText('他セッション');
    await page.locator('#live-feed-panel .feed-scope-btn[data-scope="all"]').dispatchEvent('click');
    await expect(page.locator('#live-feed-panel .feed-item-label')).toHaveText(['Beta', 'Alpha']);
    await expect(page.locator('#live-feed-panel .live-feed-footer')).toContainText('表示: 時系列 / 範囲: 全体');
    expect(runtimeIssues).toEqual([]);
  });
});
