import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScheduleService } from '../../../public/modules/domain/schedule/schedule-service.js';
import { httpClient } from '../../../public/modules/core/http-client.js';
import { appStore } from '../../../public/modules/core/store.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { sessionDataCache } from '../../../public/modules/core/session-data-cache.js';

// モジュールをモック化
vi.mock('../../../public/modules/core/http-client.js', () => ({
    httpClient: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn()
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
        appStore.setState({ schedule: null, currentSessionId: 'session-a' });

        sessionDataCache.clear();

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

        it('loadSchedule呼び出し時_セッションが変わってもglobal cacheが再利用される', async () => {
            httpClient.get.mockResolvedValue(mockSchedule);

            await scheduleService.loadSchedule();
            appStore.setState({ currentSessionId: 'session-b' });
            const result = await scheduleService.loadSchedule();

            expect(httpClient.get).toHaveBeenCalledTimes(1);
            expect(result).toEqual(mockSchedule);
        });
    });

    describe('schedule mutations', () => {
        it('addEvent呼び出し時_キャッシュ無効化後に最新スケジュールを再取得する', async () => {
            const refreshedSchedule = {
                ...mockSchedule,
                items: [...mockSchedule.items, { id: '3', title: 'Focus', start: '15:00', end: '16:00' }]
            };
            httpClient.get.mockResolvedValueOnce(mockSchedule).mockResolvedValueOnce(refreshedSchedule);
            httpClient.post.mockResolvedValue({ id: '3' });

            await scheduleService.loadSchedule();
            await scheduleService.addEvent({ title: 'Focus', start: '15:00', end: '16:00' });

            expect(httpClient.get).toHaveBeenCalledTimes(2);
            expect(appStore.getState().schedule).toEqual(refreshedSchedule);
        });

        it('updateEvent呼び出し時_キャッシュ無効化後に最新スケジュールを再取得する', async () => {
            const refreshedSchedule = {
                ...mockSchedule,
                items: mockSchedule.items.map(item =>
                    item.id === '1' ? { ...item, title: 'Updated Meeting' } : item
                )
            };
            httpClient.get.mockResolvedValueOnce(mockSchedule).mockResolvedValueOnce(refreshedSchedule);
            httpClient.put.mockResolvedValue({ id: '1' });

            await scheduleService.loadSchedule();
            await scheduleService.updateEvent('1', { title: 'Updated Meeting' });

            expect(httpClient.get).toHaveBeenCalledTimes(2);
            expect(appStore.getState().schedule).toEqual(refreshedSchedule);
        });

        it('deleteEvent呼び出し時_キャッシュ無効化後に最新スケジュールを再取得する', async () => {
            const refreshedSchedule = {
                ...mockSchedule,
                items: mockSchedule.items.filter(item => item.id !== '2')
            };
            httpClient.get.mockResolvedValueOnce(mockSchedule).mockResolvedValueOnce(refreshedSchedule);
            httpClient.delete.mockResolvedValue({});

            await scheduleService.loadSchedule();
            await scheduleService.deleteEvent('2');

            expect(httpClient.get).toHaveBeenCalledTimes(2);
            expect(appStore.getState().schedule).toEqual(refreshedSchedule);
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

    describe('google calendar auth', () => {
        it('getGoogleCalendarAuthStatus呼び出し時_API結果をキャッシュする', async () => {
            const authStatus = { configured: true, connected: true, calendarIds: ['primary'] };
            httpClient.get.mockResolvedValue(authStatus);

            const first = await scheduleService.getGoogleCalendarAuthStatus();
            const second = await scheduleService.getGoogleCalendarAuthStatus();

            expect(first).toEqual(authStatus);
            expect(second).toEqual(authStatus);
            expect(httpClient.get).toHaveBeenCalledTimes(1);
            expect(httpClient.get).toHaveBeenCalledWith('/api/schedule/google/auth-status');
        });

        it('disconnectGoogleCalendar呼び出し時_認証解除後にスケジュール再読み込みする', async () => {
            httpClient.get.mockResolvedValue(mockSchedule);
            httpClient.delete.mockResolvedValue({ success: true });

            await scheduleService.disconnectGoogleCalendar();

            expect(httpClient.delete).toHaveBeenCalledWith('/api/schedule/google/auth');
            expect(httpClient.get).toHaveBeenCalledWith('/api/schedule/today');
        });
    });
});
