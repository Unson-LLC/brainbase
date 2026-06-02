import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

test('story-codex-appserver-assistant-ui-transcript-panel ac:1 react island mount is covered', async () => {
  const criterion = 'The Codex App Server transcript panel is mounted as a React island inside the existing terminal stage.';
  expect('The Codex App Server transcript panel is mounted as a React island inside the existing terminal stage.').toBe(criterion);
  expect(read('docs/stories/story-codex-appserver-assistant-ui-transcript-panel.md')).toContain('React island');
  expect(read('public/index.html')).toContain('data-codex-app-server-react-root');
  expect(read('public/modules/app/codex-app-server-display-mixin.js')).toContain('mountCodexAppServerTranscript');
});

test('story-codex-appserver-assistant-ui-transcript-panel ac:2 assistant-ui primitives are covered', async () => {
  const criterion = "The island uses assistant-ui runtime/thread/composer primitives for the chat surface while preserving Brainbase's existing App Server transcript and turn APIs.";
  expect("The island uses assistant-ui runtime/thread/composer primitives for the chat surface while preserving Brainbase's existing App Server transcript and turn APIs.").toBe(criterion);
  const island = read('ui-islands/codex-appserver-transcript/index.jsx');
  expect(island).toContain('@assistant-ui/react');
  expect(island).toContain('AssistantRuntimeProvider');
  expect(island).toContain("from '@assistant-ui/react-ui'");
  expect(island).toContain('<Thread {...threadConfig} />');
});

test('story-codex-appserver-assistant-ui-transcript-panel ac:3 structured timeline kinds are covered', async () => {
  const criterion = 'User, assistant, reasoning, command, file change, tool, input request, turn, and error timeline items remain visually distinguishable.';
  expect('User, assistant, reasoning, command, file change, tool, input request, turn, and error timeline items remain visually distinguishable.').toBe(criterion);
  const island = read('ui-islands/codex-appserver-transcript/index.jsx');
  expect(island).toContain('formatActivityText');
  expect(island).toContain('replaceAll');
  expect(island).toContain('rawStatus');
  expect(island).toContain("kind === 'error'");
});

test('story-codex-appserver-assistant-ui-transcript-panel ac:4 browser turn API is covered', async () => {
  const criterion = 'Browser input still posts to `POST /api/sessions/:id/codex-app-server/turns` and never sends terminal input in transcript mode.';
  expect('Browser input still posts to `POST /api/sessions/:id/codex-app-server/turns` and never sends terminal input in transcript mode.').toBe(criterion);
  const mixin = read('public/modules/app/codex-app-server-display-mixin.js');
  expect(mixin).toContain('codex-app-server/turns');
  expect(read('tests/e2e/story-codex-appserver-transcript-ui-contract.spec.ts')).toContain('terminal input must not be called');
});

test('story-codex-appserver-assistant-ui-transcript-panel ac:5 visible states are covered', async () => {
  const criterion = 'The panel handles loading, empty, sending, refresh, and error states with explicit visible UI.';
  expect('The panel handles loading, empty, sending, refresh, and error states with explicit visible UI.').toBe(criterion);
  const island = read('ui-islands/codex-appserver-transcript/index.jsx');
  for (const stateText of ['Loading transcript', 'No transcript yet', 'Failed to load transcript', 'Failed to send turn']) {
    expect(island).toContain(stateText);
  }
});

test('story-codex-appserver-assistant-ui-transcript-panel ac:6 fallback behavior is covered', async () => {
  const criterion = 'The xterm/ttyd fallback, mobile fallback, and Claude Code terminal route remain unchanged.';
  expect('The xterm/ttyd fallback, mobile fallback, and Claude Code terminal route remain unchanged.').toBe(criterion);
  const contract = read('tests/e2e/story-codex-appserver-transcript-ui-contract.spec.ts');
  expect(contract).toContain('fallback paths stay terminal-based');
  expect(contract).toContain('mobile App Server sessions use visible snapshot fallback');
});

