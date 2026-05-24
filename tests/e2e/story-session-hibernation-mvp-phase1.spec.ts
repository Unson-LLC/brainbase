import { test, expect } from '@playwright/test';

import { buildHibernationEligibility, buildRuntimeInventory } from '../../server/services/session-runtime/runtime-query-methods.js';
import { renderSessionRowHTML } from '../../public/modules/session-list-renderer.js';

test.use({ video: 'off' });

// story-session-hibernation-mvp ac:1
// story-session-hibernation-mvp ac:2
// story-session-hibernation-mvp ac:3
// story-session-hibernation-mvp ac:4
// story-session-hibernation-mvp ac:5
// story-session-hibernation-mvp ac:6
// story-session-hibernation-mvp ac:7
// story-session-hibernation-mvp ac:8
// story-session-hibernation-mvp ac:9
// story-session-hibernation-mvp ac:10
// story-session-hibernation-mvp ac:11
// story-session-hibernation-mvp ac:12
// Deferred: Phase 3 auto hibernate and Phase 4 App Server loaded/notLoaded are out of this PR.

test('story-session-hibernation-mvp phase 1 runtime inventory contract', async () => {
  const session = {
    id: 'story-session-hot',
    name: 'Story Session Hot',
    intendedState: 'active',
    path: '/tmp/story-session-hot',
  };

  const inventory = buildRuntimeInventory({
    sessions: [session],
    activeSessions: new Map(),
    psOutput: [
      '501 1 4096 codex resume story-session-hot',
      '502 501 2048 node /tmp/story-session-hot/.claude/mcp/server.js',
      '503 1 1024 node /tmp/shared/.claude/mcp/server.js',
    ].join('\n'),
  });

  expect(inventory.sessions).toHaveLength(1);
  expect(inventory.sessions[0]).toMatchObject({
    sessionId: 'story-session-hot',
    runtimePresence: 'hot',
    rssKb: 6144,
    processCount: 2,
    processesByCategory: {
      codex: 1,
      mcp: 1,
    },
  });
  expect(inventory.unattributed).toEqual([
    expect.objectContaining({
      category: 'mcp',
      reason: 'no_session_match',
    }),
  ]);
});

