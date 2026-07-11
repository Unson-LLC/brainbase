import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const PORT = process.env.BRAINBASE_E2E_PORT || (isWorktree ? DEFAULT_PORT : (process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT));
const BASE_URL = process.env.BRAINBASE_BASE_URL || `http://localhost:${PORT}`;

async function openApp(page) {
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(() => window.brainbaseApp !== undefined);
    await page.waitForFunction(() => {
        const splash = document.getElementById('app-loading-splash');
        if (!splash) return true;
        const style = window.getComputedStyle(splash);
        return splash.classList.contains('hidden') || style.pointerEvents === 'none';
    });
}

async function ensureLaunchPickerOpen(page, project = 'general') {
    if (await page.locator('#session-launch-picker.hidden').count()) {
        await page.evaluate((selectedProject) => {
            return window.brainbaseApp?.openSessionLaunchPicker?.(selectedProject);
        }, project);
    }
}

test.describe('story-worktree-service-git-migration session launch UI', () => {
    test('story-worktree-service-git-migration ac:1 session launch UI labels say git worktree instead of jj workspace', async ({ page }) => {
        // story-worktree-service-git-migration ac:1 UI文言がjj workspaceからgit worktreeへ移行済み
        await openApp(page);
        await ensureLaunchPickerOpen(page);

        const worktreeLabel = page.locator('#session-launch-worktree-label');
        await expect(worktreeLabel).toContainText('git worktreeを使用');

        const pageContent = await page.content();
        expect(pageContent).not.toContain('jj workspaceを使用');
        expect(pageContent).not.toContain('>jj workspace<');

        mkdirSync('.vibepro/artifacts', { recursive: true });
        await worktreeLabel.scrollIntoViewIfNeeded();
        await expect(worktreeLabel).toBeVisible();
        await page.locator('#session-launch-picker').screenshot({
            path: '.vibepro/artifacts/session-launch-git-worktree-label.png'
        });
    });
});
