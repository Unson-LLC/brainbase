import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import {
  shouldStartCodexAppServerSession,
  waitForCodexAppServerSessionMetadata
} from '../../server/controllers/session/codex-app-server-startup.js';
import { buildCodexAppServerStatePatch } from '../../scripts/lib/codex-app-server-activity-client.mjs';

function read(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

async function ensureLaunchPickerOpen(page, project = 'general') {
  if (await page.locator('#session-launch-picker.hidden').count()) {
    await page.evaluate((selectedProject) => {
      return window.brainbaseApp?.openSessionLaunchPicker?.(selectedProject);
    }, project);
  }
}

test('ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 story-codex-appserver-session-create traceability contract', async () => {
  const story = read('docs/stories/story-codex-appserver-session-create.md');
  const spec = read('docs/specs/codex-appserver-session-create-spec.md');
  const runtime = read('server/services/session-runtime/runtime-lifecycle-methods.js');
  const startHandler = read('server/controllers/session/runtime-handlers.js');
  const worktreeHandler = read('server/controllers/session/worktree-handlers.js');
  const sessionService = read('public/modules/domain/session/session-service.js');
  const capability = read('docs/brainbase-capabilities/capabilities/codex.app-server.yml');

  // story-codex-appserver-session-create ac:1
  expect(story).toContain('AC-1: `POST /api/sessions/start` accepts a Codex App Server creation request and passes `BRAINBASE_CODEX_APP_SERVER=1` to the runtime startup path.');
  // story-codex-appserver-session-create ac:2
  expect(story).toContain('AC-2: Regular new Codex sessions request Codex App Server startup from the browser session service.');
  // story-codex-appserver-session-create ac:3
  expect(story).toContain('AC-3: Worktree new Codex sessions request Codex App Server startup from the server-side worktree creation path.');
  // story-codex-appserver-session-create ac:4
  expect(story).toContain('AC-4: Codex App Server creation waits until `session.codexAppServer.threadId` or `session.codexAppServer.restore.threadId` is persisted before returning success.');
  // story-codex-appserver-session-create ac:5
  expect(story).toContain('AC-5: Claude Code sessions do not set `BRAINBASE_CODEX_APP_SERVER` and keep the existing terminal path.');
  // story-codex-appserver-session-create ac:6
  expect(story).toContain('AC-6: Existing Codex sessions without App Server metadata keep terminal fallback unless they are explicitly started through this creation request.');
  // story-codex-appserver-session-create ac:7
  expect(story).toContain('AC-7: If App Server metadata is not persisted after runtime startup, the just-started runtime is stopped before creation failure is reported.');
  // story-codex-appserver-session-create ac:8
  expect(story).toContain('AC-8: Regular and worktree Codex creation paths have browser evidence that the persisted App Server thread id drives the Codex App Server display panel.');
  expect(story).toContain('persist App Server thread metadata before creation is reported successful');
  expect(spec).toContain('REQ-1');
  expect(spec).toContain('REQ-11');
  expect(sessionService).toContain("codexAppServer: engine === 'codex'");
  expect(sessionService).toContain('codexAppServer: s.codexAppServer');
  expect(startHandler).toContain('waitForCodexAppServerSessionMetadata');
  expect(worktreeHandler).toContain('codexAppServer: shouldStartCodexAppServerSession(engine, true)');
  expect(runtime).toContain("spawnOptions.env.BRAINBASE_CODEX_APP_SERVER = '1'");
  expect(read('scripts/codex-app-repl.mjs')).toContain("reportAppServerActivity('thread/started'");
  expect(capability).toContain('New Codex session creation requests the App Server REPL path');
});

test('ac:1 ac:4 /api/sessions/start waits for persisted Codex App Server metadata', async () => {
  const controller = {
    _getSessionById: () => ({
      id: 'session-e2e-codex-appserver',
      engine: 'codex',
      codexAppServer: {
        threadId: 'thread-e2e-1',
        stale: false
      }
    })
  };

  await expect(waitForCodexAppServerSessionMetadata(controller, 'session-e2e-codex-appserver', {
    timeoutMs: 20,
    intervalMs: 1
  })).resolves.toMatchObject({
    threadId: 'thread-e2e-1'
  });
});

test('ac:4 ac:7 missing Codex App Server metadata fails before reporting creation success', async () => {
  const controller = {
    _getSessionById: () => ({
      id: 'session-e2e-missing-metadata',
      engine: 'codex'
    })
  };

  await expect(waitForCodexAppServerSessionMetadata(controller, 'session-e2e-missing-metadata', {
    timeoutMs: 5,
    intervalMs: 1
  })).rejects.toThrow('Codex App Server metadata was not persisted');
});

test('ac:4 Codex App Server REPL persists thread metadata before any prompt turn starts', async () => {
  const repl = read('scripts/codex-app-repl.mjs');
  const threadStartIndex = repl.indexOf("request('thread/start'");
  const threadReportIndex = repl.indexOf("reportAppServerActivity('thread/started'");
  const initialPromptIndex = repl.indexOf('if (initialPrompt)');
  const initialTurnIndex = repl.indexOf('await startTurn(initialPrompt)');

  expect(threadStartIndex).toBeGreaterThan(-1);
  expect(threadReportIndex).toBeGreaterThan(threadStartIndex);
  expect(threadReportIndex).toBeLessThan(initialPromptIndex);
  expect(initialTurnIndex).toBeGreaterThan(initialPromptIndex);

  const patch = buildCodexAppServerStatePatch({
    sessionId: 'session-empty-prompt',
    method: 'thread/started',
    reportedAt: 1779688449000,
    params: { thread: { id: 'thread-empty-prompt' } }
  });

  expect(patch).toMatchObject({
    mutates: true,
    sessionId: 'session-empty-prompt',
    patch: {
      codexAppServer: {
        source: 'codex_app_server',
        threadId: 'thread-empty-prompt',
        activeTurnId: null,
        lifecycle: 'thread_started',
        status: 'done',
        restore: {
          strategy: 'codex_app_server_thread',
          threadId: 'thread-empty-prompt'
        }
      }
    }
  });
});

test('ac:5 ac:6 Claude Code and legacy Codex stay on fallback runtime unless explicitly opted in', async () => {
  expect(shouldStartCodexAppServerSession('codex', true)).toBe(true);
  expect(shouldStartCodexAppServerSession('claude', true)).toBe(false);
  expect(shouldStartCodexAppServerSession('codex', false)).toBe(false);
});

test('ac:5 ac:6 visual qa: Claude and legacy Codex sessions stay on terminal fallback display', async ({ page }) => {
  const claudeSessionId = 'story-claude-terminal-fallback';
  const legacyCodexSessionId = 'story-legacy-codex-terminal-fallback';
  const consoleRequests: string[] = [];

  await page.route('**/api/state', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [
          {
            id: claudeSessionId,
            name: 'Claude Terminal Fallback',
            path: '/tmp/claude-terminal-fallback',
            project: 'general',
            engine: 'claude',
            intendedState: 'active',
            runtimeStatus: {
              ttydRunning: true,
              proxyPath: `/console/${claudeSessionId}`
            }
          },
          {
            id: legacyCodexSessionId,
            name: 'Legacy Codex Terminal Fallback',
            path: '/tmp/legacy-codex-terminal-fallback',
            project: 'general',
            engine: 'codex',
            intendedState: 'active',
            runtimeStatus: {
              ttydRunning: true,
              proxyPath: `/console/${legacyCodexSessionId}`
            }
          }
        ],
        currentSessionId: claudeSessionId
      })
    });
  });
  await page.route('**/api/sessions/*/runtime?**', async (route) => {
    const url = route.request().url();
    const sessionId = url.includes(legacyCodexSessionId) ? legacyCodexSessionId : claudeSessionId;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        runtimeStatus: {
          ttydRunning: true,
          proxyPath: `/console/${sessionId}`
        },
        terminalAccess: { state: 'ready' }
      })
    });
  });
  await page.route('**/api/state/sessions/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true })
    });
  });
  await page.route('**/console/**', async (route) => {
    consoleRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body><pre id="terminal-proof">Terminal fallback ready</pre></body></html>'
    });
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.getElementById('app-loading-splash')?.remove());

  await page.evaluate(async (sessionId) => {
    await window.brainbaseApp?.switchSession?.(sessionId, {
      proxyPath: `/console/${sessionId}`
    });
  }, claudeSessionId);

  await expect(page.locator('#codex-app-server-display-panel')).toHaveClass(/hidden/);
  await expect(page.locator('#terminal-frame')).toBeVisible();
  await expect.poll(async () => page.locator('#terminal-frame').getAttribute('src')).toContain(`/console/${claudeSessionId}`);

  await page.evaluate(async (sessionId) => {
    await window.brainbaseApp?.switchSession?.(sessionId, {
      proxyPath: `/console/${sessionId}`
    });
  }, legacyCodexSessionId);

  await expect(page.locator('#codex-app-server-display-panel')).toHaveClass(/hidden/);
  await expect(page.locator('#terminal-frame')).toBeVisible();
  await expect.poll(async () => page.locator('#terminal-frame').getAttribute('src')).toContain(`/console/${legacyCodexSessionId}`);
  expect(consoleRequests.some((url) => url.includes(`/console/${claudeSessionId}`))).toBe(true);
  expect(consoleRequests.some((url) => url.includes(`/console/${legacyCodexSessionId}`))).toBe(true);

  await page.screenshot({
    path: '.vibepro/verification/story-codex-appserver-session-create/terminal-fallback-display.png',
    fullPage: true
  });
});

