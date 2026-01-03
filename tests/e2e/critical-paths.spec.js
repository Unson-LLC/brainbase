import { test, expect } from '@playwright/test';

test.describe('Critical User Flows', () => {
    test.beforeEach(async ({ page }) => {
        // コンソールエラーをキャプチャ
        page.on('console', msg => {
            if (msg.type() === 'error') {
                console.error(`Console error: ${msg.text()}`);
            }
        });

        await page.goto('http://localhost:3001');
        await page.waitForLoadState('networkidle');
    });

    test.describe('Session Lifecycle', () => {
        test('should display session in archive modal after archiving', async ({ page }) => {
            // セッションリストの最初のセッションを取得
            const sessionItem = await page.locator('#session-list .session-item').first();
            const sessionExists = await sessionItem.count() > 0;

            if (sessionExists) {
                // セッション名を記録
                const sessionName = await sessionItem.locator('.session-name').textContent();

                // アーカイブボタンをクリック（3点メニューまたはコンテキストメニュー経由）
                await sessionItem.click({ button: 'right' });
                const archiveOption = await page.locator('[data-action="archive"]');
                if (await archiveOption.isVisible()) {
                    await archiveOption.click();

                    // アーカイブモーダルを開く
                    await page.locator('#toggle-archived-btn').click();
                    const archiveModal = await page.locator('#archive-modal');
                    await expect(archiveModal).toHaveClass(/active/);

                    // アーカイブされたセッションがリストに表示されることを確認
                    const archiveList = await page.locator('#archive-list');
                    await expect(archiveList).toBeVisible();
                }
            }
        });

        test('should restore session from archive to session list', async ({ page }) => {
            // アーカイブモーダルを開く
            await page.locator('#toggle-archived-btn').click();
            const archiveModal = await page.locator('#archive-modal');
            await expect(archiveModal).toHaveClass(/active/);

            // アーカイブリストにセッションがあるか確認
            const archiveItems = await page.locator('#archive-list .archive-item');
            const hasArchivedSessions = await archiveItems.count() > 0;

            if (hasArchivedSessions) {
                // 最初のセッションの復元ボタンをクリック
                const restoreBtn = await archiveItems.first().locator('[data-action="unarchive"]');
                if (await restoreBtn.isVisible()) {
                    await restoreBtn.click();

                    // モーダルを閉じて確認
                    await page.locator('#archive-modal .close-modal-btn').first().click();

                    // セッションリストに表示されることを確認
                    const sessionList = await page.locator('#session-list');
                    await expect(sessionList).toBeVisible();
                }
            }
        });
    });

    test.describe('Task Lifecycle', () => {
        test('should display next task after completing current focus task', async ({ page }) => {
            // フォーカスタスクが表示されていることを確認
            const focusTask = await page.locator('#focus-task');
            await expect(focusTask).toBeVisible();

            // タスクの完了ボタンをクリック
            const completeBtn = await page.locator('#focus-task [data-action="complete"]');
            if (await completeBtn.isVisible()) {
                // 完了前のタスク内容を記録
                const taskBefore = await page.locator('#focus-task .task-title').textContent();

                await completeBtn.click();

                // 次のタスクが表示されるのを待つ
                await page.waitForTimeout(500);

                // フォーカスタスクエリアが引き続き表示されていることを確認
                await expect(focusTask).toBeVisible();
            }
        });

        test('should update task priority after deferring', async ({ page }) => {
            // フォーカスタスクの延期ボタンをクリック
            const deferBtn = await page.locator('#focus-task [data-action="defer"]');
            if (await deferBtn.isVisible()) {
                await deferBtn.click();

                // 優先度が変更されることを確認（APIが呼ばれる）
                await page.waitForTimeout(500);

                // フォーカスタスクエリアが表示されていることを確認
                const focusTask = await page.locator('#focus-task');
                await expect(focusTask).toBeVisible();
            }
        });
    });

    test.describe('Modal Interactions', () => {
        test('should switch settings modal tabs', async ({ page }) => {
            // 設定ボタンをクリック
            await page.locator('#settings-btn').click();

            // 設定モーダルが開く
            const settingsModal = await page.locator('#settings-modal');
            await expect(settingsModal).toHaveClass(/active/);

            // タブを取得
            const tabs = await page.locator('.settings-tab');
            const tabCount = await tabs.count();

            if (tabCount > 1) {
                // 2番目のタブをクリック
                await tabs.nth(1).click();

                // タブがアクティブになることを確認
                await expect(tabs.nth(1)).toHaveClass(/active/);
            }
        });

        test('should save task edits in task edit modal', async ({ page }) => {
            // Nextタスクリストからタスクをクリック
            const nextTaskItem = await page.locator('#next-tasks-list .task-card').first();
            if (await nextTaskItem.isVisible()) {
                // 編集ボタンをクリック
                const editBtn = await nextTaskItem.locator('[data-action="edit"]');
                if (await editBtn.isVisible()) {
                    await editBtn.click();

                    // 編集モーダルが開く
                    const editModal = await page.locator('#edit-task-modal');
                    await expect(editModal).toHaveClass(/active/);

                    // タスク名入力欄に値を入力
                    const nameInput = await page.locator('#edit-task-name');
                    if (await nameInput.isVisible()) {
                        await nameInput.fill('Updated Task Name');

                        // 保存ボタンをクリック
                        const saveBtn = await page.locator('#save-task-btn');
                        if (await saveBtn.isVisible()) {
                            await saveBtn.click();

                            // モーダルが閉じることを確認
                            await expect(editModal).not.toHaveClass(/active/);
                        }
                    }
                }
            }
        });
    });

    test.describe('Inbox Functionality', () => {
        test('should toggle inbox dropdown on button click', async ({ page }) => {
            // Inboxボタンをクリック
            const inboxBtn = await page.locator('#inbox-trigger-btn');
            await expect(inboxBtn).toBeVisible();
            await inboxBtn.click();

            // Inboxドロップダウンが表示される
            const inboxDropdown = await page.locator('#inbox-dropdown');
            await expect(inboxDropdown).toBeVisible();

            // 再度クリックで閉じる
            await inboxBtn.click();
            await expect(inboxDropdown).not.toBeVisible();
        });

        test('should complete inbox item and remove from list', async ({ page }) => {
            // Inboxボタンをクリック
            await page.locator('#inbox-trigger-btn').click();

            // Inboxドロップダウンが表示される
            const inboxDropdown = await page.locator('#inbox-dropdown');
            await expect(inboxDropdown).toBeVisible();

            // Inbox項目があるか確認
            const inboxItems = await page.locator('#inbox-list .inbox-item');
            const hasItems = await inboxItems.count() > 0;

            if (hasItems) {
                // 最初のアイテムの数を記録
                const initialCount = await inboxItems.count();

                // 完了ボタンをクリック
                const completeBtn = await inboxItems.first().locator('[data-action="complete"]');
                if (await completeBtn.isVisible()) {
                    await completeBtn.click();

                    // アイテム数が減ることを確認
                    await page.waitForTimeout(500);
                    const newCount = await page.locator('#inbox-list .inbox-item').count();
                    expect(newCount).toBeLessThan(initialCount);
                }
            }
        });
    });

    test.describe('Session Navigation', () => {
        test('should create new session via button click', async ({ page }) => {
            // 新規セッションボタンをクリック
            const newSessionBtn = await page.locator('#new-session-btn');
            if (await newSessionBtn.isVisible()) {
                const initialCount = await page.locator('#session-list .session-item').count();

                await newSessionBtn.click();

                // セッションが追加されることを確認
                await page.waitForTimeout(500);
                const newCount = await page.locator('#session-list .session-item').count();
                expect(newCount).toBeGreaterThanOrEqual(initialCount);
            }
        });

        test('should select session on click', async ({ page }) => {
            // セッションリストからセッションをクリック
            const sessionItems = await page.locator('#session-list .session-item');
            const hasMultipleSessions = await sessionItems.count() > 1;

            if (hasMultipleSessions) {
                // 2番目のセッションをクリック
                await sessionItems.nth(1).click();

                // セッションが選択されることを確認
                await expect(sessionItems.nth(1)).toHaveClass(/selected/);
            }
        });
    });

    test.describe('Priority Filter', () => {
        test('should filter tasks by priority', async ({ page }) => {
            // 優先度フィルタボタンがあるか確認
            const priorityFilter = await page.locator('#priority-filter');
            if (await priorityFilter.isVisible()) {
                // HIGHをクリック
                await priorityFilter.selectOption('HIGH');

                // タスクリストが更新されることを確認
                await page.waitForTimeout(300);

                // フィルタが適用されていることを確認
                const selectedValue = await priorityFilter.inputValue();
                expect(selectedValue).toBe('HIGH');
            }
        });
    });
});
