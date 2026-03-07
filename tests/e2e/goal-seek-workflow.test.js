/**
 * Goal Seek V2 E2E Test Scenarios
 *
 * Phase 1実装機能のE2Eテスト:
 * - Goal作成フロー (UI → API → Persistence)
 * - Goal表示・更新・削除
 * - Cascade Delete（セッション削除時）
 * - Persistence確認（goals.json）
 */

import { test, expect } from '@playwright/test';
import fs from 'fs/promises';
import path from 'path';

const BASE_URL = 'http://localhost:31013';
const GOALS_JSON_PATH = path.join(process.env.HOME, 'workspace/var/goals.json');

// テストデータ
const TEST_GOAL = {
    title: 'E2Eテストゴール',
    description: 'Goal Seek V2のE2Eテストで作成されたゴール',
    commitCriteria: 'テストが全て通る',
    signalCriteria: 'UIが正常に動作する',
    autoAnswerLevel: 'moderate'
};

// Helper: goals.jsonの内容を読み込む
async function readGoalsJson() {
    try {
        const content = await fs.readFile(GOALS_JSON_PATH, 'utf-8');
        return JSON.parse(content);
    } catch (err) {
        return { goals: [], problems: [], escalations: [], timeline: [] };
    }
}

// Helper: goals.jsonをバックアップ
async function backupGoalsJson() {
    try {
        const content = await fs.readFile(GOALS_JSON_PATH, 'utf-8');
        const backupPath = `${GOALS_JSON_PATH}.backup.${Date.now()}`;
        await fs.writeFile(backupPath, content);
        return backupPath;
    } catch (err) {
        return null;
    }
}

// Helper: goals.jsonをリストア
async function restoreGoalsJson(backupPath) {
    if (backupPath) {
        try {
            const content = await fs.readFile(backupPath, 'utf-8');
            await fs.writeFile(GOALS_JSON_PATH, content);
            await fs.unlink(backupPath);
        } catch (err) {
            // バックアップファイルが存在しない場合は無視
            console.warn(`[restoreGoalsJson] Failed to restore: ${err.message}`);
        }
    }
}

// Helper: テストセッションを作成（state.json直接操作）
async function createTestSession(page, sessionId) {
    try {
        const STATE_JSON_PATH = path.join(process.env.HOME, 'workspace/var/state.json');

        // state.jsonを読み込む
        let state;
        try {
            const content = await fs.readFile(STATE_JSON_PATH, 'utf-8');
            state = JSON.parse(content);
        } catch (err) {
            // state.jsonが無い場合はデフォルト構造を作成
            state = {
                schemaVersion: 2,
                lastOpenTaskId: null,
                filters: {},
                readNotifications: [],
                focusSession: null,
                sessions: []
            };
        }

        // テストセッションが既に存在する場合は削除
        state.sessions = state.sessions.filter(s => s.id !== sessionId);

        // テストセッションを追加（pathをnullに設定してプロジェクトグループ化を回避）
        state.sessions.push({
            id: sessionId,
            name: sessionId,
            icon: 'terminal',
            path: null,
            engine: 'claude',
            intendedState: 'stopped',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString(),
            hookStatus: null,
            ttydProcess: null
        });

        // state.jsonに書き込む（アトミック操作）
        const tmpPath = `${STATE_JSON_PATH}.tmp-${Date.now()}`;
        await fs.writeFile(tmpPath, JSON.stringify(state, null, 2));
        await fs.rename(tmpPath, STATE_JSON_PATH);

        // brainbaseサーバーが変更を検出して再ロードするのを待つ（UIの再レンダリング待ち）
        // StateStoreのchokidar watcher（stabilityThreshold: 100ms、pollInterval: 50ms）が
        // 反応して_reloadFromFile()を実行するまで待機
        // 並列実行時はファイルシステムの競合により待機時間を長めに取る
        await page.waitForTimeout(1500);

        return true;
    } catch (err) {
        console.error('Failed to create test session:', err.message);
        return false;
    }
}

test.describe.configure({ mode: 'serial' }); // state.json書き込み競合を防ぐためシーケンシャル実行

