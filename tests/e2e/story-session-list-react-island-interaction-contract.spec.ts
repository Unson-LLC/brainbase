import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

// VP-FLOW-006 interaction contract for the React #session-list island (default-on).
// The island reached display+action parity with the vanilla session list (#892–900).
// This spec proves: (a) the island owns #session-list by default, (b) every
// clickable-looking control honours its contract — row click switches the session,
// the ⋮ menu opens WITHOUT switching the row (stopPropagation), the grouped view
// exposes drag affordances, and the menu exposes the rename action.
//
// The e2e server (`node server.js`) does not run start.js, so it neither builds the
// island bundle nor seeds sessions. We therefore (1) build the bundle here and
// (2) inject a synthetic session into the live appStore so the contract is verified
// deterministically. Real sessionService delegation (favorite/archive/drag/rename
// persistence) is verified separately on the running server.

const isWorktree = process.cwd().includes('brainbase-worktrees') || process.cwd().includes('.worktrees');
const PORT = process.env.BRAINBASE_E2E_PORT || (isWorktree ? 31014 : 31013);
const BASE_URL = process.env.BRAINBASE_BASE_URL || `http://localhost:${PORT}`;

test.describe('story-session-list-react-island interaction contract (VP-FLOW-006)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    // start.js builds this at boot; the bare e2e server does not — build it so the
    // default-on island actually loads.
    execFileSync(process.execPath, ['scripts/build-ui-islands.mjs'], { stdio: 'inherit' });
  });

  async function openApp(page) {
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => (window as any).brainbaseApp !== undefined);
    // dismiss the load splash so it stops intercepting pointer events
    await page.waitForFunction(() => {
      const splash = document.getElementById('app-loading-splash');
      if (!splash) return true;
      const style = window.getComputedStyle(splash);
      return splash.classList.contains('hidden') || style.pointerEvents === 'none' || style.display === 'none';
    });
  }

  // Dispatch a click on the row element. React reconciliation can re-create the row
  // node between a Playwright actionability check and the click (detach), so we click
  // through the DOM to deterministically exercise the onClick contract. (Real-click
  // behaviour is verified on the running server.)
  async function domClick(page, selector) {
    await page.locator(selector).first().waitFor({ state: 'attached' });
    await page.evaluate((sel) => (document.querySelector(sel) as HTMLElement)?.click(), selector);
  }

  // Inject a synthetic session into the live appStore so rows render deterministically.
  async function seedSession(page, session) {
    await page.evaluate(async (s) => {
      const { appStore } = await import('/modules/core/store.js');
      const prev = appStore.getState().sessions || [];
      appStore.setState({ sessions: [...prev.filter((x: any) => x.id !== s.id), s] });
    }, session);
  }

  const SID = 'e2e-island-contract-session';
  const baseSession = {
    id: SID,
    name: 'E2E Island Contract',
    project: 'brainbase',
    intendedState: 'active',
    createdAt: 1700000000000,
    lastActivityAt: 1700000000000,
    conversationSummary: { totalConversations: 2 },
  };

  test('default-on: the React island owns #session-list (no ?island flag)', async ({ page }) => {
    await openApp(page);
    const owned = await page.evaluate(() => {
      const el = document.getElementById('session-list');
      return el?.dataset?.islandOwned === '1';
    });
    expect(owned).toBe(true);
  });

  test('row click contract: clicking a row switches the current session', async ({ page }) => {
    await openApp(page);
    await seedSession(page, baseSession);
    const row = page.locator(`#session-list .session-child-row[data-id="${SID}"]`);
    await expect(row).toBeVisible();

    // contract: row click -> appStore.currentSessionId becomes this id AND SESSION_CHANGED fires
    await page.evaluate(async () => {
      const { eventBus, EVENTS } = await import('/modules/core/event-bus.js');
      (window as any).__sessionChanged = null;
      eventBus.on(EVENTS.SESSION_CHANGED, (e: any) => { (window as any).__sessionChanged = e.detail?.sessionId; });
    });
    await domClick(page, `#session-list .session-child-row[data-id="${SID}"]`);
    const result = await page.evaluate(async () => {
      const { appStore } = await import('/modules/core/store.js');
      return { current: appStore.getState().currentSessionId, fired: (window as any).__sessionChanged };
    });
    expect(result.current).toBe(SID);
    expect(result.fired).toBe(SID);
  });

  test('menu contract: ⋮ opens the dropdown and does NOT switch the row', async ({ page }) => {
    await openApp(page);
    await seedSession(page, { ...baseSession, id: SID + '-2', name: 'Contract Menu' });
    // make a different session current first, so we can assert the menu does not switch it
    await page.evaluate(async () => {
      const { appStore } = await import('/modules/core/store.js');
      appStore.setState({ currentSessionId: 'some-other-current' });
    });
    const row = page.locator(`#session-list .session-child-row[data-id="${SID}-2"]`);
    await expect(row).toBeVisible();

    // contract: the dropdown is conditionally rendered, so it is absent until the
    // toggle opens it. (CSS-visibility of the absolutely-positioned menu inside the
    // overflow:auto sidebar is verified on the running server, not here.)
    const menu = row.locator('.session-dropdown-menu');
    await expect(menu).toHaveCount(0);

    // the toggle is hover-revealed via CSS; click it directly through the DOM
    await page.evaluate((sid) => {
      const r = document.querySelector(`#session-list .session-child-row[data-id="${sid}"]`);
      (r?.querySelector('.session-menu-toggle') as HTMLElement)?.click();
    }, SID + '-2');

    // toggle opened the menu (0 -> 1) with the parity action items
    await expect(menu).toHaveCount(1);
    await expect(menu.locator('.rename-session-btn')).toHaveCount(1);
    await expect(menu.locator('.delete-session-btn')).toHaveCount(1);

    // contract: opening the menu must not have switched the current session
    const current = await page.evaluate(async () => {
      const { appStore } = await import('/modules/core/store.js');
      return appStore.getState().currentSessionId;
    });
    expect(current).toBe('some-other-current');
  });

  test('grouped view contract: project sections render with drag affordances', async ({ page }) => {
    await openApp(page);
    await seedSession(page, baseSession);
    // switch to the grouped ('project') view via the same appStore field the toolbar writes
    await page.evaluate(async () => {
      const { appStore } = await import('/modules/core/store.js');
      appStore.setState({ ui: { ...appStore.getState().ui, sessionListView: 'project' } });
    });

    await expect(page.locator('#session-list .session-section')).not.toHaveCount(0);
    const group = page.locator('#session-list .session-project-group').first();
    await expect(group).toBeVisible();
    // group header affordances: project add button + collapsible header
    await expect(group.locator('.add-project-session-btn')).toHaveCount(1);
    // drag affordance contract: grouped rows expose a drag handle
    await expect(page.locator(`#session-list .session-child-row[data-id="${SID}"] .drag-handle`)).toHaveCount(1);
  });

  test('no console errors while exercising the island', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await openApp(page);
    await seedSession(page, baseSession);
    await page.waitForTimeout(800);
    const critical = errors.filter((e) =>
      !e.includes('Failed to load') && !e.includes('favicon.ico') && !e.includes('/api/'));
    expect(critical).toHaveLength(0);
  });
});
