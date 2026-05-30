import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

// Phase K1: the React mobile bottom-sheet island (#mobile-session-list), flag-gated OFF
// (opt in: ?mobile-island=1 / localStorage bb:mobile-island='1'). It reproduces the
// vanilla mobile design (toolbar + spacious rows + "Live" pill) via React from the live
// appStore, and when present the vanilla renderInto path is skipped.

const isWorktree = process.cwd().includes('brainbase-worktrees') || process.cwd().includes('.worktrees');
const PORT = process.env.BRAINBASE_E2E_PORT || (isWorktree ? 31014 : 31013);
const BASE_URL = process.env.BRAINBASE_BASE_URL || `http://localhost:${PORT}`;

test.describe('session-list mobile island (Phase K1)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(() => {
    execFileSync(process.execPath, ['scripts/build-ui-islands.mjs'], { stdio: 'inherit' });
  });

  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  async function openApp(page) {
    // opt into the mobile island before any script runs
    await page.addInitScript(() => localStorage.setItem('bb:mobile-island', '1'));
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

  const SID = 'e2e-mobile-island-session';
  async function seedAndOpen(page) {
    await page.evaluate(async (sid) => {
      const { appStore } = await import('/modules/core/store.js');
      const prev = appStore.getState().sessions || [];
      const s = { id: sid, name: 'Mobile Island Row', project: 'brainbase', intendedState: 'active',
        createdAt: 1700000000000, lastActivityAt: 1700000000000, conversationSummary: { totalConversations: 1 } };
      appStore.setState({ sessions: [...prev.filter((x: any) => x.id !== sid), s] });
      (document.getElementById('mobile-sessions-btn') as HTMLElement)?.click();
    }, SID);
    await page.waitForFunction((sid) =>
      !!document.querySelector(`#mobile-session-list .session-child-row[data-id="${sid}"]`), SID, { timeout: 5000 });
  }

  test('mobile island owns the sheet and renders the vanilla-style toolbar + rows', async ({ page }) => {
    await openApp(page);
    await seedAndOpen(page);
    const info = await page.evaluate(() => {
      const el = document.getElementById('mobile-session-list');
      return {
        islandOwned: el?.dataset?.islandOwned === '1',
        hasToolbar: !!el?.querySelector('.session-list-toolbar .session-search-input'),
        hasFavFilter: !!el?.querySelector('.session-favorites-filter-btn'),
        rows: el?.querySelectorAll('.session-child-row').length || 0,
        hasRowMain: !!el?.querySelector('.session-row-main'),
        hasSummaryRow: !!el?.querySelector('.session-summary-row'),
      };
    });
    expect(info.islandOwned).toBe(true);
    expect(info.hasToolbar).toBe(true);
    expect(info.hasFavFilter).toBe(true);
    expect(info.rows).toBeGreaterThan(0);
    expect(info.hasRowMain).toBe(true);
  });

  test('mobile island ⋮ opens on a real touch pointer sequence', async ({ page }) => {
    await openApp(page);
    await seedAndOpen(page);
    const row = page.locator(`#mobile-session-list .session-child-row[data-id="${SID}"]`);
    const menu = row.locator('.session-dropdown-menu');
    await expect(menu).toHaveCount(0);
    await page.evaluate((sid) => {
      const r = document.querySelector(`#mobile-session-list .session-child-row[data-id="${sid}"]`);
      const t = r?.querySelector('.session-menu-toggle') as HTMLElement;
      const rect = t.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, composed: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, button: 0, pointerType: 'touch' };
      t.dispatchEvent(new PointerEvent('pointerdown', o));
      t.dispatchEvent(new PointerEvent('pointerup', o));
      t.dispatchEvent(new MouseEvent('click', o));
    }, SID);
    await expect(menu).toHaveCount(1);
    await expect(menu.locator('.rename-session-btn')).toHaveCount(1);
  });

  test('mobile island search filters the list', async ({ page }) => {
    await openApp(page);
    await seedAndOpen(page);
    await page.evaluate((sid) => {
      const el = document.getElementById('mobile-session-list');
      const input = el?.querySelector('.session-search-input') as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'Mobile Island Row');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, SID);
    await expect(page.locator(`#mobile-session-list .session-child-row[data-id="${SID}"]`)).toHaveCount(1);
    await expect(page.locator('#mobile-session-list .session-child-row')).toHaveCount(1);
  });
});
