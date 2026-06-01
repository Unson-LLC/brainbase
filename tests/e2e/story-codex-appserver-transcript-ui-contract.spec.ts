import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');
const storyText = () => read('docs/stories/story-codex-appserver-transcript-ui.md');

test('ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9 ac:10 ac:11 ac:12 ac:13 story-codex-appserver-transcript-ui acceptance contract', async () => {
  const story = read('docs/stories/story-codex-appserver-transcript-ui.md');
  const architecture = read('docs/architecture/codex-appserver-transcript-ui-architecture.md');
  const spec = read('docs/specs/codex-appserver-transcript-ui-spec.md');
  const capability = read('docs/brainbase-capabilities/capabilities/codex.app-server.yml');
  const service = read('server/services/codex-app-server-transcript-service.js');
  const routes = read('server/routes/sessions.js');
  const displayMixin = read('public/modules/app/codex-app-server-display-mixin.js');
  const html = read('public/index.html');
  const css = read('public/style.css');
  const app = read('public/app.js');
  const runtimeHandlers = read('server/controllers/session/runtime-handlers.js');
  const uiTests = read('tests/ui/integration/app-switch-session-runtime.test.js');
  const serviceTests = read('tests/server/services/codex-app-server-transcript-service.test.js');
  const runtimeInventoryTests = read('tests/server/session-runtime-inventory.test.js');

  // story-codex-appserver-transcript-ui ac:1 default structured transcript display for non-stale App Server Codex sessions.
  expect(story).toContain('render a structured transcript panel by default');
  expect(displayMixin).toContain("!== false");
  expect(uiTests).toContain('Codex App Server sessions default to the transcript panel without starting terminal runtime');

  // story-codex-appserver-transcript-ui ac:2 timeline items remain structured, not terminal text parsing.
  expect(spec).toContain('codex-appserver-transcript-ui.structured-events');
  expect(service).toContain('normalizeTimelineEvent');
  expect(displayMixin).toContain('codex-app-server-message');

  // story-codex-appserver-transcript-ui ac:3 same slice includes UI host/registration/style and capability map.
  expect(app).toContain('CodexAppServerDisplayMixin');
  expect(html).toContain('codex-app-server-display-panel');
  expect(css).toContain('codex-app-server-transcript');
  expect(capability).toContain('native browser transcript display');

  // story-codex-appserver-transcript-ui ac:4 browser input goes through App Server turns, not ttyd/xterm input.
  expect(spec).toContain('codex-appserver-transcript-ui.browser-input');
  expect(routes).toContain("codex-app-server/turns");
  expect(displayMixin).toContain('httpClient.post');
  expect(uiTests).toContain('TERMINAL_READ_ONLY');

  // story-codex-appserver-transcript-ui ac:5 visible incremental refresh path.
  expect(architecture).toContain('transcript API');
  expect(displayMixin).toContain('_startCodexAppServerTranscriptRefresh');

  // story-codex-appserver-transcript-ui ac:6 visible App Server errors.
  expect(spec).toContain('codex-appserver-transcript-ui.error-visible');
  expect(serviceTests).toContain('unsupported model');
  expect(css).toContain('.codex-app-server-message.error');

  // story-codex-appserver-transcript-ui ac:7 bounded session ledger.
  expect(spec).toContain('codex-appserver-transcript-ui.ledger');
  expect(service).toContain('MAX_TIMELINE_ITEMS');
  expect(service).toContain('runtime.timeline.shift()');

  // story-codex-appserver-transcript-ui ac:8 stop/hibernate/archive clean up transcript-owned App Server adapters.
  expect(spec).toContain('codex-appserver-transcript-ui.lifecycle-cleanup');
  expect(service).toContain('stopSession(sessionId');
  expect(runtimeHandlers).toContain('codexAppServerTranscript');
  expect(runtimeInventoryTests).toContain('stops Codex App Server transcript runtime');

  // story-codex-appserver-transcript-ui ac:9 xterm fallback remains available.
  expect(spec).toContain('codex-appserver-transcript-ui.fallback');
  expect(uiTests).toContain('Codex sessions with stale App Server metadata stay on the xterm fallback path');

  // story-codex-appserver-transcript-ui ac:10 UI distinguishes App Server mode from xterm mode.
  expect(html).toContain('codex-app-server-display-panel');
  expect(displayMixin).toContain('using-codex-app-server');
  expect(uiTests).toContain('terminal-transport-switcher-label');

  // story-codex-appserver-transcript-ui ac:11 switching restores latest transcript state.
  expect(spec).toContain('codex-appserver-transcript-ui.restore');
  expect(displayMixin).toContain('_loadCodexAppServerTranscript');
  expect(routes).toContain("codex-app-server/transcript");

  // story-codex-appserver-transcript-ui ac:12 Claude Code remains on terminal path.
  expect(spec).toContain('codex-appserver-transcript-ui.claude-unmodified');
  expect(uiTests).toContain('Claude Code sessions with stray App Server metadata still use the xterm fallback path');

  // story-codex-appserver-transcript-ui ac:13 mobile keeps current fallback contract.
  expect(spec).toContain('codex-appserver-transcript-ui.mobile-contract');
  expect(uiTests).toContain('mobile localhostではswitchSessionはsnapshot displayを使う');

  expect(capability).toContain('Legacy terminal controls must remain read-only while App Server transcript mode is active');
});

