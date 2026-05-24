import { test, expect } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const PORT = process.env.BRAINBASE_E2E_PORT || (isWorktree ? DEFAULT_PORT : (process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT));
const BASE_URL = process.env.BRAINBASE_BASE_URL
  || `http://localhost:${PORT}`;

test.describe('session list actions', () => {
    test('should handle current session row quick actions', async ({ page, request }) => {
        test.setTimeout(60000);
        const stamp = Date.now();
        const originalName = `pw-session-${stamp}`;

        const row = (name) => page.locator('.session-child-row').filter({
            has: page.locator('.session-name', { hasText: name })
        }).first();

        const cleanup = async () => {
            try {
                const response = await request.get(`${BASE_URL}/api/state`);
                if (!response.ok()) return;
                const state = await response.json();
                const sessionNames = new Set([originalName]);
                const nextSessions = (state.sessions || []).filter((session) => !sessionNames.has(session.name));
                if (nextSessions.length !== (state.sessions || []).length) {
                    await request.post(`${BASE_URL}/api/state`, { data: { ...state, sessions: nextSessions } });
                }
            } catch {
                // Ignore cleanup errors on timeout/teardown.
            }
        };

        const expandSessionSections = async () => {
            await page.evaluate(() => {
                document.querySelectorAll('.session-section-header').forEach((header) => {
                    const container = header.nextElementSibling;
                    if (container && container.style.display === 'none') header.click();
                });
                document.querySelectorAll('.session-project-header').forEach((header) => {
                    const container = header.nextElementSibling;
                    if (container && container.style.display === 'none') header.click();
                });
            });
        };

        const domClick = async (name, selector) => {
            await expandSessionSections();
            await expect(row(name)).toBeVisible();
            if (selector.startsWith('.child-actions')) {
                await row(name).evaluate((element, innerSelector) => {
                    const actions = element.querySelector('.child-actions');
                    if (actions) actions.style.display = 'flex';
                    const button = element.querySelector(innerSelector);
                    if (!button) throw new Error(`missing ${innerSelector}`);
                    button.click();
                }, selector);
                return;
            }

            await row(name).evaluate((element, innerSelector) => {
                const button = element.querySelector(innerSelector);
                if (!button) throw new Error(`missing ${innerSelector}`);
                button.click();
            }, selector);
        };

        try {
            await page.goto(BASE_URL);
            await expect(page.locator('#session-list')).toBeVisible();
            await page.waitForTimeout(2000);

            await page.locator('#add-session-btn').click();
            await expect(page.locator('#create-session-modal')).not.toHaveClass(/active/);
            await expect(page.locator('#inline-session-draft')).not.toHaveClass(/hidden/);
            await page.locator('#inline-session-name-input').fill(originalName);
            const useWorktreeCheckbox = page.locator('#inline-use-worktree-checkbox');
            if (await useWorktreeCheckbox.isChecked()) {
                await useWorktreeCheckbox.uncheck();
            }
            await page.locator('#inline-session-create').click();
            await expect(row(originalName)).toBeVisible({ timeout: 30000 });
            console.log('created session');

            await expect(row(originalName).locator('.session-dropdown-menu .pause-session-btn')).toHaveCount(0);
            await expect(row(originalName)).not.toContainText('一時停止');
            console.log('legacy pause action hidden');

            await domClick(originalName, '.session-dropdown-menu .archive-session-btn');
            await expect(row(originalName)).toHaveCount(0);
            console.log('archived session');
        } finally {
            await cleanup();
        }
    });
});
