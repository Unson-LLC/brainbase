import { test, expect } from '@playwright/test';

const DEFAULT_PORT = process.cwd().includes('.worktrees') ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
  || `http://localhost:${process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

test.describe('session list actions', () => {
    test('should handle quick actions and commit tree from a session row', async ({ page, request }) => {
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
            await page.locator('.session-view-btn[data-view="project"]').first().click();

            await page.locator('#add-session-btn').click();
            await expect(page.locator('#create-session-modal')).toHaveClass(/active/);
            await page.locator('#session-name-input').fill(originalName);
            const useWorktreeCheckbox = page.locator('#use-worktree-checkbox');
            if (await useWorktreeCheckbox.isChecked()) {
                await useWorktreeCheckbox.uncheck();
            }
            await page.locator('#create-session-btn').click();
            await expect(row(originalName)).toBeVisible({ timeout: 30000 });
            console.log('created session');

            await domClick(originalName, '.child-actions .pause-session-btn');
            await expect(row(originalName)).toContainText('Manual pause');
            console.log('paused session');

            await domClick(originalName, '.child-actions .resume-session-btn');
            await expect(row(originalName)).not.toContainText('Manual pause', { timeout: 15000 });
            console.log('resumed session');

            const commitTreePanel = page.locator('#commit-tree-panel');
            await page.evaluate(() => {
                const panel = document.getElementById('commit-tree-panel');
                const expandBtn = document.getElementById('commit-tree-expand-btn');
                if (panel) {
                    panel.classList.add('is-collapsed');
                    panel.style.display = 'none';
                }
                if (expandBtn) {
                    expandBtn.classList.remove('hidden');
                    expandBtn.classList.add('active');
                }
            });
            await domClick(originalName, '.session-dropdown-menu .commit-tree-btn');
            await expect.poll(async () => (
                commitTreePanel.evaluate((element) => element.classList.contains('is-collapsed'))
            )).toBe(false);
            console.log('opened commit tree');

            await domClick(originalName, '.child-actions .archive-session-btn');
            await expect(row(originalName)).toHaveCount(0);
            console.log('archived session');
        } finally {
            await cleanup();
        }
    });
});