test('story-session-hibernation-mvp phase 2 hibernate/resume UI contract', async () => {
  const unknownChildInventory = buildRuntimeInventory({
    sessions: [{
      id: 'story-session-codex',
      engine: 'codex',
      codexThreadId: '141b7a15-e5fe-472d-a40a-01ea5f576f66'
    }],
    activeSessions: new Map([['story-session-codex', { pid: 501 }]]),
    psOutput: [
      '501 1 2048 ttyd -p 40001 -b /console/story-session-codex',
      '502 501 1024 opaque-child-without-session-token'
    ].join('\n')
  });
  const unknownChildSession = unknownChildInventory.sessions[0];
  expect(unknownChildSession.processes).toEqual([
    expect.objectContaining({ pid: 501, ownershipStrength: 'strong' }),
    expect.objectContaining({ pid: 502, category: 'unknown_child', ownershipStrength: 'strong' })
  ]);

  const stalePidInventory = buildRuntimeInventory({
    sessions: [{
      id: 'story-session-codex',
      engine: 'codex',
      codexThreadId: '141b7a15-e5fe-472d-a40a-01ea5f576f66'
    }],
    activeSessions: new Map([['story-session-codex', { pid: 601 }]]),
    psOutput: '601 1 2048 unrelated-process'
  });
  expect(stalePidInventory.sessions[0].processCount).toBe(0);
  expect(stalePidInventory.unattributed).toEqual([
    expect.objectContaining({ pid: 601, reason: 'no_session_match' })
  ]);

  const codexEligibility = buildHibernationEligibility({
    session: {
      id: 'story-session-codex',
      engine: 'codex',
      codexThreadId: '141b7a15-e5fe-472d-a40a-01ea5f576f66'
    },
    inventorySession: {
      runtimePresence: 'hot',
      rssKb: 2048,
      processCount: 1,
      processesByCategory: { codex: 1, unknown_child: 0 },
      processes: [{ pid: 501, category: 'codex', ownershipStrength: 'strong' }]
    }
  });
  expect(codexEligibility).toMatchObject({
    eligible: true,
    blockers: [],
    restoreMetadata: {
      restoreStrategy: 'codex_resume',
      codexResumeId: '141b7a15-e5fe-472d-a40a-01ea5f576f66'
    }
  });
  expect(codexEligibility.ownedProcesses).toEqual([
    expect.objectContaining({ pid: 501, category: 'codex' })
  ]);

  const unknownChildEligibility = buildHibernationEligibility({
    session: {
      id: 'story-session-codex',
      engine: 'codex',
      codexThreadId: '141b7a15-e5fe-472d-a40a-01ea5f576f66'
    },
    inventorySession: unknownChildSession
  });
  expect(unknownChildEligibility.eligible).toBe(true);
  expect(unknownChildEligibility.blockers).toEqual([]);

  const claudeEligibility = buildHibernationEligibility({
    session: {
      id: 'story-session-claude',
      engine: 'claude'
    },
    inventorySession: {
      runtimePresence: 'hot',
      rssKb: 2048,
      processCount: 1,
      processesByCategory: { claude: 1, unknown_child: 0 },
      processes: [{ pid: 601, category: 'claude' }]
    }
  });
  expect(claudeEligibility.eligible).toBe(false);
  expect(claudeEligibility.blockers).toContain('unsupported_engine');

  const activeCodexHtml = renderSessionRowHTML({
    id: 'story-session-codex',
    name: 'Story Codex',
    engine: 'codex',
    intendedState: 'active'
  }, { project: 'brainbase' });
  expect(activeCodexHtml).toContain('hibernate-session-btn');

  const activeClaudeHtml = renderSessionRowHTML({
    id: 'story-session-claude',
    name: 'Story Claude',
    engine: 'claude',
    intendedState: 'active'
  }, { project: 'brainbase' });
  expect(activeClaudeHtml).not.toContain('hibernate-session-btn');

  const hibernatedHtml = renderSessionRowHTML({
    id: 'story-session-hibernated',
    name: 'Story Hibernated',
    engine: 'codex',
    intendedState: 'hibernated',
    hibernatedAt: '2026-05-23T00:00:00.000Z'
  }, { project: 'brainbase' });
  expect(hibernatedHtml).toContain('session-child-row hibernated');
  expect(hibernatedHtml).toContain('resume-runtime-btn');
  expect(hibernatedHtml).toContain('スリープ中');
  expect(hibernatedHtml).toContain('再開');
});