test('ac:7 visual qa: metadata startup failure is visible as App Server-specific feedback', async ({ page }) => {
  const startCalls: unknown[] = [];

  await page.route('**/api/state', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [], currentSessionId: null })
    });
  });
  await page.route('**/api/sessions/start', async (route) => {
    startCalls.push(route.request().postDataJSON());
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Codex App Server metadata was not persisted for session-missing-metadata'
      })
    });
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.getElementById('app-loading-splash')?.remove());

  await page.waitForFunction(() => Boolean(window.brainbaseApp?.openSessionLaunchPicker));
  await page.locator('#add-session-btn').click();
  await ensureLaunchPickerOpen(page);
  await page.locator('input[name="session-launch-engine"][value="codex"]').check();
  const workspace = page.locator('#session-launch-use-worktree-checkbox');
  if (await workspace.isChecked()) await workspace.uncheck();
  await page.locator('#session-launch-start').click();

  await expect.poll(() => startCalls.length).toBe(1);
  await expect(page.locator('#toast-container')).toContainText('Codex App Serverの起動情報を確認できませんでした');
  await expect(page.locator('#codex-app-server-display-panel')).toHaveClass(/hidden/);

  await page.screenshot({
    path: '.vibepro/verification/story-codex-appserver-session-create/metadata-failure-toast.png',
    fullPage: true
  });
});

