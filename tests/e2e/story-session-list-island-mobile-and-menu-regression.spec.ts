import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

// Regression guards for two defects introduced when the React #session-list island
// became default-on:
//   (1) the mobile bottom-sheet (#mobile-session-list) cloned the now-React-owned
//       #session-list innerHTML and rendered an empty/broken list. Fixed by rendering
//       the original vanilla list straight into the sheet via SessionView.renderInto().
//   (2) a real pointer sequence on the island's ⋮ toggle was swallowed by the vanilla
//       global session-menu capture handler (pointerdown retarget/suppress), so the
//       menu never opened. Fixed by making that handler ignore island-owned toggles.

const isWorktree = process.cwd().includes('brainbase-worktrees') || process.cwd().includes('.worktrees');
const PORT = process.env.BRAINBASE_E2E_PORT || (isWorktree ? 31014 : 31013);
const BASE_URL = process.env.BRAINBASE_BASE_URL || `http://localhost:${PORT}`;

test.describe('session-list island mobile + menu regression', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    execFileSync(process.execPath, ['scripts/build-ui-islands.mjs'], { stdio: 'inherit' });
  });

  async function openApp(page) {
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => (window as any).brainbaseApp !== undefined);
    await page.waitForFunction(() => {
      const s = document.getElementById('app-loading-splash');
      if (!s) return true;
      const st = window.getComputedStyle(s);
      return s.classList.contains('hidden') || st.pointerEvents === 'none' || st.display === 'none';
    });
  }

  async function seedSession(page, session) {
    await page.evaluate(async (s) => {
      const { appStore } = await import('/modules/core/store.js');
      const prev = appStore.getState().sessions || [];
      appStore.setState({ sessions: [...prev.filter((x: any) => x.id !== s.id), s] });
    }, session);
  }

  const SID = 'e2e-mobile-menu-session';
  const session = {
    id: SID, name: 'Mobile Menu Regression', project: 'brainbase',
    intendedState: 'active', createdAt: 1700000000000, lastActivityAt: 1700000000000,
  };

  test('island ⋮ opens on a real pointer sequence (not swallowed by the capture handler)', async ({ page }) => {
    await openApp(page);
    await seedSession(page, session);
    const row = page.locator(`#session-list .session-child-row[data-id="${SID}"]`);
    await expect(row).toBeVisible();

    const menu = row.locator('.session-dropdown-menu');
    await expect(menu).toHaveCount(0);

    await page.evaluate((sid) => {
      const r = document.querySelector(`#session-list .session-child-row[data-id="${sid}"]`);
      const toggle = r?.querySelector('.session-menu-toggle') as HTMLElement;
      if (!toggle) return;
      const rect = toggle.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, composed: true,
        clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, button: 0, pointerType: 'mouse' };
      // the exact sequence a user produces — previously suppressed by the vanilla handler
      toggle.dispatchEvent(new PointerEvent('pointerdown', o));
      toggle.dispatchEvent(new PointerEvent('pointerup', o));
      toggle.dispatchEvent(new MouseEvent('click', o));
    }, SID);

    // React renders the menu asynchronously; poll for it (0 -> 1)
    await expect(menu).toHaveCount(1);
  });

  test('mobile sheet renders the original vanilla list (not an empty clone)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    await seedSession(page, session);

    // open the sessions bottom sheet through the real mobile entrypoint
    await page.evaluate(() => (document.getElementById('mobile-sessions-btn') as HTMLElement)?.click());
    await page.waitForFunction(
      (sid) => !!document.querySelector(`#mobile-session-list .session-child-row[data-id="${sid}"]`),
      SID, { timeout: 5000 });

    const msl = await page.evaluate((sid) => {
      const el = document.getElementById('mobile-session-list');
      return {
        rows: el?.querySelectorAll('.session-child-row').length || 0,
        hasMenuToggle: !!el?.querySelector('.session-menu-toggle'),
        islandOwned: el?.dataset?.islandOwned === '1', // must be false: the sheet is vanilla
        seededPresent: !!el?.querySelector(`.session-child-row[data-id="${sid}"]`),
      };
    }, SID);

    expect(msl.rows).toBeGreaterThan(0);
    expect(msl.hasMenuToggle).toBe(true);
    expect(msl.islandOwned).toBe(false);
    expect(msl.seededPresent).toBe(true);
  });
});