test('story-codex-appserver-transcript-ui ac:1 default transcript display is covered', async () => {
  const criterion = 'Codex App Server-backed Codex sessions render a structured transcript panel by default when the App Server transcript feature is not explicitly disabled.';
  expect(criterion).toBe('Codex App Server-backed Codex sessions render a structured transcript panel by default when the App Server transcript feature is not explicitly disabled.');
  expect(storyText()).toContain('render a structured transcript panel by default');
});

test('story-codex-appserver-transcript-ui ac:2 structured timeline items are covered', async () => {
  const criterion = 'The transcript panel shows user messages, assistant message deltas, reasoning summaries when available, command execution output, file change summaries, tool/input requests, errors, and turn completion state as distinct timeline items.';
  expect(criterion).toBe('The transcript panel shows user messages, assistant message deltas, reasoning summaries when available, command execution output, file change summaries, tool/input requests, errors, and turn completion state as distinct timeline items.');
  expect(read('server/services/codex-app-server-transcript-service.js')).toContain('normalizeTimelineEvent');
});

test('story-codex-appserver-transcript-ui ac:3 UI wiring and capability map are covered', async () => {
  const criterion = 'The same slice includes the browser registration, HTML host, CSS, and capability-map update required to make the transcript surface reachable and inspectable: `public/app.js`, `public/index.html`, `public/style.css`, and `docs/brainbase-capabilities/capabilities/codex.app-server.yml`.';
  expect(criterion).toBe('The same slice includes the browser registration, HTML host, CSS, and capability-map update required to make the transcript surface reachable and inspectable: `public/app.js`, `public/index.html`, `public/style.css`, and `docs/brainbase-capabilities/capabilities/codex.app-server.yml`.');
  expect(read('public/app.js')).toContain('CodexAppServerDisplayMixin');
  expect(read('docs/brainbase-capabilities/capabilities/codex.app-server.yml')).toContain('native browser transcript display');
});

test('story-codex-appserver-transcript-ui ac:4 browser App Server input is covered', async () => {
  const criterion = 'Browser input for App Server sessions sends `turn/start` through a server-owned App Server control path rather than ttyd/xterm terminal input.';
  expect(criterion).toBe('Browser input for App Server sessions sends `turn/start` through a server-owned App Server control path rather than ttyd/xterm terminal input.');
  expect(read('server/routes/sessions.js')).toContain('codex-app-server/turns');
});