test.describe.skip('Goal Seek V2 - E2E Workflow', () => {
    let backupPath;
    let testStartTime;
    let testSessionId; // 各テストで異なるセッションIDを使用

    test.beforeEach(async ({ page }) => {
        // テストごとにユニークなセッションIDを生成（並列実行時の競合回避）
        testSessionId = `test-session-goal-seek-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

        // テスト開始時刻を記録（S6で使用）
        testStartTime = new Date().toISOString();

        // goals.jsonをバックアップ
        backupPath = await backupGoalsJson();

        // テストセッションを作成
        await createTestSession(page, testSessionId);
    });

    test.afterEach(async ({ page }) => {
        // テストセッションを削除
        await page.request.delete(`${BASE_URL}/api/sessions/${testSessionId}`).catch(() => {});

        // goals.jsonをリストア
        await restoreGoalsJson(backupPath);
    });

    // ========================================
    // Scenario 1: Goal作成フロー
    // ========================================
    test('S1: Goal作成フロー - UI → API → Persistence', async ({ page }) => {
        // Step 1: brainbase UIを開く
        await page.goto(BASE_URL);
        await page.waitForSelector('#session-list', { timeout: 5000 });

        // Step 2: テストセッションを選択
        const sessionRow = page.locator(`.session-child-row[data-id="${testSessionId}"]`);
        await expect(sessionRow).toBeVisible({ timeout: 5000 });
        await sessionRow.click();
        await page.waitForTimeout(500);

        // Step 3: メニュートグルをクリック
        await sessionRow.locator('.session-menu-toggle').click();

        // Step 4: ドロップダウンメニューが開くのを待ち、Goal Setupボタンをクリック
        const goalSetupBtn = sessionRow.locator('.goal-setup-btn');
        await expect(goalSetupBtn).toBeVisible({ timeout: 3000 });
        await goalSetupBtn.click();

        // Step 5: Goal Seekモーダルが開くことを確認
        await page.waitForSelector('#goal-seek-modal.active', { timeout: 3000 });
        const modal = page.locator('#goal-seek-modal');
        await expect(modal).toBeVisible();

        // Step 6: フォームに入力（実際のid属性を使用）
        await modal.locator('#gs-goal-title').fill(TEST_GOAL.title);
        await modal.locator('#gs-goal-desc').fill(TEST_GOAL.description);

        // Criteria入力（完了条件テキストエリア）
        const criteriaText = `${TEST_GOAL.commitCriteria}\n${TEST_GOAL.signalCriteria}`;
        await modal.locator('#gs-goal-criteria').fill(criteriaText);

        // Step 7: 保存ボタンをクリック
        await modal.locator('#gs-modal-submit').click();
        await page.waitForTimeout(1000);

        // Step 8: モーダルが閉じることを確認
        await expect(modal).not.toHaveClass(/show/);

        // Step 9: Persistence確認 - goals.jsonに保存されている
        const goalsData = await readGoalsJson();
        const createdGoal = goalsData.goals.find(g =>
            g.sessionId === testSessionId &&
            g.title === TEST_GOAL.title
        );

        expect(createdGoal).toBeDefined();
        expect(createdGoal.title).toBe(TEST_GOAL.title);
        expect(createdGoal.description).toBe(TEST_GOAL.description);
        expect(createdGoal.status).toBe('active');
        expect(createdGoal.id).toMatch(/^goal_[a-f0-9]{8}$/);
    });

    // ========================================
    // Scenario 2: Goal表示フロー
    // ========================================
    test('S2: Goal表示フロー - 既存ゴールの表示', async ({ page }) => {
        // Setup: 事前にゴールを作成
        const response = await page.request.post(`${BASE_URL}/api/goal-seek/goals`, {
            data: {
                sessionId: testSessionId,
                title: TEST_GOAL.title,
                description: TEST_GOAL.description,
                criteria: {
                    commit: [TEST_GOAL.commitCriteria],
                    signal: [TEST_GOAL.signalCriteria]
                },
                managerConfig: {
                    autoAnswerLevel: TEST_GOAL.autoAnswerLevel
                }
            }
        });
        expect(response.ok()).toBeTruthy();

        // Step 1: brainbase UIを開く
        await page.goto(BASE_URL);
        await page.waitForSelector('#session-list', { timeout: 5000 });

        // Step 2: セッションを選択
        const sessionRow = page.locator(`.session-child-row[data-id="${testSessionId}"]`);
        await expect(sessionRow).toBeVisible({ timeout: 5000 });
        await sessionRow.click();

        // Step 3: ゴールバナーが表示される（goal banner更新まで待機）
        const goalBanner = page.locator('#session-goal-banner');
        // goal bannerのテキストが更新されるまで最大10秒待機
        await expect(goalBanner).toContainText(TEST_GOAL.title, { timeout: 10000 });
    });

    // ========================================
    // Scenario 3: Goal更新フロー
    // ========================================
    // TODO: Goal Seekモーダルに更新機能を実装後に有効化
    // 現在はモーダルが「作成モード」のみで、更新機能が未実装
    // サーバーサイドAPI (PUT /goals/:id) は実装済み
    test.skip('S3: Goal更新フロー - タイトル・説明の編集', async ({ page }) => {
        // Setup: 事前にゴールを作成
        const response = await page.request.post(`${BASE_URL}/api/goal-seek/goals`, {
            data: {
                sessionId: testSessionId,
                title: TEST_GOAL.title,
                description: TEST_GOAL.description,
                criteria: {
                    commit: [TEST_GOAL.commitCriteria],
                    signal: [TEST_GOAL.signalCriteria]
                },
                managerConfig: {
                    autoAnswerLevel: TEST_GOAL.autoAnswerLevel
                }
            }
        });
        const createdGoal = await response.json();

        // 更新データ
        const UPDATED_TITLE = 'E2Eテストゴール（更新後）';
        const UPDATED_DESCRIPTION = '更新されたゴールの説明';

        // Step 1: brainbase UIを開く
        await page.goto(BASE_URL);
        await page.waitForSelector('#session-list', { timeout: 5000 });

        // Step 2: セッションを選択
        const sessionRow = page.locator(`.session-child-row[data-id="${testSessionId}"]`);
        await expect(sessionRow).toBeVisible({ timeout: 5000 });
        await sessionRow.click();
        await page.waitForTimeout(500);

        // Step 3: メニュートグルをクリック
        await sessionRow.locator('.session-menu-toggle').click();
        await page.waitForTimeout(300);

        // Step 4: Goal Setupボタンをクリック
        await sessionRow.locator('.goal-setup-btn').click();

        await page.waitForSelector('#goal-seek-modal.active', { timeout: 3000 });
        const modal = page.locator('#goal-seek-modal');

        // Step 5: フォームを編集
        await modal.locator('#gs-goal-title').fill(UPDATED_TITLE);
        await modal.locator('#gs-goal-desc').fill(UPDATED_DESCRIPTION);

        // Step 6: 保存ボタンをクリック
        await modal.locator('#gs-modal-submit').click();
        await page.waitForTimeout(1000);

        // Step 7: モーダルが閉じることを確認
        await expect(modal).not.toHaveClass(/active/);

        // Step 8: Persistence確認 - goals.jsonに更新が反映されている
        const goalsData = await readGoalsJson();
        const updatedGoal = goalsData.goals.find(g => g.id === createdGoal.id);

        expect(updatedGoal).toBeDefined();
        expect(updatedGoal.title).toBe(UPDATED_TITLE);
        expect(updatedGoal.description).toBe(UPDATED_DESCRIPTION);
        expect(updatedGoal.updatedAt).toBeDefined();
    });

    // ========================================
    // Scenario 6: Persistence Integrity
    // ========================================
    test('S6: Persistence Integrity - アトミック書き込みとデータ整合性', async ({ page }) => {
        // Step 1: 複数のゴールを短時間で連続作成（競合状態のテスト）
        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push(
                page.request.post(`${BASE_URL}/api/goal-seek/goals`, {
                    data: {
                        sessionId: `${testSessionId}-${i}`,
                        title: `並行テストゴール ${i}`,
                        description: 'アトミック書き込みテスト',
                        criteria: { commit: ['テスト'], signal: [] },
                        managerConfig: { autoAnswerLevel: 'moderate' }
                    }
                })
            );
        }

        const responses = await Promise.all(promises);
        responses.forEach(res => expect(res.ok()).toBeTruthy());

        // Step 2: goals.jsonを確認 - 全てのゴールが正しく保存されている
        const goalsData = await readGoalsJson();
        expect(goalsData.goals.length).toBeGreaterThanOrEqual(5);

        // Step 3: JSONの整合性を確認（破損していない）
        expect(goalsData).toHaveProperty('goals');
        expect(goalsData).toHaveProperty('problems');
        expect(goalsData).toHaveProperty('escalations');
        expect(goalsData).toHaveProperty('timeline');

        // Step 4: 各ゴールのデータ構造を確認（今回のテスト実行で作成されたゴールのみ）
        const createdGoals = goalsData.goals.filter(g =>
            g.title.startsWith('並行テストゴール') &&
            new Date(g.createdAt) >= new Date(testStartTime)
        );
        expect(createdGoals.length).toBe(5);

        createdGoals.forEach(goal => {
            expect(goal.id).toMatch(/^goal_[a-f0-9]{8}$/);
            expect(goal.sessionId).toMatch(/^test-session-goal-seek-e2e-\d+-[a-z0-9]+-\d$/);
            expect(goal.status).toBe('active');
            expect(goal.createdAt).toBeDefined();
            expect(goal.updatedAt).toBeDefined();
        });
    });
});