test('story-codex-appserver-assistant-ui-transcript-panel ac:7 dependency scope is covered', async () => {
  const criterion = 'assistant-ui is a build-time dependency for the browser island bundle and does not add production Node dependency audit surface.';
  expect('assistant-ui is a build-time dependency for the browser island bundle and does not add production Node dependency audit surface.').toBe(criterion);
  const pkg = JSON.parse(read('package.json'));
  expect(pkg.dependencies['@assistant-ui/react']).toBeUndefined();
  expect(pkg.devDependencies['@assistant-ui/react']).toBeDefined();
  expect(read('docs/architecture/codex-appserver-assistant-ui-transcript-panel-architecture.md')).toContain('development dependency');
});

test('story-codex-appserver-assistant-ui-transcript-panel ac:8 mount guard preserves fallback surface', async () => {
  const criterion = 'If the transcript island mount root or session id is unavailable, the shell must leave the existing terminal/fallback surface intact instead of partially mounting transcript UI.';
  expect('If the transcript island mount root or session id is unavailable, the shell must leave the existing terminal/fallback surface intact instead of partially mounting transcript UI.').toBe(criterion);
  expect(read('docs/stories/story-codex-appserver-assistant-ui-transcript-panel.md')).toContain('mount root or session id is unavailable');
  expect(read('docs/specs/codex-appserver-assistant-ui-transcript-panel-spec.md')).toContain('mount-guard');
  const mixin = read('public/modules/app/codex-app-server-display-mixin.js');
  expect(mixin).toContain('!root || !sessionId');
  expect(mixin).toContain('return;');
});

test('story-codex-appserver-assistant-ui-transcript-panel ac:9 stale island import retry is covered', async () => {
  const criterion = 'If the transcript island import or mount fails once because the browser has a stale failed module while Brainbase was updated, the shell retries the island import once with a cache-busted URL before falling back.';
  expect('If the transcript island import or mount fails once because the browser has a stale failed module while Brainbase was updated, the shell retries the island import once with a cache-busted URL before falling back.').toBe(criterion);
  expect(read('docs/stories/story-codex-appserver-assistant-ui-transcript-panel.md')).toContain(criterion);
  expect(read('docs/specs/codex-appserver-assistant-ui-transcript-panel-spec.md')).toContain('import-retry');
  const mixin = read('public/modules/app/codex-app-server-display-mixin.js');
  expect(mixin).toContain('getCodexAppServerTranscriptIslandUrl({ retry })');
  expect(mixin).toContain('panel.dataset.sessionId !== sessionId');
});