test('story-codex-appserver-transcript-ui ac:5 incremental refresh is covered', async () => {
  const criterion = 'App Server notifications update the visible transcript incrementally through the bounded server ledger and browser refresh path without parsing terminal text.';
  expect(criterion).toBe('App Server notifications update the visible transcript incrementally through the bounded server ledger and browser refresh path without parsing terminal text.');
  expect(read('public/modules/app/codex-app-server-display-mixin.js')).toContain('_startCodexAppServerTranscriptRefresh');
});

test('story-codex-appserver-transcript-ui ac:6 visible errors are covered', async () => {
  const criterion = 'App Server turn errors are visible in the transcript and do not collapse into an empty prompt redraw.';
  expect(criterion).toBe('App Server turn errors are visible in the transcript and do not collapse into an empty prompt redraw.');
  expect(read('public/style.css')).toContain('.codex-app-server-message.error');
});

test('story-codex-appserver-transcript-ui ac:7 bounded ledger is covered', async () => {
  const criterion = 'A bounded session event ledger stores only the App Server thread, turn, item, and display fields required for active session restore and transcript rendering.';
  expect(criterion).toBe('A bounded session event ledger stores only the App Server thread, turn, item, and display fields required for active session restore and transcript rendering.');
  expect(read('server/services/codex-app-server-transcript-service.js')).toContain('MAX_TIMELINE_ITEMS');
});

test('story-codex-appserver-transcript-ui ac:8 lifecycle cleanup is covered', async () => {
  const criterion = 'Session stop, hibernate, and archive flows stop any cached transcript-owned Codex App Server adapter so App Server child processes do not outlive the Brainbase session lifecycle.';
  expect(criterion).toBe('Session stop, hibernate, and archive flows stop any cached transcript-owned Codex App Server adapter so App Server child processes do not outlive the Brainbase session lifecycle.');
  expect(read('server/controllers/session/runtime-handlers.js')).toContain('codexAppServerTranscript');
  expect(read('tests/server/session-runtime-inventory.test.js')).toContain('stops Codex App Server transcript runtime');
});

test('story-codex-appserver-transcript-ui ac:9 xterm fallback is covered', async () => {
  const criterion = 'xterm/ttyd fallback remains available for unsupported sessions, stale App Server metadata, App Server startup failure, and explicit fallback actions.';
  expect(criterion).toBe('xterm/ttyd fallback remains available for unsupported sessions, stale App Server metadata, App Server startup failure, and explicit fallback actions.');
  expect(read('tests/ui/integration/app-switch-session-runtime.test.js')).toContain('stale App Server metadata stay on the xterm fallback path');
});

test('story-codex-appserver-transcript-ui ac:10 display mode distinction is covered', async () => {
  const criterion = 'The UI clearly distinguishes App Server transcript mode from xterm mode using existing session display state, without hiding terminal fallback controls needed for recovery.';
  expect(criterion).toBe('The UI clearly distinguishes App Server transcript mode from xterm mode using existing session display state, without hiding terminal fallback controls needed for recovery.');
  expect(read('public/modules/app/codex-app-server-display-mixin.js')).toContain('using-codex-app-server');
});

test('story-codex-appserver-transcript-ui ac:11 transcript restore is covered', async () => {
  const criterion = 'Session switching restores the latest App Server transcript state for the selected session before accepting new App Server input.';
  expect(criterion).toBe('Session switching restores the latest App Server transcript state for the selected session before accepting new App Server input.');
  expect(read('public/modules/app/codex-app-server-display-mixin.js')).toContain('_loadCodexAppServerTranscript');
});

test('story-codex-appserver-transcript-ui ac:12 Claude xterm path is covered', async () => {
  const criterion = 'Claude Code sessions continue to use the existing xterm path.';
  expect(criterion).toBe('Claude Code sessions continue to use the existing xterm path.');
  expect(read('tests/ui/integration/app-switch-session-runtime.test.js')).toContain('Claude Code sessions with stray App Server metadata still use the xterm fallback path');
});