test('ac:2 ac:8 visual qa: launch picker sends Codex App Server creation intent through /api/sessions/start', async ({ page }) => {
  const startCalls: unknown[] = [];
  const worktreeCalls: unknown[] = [];
  const stateSessionWrites: unknown[] = [];
  const sessionId = 'story-codex-appserver-session-create';
  const threadId = 'thread-story-codex-appserver-session-create';
  fs.mkdirSync('.vibepro/verification/story-codex-appserver-session-create', { recursive: true });

  await page.route('**/api/state', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions: [{
          id: sessionId,
          name: 'Codex App Server Story',
          path: '/tmp/story-codex-appserver-session-create',
          project: 'general',
          engine: 'codex',
          intendedState: 'active',
          codexAppServer: {
            threadId,
            stale: false
          }
        }],
        currentSessionId: sessionId
      })
    });
  });
  await page.route('**/api/state/sessions', async (route) => {
    stateSessionWrites.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true })
    });
  });
  await page.route('**/api/state/sessions/**', async (route) => {
    stateSessionWrites.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true })
    });
  });
  await page.route('**/api/sessions/create-with-worktree', async (route) => {
    worktreeCalls.push(route.request().postDataJSON());
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'worktree route must not be called for this regular Codex session' })
    });
  });
  await page.route('**/api/sessions/start', async (route) => {
    startCalls.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        proxyPath: `/console/${sessionId}`,
        codexAppServer: {
          threadId,
          stale: false
        }
      })
    });
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.getElementById('app-loading-splash')?.remove());

  await page.waitForFunction(() => Boolean(window.brainbaseApp?.openSessionLaunchPicker));
  await page.locator('#add-session-btn').click();
  await ensureLaunchPickerOpen(page);
  await page.locator('input[name="session-launch-engine"][value="codex"]').check();

  const workspace = page.locator('#session-launch-use-worktree-checkbox');
  if (await workspace.isChecked()) await workspace.uncheck();

  await page.screenshot({
    path: '.vibepro/verification/story-codex-appserver-session-create/launch-picker-codex-before-start.png',
    fullPage: true
  });
  await page.locator('#session-launch-start').click();

  await expect.poll(() => startCalls.length).toBe(1);
  expect(startCalls[0]).toMatchObject({
    initialCommand: '',
    engine: 'codex',
    codexAppServer: true
  });
  expect(worktreeCalls).toHaveLength(0);
  await expect.poll(() => stateSessionWrites.length).toBeGreaterThan(0);
  await expect(page.locator('#codex-app-server-display-panel')).not.toHaveClass(/hidden/);
  await expect(page.locator('#console-area')).toHaveClass(/using-codex-app-server/);
  await expect(page.locator('#terminal-frame')).toHaveClass(/hidden/);
  await expect(page.locator('[data-codex-app-server-session-id]')).toHaveText(sessionId);
  await expect(page.locator('[data-codex-app-server-thread-label]')).toHaveText(threadId);

  await page.screenshot({
    path: '.vibepro/verification/story-codex-appserver-session-create/launch-picker-codex-after-start.png',
    fullPage: true
  });
});

