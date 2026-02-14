import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GoalSeekRepository } from '../../../public/modules/domain/goal/goal-repository.js';

/**
 * GoalSeekRepository 単体テスト
 *
 * テスト対象:
 * 1. createGoal() - ゴール作成
 * 2. getGoal() - ゴール取得
 * 3. updateGoal() - ゴール更新
 * 4. deleteGoal() - ゴール削除
 * 5. createIntervention() - 介入作成
 * 6. getIntervention() - 介入取得
 * 7. updateIntervention() - 介入更新
 * 8. createLog() - ログ作成
 */

// モックHttpClient
const createMockHttpClient = () => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn()
});

describe('GoalSeekRepository', () => {
    let repository;
    let mockHttpClient;

    beforeEach(() => {
        mockHttpClient = createMockHttpClient();
        repository = new GoalSeekRepository({ httpClient: mockHttpClient });
    });

    describe('createGoal()', () => {
        it('POST_/api/goal-seek/goals_を呼び出す', async () => {
            const goalData = {
                sessionId: 'session-123',
                goalType: 'count',
                target: { value: 100 }
            };

            mockHttpClient.post.mockResolvedValueOnce({
                id: 'goal-123',
                ...goalData
            });

            const result = await repository.createGoal(goalData);

            expect(mockHttpClient.post).toHaveBeenCalledWith('/api/goal-seek/goals', goalData);
            expect(result.id).toBe('goal-123');
        });
    });

    describe('getGoal()', () => {
        it('GET_/api/goal-seek/goals/:id_を呼び出す', async () => {
            mockHttpClient.get.mockResolvedValueOnce({
                id: 'goal-123',
                sessionId: 'session-123'
            });

            const result = await repository.getGoal('goal-123');

            expect(mockHttpClient.get).toHaveBeenCalledWith('/api/goal-seek/goals/goal-123');
            expect(result.id).toBe('goal-123');
        });
    });

    describe('updateGoal()', () => {
        it('PUT_/api/goal-seek/goals/:id_を呼び出す', async () => {
            const updates = { status: 'completed' };

            mockHttpClient.put.mockResolvedValueOnce({
                id: 'goal-123',
                ...updates
            });

            const result = await repository.updateGoal('goal-123', updates);

            expect(mockHttpClient.put).toHaveBeenCalledWith('/api/goal-seek/goals/goal-123', updates);
            expect(result.status).toBe('completed');
        });
    });

    describe('deleteGoal()', () => {
        it('DELETE_/api/goal-seek/goals/:id_を呼び出す', async () => {
            mockHttpClient.delete.mockResolvedValueOnce({ success: true });

            const result = await repository.deleteGoal('goal-123');

            expect(mockHttpClient.delete).toHaveBeenCalledWith('/api/goal-seek/goals/goal-123');
            expect(result.success).toBe(true);
        });
    });

    describe('createIntervention()', () => {
        it('POST_/api/goal-seek/interventions_を呼び出す', async () => {
            const interventionData = {
                goalId: 'goal-123',
                type: 'blocker',
                reason: 'エラーが発生'
            };

            mockHttpClient.post.mockResolvedValueOnce({
                id: 'intervention-123',
                ...interventionData
            });

            const result = await repository.createIntervention(interventionData);

            expect(mockHttpClient.post).toHaveBeenCalledWith('/api/goal-seek/interventions', interventionData);
            expect(result.id).toBe('intervention-123');
        });
    });

    describe('getIntervention()', () => {
        it('GET_/api/goal-seek/interventions/:id_を呼び出す', async () => {
            mockHttpClient.get.mockResolvedValueOnce({
                id: 'intervention-123',
                goalId: 'goal-123'
            });

            const result = await repository.getIntervention('intervention-123');

            expect(mockHttpClient.get).toHaveBeenCalledWith('/api/goal-seek/interventions/intervention-123');
            expect(result.id).toBe('intervention-123');
        });
    });

    describe('updateIntervention()', () => {
        it('PUT_/api/goal-seek/interventions/:id_を呼び出す', async () => {
            const updates = { status: 'responded', userChoice: 'proceed' };

            mockHttpClient.put.mockResolvedValueOnce({
                id: 'intervention-123',
                ...updates
            });

            const result = await repository.updateIntervention('intervention-123', updates);

            expect(mockHttpClient.put).toHaveBeenCalledWith('/api/goal-seek/interventions/intervention-123', updates);
            expect(result.status).toBe('responded');
        });
    });

    describe('createLog()', () => {
        it('POST_/api/goal-seek/logs_を呼び出す', async () => {
            const logData = {
                goalId: 'goal-123',
                phase: 'seek',
                action: 'progress_updated'
            };

            mockHttpClient.post.mockResolvedValueOnce({
                id: 'log-123',
                ...logData
            });

            const result = await repository.createLog(logData);

            expect(mockHttpClient.post).toHaveBeenCalledWith('/api/goal-seek/logs', logData);
            expect(result.id).toBe('log-123');
        });
    });

    describe('getGoalsBySession()', () => {
        it('GET_/api/goal-seek/goals?sessionId=X_を呼び出す', async () => {
            mockHttpClient.get.mockResolvedValueOnce([
                { id: 'goal-1', sessionId: 'session-123' },
                { id: 'goal-2', sessionId: 'session-123' }
            ]);

            const result = await repository.getGoalsBySession('session-123');

            expect(mockHttpClient.get).toHaveBeenCalledWith('/api/goal-seek/goals?sessionId=session-123');
            expect(result).toHaveLength(2);
        });
    });

    describe('getPendingInterventions()', () => {
        it('GET_/api/goal-seek/interventions?status=pending_を呼び出す', async () => {
            mockHttpClient.get.mockResolvedValueOnce([
                { id: 'intervention-1', status: 'pending' }
            ]);

            const result = await repository.getPendingInterventions();

            expect(mockHttpClient.get).toHaveBeenCalledWith('/api/goal-seek/interventions?status=pending');
            expect(result).toHaveLength(1);
        });
    });
});
