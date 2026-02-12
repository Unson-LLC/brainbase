import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GoalSeekCalculationService } from '../../../server/services/goal-seek-calculation-service.js';

/**
 * GoalSeekCalculationService 単体テスト
 *
 * テスト対象:
 * 1. calculate() - 逆算計算実行
 * 2. checkInterventionNeeded() - 人介入判定
 * 3. progress notification - 進捗通知生成
 * 4. parameter validation - パラメータ検証
 * 5. error handling - エラーハンドリング
 */

describe('GoalSeekCalculationService', () => {
    let service;
    let mockEventBus;

    beforeEach(() => {
        mockEventBus = {
            emit: vi.fn()
        };
        service = new GoalSeekCalculationService({ eventBus: mockEventBus });
    });

    describe('calculate()', () => {
        it('UT-001: 基本的な逆算計算を実行できる', async () => {
            const params = {
                target: 1000,
                period: 30,
                current: 0,
                unit: '件'
            };

            const result = await service.calculate(params);

            expect(result).toBeDefined();
            expect(result.dailyTarget).toBeGreaterThan(0);
            expect(result.totalDays).toBe(30);
            expect(result.remainingDays).toBe(30);
        });

        it('UT-002: 既に進捗がある場合の逆算計算', async () => {
            const params = {
                target: 1000,
                period: 30,
                current: 300,
                unit: '件'
            };

            const result = await service.calculate(params);

            expect(result.dailyTarget).toBeCloseTo(700 / 30, 2);
            expect(result.completed).toBe(300);
            expect(result.remaining).toBe(700);
        });

        it('UT-003: period=0の場合はエラー', async () => {
            const params = {
                target: 1000,
                period: 0,
                current: 0,
                unit: '件'
            };

            await expect(service.calculate(params)).rejects.toThrow('period must be between 1 and 365');
        });

        it('UT-004: period > 365の場合はエラー', async () => {
            const params = {
                target: 1000,
                period: 400,
                current: 0,
                unit: '件'
            };

            await expect(service.calculate(params)).rejects.toThrow('period must be between 1 and 365');
        });

        it('UT-005: targetが負の値の場合はエラー', async () => {
            const params = {
                target: -100,
                period: 30,
                current: 0,
                unit: '件'
            };

            await expect(service.calculate(params)).rejects.toThrow('target must be >= 0');
        });

        it('UT-006: current > targetの場合は完了扱い', async () => {
            const params = {
                target: 100,
                period: 30,
                current: 150,
                unit: '件'
            };

            const result = await service.calculate(params);

            expect(result.isCompleted).toBe(true);
            expect(result.dailyTarget).toBe(0);
        });

        it('UT-007: correlationIdを追跡できる', async () => {
            const params = {
                target: 1000,
                period: 30,
                current: 0,
                unit: '件'
            };
            const correlationId = 'test-correlation-123';

            const result = await service.calculate(params, { correlationId });

            expect(result.correlationId).toBe(correlationId);
        });
    });

    describe('checkInterventionNeeded()', () => {
        it('UT-008: 正常な計算では介入不要', async () => {
            const params = {
                target: 1000,
                period: 30,
                current: 0,
                unit: '件'
            };

            const result = await service.calculate(params);
            const intervention = service.checkInterventionNeeded(result);

            expect(intervention.needed).toBe(false);
        });

        it('UT-009: dailyTargetが極端に高い場合は介入判定', async () => {
            const params = {
                target: 100000,
                period: 1,
                current: 0,
                unit: '件'
            };

            const result = await service.calculate(params);
            const intervention = service.checkInterventionNeeded(result);

            expect(intervention.needed).toBe(true);
            expect(intervention.type).toBe('decision');
            expect(intervention.reason).toContain('dailyTarget');
        });

        it('UT-010: 完了済みの場合は介入不要', async () => {
            const params = {
                target: 100,
                period: 30,
                current: 150,
                unit: '件'
            };

            const result = await service.calculate(params);
            const intervention = service.checkInterventionNeeded(result);

            expect(intervention.needed).toBe(false);
        });
    });

    describe('progress notification', () => {
        it('UT-011: 進捗イベントを発行できる', async () => {
            const params = {
                target: 1000,
                period: 30,
                current: 0,
                unit: '件'
            };
            const correlationId = 'progress-test-123';

            await service.calculate(params, { correlationId, emitProgress: true });

            expect(mockEventBus.emit).toHaveBeenCalledWith(
                'goal-seek:progress',
                expect.objectContaining({
                    correlationId,
                    progress: expect.any(Number)
                })
            );
        });

        it('UT-012: emitProgress=falseでは進捗イベントを発行しない', async () => {
            const params = {
                target: 1000,
                period: 30,
                current: 0,
                unit: '件'
            };

            await service.calculate(params, { emitProgress: false });

            expect(mockEventBus.emit).not.toHaveBeenCalled();
        });
    });

    describe('parameter validation', () => {
        it('UT-013: unitが未指定の場合はデフォルト値を使用', async () => {
            const params = {
                target: 1000,
                period: 30,
                current: 0
            };

            const result = await service.calculate(params);

            expect(result.unit).toBe('件');
        });

        it('UT-014: currentが未指定の場合は0を使用', async () => {
            const params = {
                target: 1000,
                period: 30
            };

            const result = await service.calculate(params);

            expect(result.completed).toBe(0);
        });
    });

    describe('intervention types', () => {
        it('UT-015: blocker介入タイプを判定できる', async () => {
            const calculationResult = {
                dailyTarget: 50,
                hasBlocker: true,
                blockerReason: '依存タスクが未完了'
            };

            const intervention = service.checkInterventionNeeded(calculationResult);

            expect(intervention.needed).toBe(true);
            expect(intervention.type).toBe('blocker');
        });
    });
});