test('ac:3 ac:4 ac:8 visual qa: Codex worktree launch waits for App Server metadata and reaches display route', async ({ page }) => {
  const worktreeCalls: unknown[] = [];
  const startCalls: unknown[] = [];
  const stateSessionWrites: unknown[] = [];
  let createdSessionId: string | null = null;
  let createdThreadId: string | null = null;

  await page.route('**/api/state', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const hasWorktreeStarted = worktreeCalls.length > 0;
    const sessionId = createdSessionId || 'story-codex-appserver-worktree-session-create';
    const threadId = createdThreadId || 'thread-story-codex-appserver-worktree-session-create';
    const sessions = hasWorktreeStarted ? [{
      id: sessionId,
      name: 'Codex App Server Worktree Story',
      path: `/tmp/${sessionId}`,
      project: 'general',
      engine: 'codex',
      intendedState: 'active',
      startupStatus: 'ready',
      startupPhase: 'done',
      worktree: {
        path: `/tmp/${sessionId}`,
        repo: '/tmp/general'
      },
      codexAppServer: {
        threadId,
        stale: false
      }
    }] : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessions,
        currentSessionId: hasWorktreeStarted ? sessionId : null
      })
    });
  });
  await page.route('**/api/state/sessions', async (route) => {
    stateSessionWrites.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true })
    });
  });
  await page.route('**/api/state/sessions/**', async (route) => {
    stateSessionWrites.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true })
    });
  });
  await page.route('**/api/sessions/start', async (route) => {
    startCalls.push(route.request().postDataJSON());
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'regular start route must not be called for worktree creation' })
    });
  });
  await page.route('**/api/sessions/create-with-worktree', async (route) => {
    const payload = route.request().postDataJSON();
    worktreeCalls.push(payload);
    createdSessionId = payload.sessionId;
    createdThreadId = `thread-${createdSessionId}`;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        sessionId: createdSessionId,
        proxyPath: `/console/${createdSessionId}`,
        codexAppServer: {
          threadId: createdThreadId,
          stale: false
        }
      })
    });
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => document.getElementById('app-loading-splash')?.remove());

  await page.waitForFunction(() => Boolean(window.brainbaseApp?.openSessionLaunchPicker));
  await page.locator('#add-session-btn').click();
  await ensureLaunchPickerOpen(page);
  await page.locator('input[name="session-launch-engine"][value="codex"]').check();
  const workspace = page.locator('#session-launch-use-worktree-checkbox');
  if (!(await workspace.isChecked())) await workspace.check();

  await page.locator('#session-launch-start').click();
  await expect.poll(() => worktreeCalls.length).toBe(1);
  expect(worktreeCalls[0]).toMatchObject({
    engine: 'codex'
  });
  expect(startCalls).toHaveLength(0);
  const sessionId = createdSessionId || '';
  const threadId = createdThreadId || '';
  await expect.poll(async () => {
    return await page.evaluate(async (nextSessionId) => {
      const { appStore } = await import('/modules/core/store.js');
      const session = (appStore.getState().sessions || []).find((entry) => entry.id === nextSessionId);
      return {
        currentSessionId: appStore.getState().currentSessionId || null,
        startupStatus: session?.startupStatus || null,
        threadId: session?.codexAppServer?.threadId || null
      };
    }, sessionId);
  }).toMatchObject({
    currentSessionId: sessionId,
    startupStatus: 'ready',
    threadId
  });

  await expect(page.locator('#codex-app-server-display-panel')).not.toHaveClass(/hidden/);
  await expect(page.locator('#console-area')).toHaveClass(/using-codex-app-server/);
  await expect(page.locator('#terminal-frame')).toHaveClass(/hidden/);
  await expect(page.locator('[data-codex-app-server-session-id]')).toHaveText(sessionId);
  await expect(page.locator('[data-codex-app-server-thread-label]')).toHaveText(threadId);

  await page.screenshot({
    path: '.vibepro/verification/story-codex-appserver-session-create/launch-picker-codex-worktree-after-start.png',
    fullPage: true
  });
});
