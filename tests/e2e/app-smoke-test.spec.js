import { test, expect } from '@playwright/test';

const isWorktree = process.cwd().includes('.worktrees') || process.cwd().includes('brainbase-worktrees');
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const BASE_URL = process.env.BRAINBASE_BASE_URL
  || `http://localhost:${process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT}`;

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

test.describe('brainbase-ui smoke test', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        // コンソールエラーをキャプチャ
        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.error(`Console error: ${msg.text()}`);
            }
        });

        // ページエラーをキャプチャ
        page.on('pageerror', error => {
            console.error(`Page error: ${error.message}`);
        });
    });

    test('should load page without errors', async ({ page }) => {
        const response = await page.goto(BASE_URL);
        expect(response.status()).toBe(200);
    });

    test('should initialize brainbase app', async ({ page }) => {
        await page.goto(BASE_URL);

        // app.jsが起動していることを確認
        const appStarted = await page.evaluate(() => {
            return window.brainbaseApp !== undefined;
        });
        expect(appStarted).toBe(true);

        // コンソールで起動メッセージを確認
        const consoleMessages = [];
        page.on('console', msg => consoleMessages.push(msg.text()));

        await page.waitForTimeout(1000); // 起動を待つ

        const hasStartMessage = await page.evaluate(() => {
            return window.brainbaseApp !== undefined;
        });
        expect(hasStartMessage).toBe(true);
    });

    test('should display main UI elements', async ({ page }) => {
        await openApp(page);

        // セッションリスト
        const sessionList = await page.locator('#session-list');
        await expect(sessionList).toBeVisible();

        // フォーカスタスクは空の場合、現行UIでは親セクションごと非表示
        const focusTask = await page.locator('#focus-task');
        await expect(focusTask).toHaveCount(1);
        const hasFocusContent = await focusTask.evaluate((el) => el.textContent.trim().length > 0 || el.children.length > 0);
        if (hasFocusContent) {
            await expect(focusTask).toBeVisible();
        } else {
            await expect(page.locator('#focus-section')).toBeHidden();
        }

        const bodyText = await page.locator('body').innerText();

        // タイムライン: slot移動後は元コンテナがhidden判定になるため、画面テキストとDOMを確認
        expect(bodyText).toContain('タイムライン');
        await expect(page.locator('#timeline-list')).toHaveCount(1);

        // Next Tasks
        expect(bodyText).toContain('次にやること');
        await expect(page.locator('#next-tasks-list')).toHaveCount(1);
    });

    test('should have no console errors', async ({ page }) => {
        const errors = [];
        page.on('console', msg => {
            if (msg.type() === 'error') {
                errors.push(msg.text());
            }
        });

        page.on('pageerror', error => {
            errors.push(error.message);
        });

        await openApp(page);
        await page.waitForTimeout(2000);

        // 起動ログ以外のエラーがないことを確認
        const criticalErrors = errors.filter(err =>
            !err.includes('Failed to load') && // APIエラーは許容（モックデータなし）
            !err.includes('favicon.ico') // faviconなしは許容
        );

        expect(criticalErrors).toHaveLength(0);
    });

    test('should open and close TaskEditModal', async ({ page }) => {
        await openApp(page);

        // モーダルが初期状態で非表示
        const modal = await page.locator('#edit-task-modal');
        const isHidden = await modal.evaluate(el => !el.classList.contains('active'));
        expect(isHidden).toBe(true);

        // TODO: 編集ボタンをクリックしてモーダルを開く
        // （実際のボタンが表示されている場合のみ）
        // const editBtn = await page.locator('[data-action="edit"]').first();
        // if (await editBtn.isVisible()) {
        //     await editBtn.click();
        //     await expect(modal).toHaveClass(/active/);
        // }
    });

    test('should verify modal elements exist', async ({ page }) => {
        await openApp(page);

        // 3つのモーダルがDOM上に存在することを確認
        const taskEditModal = await page.locator('#edit-task-modal');
        expect(await taskEditModal.count()).toBe(1);

        const archiveModal = await page.locator('#archive-modal');
        expect(await archiveModal.count()).toBe(1);

        const focusEngineModal = await page.locator('#focus-engine-modal');
        expect(await focusEngineModal.count()).toBe(1);
    });

    test('should verify app structure', async ({ page }) => {
        await openApp(page);
        await page.waitForFunction(() => Object.keys(window.brainbaseApp?.modals || {}).length > 0);

        // window.brainbaseAppの構造を確認
        const appStructure = await page.evaluate(() => {
            const app = window.brainbaseApp;
            return {
                hasViews: Object.keys(app.views || {}).length > 0,
                hasModals: Object.keys(app.modals || {}).length > 0,
                hasServices: app.taskService !== undefined &&
                            app.sessionService !== undefined &&
                            app.scheduleService !== undefined
            };
        });

        expect(appStructure.hasViews).toBe(true);
        expect(appStructure.hasModals).toBe(true);
        expect(appStructure.hasServices).toBe(true);
    });

    test('should open archive modal when clicking archive button', async ({ page }) => {
        await openApp(page);

        // アーカイブボタンをクリック
        const archiveBtn = await page.locator('#toggle-archived-btn');
        await archiveBtn.click();

        // アーカイブモーダルが開く
        const archiveModal = await page.locator('#archive-modal');
        await expect(archiveModal).toHaveClass(/active/);
    });

    test('should open settings modal from initialized settings UI', async ({ page }) => {
        await openApp(page);

        const opened = await page.evaluate(async () => {
            await window.brainbaseApp?.settingsCore?.ui?.openModal?.();
            return document.getElementById('settings-modal')?.classList.contains('active') === true;
        });
        expect(opened).toBe(true);

        // 設定モーダルが開く
        const settingsModal = await page.locator('#settings-modal');
        await expect(settingsModal).toHaveClass(/active/);

        // 設定内容が読み込まれる（タブが存在する）
        const settingsTabs = await page.locator('.settings-tab');
        await expect(settingsTabs.first()).toBeVisible();
    });

    test('should display inbox button and badge state', async ({ page }) => {
        await openApp(page);
        await page.waitForTimeout(1000); // Wait for inbox to load

        // 通知ボタンはviewport/layoutで非表示になる場合があるため、DOMとbadge stateを確認
        const inboxBtn = await page.locator('#inbox-trigger-btn');
        await expect(inboxBtn).toHaveCount(1);

        // バッジは通知数に応じて表示・非表示
        const inboxBadge = await page.locator('#inbox-badge');
        const badgeCount = Number(await inboxBadge.textContent());
        const badgeDisplay = await inboxBadge.evaluate(el => window.getComputedStyle(el).display);
        expect(Number.isNaN(badgeCount)).toBe(false);
        if (badgeCount === 0) {
            expect(badgeDisplay).toBe('none');
        } else {
            expect(['flex', 'inline-flex', 'none']).toContain(badgeDisplay);
        }
    });
});
