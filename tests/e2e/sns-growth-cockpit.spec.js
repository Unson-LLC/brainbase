import { test, expect } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
    || `http://localhost:${process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

async function csrfHeaders(request, sessionId) {
    const response = await request.get(`${BASE_URL}/api/csrf-token`, {
        headers: { 'X-Session-Id': sessionId }
    });
    expect(response.ok()).toBe(true);
    const { token } = await response.json();
    return {
        'X-Session-Id': sessionId,
        'X-CSRF-Token': token
    };
}

test.describe('SNS Growth Cockpit', () => {
    test('renders the ledger review surface with publish bridge actions', async ({ page, request }) => {
        const lane = `render_e2e_${Date.now()}`;
        const accountId = `acc_x_sato_${lane}`;
        const headers = await csrfHeaders(request, lane);
        const seedResponse = await request.post(`${BASE_URL}/api/sns-growth/review-pack`, {
            headers,
            data: {
                account_id: accountId,
                account_handle: '@AIBizNavigator',
                drafts: [{
                    date: '2026-05-14',
                    slot_index: 1,
                    lane,
                    body: 'Claude Codeを会社で使うなら、レビュー境界を先に決める',
                    source_url: 'https://x.com/example/status/1',
                    persona_brain: { target_person: 'AI導入を任されたPM' },
                    quality_gate: { status: 'pass' }
                }]
            }
        });
        expect(seedResponse.ok()).toBe(true);
        const seedJson = await seedResponse.json();
        const post = (seedJson.created || [])[0] || (seedJson.updated || [])[0];
        expect(post).toBeTruthy();
        await request.patch(`${BASE_URL}/api/sns-growth/posts/${post.id}`, { headers, data: { status: 'approved' } });

        await page.goto(`${BASE_URL}/sns-growth.html`);
        await page.waitForLoadState('domcontentloaded');
        await page.locator(`.sns-calendar-post[data-post-id="${post.id}"]`).click();

        await expect(page.locator('.sns-growth-app')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'SNS Growth Cockpit' }).first()).toBeVisible();
        await expect(page.locator('.sns-growth-calendar-grid')).toBeVisible();
        await expect(page.locator('.sns-growth-detail')).toBeVisible();
        await expect(page.locator('[data-sns-action="publish-dry-run"]')).toBeVisible();
        await expect(page.locator('[data-sns-action="publish"]')).toBeVisible();
        await expect(page.locator('[data-sns-action="posted"]')).toHaveCount(0);
    });

    test('marks a posted Ledger record as deleted from the detail panel', async ({ page, request }) => {
        const lane = `deletion_e2e_${Date.now()}`;
        const accountId = `acc_x_sato_${lane}`;
        const headers = await csrfHeaders(request, lane);
        const pack = await request.post(`${BASE_URL}/api/sns-growth/review-pack`, {
            headers,
            data: {
                account_id: accountId,
                account_handle: '@AIBizNavigator',
                drafts: [{
                    date: '2026-05-14',
                    slot_index: 2,
                    lane,
                    body: 'X上で削除した投稿をLedgerでは削除済みとして扱う',
                    source_url: 'https://x.com/example/status/2',
                    persona_brain: { target_person: 'AI導入を任されたPM' },
                    quality_gate: { status: 'pass' }
                }]
            }
        });
        expect(pack.ok()).toBe(true);
        const packJson = await pack.json();
        const post = (packJson.created || [])[0] || (packJson.updated || [])[0];
        expect(post).toBeTruthy();

        await request.patch(`${BASE_URL}/api/sns-growth/posts/${post.id}`, { headers, data: { status: 'approved' } });
        await request.patch(`${BASE_URL}/api/sns-growth/posts/${post.id}`, { headers, data: { status: 'scheduled' } });
        await request.patch(`${BASE_URL}/api/sns-growth/posts/${post.id}`, {
            headers,
            data: {
                status: 'posted',
                posted_url: 'https://x.com/AIBizNavigator/status/2055000000000000001',
                posted_at: '2026-05-14T03:00:00.000Z'
            }
        });

        page.on('dialog', async (dialog) => dialog.accept());
        await page.goto(`${BASE_URL}/sns-growth.html`);
        await page.waitForLoadState('domcontentloaded');
        await page.locator(`.sns-calendar-post[data-post-id="${post.id}"]`).click();
        await page.locator('[data-detail-field="memo"]').fill('X上で削除した');
        await page.locator('[data-sns-action="mark-deleted"]').click();

        await expect(page.locator('.sns-growth-detail')).toContainText('deleted');
        await expect(page.locator('.sns-growth-detail')).toContainText('X上で削除した');
        await expect(page.locator('.sns-growth-detail')).toContainText('https://x.com/AIBizNavigator/status/2055000000000000001');
    });

    test('shows visible feedback after approving a review-needed post', async ({ page, request }) => {
        const lane = `approve_e2e_${Date.now()}`;
        const accountId = `acc_x_sato_${lane}`;
        const headers = await csrfHeaders(request, lane);
        const pack = await request.post(`${BASE_URL}/api/sns-growth/review-pack`, {
            headers,
            data: {
                account_id: accountId,
                account_handle: '@AIBizNavigator',
                drafts: [{
                    date: '2026-05-14',
                    slot_index: 5,
                    lane,
                    body: '承認後に次の操作が見える投稿',
                    source_url: 'https://x.com/example/status/approve',
                    persona_brain: { target_person: 'AI導入を任されたPM' },
                    quality_gate: { status: 'pass' }
                }]
            }
        });
        expect(pack.ok()).toBe(true);
        const packJson = await pack.json();
        const post = (packJson.created || [])[0] || (packJson.updated || [])[0];
        expect(post).toBeTruthy();

        await page.goto(`${BASE_URL}/sns-growth.html`);
        await page.waitForLoadState('domcontentloaded');
        await page.locator(`.sns-calendar-post[data-post-id="${post.id}"]`).click();
        await page.locator('[data-sns-action="approve"]').click();

        await expect(page.locator('.sns-growth-insight')).toContainText('承認しました');
        await expect(page.locator('.sns-growth-detail')).toContainText('approved');
        await expect(page.locator('.sns-growth-detail [data-sns-action="approve"]')).toHaveCount(0);
        await expect(page.locator('.sns-growth-detail [data-sns-action="schedule"]')).toBeVisible();
    });
});
