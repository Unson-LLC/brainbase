import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NocoDBService } from '../../../server/services/nocodb-service.js';

/**
 * NocoDBService統合テスト
 *
 * テスト対象メソッド:
 * 1. getProjectStats() - プロジェクト統計取得
 * 2. getCriticalAlerts() - Critical Alerts取得
 * 3. getWorkflowStats() - Manaワークフロー統計取得
 * 4. insertWorkflowHistory() - ワークフロー履歴挿入
 * 5. insertSnapshot() - スナップショット挿入
 */

// 相対日付を生成するヘルパー関数（基準日指定）
const getRelativeDate = (baseDate, daysFromNow) => {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + daysFromNow);
    return date.toISOString().split('T')[0]; // YYYY-MM-DD形式
};

// NocoDB APIレスポンスのモックデータ（基準日から生成）
const buildMockTasksResponse = (baseDate) => ({
    list: [
        {
            Id: 1,
            タスク名: 'タスク1',
            ステータス: '完了',
            担当者: 'テスト担当',
            期限: getRelativeDate(baseDate, -30), // 30日前（完了なので期限超過にならない）
            作成日: getRelativeDate(baseDate, -60)
        },
        {
            Id: 2,
            タスク名: 'タスク2',
            ステータス: '進行中',
            担当者: '太田',
            期限: getRelativeDate(baseDate, 7), // 7日後（期限超過にならない）
            作成日: getRelativeDate(baseDate, -14)
        },
        {
            Id: 3,
            タスク名: 'タスク3',
            ステータス: 'ブロック',
            担当者: '山田',
            期限: getRelativeDate(baseDate, -7), // 7日前（期限超過）
            作成日: getRelativeDate(baseDate, -60)
        },
        {
            Id: 4,
            タスク名: 'タスク4',
            ステータス: '未着手',
            担当者: '田中',
            期限: getRelativeDate(baseDate, -30), // 30日前（期限超過）
            作成日: getRelativeDate(baseDate, -45)
        }
    ]
});

const mockMilestonesResponse = {
    list: [
        {
            Id: 1,
            マイルストーン名: 'マイルストーン1',
            進捗率: 75
        },
        {
            Id: 2,
            マイルストーン名: 'マイルストーン2',
            進捗率: 50
        }
    ]
};

