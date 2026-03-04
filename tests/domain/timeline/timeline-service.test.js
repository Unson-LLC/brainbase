import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimelineService } from '../../../public/modules/domain/timeline/timeline-service.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { appStore } from '../../../public/modules/core/store.js';

describe('TimelineService', () => {
    let service;
    let mockRepository;

    beforeEach(() => {
        mockRepository = {
            fetchToday: vi.fn(),
            fetchByDate: vi.fn(),
            createItem: vi.fn(),
            updateItem: vi.fn(),
            deleteItem: vi.fn()
        };

        service = new TimelineService({
            repository: mockRepository,
            store: appStore,
            eventBus: eventBus
        });

        // Reset store
        appStore.setState({
            timeline: {
                items: [],
                date: null,
                filters: { type: null, search: '' }
            }
        });

        vi.clearAllMocks();
    });

    describe('loadTimeline', () => {
        it('loadTimeline呼び出し時_今日のタイムラインを取得しストアを更新', async () => {
            const mockData = {
                date: '2025-01-11',
                items: [{ id: 'tl_1', type: 'session', title: 'Test' }]
            };
            mockRepository.fetchToday.mockResolvedValue(mockData);

            const result = await service.loadTimeline();

            expect(mockRepository.fetchToday).toHaveBeenCalled();
            expect(appStore.getState().timeline.items).toEqual(mockData.items);
            expect(appStore.getState().timeline.date).toBe(mockData.date);
            expect(result).toEqual(mockData);
        });

        it('loadTimeline呼び出し時_TIMELINE_LOADEDイベントが発火される', async () => {
            const mockData = { date: '2025-01-11', items: [] };
            mockRepository.fetchToday.mockResolvedValue(mockData);
            const listener = vi.fn();
            eventBus.on(EVENTS.TIMELINE_LOADED, listener);

            await service.loadTimeline();

            expect(listener).toHaveBeenCalled();
            expect(listener.mock.calls[0][0].detail).toMatchObject(mockData);
        });
    });

    describe('loadTimelineByDate', () => {
        it('loadTimelineByDate呼び出し時_指定日のタイムラインを取得', async () => {
            const mockData = {
                date: '2025-01-10',
                items: [{ id: 'tl_2', type: 'manual', title: 'Past entry' }]
            };
            mockRepository.fetchByDate.mockResolvedValue(mockData);

            const result = await service.loadTimelineByDate('2025-01-10');

            expect(mockRepository.fetchByDate).toHaveBeenCalledWith('2025-01-10');
            expect(result).toEqual(mockData);
        });
    });

    describe('getTimelineItems', () => {
        it('getTimelineItems呼び出し時_ストアから項目を取得', () => {
            const items = [{ id: 'tl_1', type: 'session', title: 'Test' }];
            appStore.setState({ timeline: { items, date: '2025-01-11', filters: {} } });

            const result = service.getTimelineItems();

            expect(result).toEqual(items);
        });

        it('getTimelineItems呼び出し時_フィルタ適用_タイプでフィルタリング', () => {
            const items = [
                { id: 'tl_1', type: 'session', title: 'Session' },
                { id: 'tl_2', type: 'manual', title: 'Manual' }
            ];
            appStore.setState({
                timeline: { items, date: '2025-01-11', filters: { type: 'session', search: '' } }
            });

            const result = service.getTimelineItems();

            expect(result).toHaveLength(1);
            expect(result[0].type).toBe('session');
        });

        it('getTimelineItems呼び出し時_フィルタ適用_タイトル検索', () => {
            const items = [
                { id: 'tl_1', type: 'session', title: 'Morning session' },
                { id: 'tl_2', type: 'manual', title: 'Afternoon break' }
            ];
            appStore.setState({
                timeline: { items, date: '2025-01-11', filters: { type: null, search: 'morning' } }
            });

            const result = service.getTimelineItems();

            expect(result).toHaveLength(1);
            expect(result[0].title).toContain('Morning');
        });
    });

    describe('createItem', () => {
        it('createItem呼び出し時_項目が作成されストアに追加', async () => {
            const newItem = { type: 'manual', title: 'New entry' };
            const createdItem = { id: 'tl_new', ...newItem, timestamp: '2025-01-11T10:00:00.000Z' };
            mockRepository.createItem.mockResolvedValue({ success: true, item: createdItem });
            appStore.setState({ timeline: { items: [], date: '2025-01-11', filters: {} } });

            const result = await service.createItem(newItem);

            expect(mockRepository.createItem).toHaveBeenCalled();
            expect(result.success).toBe(true);
            expect(appStore.getState().timeline.items).toContainEqual(createdItem);
        });

        it('createItem呼び出し時_TIMELINE_ITEM_CREATEDイベントが発火される', async () => {
            const newItem = { type: 'manual', title: 'New entry' };
            const createdItem = { id: 'tl_new', ...newItem };
            mockRepository.createItem.mockResolvedValue({ success: true, item: createdItem });
            const listener = vi.fn();
            eventBus.on(EVENTS.TIMELINE_ITEM_CREATED, listener);

            await service.createItem(newItem);

            expect(listener).toHaveBeenCalled();
        });
    });

    describe('updateItem', () => {
        it('updateItem呼び出し時_項目が更新されストアも更新', async () => {
            const existingItems = [{ id: 'tl_1', type: 'session', title: 'Original' }];
            appStore.setState({ timeline: { items: existingItems, date: '2025-01-11', filters: {} } });
            const updatedItem = { id: 'tl_1', type: 'session', title: 'Updated' };
            mockRepository.updateItem.mockResolvedValue({ success: true, item: updatedItem });

            const result = await service.updateItem('tl_1', { title: 'Updated' });

            expect(mockRepository.updateItem).toHaveBeenCalledWith('tl_1', { title: 'Updated' });
            expect(result.success).toBe(true);
            expect(appStore.getState().timeline.items[0].title).toBe('Updated');
        });

        it('updateItem呼び出し時_TIMELINE_ITEM_UPDATEDイベントが発火される', async () => {
            appStore.setState({ timeline: { items: [{ id: 'tl_1' }], date: '2025-01-11', filters: {} } });
            mockRepository.updateItem.mockResolvedValue({ success: true, item: { id: 'tl_1', title: 'Updated' } });
            const listener = vi.fn();
            eventBus.on(EVENTS.TIMELINE_ITEM_UPDATED, listener);

            await service.updateItem('tl_1', { title: 'Updated' });

            expect(listener).toHaveBeenCalled();
        });
    });

    describe('deleteItem', () => {
        it('deleteItem呼び出し時_項目が削除されストアからも削除', async () => {
            const existingItems = [
                { id: 'tl_1', type: 'session', title: 'First' },
                { id: 'tl_2', type: 'manual', title: 'Second' }
            ];
            appStore.setState({ timeline: { items: existingItems, date: '2025-01-11', filters: {} } });
            mockRepository.deleteItem.mockResolvedValue({ success: true });

            const result = await service.deleteItem('tl_1');

            expect(mockRepository.deleteItem).toHaveBeenCalledWith('tl_1');
            expect(result.success).toBe(true);
            expect(appStore.getState().timeline.items).toHaveLength(1);
            expect(appStore.getState().timeline.items[0].id).toBe('tl_2');
        });

        it('deleteItem呼び出し時_TIMELINE_ITEM_DELETEDイベントが発火される', async () => {
            appStore.setState({ timeline: { items: [{ id: 'tl_1' }], date: '2025-01-11', filters: {} } });
            mockRepository.deleteItem.mockResolvedValue({ success: true });
            const listener = vi.fn();
            eventBus.on(EVENTS.TIMELINE_ITEM_DELETED, listener);

            await service.deleteItem('tl_1');

            expect(listener).toHaveBeenCalled();
        });
    });

    describe('setFilter', () => {
        it('setFilter呼び出し時_フィルタが更新される', () => {
            service.setFilter({ type: 'session' });

            expect(appStore.getState().timeline.filters.type).toBe('session');
        });

        it('setFilter呼び出し時_TIMELINE_FILTER_CHANGEDイベントが発火される', async () => {
            const listener = vi.fn();
            eventBus.on(EVENTS.TIMELINE_FILTER_CHANGED, listener);

            await service.setFilter({ search: 'test' });

            expect(listener).toHaveBeenCalled();
        });
    });

    describe('Auto-Recording', () => {
        it('startAutoRecording呼び出し時_SESSION_CREATEDイベントでタイムライン項目が作成される', async () => {
            const createdItem = { id: 'tl_auto', type: 'session', title: 'Session created' };
            mockRepository.createItem.mockResolvedValue({ success: true, item: createdItem });
            appStore.setState({ timeline: { items: [], date: '2025-01-11', filters: {} } });

            service.startAutoRecording();
            await eventBus.emit(EVENTS.SESSION_CREATED, { sessionId: 'session-123', name: 'New Session' });

            // Wait for async handler
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(mockRepository.createItem).toHaveBeenCalled();
            const call = mockRepository.createItem.mock.calls[0][0];
            expect(call.type).toBe('session');
        });

        it('startAutoRecording呼び出し時_TASK_COMPLETEDイベントでタイムライン項目が作成される', async () => {
            const createdItem = { id: 'tl_auto', type: 'task', title: 'Task completed' };
            mockRepository.createItem.mockResolvedValue({ success: true, item: createdItem });
            appStore.setState({ timeline: { items: [], date: '2025-01-11', filters: {} } });

            service.startAutoRecording();
            await eventBus.emit(EVENTS.TASK_COMPLETED, { taskId: 'task-456', title: 'Fix bug' });

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(mockRepository.createItem).toHaveBeenCalled();
            const call = mockRepository.createItem.mock.calls[0][0];
            expect(call.type).toBe('task');
        });

        it('stopAutoRecording呼び出し時_イベントリスナーが解除される', async () => {
            mockRepository.createItem.mockResolvedValue({ success: true, item: {} });
            appStore.setState({ timeline: { items: [], date: '2025-01-11', filters: {} } });

            service.startAutoRecording();
            service.stopAutoRecording();
            await eventBus.emit(EVENTS.SESSION_CREATED, { sessionId: 'session-123' });

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(mockRepository.createItem).not.toHaveBeenCalled();
        });
    });

    describe('Task Integration', () => {
        it('linkToTask呼び出し時_項目にlinkedTaskIdが設定される', async () => {
            const existingItems = [{ id: 'tl_1', type: 'manual', title: 'Test' }];
            appStore.setState({ timeline: { items: existingItems, date: '2025-01-11', filters: {} } });
            const updatedItem = { id: 'tl_1', type: 'manual', title: 'Test', linkedTaskId: 'task-123' };
            mockRepository.updateItem.mockResolvedValue({ success: true, item: updatedItem });

            const result = await service.linkToTask('tl_1', 'task-123');

            expect(mockRepository.updateItem).toHaveBeenCalledWith('tl_1', { linkedTaskId: 'task-123' });
            expect(result.success).toBe(true);
        });

        it('linkToTask呼び出し時_TIMELINE_TASK_LINKEDイベントが発火される', async () => {
            appStore.setState({ timeline: { items: [{ id: 'tl_1' }], date: '2025-01-11', filters: {} } });
            mockRepository.updateItem.mockResolvedValue({ success: true, item: { id: 'tl_1', linkedTaskId: 'task-123' } });
            const listener = vi.fn();
            eventBus.on(EVENTS.TIMELINE_TASK_LINKED, listener);

            await service.linkToTask('tl_1', 'task-123');

            expect(listener).toHaveBeenCalled();
        });

        it('unlinkFromTask呼び出し時_linkedTaskIdがnullに設定される', async () => {
            const existingItems = [{ id: 'tl_1', linkedTaskId: 'task-123' }];
            appStore.setState({ timeline: { items: existingItems, date: '2025-01-11', filters: {} } });
            const updatedItem = { id: 'tl_1', linkedTaskId: null };
            mockRepository.updateItem.mockResolvedValue({ success: true, item: updatedItem });

            const result = await service.unlinkFromTask('tl_1');

            expect(mockRepository.updateItem).toHaveBeenCalledWith('tl_1', { linkedTaskId: null });
            expect(result.success).toBe(true);
        });

        it('unlinkFromTask呼び出し時_TIMELINE_TASK_UNLINKEDイベントが発火される', async () => {
            appStore.setState({ timeline: { items: [{ id: 'tl_1', linkedTaskId: 'task-123' }], date: '2025-01-11', filters: {} } });
            mockRepository.updateItem.mockResolvedValue({ success: true, item: { id: 'tl_1', linkedTaskId: null } });
            const listener = vi.fn();
            eventBus.on(EVENTS.TIMELINE_TASK_UNLINKED, listener);

            await service.unlinkFromTask('tl_1');

            expect(listener).toHaveBeenCalled();
        });
    });
});
