import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createGoalSeekRouter } from '../../server/routes/goal-seek-routes.js';
import { GoalSeekStore } from '../../server/services/goal-seek-store.js';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Goal Seek API Routes テスト
 *
 * テスト対象:
 * 1. POST /api/goal-seek/goals - ゴール作成
 * 2. GET /api/goal-seek/goals/:id - ゴール取得
 * 3. PUT /api/goal-seek/goals/:id - ゴール更新
 * 4. DELETE /api/goal-seek/goals/:id - ゴール削除
 * 5. GET /api/goal-seek/goals?sessionId=X - セッション別ゴール一覧
 * 6. POST /api/goal-seek/interventions - 介入作成
 * 7. GET /api/goal-seek/interventions/:id - 介入取得
 * 8. PUT /api/goal-seek/interventions/:id - 介入更新
 * 9. POST /api/goal-seek/logs - ログ作成
 */

describe('Goal Seek API Routes', () => {
    let app;
    let store;
    let tempDir;

    beforeEach(async () => {
        app = express();
        app.use(express.json());

        // テスト用の一時ディレクトリ
        tempDir = await mkdtemp(join(tmpdir(), 'goal-seek-test-'));

        // テスト用のファイルベースストア
        store = new GoalSeekStore({ dataFile: join(tempDir, 'test.json') });
        await store.init();
        app.use('/api/goal-seek', createGoalSeekRouter(store));
    });

    afterEach(async () => {
        await store?.clear?.();
        if (tempDir) {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    // ========================================
    // Goals API
    // ========================================

    describe('POST /api/goal-seek/goals', () => {
        it('ゴールを作成できる', async () => {
            const goalData = {
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100, unit: '件' },
                deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
                successCriteria: ['100件達成']
            };

            const response = await request(app)
                .post('/api/goal-seek/goals')
                .send(goalData)
                .expect(201);

            expect(response.body.id).toBeDefined();
            expect(response.body.sessionId).toBe('session-123');
            expect(response.body.status).toBe('seeking');
        });

        it('必須フィールドが欠けている場合_400を返す', async () => {
            const response = await request(app)
                .post('/api/goal-seek/goals')
                .send({ sessionId: 'session-123' })
                .expect(400);

            expect(response.body.error).toBeDefined();
        });
    });

    describe('GET /api/goal-seek/goals/:id', () => {
        it('ゴールを取得できる', async () => {
            // ゴール作成
            const createResponse = await request(app)
                .post('/api/goal-seek/goals')
                .send({
                    sessionId: 'session-123',
                    goalType: 'count',
                    target: { value: 100 }
                });

            const goalId = createResponse.body.id;

            // ゴール取得
            const response = await request(app)
                .get(`/api/goal-seek/goals/${goalId}`)
                .expect(200);

            expect(response.body.id).toBe(goalId);
        });

        it('存在しないゴールの場合_404を返す', async () => {
            await request(app)
                .get('/api/goal-seek/goals/non-existent')
                .expect(404);
        });
    });

    describe('PUT /api/goal-seek/goals/:id', () => {
        it('ゴールを更新できる', async () => {
            // ゴール作成
            const createResponse = await request(app)
                .post('/api/goal-seek/goals')
                .send({
                    sessionId: 'session-123',
                    goalType: 'count',
                    target: { value: 100 }
                });

            const goalId = createResponse.body.id;

            // ゴール更新
            const response = await request(app)
                .put(`/api/goal-seek/goals/${goalId}`)
                .send({ current: { value: 50 } })
                .expect(200);

            expect(response.body.current.value).toBe(50);
        });
    });

    describe('DELETE /api/goal-seek/goals/:id', () => {
        it('ゴールを削除できる', async () => {
            // ゴール作成
            const createResponse = await request(app)
                .post('/api/goal-seek/goals')
                .send({
                    sessionId: 'session-123',
                    goalType: 'count',
                    target: { value: 100 }
                });

            const goalId = createResponse.body.id;

            // ゴール削除
            await request(app)
                .delete(`/api/goal-seek/goals/${goalId}`)
                .expect(200);

            // 削除確認
            await request(app)
                .get(`/api/goal-seek/goals/${goalId}`)
                .expect(404);
        });
    });

    describe('GET /api/goal-seek/goals?sessionId=X', () => {
        it('セッションIDでゴール一覧を取得できる', async () => {
            // 複数ゴール作成
            await request(app)
                .post('/api/goal-seek/goals')
                .send({
                    sessionId: 'session-123',
                    goalType: 'count',
                    target: { value: 100 }
                });

            await request(app)
                .post('/api/goal-seek/goals')
                .send({
                    sessionId: 'session-456',
                    goalType: 'count',
                    target: { value: 200 }
                });

            // セッション別取得
            const response = await request(app)
                .get('/api/goal-seek/goals?sessionId=session-123')
                .expect(200);

            expect(response.body.length).toBe(1);
            expect(response.body[0].sessionId).toBe('session-123');
        });
    });

    // ========================================
    // Interventions API
    // ========================================

    describe('POST /api/goal-seek/interventions', () => {
        it('介入を作成できる', async () => {
            // ゴール作成
            const goalResponse = await request(app)
                .post('/api/goal-seek/goals')
                .send({
                    sessionId: 'session-123',
                    goalType: 'count',
                    target: { value: 100 }
                });

            // 介入作成
            const response = await request(app)
                .post('/api/goal-seek/interventions')
                .send({
                    goalId: goalResponse.body.id,
                    type: 'blocker',
                    reason: 'エラーが発生',
                    choices: [
                        { value: 'proceed', label: '継続' },
                        { value: 'abort', label: '中止' }
                    ]
                })
                .expect(201);

            expect(response.body.id).toBeDefined();
            expect(response.body.type).toBe('blocker');
        });
    });

    describe('GET /api/goal-seek/interventions/:id', () => {
        it('介入を取得できる', async () => {
            // ゴール作成
            const goalResponse = await request(app)
                .post('/api/goal-seek/goals')
                .send({
                    sessionId: 'session-123',
                    goalType: 'count',
                    target: { value: 100 }
                });

            // 介入作成
            const createResponse = await request(app)
                .post('/api/goal-seek/interventions')
                .send({
                    goalId: goalResponse.body.id,
                    type: 'blocker',
                    reason: 'エラーが発生',
                    choices: [{ value: 'proceed', label: '継続' }]
                });

            // 介入取得
            const response = await request(app)
                .get(`/api/goal-seek/interventions/${createResponse.body.id}`)
                .expect(200);

            expect(response.body.id).toBe(createResponse.body.id);
        });
    });

    describe('PUT /api/goal-seek/interventions/:id', () => {
        it('介入を更新できる', async () => {
            // ゴール作成
            const goalResponse = await request(app)
                .post('/api/goal-seek/goals')
                .send({
                    sessionId: 'session-123',
                    goalType: 'count',
                    target: { value: 100 }
                });

            // 介入作成
            const createResponse = await request(app)
                .post('/api/goal-seek/interventions')
                .send({
                    goalId: goalResponse.body.id,
                    type: 'blocker',
                    reason: 'エラーが発生',
                    choices: [{ value: 'proceed', label: '継続' }]
                });

            // 介入更新
            const response = await request(app)
                .put(`/api/goal-seek/interventions/${createResponse.body.id}`)
                .send({
                    status: 'responded',
                    userChoice: 'proceed'
                })
                .expect(200);

            expect(response.body.status).toBe('responded');
            expect(response.body.userChoice).toBe('proceed');
        });
    });

    // ========================================
    // Logs API
    // ========================================

    describe('POST /api/goal-seek/logs', () => {
        it('ログを作成できる', async () => {
            // ゴール作成
            const goalResponse = await request(app)
                .post('/api/goal-seek/goals')
                .send({
                    sessionId: 'session-123',
                    goalType: 'count',
                    target: { value: 100 }
                });

            // ログ作成
            const response = await request(app)
                .post('/api/goal-seek/logs')
                .send({
                    goalId: goalResponse.body.id,
                    phase: 'seek',
                    action: 'progress_check',
                    result: { progress: 50 }
                })
                .expect(201);

            expect(response.body.id).toBeDefined();
        });
    });
});
