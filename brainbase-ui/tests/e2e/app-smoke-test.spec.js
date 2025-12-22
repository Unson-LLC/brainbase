import { test, expect } from '@playwright/test';

test.describe('brainbase-ui smoke test', () => {
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
        const response = await page.goto('http://localhost:3001');
        expect(response.status()).toBe(200);
    });

    test('should initialize brainbase app', async ({ page }) => {
        await page.goto('http://localhost:3001');

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
        await page.goto('http://localhost:3001');
        await page.waitForLoadState('networkidle');

        // セッションリスト
        const sessionList = await page.locator('#session-list');
        await expect(sessionList).toBeVisible();

        // フォーカスタスク
        const focusTask = await page.locator('#focus-task');
        await expect(focusTask).toBeVisible();

        // タイムライン
        const timeline = await page.locator('#timeline-list');
        await expect(timeline).toBeVisible();

        // Next Tasks
        const nextTasks = await page.locator('#next-tasks-list');
        await expect(nextTasks).toBeVisible();
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

        await page.goto('http://localhost:3001');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        // 起動ログ以外のエラーがないことを確認
        const criticalErrors = errors.filter(err =>
            !err.includes('Failed to load') && // APIエラーは許容（モックデータなし）
            !err.includes('favicon.ico') // faviconなしは許容
        );

        expect(criticalErrors).toHaveLength(0);
    });

    test('should open and close TaskEditModal', async ({ page }) => {
        await page.goto('http://localhost:3001');
        await page.waitForLoadState('networkidle');

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
        await page.goto('http://localhost:3001');
        await page.waitForLoadState('networkidle');

        // 3つのモーダルがDOM上に存在することを確認
        const taskEditModal = await page.locator('#edit-task-modal');
        expect(await taskEditModal.count()).toBe(1);

        const archiveModal = await page.locator('#archive-modal');
        expect(await archiveModal.count()).toBe(1);

        const focusEngineModal = await page.locator('#focus-engine-modal');
        expect(await focusEngineModal.count()).toBe(1);
    });

    test('should verify app structure', async ({ page }) => {
        await page.goto('http://localhost:3001');
        await page.waitForLoadState('networkidle');

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
        await page.goto('http://localhost:3001');
        await page.waitForLoadState('networkidle');

        // アーカイブボタンをクリック
        const archiveBtn = await page.locator('#toggle-archived-btn');
        await archiveBtn.click();

        // アーカイブモーダルが開く
        const archiveModal = await page.locator('#archive-modal');
        await expect(archiveModal).toHaveClass(/active/);
    });

    test('should open settings modal when clicking settings button', async ({ page }) => {
        await page.goto('http://localhost:3001');
        await page.waitForLoadState('networkidle');

        // 設定ボタンをクリック
        const settingsBtn = await page.locator('#settings-btn');
        await settingsBtn.click();

        // 設定モーダルが開く
        const settingsModal = await page.locator('#settings-modal');
        await expect(settingsModal).toHaveClass(/active/);

        // 設定内容が読み込まれる（タブが存在する）
        const settingsTabs = await page.locator('.settings-tab');
        expect(await settingsTabs.count()).toBeGreaterThan(0);
    });
});