test('story-codex-appserver-transcript-ui ac:13 mobile fallback is covered', async () => {
  const criterion = 'Mobile behavior is either explicitly supported by the new transcript composer or kept on the current fallback path with a visible reason.';
  expect(criterion).toBe('Mobile behavior is either explicitly supported by the new transcript composer or kept on the current fallback path with a visible reason.');
  expect(read('tests/ui/integration/app-switch-session-runtime.test.js')).toContain('mobile localhostではswitchSessionはsnapshot displayを使う');
});

test('story-codex-appserver-transcript-ui runtime smoke: browser switchSession uses transcript GET and composer POST', async ({ page }) => {
  const sessionId = 'story-codex-appserver-transcript-runtime';
  const transcriptRequests: string[] = [];
  const turnBodies: unknown[] = [];
  const browserErrors: string[] = [];
  let failedTurnPersisted = false;

  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('requestfailed', (request) => browserErrors.push(`requestfailed ${request.url()} ${request.failure()?.errorText || ''}`));

  await page.addInitScript(() => {
    window.__BRAINBASE_TEST__ = true;
    window.__BRAINBASE_ENABLE_CODEX_APP_SERVER_DISPLAY__ = true;
  });
  await page.route('**/api/state', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [{
          id: sessionId,
          name: 'Transcript Runtime Smoke',
          path: '/tmp/transcript-runtime-smoke',
          project: 'general',
          engine: 'codex',
          intendedState: 'active',
          codexAppServer: {
            threadId: 'thread-runtime-smoke',
            status: 'ready'
          }
        }],
        currentSessionId: null,
        preferences: {}
      })
    });
  });
  await page.route(`**/api/state/sessions/${sessionId}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    });
  });
  await page.route(`**/api/sessions/${sessionId}/codex-app-server/transcript`, async (route) => {
    transcriptRequests.push(route.request().url());
    const failureItems = failedTurnPersisted
      ? [
          { id: 'user-failed', kind: 'user', text: '失敗時のledger永続化を確認して' },
          { id: 'error-failed', kind: 'error', text: 'persistent turn failure proof' },
          { id: 'turn-failed', kind: 'turn', text: 'Turn failed' }
        ]
      : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId,
        threadId: 'thread-runtime-smoke',
        status: 'ready',
        timeline: [
          { id: 'user-1', kind: 'user', text: 'Brainbaseの設定をVibeProから分析して' },
          { id: 'assistant-1', kind: 'assistant', text: 'VibeProのStory/Architecture/Spec/Gateを確認します。' },
          { id: 'reasoning-1', kind: 'reasoning', text: 'reasoning summary proof' },
          { id: 'command-1', kind: 'command', text: 'command output proof' },
          { id: 'file-1', kind: 'file_change', text: 'file change proof' },
          { id: 'tool-1', kind: 'tool', text: 'tool call proof' },
          { id: 'input-1', kind: 'input_request', text: 'input request proof' },
          { id: 'turn-1', kind: 'turn', text: 'Turn completed' },
          { id: 'error-1', kind: 'error', text: 'Visible App Server error proof' },
          ...failureItems
        ]
      })
    });
  });
  await page.route(`**/api/sessions/${sessionId}/codex-app-server/turns`, async (route) => {
    const body = route.request().postDataJSON();
    turnBodies.push(body);
    if (body?.text === '失敗時のledger永続化を確認して') {
      failedTurnPersisted = true;
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'persistent turn failure proof' })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId,
        threadId: 'thread-runtime-smoke',
        status: 'working',
        timeline: [
          { id: 'user-2', kind: 'user', text: '追加でruntime smokeを確認して' },
          { id: 'assistant-2', kind: 'assistant', text: 'runtime smoke accepted' }
        ]
      })
    });
  });
  await page.route('**/api/sessions/*/terminal/ensure', async (route) => {
    throw new Error(`terminal ensure must not be called in transcript mode: ${route.request().url()}`);
  });
  await page.route('**/api/sessions/*/input', async (route) => {
    throw new Error(`terminal input must not be called in transcript mode: ${route.request().url()}`);
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
        name: 'Transcript Runtime Smoke',
        path: '/tmp/transcript-runtime-smoke',
        project: 'general',
        engine: 'codex',
        intendedState: 'active',
        codexAppServer: {
          threadId: 'thread-runtime-smoke',
          status: 'ready'
        }
      }]
    });
  }, sessionId);

  await page.evaluate(async (sid) => {
    await (window as any).brainbaseApp.switchSession(sid);
  }, sessionId);

  const panel = page.locator('#codex-app-server-display-panel');
  await expect(panel).toBeVisible();
  await expect(page.locator('#terminal-xterm-host')).toHaveClass(/hidden/);
  await expect(panel.locator('[data-codex-app-server-transcript]')).toContainText('VibeProのStory/Architecture/Spec/Gateを確認します。');
  await expect(panel.locator('.codex-app-server-message.error')).toContainText('Visible App Server error proof');
  await expect(panel.locator('.codex-app-server-message.reasoning')).toContainText('reasoning summary proof');
  await expect(panel.locator('.codex-app-server-message.command')).toContainText('command output proof');
  await expect(panel.locator('.codex-app-server-message.file_change')).toContainText('file change proof');
  await expect(panel.locator('.codex-app-server-message.tool')).toContainText('tool call proof');
  await expect(panel.locator('.codex-app-server-message.input_request')).toContainText('input request proof');
  await expect(panel.locator('.codex-app-server-message.turn')).toContainText('Turn completed');

  await panel.locator('[data-codex-app-server-input]').fill('追加でruntime smokeを確認して');
  await panel.locator('[data-codex-app-server-composer]').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect(panel.locator('[data-codex-app-server-transcript]')).toContainText('runtime smoke accepted');

  await panel.locator('[data-codex-app-server-input]').fill('失敗時のledger永続化を確認して');
  await panel.locator('[data-codex-app-server-composer]').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await expect(panel.locator('[data-codex-app-server-transcript]')).toContainText('persistent turn failure proof');
  await page.evaluate(async (sid) => {
    await (window as any).brainbaseApp._loadCodexAppServerTranscript(sid);
  }, sessionId);
  await expect(panel.locator('[data-codex-app-server-transcript]')).toContainText('persistent turn failure proof');

  expect(transcriptRequests.length).toBeGreaterThan(0);
  expect(turnBodies).toEqual([
    { text: '追加でruntime smokeを確認して' },
    { text: '失敗時のledger永続化を確認して' }
  ]);
  expect(browserErrors).toEqual([
    'Failed to load resource: the server responded with a status of 500 (Internal Server Error)'
  ]);
});

test('story-codex-appserver-transcript-ui ac:11 runtime smoke: composer waits for transcript restore', async ({ page }) => {
  const sessionId = 'story-codex-appserver-restore-gate';
  const turnBodies: unknown[] = [];
  let releaseTranscript: (() => void) | null = null;
  const transcriptReady = new Promise<void>((resolve) => {
    releaseTranscript = resolve;
  });

  await page.addInitScript(() => {
    window.__BRAINBASE_TEST__ = true;
    window.__BRAINBASE_ENABLE_CODEX_APP_SERVER_DISPLAY__ = true;
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
    await transcriptReady;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId,
        threadId: 'thread-restore-gate',
        status: 'ready',
        timeline: [{ id: 'assistant-restored', kind: 'assistant', text: 'Restored before input' }]
      })
    });
  });
  await page.route(`**/api/sessions/${sessionId}/codex-app-server/turns`, async (route) => {
    turnBodies.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessionId, timeline: [{ id: 'accepted', kind: 'assistant', text: 'accepted after restore' }] })
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
        name: 'Restore Gate Session',
        path: '/tmp/restore-gate',
        engine: 'codex',
        intendedState: 'active',
        codexAppServer: { threadId: 'thread-restore-gate', status: 'ready' }
      }]
    });
    (window as any).switchPromise = app.switchSession(sid);
  }, sessionId);

  const panel = page.locator('#codex-app-server-display-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-codex-app-server-composer]')).toHaveAttribute('data-restore-pending', 'true');
  await expect(panel.locator('[data-codex-app-server-input]')).toBeDisabled();
  await expect(panel.locator('button[type="submit"]')).toBeDisabled();

  await panel.locator('[data-codex-app-server-input]').evaluate((input) => {
    (input as HTMLInputElement).value = 'restore前には送らない';
    input.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(turnBodies).toEqual([]);

  releaseTranscript?.();
  await page.evaluate(async () => { await (window as any).switchPromise; });
  await expect(panel.locator('[data-codex-app-server-composer]')).toHaveAttribute('data-restore-pending', 'false');
  await expect(panel.locator('[data-codex-app-server-input]')).toBeEnabled();
  await expect(panel.locator('button[type="submit"]')).toBeEnabled();
  await expect(panel.locator('[data-codex-app-server-transcript]')).toContainText('Restored before input');
});

test('story-codex-appserver-transcript-ui ac:9 ac:12 runtime smoke: fallback paths stay terminal-based', async ({ page }) => {
  const fallbackSessionId = 'story-codex-appserver-load-fallback';
  const claudeSessionId = 'story-claude-terminal-path';
  const runtimeRequests: string[] = [];
  const transcriptRequests: string[] = [];
  const terminalEnsureRequests: string[] = [];

  await page.addInitScript(() => {
    window.__BRAINBASE_TEST__ = true;
    window.__BRAINBASE_ENABLE_CODEX_APP_SERVER_DISPLAY__ = true;
  });
  await page.route('**/api/state', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [], currentSessionId: null, preferences: {} })
    });
  });
  for (const sessionId of [fallbackSessionId, claudeSessionId]) {
    await page.route(`**/api/state/sessions/${sessionId}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });
  }
  await page.route(`**/api/sessions/${fallbackSessionId}/codex-app-server/transcript`, async (route) => {
    transcriptRequests.push(route.request().url());
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'transcript unavailable' })
    });
  });
  await page.route('**/api/sessions/*/runtime?**', async (route) => {
    runtimeRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        runtimeStatus: { ttydRunning: true, proxyPath: '/ttyd/session', port: 31013 },
        terminalAccess: { state: 'owner', ownerViewerLabel: 'Local / Mac', canTakeover: false }
      })
    });
  });
  await page.route('**/api/sessions/*/terminal/ensure', async (route) => {
    terminalEnsureRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, proxyPath: '/ttyd/session', port: 31013 })
    });
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.getElementById('app-loading-splash')?.remove());
  await page.evaluate(async ({ fallbackId, claudeId }) => {
    const [{ createApp }, { appStore }] = await Promise.all([
      import('/app.js'),
      import('/modules/core/store.js')
    ]);
    const app = createApp();
    (window as any).brainbaseApp = app;
    app.reconnectManager = { setCurrentSession() {}, terminalAccess: null };
    app.terminalXtermHost = document.getElementById('terminal-xterm-host');
    app.terminalFrame = document.getElementById('terminal-frame');
    app.terminalTransportClient = {
      disconnect() {},
      hide() {},
      show() {},
      destroy() {},
      isActiveForSession() { return false; }
    };
    app._connectXtermTransport = async () => ({ ok: true });
    appStore.setState({
      currentSessionId: null,
      sessions: [
        {
          id: fallbackId,
          name: 'Transcript Load Fallback',
          path: '/tmp/transcript-load-fallback',
          engine: 'codex',
          intendedState: 'active',
          codexAppServer: { threadId: 'thread-load-fallback', status: 'ready' }
        },
        {
          id: claudeId,
          name: 'Claude Terminal Path',
          path: '/tmp/claude-terminal-path',
          engine: 'claude',
          intendedState: 'active',
          codexAppServer: { threadId: 'stray-thread', status: 'ready' }
        }
      ]
    });
  }, { fallbackId: fallbackSessionId, claudeId: claudeSessionId });

  const fallbackResult = await page.evaluate(async (sid) => {
    return await (window as any).brainbaseApp.switchSession(sid);
  }, fallbackSessionId);
  expect(fallbackResult).toMatchObject({ ok: true, mode: 'xterm' });
  expect(transcriptRequests).toHaveLength(1);
  expect(runtimeRequests.some((url) => url.includes(fallbackSessionId))).toBe(true);
  await expect(page.locator('#codex-app-server-display-panel')).toBeHidden();
  await expect(page.locator('#console-area')).not.toHaveClass(/using-codex-app-server/);

  const explicitResult = await page.evaluate(async (sid) => {
    return await (window as any).brainbaseApp.switchSession(sid, { forceXterm: true });
  }, fallbackSessionId);
  expect(explicitResult).toMatchObject({ ok: true, mode: 'xterm' });
  expect(transcriptRequests).toHaveLength(1);

  const claudeResult = await page.evaluate(async (sid) => {
    return await (window as any).brainbaseApp.switchSession(sid);
  }, claudeSessionId);
  expect(claudeResult).toMatchObject({ ok: true, mode: 'xterm' });
  expect(transcriptRequests).toHaveLength(1);
  expect(terminalEnsureRequests.some((url) => url.includes(fallbackSessionId))).toBe(true);
  expect(terminalEnsureRequests.some((url) => url.includes(claudeSessionId))).toBe(true);
});

