import { test, expect } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
    || `http://localhost:${process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

test.describe('SNS Growth Cockpit', () => {
    test('renders the ledger review surface with publish bridge actions', async ({ page, request }) => {
        await request.post(`${BASE_URL}/api/sns-growth/review-pack`, {
            data: {
                account_id: 'acc_x_sato',
                account_handle: '@AIBizNavigator',
                drafts: [{
                    date: '2026-05-14',
                    slot_index: 1,
                    lane: 'trust_balance',
                    body: 'Claude Codeを会社で使うなら、レビュー境界を先に決める',
                    source_url: 'https://x.com/example/status/1',
                    persona_brain: { target_person: 'AI導入を任されたPM' },
                    quality_gate: { status: 'pass' }
                }]
            }
        });

        await page.goto(`${BASE_URL}/sns-growth.html`);
        await page.waitForLoadState('domcontentloaded');

        await expect(page.locator('.sns-growth-app')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'SNS Growth Cockpit' }).first()).toBeVisible();
        await expect(page.locator('.sns-growth-calendar-grid')).toBeVisible();
        await expect(page.locator('.sns-growth-detail')).toBeVisible();
        await expect(page.locator('[data-sns-action="publish-dry-run"]')).toBeVisible();
        await expect(page.locator('[data-sns-action="publish"]')).toBeVisible();
        await expect(page.locator('[data-sns-action="posted"]')).toHaveCount(0);
    });
});