describe('NocoDBService', () => {
    let service;
    let fetchMock;

    beforeEach(() => {
        // fetch APIのモック
        fetchMock = vi.fn();
        global.fetch = fetchMock;

        // NocoDBService インスタンス作成
        service = new NocoDBService();
        service.baseUrl = 'https://noco.test.jp';
        service.apiToken = 'test-token';
        service.timeout = 10000;
    });

    // ==================== 1. getProjectStats() ====================

    describe('getProjectStats()', () => {
        it('正常にプロジェクト統計を返す', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-01-12T12:00:00Z'));
            const mockTasksResponse = buildMockTasksResponse(new Date());
            // モック設定: タスクとマイルストーンを返す
            fetchMock
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => mockTasksResponse
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => mockMilestonesResponse
                });

            const stats = await service.getProjectStats('test-project');

            // タスク統計の検証
            expect(stats.total).toBe(4);
            expect(stats.completed).toBe(1);
            expect(stats.inProgress).toBe(1);
            expect(stats.pending).toBe(1);
            expect(stats.blocked).toBe(1);
            expect(stats.overdue).toBe(2); // タスク3（2026-01-10）とタスク4（2025-12-01）が期限超過
            expect(stats.completionRate).toBe(25); // 1/4 = 25%

            // マイルストーン統計の検証
            expect(stats.averageProgress).toBe(63); // (75 + 50) / 2 = 62.5 → 63

            // fetch APIの呼び出し検証
            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(fetchMock).toHaveBeenNthCalledWith(
                1,
                'https://noco.test.jp/api/v1/db/data/noco/test-project/%E3%82%BF%E3%82%B9%E3%82%AF',
                expect.objectContaining({
                    headers: { 'xc-token': 'test-token' }
                })
            );

            vi.useRealTimers();
        });

        it('存在しないproject_idでデフォルト統計を返す', async () => {
            // モック設定: API エラー
            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 404
            });

            const stats = await service.getProjectStats('non-existent');

            // デフォルト統計が返ること
            expect(stats.total).toBe(0);
            expect(stats.completed).toBe(0);
            expect(stats.completionRate).toBe(0);
            expect(stats.averageProgress).toBe(0);
        });

        it('API timeout時にデフォルト統計を返す', async () => {
            // モック設定: Timeout エラー
            fetchMock.mockRejectedValueOnce(new Error('AbortError'));

            const stats = await service.getProjectStats('test-project');

            // デフォルト統計が返ること
            expect(stats.total).toBe(0);
            expect(stats.completed).toBe(0);
        });
    });

    // ==================== 2. getCriticalAlerts() ====================

    describe('getCriticalAlerts()', () => {
        it('ブロッカー・期限超過タスクを正しく分類する', async () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-01-12T12:00:00Z'));
            const mockTasksResponse = buildMockTasksResponse(new Date());
            const projects = [
                { id: 'project1', project_id: 'proj1' },
                { id: 'project2', project_id: 'proj2' }
            ];

            // モック設定: 2プロジェクト分のタスクを返す
            fetchMock
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => mockTasksResponse
                })
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({ list: [] })
                });

            const result = await service.getCriticalAlerts(projects);

            // アラート数の検証
            expect(result.total_critical).toBe(1); // ブロッカータスク（タスク3）
            expect(result.total_warning).toBe(2); // 期限超過タスク（タスク3、タスク4）
            expect(result.alerts).toHaveLength(3); // blocker(1) + overdue(2)

            // ブロッカータスクの検証
            const blockerAlert = result.alerts.find(a => a.type === 'blocker');
            expect(blockerAlert).toBeDefined();
            expect(blockerAlert.project).toBe('project1');
            expect(blockerAlert.task).toBe('タスク3');
            expect(blockerAlert.severity).toBe('critical');

            // 期限超過タスクの検証（タスク4）
            const task4OverdueAlert = result.alerts.find(a => a.type === 'overdue' && a.task === 'タスク4');
            expect(task4OverdueAlert).toBeDefined();
            expect(task4OverdueAlert.project).toBe('project1');
            expect(task4OverdueAlert.severity).toBe('warning');

            vi.useRealTimers();
        });

        it('アラートなし時に空配列を返す', async () => {
            const projects = [{ id: 'project1', project_id: 'proj1' }];

            // モック設定: 完了タスクのみ
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    list: [
                        {
                            タスク名: '完了タスク',
                            ステータス: '完了',
                            期限: '2026-01-01'
                        }
                    ]
                })
            });

            const result = await service.getCriticalAlerts(projects);

            expect(result.alerts).toHaveLength(0);
            expect(result.total_critical).toBe(0);
            expect(result.total_warning).toBe(0);
        });
    });

    // ==================== 3. getWorkflowStats() ====================

    describe('getWorkflowStats()', () => {
        it('成功率・実行回数を正しく計算する', async () => {
            const mockWorkflowHistory = {
                list: [
                    {
                        workflow_id: 'm1',
                        execution_date: '2026-01-10',
                        success_count: 10,
                        failure_count: 2,
                        success_rate: 83
                    },
                    {
                        workflow_id: 'm1',
                        execution_date: '2026-01-09',
                        success_count: 8,
                        failure_count: 1,
                        success_rate: 89
                    }
                ]
            };

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => mockWorkflowHistory
            });

            const result = await service.getWorkflowStats('m1', 30);

            // 統計計算の検証
            expect(result.workflow_id).toBe('m1');
            expect(result.stats.total_executions).toBe(21); // 10+2+8+1
            expect(result.stats.total_success).toBe(18); // 10+8
            expect(result.stats.total_failure).toBe(3); // 2+1
            expect(result.stats.success_rate).toBe(86); // 18/21 = 85.7 → 86
        });

        it('日付範囲フィルタが正しく適用される', async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ list: [] })
            });

            await service.getWorkflowStats('m1', 30);

            // fetch URLに日付範囲が含まれることを確認（URL encoded形式）
            const callUrl = fetchMock.mock.calls[0][0];
            expect(callUrl).toContain('execution_date%2Cgte');
            expect(callUrl).toContain('execution_date%2Clte');
        });

        it('workflow_id未指定時に全ワークフローの統計を返す', async () => {
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ list: [] })
            });

            const result = await service.getWorkflowStats(null, 30);

            // workflow_idがnullであることを確認
            expect(result.workflow_id).toBeNull();

            // fetch URLにworkflow_idフィルタが含まれないことを確認
            const callUrl = fetchMock.mock.calls[0][0];
            expect(callUrl).not.toContain('workflow_id,eq');
        });
    });

    // ==================== 4. insertWorkflowHistory() ====================

    describe('insertWorkflowHistory()', () => {
        it('正常に履歴を挿入する', async () => {
            const mockInsertResponse = {
                Id: 123,
                workflow_id: 'm1',
                execution_date: '2026-01-11'
            };

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => mockInsertResponse
            });

            const data = {
                workflow_id: 'm1',
                execution_date: '2026-01-11',
                success_count: 10,
                failure_count: 1,
                success_rate: 91
            };

            const result = await service.insertWorkflowHistory(data);

            // 挿入結果の検証
            expect(result.Id).toBe(123);
            expect(result.workflow_id).toBe('m1');

            // fetch APIの呼び出し検証（POST）
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('Mana%E3%83%AF%E3%83%BC%E3%82%AF%E3%83%95%E3%83%AD%E3%83%BC%E5%B1%A5%E6%AD%B4'),
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'xc-token': 'test-token',
                        'Content-Type': 'application/json'
                    }),
                    body: expect.any(String)
                })
            );
        });

        it('UNIQUE制約違反時にエラーをスローする', async () => {
            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 409 // Conflict
            });

            const data = {
                workflow_id: 'm1',
                execution_date: '2026-01-11',
                success_count: 10,
                failure_count: 1,
                success_rate: 91
            };

            await expect(service.insertWorkflowHistory(data)).rejects.toThrow();
        });
    });

    // ==================== 5. insertSnapshot() ====================

    describe('insertSnapshot()', () => {
        it('正常にスナップショットを挿入する', async () => {
            const mockInsertResponse = {
                Id: 456,
                project_id: 'salestailor',
                snapshot_date: '2026-01-11'
            };

            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => mockInsertResponse
            });

            const data = {
                project_id: 'salestailor',
                snapshot_date: '2026-01-11',
                total_tasks: 50,
                completed_tasks: 30,
                overdue_tasks: 5,
                blocked_tasks: 2,
                completion_rate: 60,
                milestone_progress: 75,
                health_score: 82
            };

            const result = await service.insertSnapshot(data);

            // 挿入結果の検証
            expect(result.Id).toBe(456);
            expect(result.project_id).toBe('salestailor');

            // fetch APIの呼び出し検証（POST）
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('brainbase'),
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'xc-token': 'test-token',
                        'Content-Type': 'application/json'
                    })
                })
            );
        });

        it('UNIQUE制約違反時にエラーをスローする', async () => {
            fetchMock.mockResolvedValueOnce({
                ok: false,
                status: 409 // Conflict
            });

            const data = {
                project_id: 'salestailor',
                snapshot_date: '2026-01-11',
                total_tasks: 50,
                completed_tasks: 30,
                health_score: 82
            };

            await expect(service.insertSnapshot(data)).rejects.toThrow();
        });

        it('タイムアウト時にエラーをスローする', async () => {
            vi.useFakeTimers();
            // タイムアウトをシミュレート
            fetchMock.mockImplementationOnce(() => {
                return new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('AbortError')), 100);
                });
            });

            const data = {
                project_id: 'salestailor',
                snapshot_date: '2026-01-11',
                health_score: 82
            };

            const promise = service.insertSnapshot(data);
            const assertion = expect(promise).rejects.toThrow();
            await vi.advanceTimersByTimeAsync(150);
            await assertion;
            vi.useRealTimers();
        });
    });
});