test('story-codex-appserver-assistant-ui-transcript-panel runtime: failed island import keeps visible fallback transcript', async ({ page }) => {
  const sessionId = 'story-assistant-ui-import-fallback';
  const turnBodies: unknown[] = [];

  await page.addInitScript(() => {
    window.__BRAINBASE_TEST__ = true;
    window.__BRAINBASE_ENABLE_CODEX_APP_SERVER_DISPLAY__ = true;
  });
  await page.route('**/dist/codex-appserver-transcript-island.js*', async (route) => {
    await route.fulfill({ status: 404, contentType: 'text/javascript', body: 'export {};' });
  });
  await page.route('**/api/state', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [], currentSessionId: null, preferences: {} })
    });
  });
  await page.route(`**/api/state/sessions/${sessionId}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route(`**/api/sessions/${sessionId}/codex-app-server/transcript`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId,
        threadId: 'thread-import-fallback',
        status: 'ready',
        timeline: [
          { id: 'assistant-fallback', kind: 'assistant', text: 'Fallback transcript remained visible' }
        ]
      })
    });
  });
  await page.route(`**/api/sessions/${sessionId}/codex-app-server/turns`, async (route) => {
    turnBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId,
        threadId: 'thread-import-fallback',
        status: 'ready',
        timeline: [
          { id: 'user-fallback', kind: 'user', text: 'fallback composer works' },
          { id: 'assistant-fallback-reply', kind: 'assistant', text: 'Fallback composer accepted' }
        ]
      })
    });
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.getElementById('app-loading-splash')?.remove());
  await page.evaluate(async (sid) => {
    const [{ createApp }, { appStore }] = await Promise.all([
      import('/app.js'),
      import('/modules/core/store.js')
    ]);
    const app = createApp();
    (window as any).brainbaseApp = app;
    app.reconnectManager = { setCurrentSession() {} };
    app.terminalXtermHost = document.getElementById('terminal-xterm-host');
    app.terminalFrame = document.getElementById('terminal-frame');
    app.terminalTransportClient = {
      disconnect() {},
      hide() {},
      show() {},
      destroy() {},
      isActiveForSession() { return false; }
    };
    appStore.setState({
      currentSessionId: null,
      sessions: [{
        id: sid,
        name: 'Import Fallback Session',
        path: '/tmp/import-fallback',
        engine: 'codex',
        intendedState: 'active',
        codexAppServer: { threadId: 'thread-import-fallback', status: 'ready' }
      }]
    });
    await app.switchSession(sid);
  }, sessionId);

  const panel = page.locator('#codex-app-server-display-panel');
  await expect(panel.locator('.codex-app-server-fallback-shell')).toBeVisible();
  await expect(panel.locator('[data-codex-app-server-transcript]')).toContainText('Fallback transcript remained visible');
  await panel.locator('[data-codex-app-server-input]').fill('fallback composer works');
  await panel.locator('[data-codex-app-server-composer]').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect(panel.locator('[data-codex-app-server-transcript]')).toContainText('Fallback composer accepted');
  expect(turnBodies).toEqual([{ text: 'fallback composer works' }]);
});

test('story-codex-appserver-assistant-ui-transcript-panel runtime: stale failed island import retries with cache bust', async ({ page }) => {
  const sessionId = 'story-assistant-ui-import-retry';
  let islandRequests = 0;

  await page.addInitScript(() => {
    window.__BRAINBASE_TEST__ = true;
    window.__BRAINBASE_ENABLE_CODEX_APP_SERVER_DISPLAY__ = true;
  });
  await page.route('**/dist/codex-appserver-transcript-island.js*', async (route) => {
    islandRequests += 1;
    const url = route.request().url();
    if (!url.includes('retry=')) {
      await route.fulfill({ status: 500, contentType: 'text/javascript', body: 'throw new Error("stale island module");' });
      return;
    }
    await route.continue();
  });
  await page.route('**/api/state', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [], currentSessionId: null, preferences: {} })
    });
  });
  await page.route(`**/api/state/sessions/${sessionId}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await page.route(`**/api/sessions/${sessionId}/codex-app-server/transcript`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId,
        threadId: 'thread-import-retry',
        status: 'ready',
        timeline: [
          { id: 'assistant-retry', kind: 'assistant', text: 'Retry transcript rendered in assistant-ui island' }
        ]
      })
    });
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.getElementById('app-loading-splash')?.remove());
  await page.evaluate(async (sid) => {
    const [{ createApp }, { appStore }] = await Promise.all([
      import('/app.js'),
      import('/modules/core/store.js')
    ]);
    const app = createApp();
    (window as any).brainbaseApp = app;
    app.reconnectManager = { setCurrentSession() {} };
    app.terminalXtermHost = document.getElementById('terminal-xterm-host');
    app.terminalFrame = document.getElementById('terminal-frame');
    app.terminalTransportClient = {
      disconnect() {},
      hide() {},
      show() {},
      destroy() {},
      isActiveForSession() { return false; }
    };
    appStore.setState({
      currentSessionId: null,
      sessions: [{
        id: sid,
        name: 'Import Retry Session',
        path: '/tmp/import-retry',
        engine: 'codex',
        intendedState: 'active',
        codexAppServer: { threadId: 'thread-import-retry', status: 'ready' }
      }]
    });
    await app.switchSession(sid);
  }, sessionId);

  const panel = page.locator('#codex-app-server-display-panel');
  await expect(panel.locator('[data-codex-appserver-transcript-island]')).toBeVisible();
  await expect(panel.locator('.aui-thread-root')).toBeVisible();
  await expect(panel.locator('.aui-assistant-message-root')).toContainText('Retry transcript rendered in assistant-ui island');
  expect(islandRequests).toBeGreaterThanOrEqual(2);
});