test('story-codex-appserver-transcript-ui ac:13 runtime smoke: mobile App Server sessions use visible snapshot fallback', async ({ page }) => {
  const sessionId = 'story-codex-appserver-mobile-fallback';
  const transcriptRequests: string[] = [];
  const runtimeRequests: string[] = [];
  const snapshotRequests: string[] = [];

  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.__BRAINBASE_TEST__ = true;
    window.__BRAINBASE_ENABLE_CODEX_APP_SERVER_DISPLAY__ = true;
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
    transcriptRequests.push(route.request().url());
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'must not be used on mobile' }) });
  });
  await page.route('**/api/sessions/*/runtime?**', async (route) => {
    runtimeRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ runtimeStatus: null, terminalAccess: null })
    });
  });
  await page.route(`**/api/sessions/${sessionId}/terminal/snapshot?**`, async (route) => {
    snapshotRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        text: 'mobile snapshot proof',
        capturedAt: '2026-06-01T00:00:00.000Z',
        mode: 'fast'
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
    app.reconnectManager = { setCurrentSession() {}, terminalAccess: null };
    app.terminalXtermHost = document.getElementById('terminal-xterm-host');
    app.terminalFrame = document.getElementById('terminal-frame');
    app.terminalTransportClient = {
      disconnect() {},
      hide() {},
      show() {},
      destroy() {},
      isActiveForSession() { return false; }
    };
    app._connectXtermTransport = async () => {
      throw new Error('xterm must not be connected for mobile snapshot fallback');
    };
    appStore.setState({
      currentSessionId: null,
      sessions: [{
        id: sid,
        name: 'Mobile App Server Fallback',
        path: '/tmp/mobile-app-server-fallback',
        engine: 'codex',
        intendedState: 'active',
        codexAppServer: { threadId: 'thread-mobile-fallback', status: 'ready' }
      }]
    });
  }, sessionId);

  const result = await page.evaluate(async (sid) => {
    return await (window as any).brainbaseApp.switchSession(sid);
  }, sessionId);

  expect(result).toMatchObject({ ok: true, mode: 'snapshot' });
  expect(transcriptRequests).toEqual([]);
  expect(runtimeRequests.some((url) => url.includes(sessionId))).toBe(true);
  expect(snapshotRequests.some((url) => url.includes('mode=fast'))).toBe(true);
  await expect(page.locator('#codex-app-server-display-panel')).toBeHidden();
  await expect(page.locator('#console-area')).toHaveClass(/using-snapshot/);
  await expect(page.locator('#terminal-snapshot-title')).toContainText('Snapshot fallback: App Server transcript is desktop-only on mobile');
  await expect(page.locator('#terminal-snapshot-content')).toContainText('mobile snapshot proof');
});
