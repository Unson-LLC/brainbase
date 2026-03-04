import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScheduleService } from '../../../public/modules/domain/schedule/schedule-service.js';
import { httpClient } from '../../../public/modules/core/http-client.js';
import { appStore } from '../../../public/modules/core/store.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

// モジュールをモック化
vi.mock('../../../public/modules/core/http-client.js', () => ({
    httpClient: {
        get: vi.fn()
    }
}));

describe('ScheduleService', () => {
    let scheduleService;
    let mockSchedule;

    beforeEach(() => {
        // テストデータ準備
        mockSchedule = {
            date: '2025-01-03',
            items: [
                { id: '1', title: 'Meeting', start: '10:00', end: '11:00' },
                { id: '2', title: 'Lunch', start: '12:00', end: '13:00' }
            ]
        };

        // ストア初期化
        appStore.setState({ schedule: null });

        // サービスインスタンス作成
        scheduleService = new ScheduleService();

        // モックリセット
        vi.clearAllMocks();
    });

    describe('loadSchedule', () => {
        it('loadSchedule呼び出し時_APIからスケジュールを取得しストアを更新', async () => {
            httpClient.get.mockResolvedValue(mockSchedule);

            const result = await scheduleService.loadSchedule();

            expect(httpClient.get).toHaveBeenCalledWith('/api/schedule/today');
            expect(appStore.getState().schedule).toEqual(mockSchedule);
            expect(result).toEqual(mockSchedule);
        });

        it('loadSchedule呼び出し時_SCHEDULE_LOADEDイベントが発火される', async () => {
            httpClient.get.mockResolvedValue(mockSchedule);
            const listener = vi.fn();
            eventBus.on(EVENTS.SCHEDULE_LOADED, listener);

            await scheduleService.loadSchedule();

            expect(listener).toHaveBeenCalled();
            // toMatchObject: _meta以外のフィールドが一致することを確認
            expect(listener.mock.calls[0][0].detail).toMatchObject(mockSchedule);
            // トレーサビリティ: _metaが付与されている
            expect(listener.mock.calls[0][0].detail._meta).toBeDefined();
            expect(listener.mock.calls[0][0].detail._meta.eventId).toMatch(/^evt_/);
        });

        it('loadSchedule呼び出し時_APIエラー発生_例外がスローされる', async () => {
            const error = new Error('Network error');
            httpClient.get.mockRejectedValue(error);

            await expect(scheduleService.loadSchedule()).rejects.toThrow('Network error');
        });

        it('loadSchedule呼び出し時_空オブジェクトレスポンス_正常処理される', async () => {
            const emptySchedule = {};
            httpClient.get.mockResolvedValue(emptySchedule);

            const result = await scheduleService.loadSchedule();

            expect(appStore.getState().schedule).toEqual(emptySchedule);
            expect(result).toEqual(emptySchedule);
        });
    });

    describe('getTimeline', () => {
        it('getTimeline呼び出し時_schedule.itemsが返却される', () => {
            appStore.setState({ schedule: mockSchedule });

            const result = scheduleService.getTimeline();

            expect(result).toEqual(mockSchedule.items);
            expect(result).toHaveLength(2);
        });

        it('getTimeline呼び出し時_scheduleがnull_空配列が返却される', () => {
            appStore.setState({ schedule: null });

            const result = scheduleService.getTimeline();

            expect(result).toEqual([]);
        });

        it('getTimeline呼び出し時_schedule.itemsが未定義_空配列が返却される', () => {
            appStore.setState({ schedule: { date: '2025-01-03' } }); // items未定義

            const result = scheduleService.getTimeline();

            expect(result).toEqual([]);
        });

        it('getTimeline呼び出し時_schedule.itemsが空配列_空配列が返却される', () => {
            appStore.setState({ schedule: { date: '2025-01-03', items: [] } });

            const result = scheduleService.getTimeline();

            expect(result).toEqual([]);
            expect(result).toHaveLength(0);
        });
    });
});