test.describe('story-session-hibernation-mvp browser feedback', () => {
  test('phase 2 sleep feedback is visible in browser UI', async ({ page }) => {
    const runtimeIssues: string[] = [];
    let hibernateRequestCount = 0;
    page.on('console', (message) => {
      if (message.type() === 'error') {
        if (message.text().includes('409 (Conflict)')) return;
        runtimeIssues.push(`console:${message.text()}`);
      }
    });
    page.on('pageerror', (error) => {
      runtimeIssues.push(`pageerror:${error.message}`);
    });
    page.on('requestfailed', (request) => {
      runtimeIssues.push(`requestfailed:${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
    });
    page.on('response', (response) => {
      const status = response.status();
      const url = response.url();
      const isExpectedHibernateRejection = status === 409 && url.includes('/api/sessions/story-session-codex/hibernate');
      if (status >= 400 && !isExpectedHibernateRejection) {
        runtimeIssues.push(`response:${status} ${url}`);
      }
    });
    await page.route('**/api/auth/verify', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true })
      });
    });
    await page.route('**/api/csrf-token', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'story-csrf-token' })
      });
    });
    await page.route('**/api/sessions/story-session-codex/hibernate', async (route) => {
      hibernateRequestCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Session is not eligible for hibernation',
          blockers: ['unknown_process_ownership', 'weak_process_ownership']
        })
      });
    });
    await page.route('**/api/sessions/story-session-codex/context', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, context: null })
      });
    });
    await page.route('**/api/client-diagnostics/session-menu', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true })
      });
    });

    await page.goto('/');
    await expect(page.locator('#session-list')).toBeVisible();

    await page.evaluate(async () => {
      document.getElementById('app-loading-splash')?.remove();
      const [{ SessionView }, { SessionService }, { renderSessionRowHTML }, { appStore }] = await Promise.all([
        import('/modules/ui/views/session-view.js'),
        import('/modules/domain/session/session-service.js'),
        import('/modules/session-list-renderer.js'),
        import('/modules/core/store.js')
      ]);
      const activeSession = {
        id: 'story-session-codex',
        name: 'Story Codex',
        engine: 'codex',
        intendedState: 'active'
      };
      appStore.setState({
        sessions: [activeSession],
        currentSessionId: 'story-session-codex',
        ui: {
          ...appStore.getState().ui,
          sessionListView: 'timeline'
        }
      });
      const existing = document.getElementById('story-session-fixture');
      existing?.remove();
      const container = document.createElement('div');
      container.id = 'story-session-fixture';
      container.className = 'session-list';
      document.body.appendChild(container);
      container.innerHTML = renderSessionRowHTML(activeSession, { project: 'brainbase' });
      let toastContainer = document.getElementById('toast-container');
      if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        document.body.appendChild(toastContainer);
      }
      let menuOverlay = document.getElementById('menu-overlay');
      if (!menuOverlay) {
        menuOverlay = document.createElement('div');
        menuOverlay.id = 'menu-overlay';
        menuOverlay.className = 'hidden';
        document.body.appendChild(menuOverlay);
      }
      const view = new SessionView({
        sessionService: new SessionService(),
        fileViewerService: {}
      });
      view._logSessionMenuDebug = () => {};
      view.attachActionHandlersToContainer(container, { enableDrag: false });
      container.querySelectorAll('.child-actions').forEach((element) => {
        element.style.display = 'flex';
      });
    });

    const sessionRow = page.locator('#story-session-fixture [data-id="story-session-codex"]');
    await expect(sessionRow).toBeVisible();
    await sessionRow.evaluate((row) => {
      row.querySelectorAll('.child-actions').forEach((element) => {
        element.style.display = 'flex';
      });
    });
    const sleepButton = sessionRow.locator('.session-lifecycle-action.hibernate-session-btn');
    await expect(sleepButton).toBeVisible();
    await sleepButton.evaluate((button) => button.click());

    await expect(sleepButton).toBeDisabled();
    await expect(sleepButton).toHaveAttribute('aria-busy', 'true');
    const pendingToast = page.locator('#toast-container .toast').filter({ hasText: 'スリープ判定中' });
    await expect(pendingToast).toBeVisible();
    const toastBox = await pendingToast.first().evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    const chatBox = await page.locator('.mana-chat-widget').boundingBox().catch(() => null);
    if (toastBox && chatBox) {
      const overlaps = !(
        toastBox.x + toastBox.width <= chatBox.x ||
        chatBox.x + chatBox.width <= toastBox.x ||
        toastBox.y + toastBox.height <= chatBox.y ||
        chatBox.y + chatBox.height <= toastBox.y
      );
      expect(overlaps).toBe(false);
    }
    await page.screenshot({ path: 'test-results/session-sleep-feedback-toast.png', fullPage: true });
    await expect(page.locator('#toast-container')).toContainText('スリープできません');
    await expect(page.locator('#toast-container')).toHaveAttribute('role', 'status');
    await expect(page.locator('#toast-container')).toHaveAttribute('aria-live', 'assertive');
    await expect(page.locator('#toast-container')).toHaveAttribute('aria-atomic', 'true');
    await expect(page.locator('#toast-container')).not.toContainText('スリープ判定中');
    await expect(page.locator('#toast-container')).toContainText('所有者不明のプロセス');
    await expect(page.locator('#toast-container')).toContainText('所有判定が弱い');
    await expect(sleepButton).not.toBeDisabled();
    expect(hibernateRequestCount).toBe(1);
    expect(runtimeIssues).toEqual([]);
  });

  test('phase 2 successful sleep updates visible row actions in browser UI', async ({ page }) => {
    await page.route('**/api/auth/verify', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ authenticated: true })
      });
    });
    await page.route('**/api/csrf-token', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'story-csrf-token' })
      });
    });
    await page.route('**/api/sessions/story-session-codex/hibernate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: 'story-session-codex',
          intendedState: 'hibernated',
          runtimeState: 'hibernated',
          hibernatedAt: '2026-05-24T13:00:00.000Z',
          restoreMetadata: {
            restoreStrategy: 'codex_resume',
            restoreCommand: 'codex resume thread-story'
          },
          runtimeInventorySummary: {
            totalProcessCount: 2,
            totalRssKb: 2048
          }
        })
      });
    });
    await page.route('**/api/sessions/ui-summaries**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ 'story-session-codex': {} })
      });
    });

    await page.goto('/');
    await expect(page.locator('#session-list')).toBeVisible();

    await page.evaluate(async () => {
      document.getElementById('app-loading-splash')?.remove();
      const [{ SessionView }, { SessionService }, { renderSessionRowHTML }, { appStore }] = await Promise.all([
        import('/modules/ui/views/session-view.js'),
        import('/modules/domain/session/session-service.js'),
        import('/modules/session-list-renderer.js'),
        import('/modules/core/store.js')
      ]);
      const activeSession = {
        id: 'story-session-codex',
        name: 'Story Codex',
        engine: 'codex',
        intendedState: 'active'
      };
      appStore.setState({
        sessions: [activeSession],
        currentSessionId: 'story-session-codex'
      });
      const existing = document.getElementById('story-session-success-fixture');
      existing?.remove();
      const container = document.createElement('div');
      container.id = 'story-session-success-fixture';
      container.className = 'session-list';
      document.body.appendChild(container);
      container.innerHTML = renderSessionRowHTML(activeSession, { project: 'brainbase' });
      const view = new SessionView({
        sessionService: new SessionService(),
        fileViewerService: {}
      });
      view._logSessionMenuDebug = () => {};
      view.attachActionHandlersToContainer(container, { enableDrag: false });
      container.querySelectorAll('.child-actions').forEach((element) => {
        element.style.display = 'flex';
      });
    });

    const fixture = page.locator('#story-session-success-fixture');
    const sleepButton = fixture.locator('.session-lifecycle-action.hibernate-session-btn');
    await expect(sleepButton).toBeVisible();
    await sleepButton.evaluate((button) => button.click());
    await expect(page.locator('#toast-container')).toContainText('セッションをスリープしました');

    await page.evaluate(async () => {
      const [{ renderSessionRowHTML }, { appStore }] = await Promise.all([
        import('/modules/session-list-renderer.js'),
        import('/modules/core/store.js')
      ]);
      const session = appStore.getState().sessions.find((item) => item.id === 'story-session-codex');
      const container = document.getElementById('story-session-success-fixture');
      container.innerHTML = renderSessionRowHTML(session, { project: 'brainbase' });
      container.querySelectorAll('.child-actions').forEach((element) => {
        element.style.display = 'flex';
      });
    });

    await expect(fixture.locator('[data-id="story-session-codex"]')).toContainText('スリープ中');
    await expect(fixture.locator('.session-lifecycle-action.resume-runtime-btn')).toBeVisible();
    await expect(fixture.locator('.session-lifecycle-action.hibernate-session-btn')).toHaveCount(0);
  });
});