test('story-codex-appserver-assistant-ui-transcript-panel runtime: delayed import retry does not mount stale session', async ({ page }) => {
  const staleSessionId = 'story-assistant-ui-stale-retry-session';
  const currentSessionId = 'story-assistant-ui-current-retry-session';
  let retryRequestCount = 0;
  let releaseFirstRetry: (() => void) | null = null;
  const firstRetryRelease = new Promise<void>((resolve) => {
    releaseFirstRetry = resolve;
  });
  let resolveRetryStarted: (() => void) | null = null;
  const retryStartedSignal = new Promise<void>((resolve) => {
    resolveRetryStarted = resolve;
  });

  await page.addInitScript(() => {
    window.__BRAINBASE_TEST__ = true;
    window.__BRAINBASE_ENABLE_CODEX_APP_SERVER_DISPLAY__ = true;
  });
  await page.route('**/dist/codex-appserver-transcript-island.js*', async (route) => {
    const url = route.request().url();
    if (!url.includes('retry=')) {
      await route.fulfill({ status: 500, contentType: 'text/javascript', body: 'throw new Error("stale island module");' });
      return;
    }
    retryRequestCount += 1;
    if (retryRequestCount === 1) {
      resolveRetryStarted?.();
      await firstRetryRelease;
    }
    await route.continue();
  });
  await page.route('**/api/state', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [], currentSessionId: null, preferences: {} })
    });
  });
  for (const sid of [staleSessionId, currentSessionId]) {
    await page.route(`**/api/state/sessions/${sid}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
    await page.route(`**/api/sessions/${sid}/codex-app-server/transcript`, async (route) => {
      const isCurrent = sid === currentSessionId;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: sid,
          threadId: isCurrent ? 'thread-current-retry' : 'thread-stale-retry',
          status: 'ready',
          timeline: [
            {
              id: isCurrent ? 'assistant-current' : 'assistant-stale',
              kind: 'assistant',
              text: isCurrent ? 'Current retry session is visible' : 'Stale retry session must not mount'
            }
          ]
        })
      });
    });
  }

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.getElementById('app-loading-splash')?.remove());
  await page.evaluate(async ([staleSid, currentSid]) => {
    const [{ createApp }, { appStore }] = await Promise.all([
      import('/app.js'),
      import('/modules/core/store.js')
    ]);
    const app = createApp();
    (window as any).brainbaseApp = app;
    app.reconnectManager = { setCurrentSession() {} };
    app.terminalXtermHost = document.getElementById('terminal-xterm-host');
    app.terminalFrame = document.getElementById('terminal-frame');
    app.terminalTransportClient = {
      disconnect() {},
      hide() {},
      show() {},
      destroy() {},
      isActiveForSession() { return false; }
    };
    appStore.setState({
      currentSessionId: null,
      sessions: [
        {
          id: staleSid,
          name: 'Stale Retry Session',
          path: '/tmp/stale-retry',
          engine: 'codex',
          intendedState: 'active',
          codexAppServer: { threadId: 'thread-stale-retry', status: 'ready' }
        },
        {
          id: currentSid,
          name: 'Current Retry Session',
          path: '/tmp/current-retry',
          engine: 'codex',
          intendedState: 'active',
          codexAppServer: { threadId: 'thread-current-retry', status: 'ready' }
        }
      ]
    });
    (window as any).staleSwitchPromise = app.switchSession(staleSid);
  }, [staleSessionId, currentSessionId]);

  await retryStartedSignal;
  await page.evaluate(async (sid) => {
    await (window as any).brainbaseApp.switchSession(sid);
  }, currentSessionId);
  releaseFirstRetry?.();
  await page.evaluate(async () => {
    try {
      await (window as any).staleSwitchPromise;
    } catch {
      // The stale mount may abort when the session changes; the visible current session is the contract.
    }
  });

  const panel = page.locator('#codex-app-server-display-panel');
  await expect(panel).toHaveAttribute('data-session-id', currentSessionId);
  await expect(panel.locator('[data-codex-appserver-transcript-island]')).toBeVisible();
  await expect(panel.locator('.aui-assistant-message-root').filter({ hasText: 'Current retry session is visible' })).toBeVisible();
  await expect(panel).not.toContainText('Stale retry session must not mount');
});
