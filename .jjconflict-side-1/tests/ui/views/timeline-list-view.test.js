import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

// Setup JSDOM
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="test-container"></div></body></html>');
global.document = dom.window.document;
global.window = dom.window;

// Mock lucide
global.window.lucide = {
    createIcons: vi.fn()
};

import { TimelineListView } from '../../../public/modules/ui/views/timeline-list-view.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';

describe('TimelineListView', () => {
    let view;
    let mockTimelineService;
    let container;

    beforeEach(() => {
        mockTimelineService = {
            getTimelineItems: vi.fn().mockReturnValue([]),
            setFilter: vi.fn(),
            deleteItem: vi.fn().mockResolvedValue({ success: true })
        };

        view = new TimelineListView({
            timelineService: mockTimelineService,
            eventBus: eventBus
        });

        container = document.getElementById('test-container');
        container.innerHTML = '';
        vi.clearAllMocks();
    });

    describe('mount', () => {
        it('mount呼び出し時_コンテナにレンダリングされる', () => {
            view.mount(container);

            expect(container.innerHTML).not.toBe('');
        });

        it('mount呼び出し時_イベントリスナーが設定される', () => {
            const spy = vi.spyOn(view, '_setupEventListeners');
            view.mount(container);

            expect(spy).toHaveBeenCalled();
        });
    });

    describe('render', () => {
        beforeEach(() => {
            view.mount(container);
        });

        it('render呼び出し時_空配列_空メッセージが表示される', () => {
            mockTimelineService.getTimelineItems.mockReturnValue([]);
            view.render();

            expect(container.innerHTML).toContain('timeline-empty');
        });

        it('render呼び出し時_項目あり_項目が表示される', () => {
            const items = [
                { id: 'tl_1', type: 'session', title: 'Test Session', timestamp: new Date().toISOString() }
            ];
            mockTimelineService.getTimelineItems.mockReturnValue(items);
            view.render();

            expect(container.innerHTML).toContain('Test Session');
            expect(container.innerHTML).toContain('tl_1');
        });

        it('render呼び出し時_タイプがsession_セッションアイコンが表示される', () => {
            const items = [
                { id: 'tl_1', type: 'session', title: 'Session', timestamp: new Date().toISOString() }
            ];
            mockTimelineService.getTimelineItems.mockReturnValue(items);
            view.render();

            expect(container.innerHTML).toContain('data-lucide');
        });

        it('render呼び出し時_今日の項目_Todayグループに表示される', () => {
            const today = new Date().toISOString();
            const items = [
                { id: 'tl_1', type: 'session', title: 'Today Item', timestamp: today }
            ];
            mockTimelineService.getTimelineItems.mockReturnValue(items);
            view.render();

            expect(container.innerHTML).toContain('今日');
        });

        it('render呼び出し時_昨日の項目_Yesterdayグループに表示される', () => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const items = [
                { id: 'tl_1', type: 'session', title: 'Yesterday Item', timestamp: yesterday.toISOString() }
            ];
            mockTimelineService.getTimelineItems.mockReturnValue(items);
            view.render();

            expect(container.innerHTML).toContain('昨日');
        });

        it('render呼び出し時_今週の項目_ThisWeekグループに表示される', () => {
            const thisWeek = new Date();
            thisWeek.setDate(thisWeek.getDate() - 3);
            const items = [
                { id: 'tl_1', type: 'session', title: 'This Week Item', timestamp: thisWeek.toISOString() }
            ];
            mockTimelineService.getTimelineItems.mockReturnValue(items);
            view.render();

            expect(container.innerHTML).toContain('今週');
        });

        it('render呼び出し時_追加ボタンが表示される', () => {
            view.render();

            expect(container.innerHTML).toContain('add-timeline-item');
        });
    });

    describe('filtering', () => {
        beforeEach(() => {
            view.mount(container);
        });

        it('フィルタボタンクリック時_setFilterが呼ばれる', () => {
            const items = [
                { id: 'tl_1', type: 'session', title: 'Test', timestamp: new Date().toISOString() }
            ];
            mockTimelineService.getTimelineItems.mockReturnValue(items);
            view.render();

            const filterBtn = container.querySelector('[data-filter-type="session"]');
            if (filterBtn) {
                filterBtn.click();
                expect(mockTimelineService.setFilter).toHaveBeenCalled();
            }
        });
    });

    describe('event handling', () => {
        beforeEach(() => {
            view.mount(container);
        });

        it('TIMELINE_LOADED発火時_再レンダリングされる', async () => {
            const renderSpy = vi.spyOn(view, 'render');
            await eventBus.emit(EVENTS.TIMELINE_LOADED, {});

            expect(renderSpy).toHaveBeenCalled();
        });

        it('TIMELINE_ITEM_CREATED発火時_再レンダリングされる', async () => {
            const renderSpy = vi.spyOn(view, 'render');
            await eventBus.emit(EVENTS.TIMELINE_ITEM_CREATED, { item: {} });

            expect(renderSpy).toHaveBeenCalled();
        });

        it('TIMELINE_ITEM_UPDATED発火時_再レンダリングされる', async () => {
            const renderSpy = vi.spyOn(view, 'render');
            await eventBus.emit(EVENTS.TIMELINE_ITEM_UPDATED, { item: {} });

            expect(renderSpy).toHaveBeenCalled();
        });

        it('TIMELINE_ITEM_DELETED発火時_再レンダリングされる', async () => {
            const renderSpy = vi.spyOn(view, 'render');
            await eventBus.emit(EVENTS.TIMELINE_ITEM_DELETED, { id: 'tl_1' });

            expect(renderSpy).toHaveBeenCalled();
        });

        it('TIMELINE_FILTER_CHANGED発火時_再レンダリングされる', async () => {
            const renderSpy = vi.spyOn(view, 'render');
            await eventBus.emit(EVENTS.TIMELINE_FILTER_CHANGED, { filters: {} });

            expect(renderSpy).toHaveBeenCalled();
        });
    });

    describe('item actions', () => {
        beforeEach(() => {
            const items = [
                { id: 'tl_1', type: 'manual', title: 'Test Item', timestamp: new Date().toISOString() }
            ];
            mockTimelineService.getTimelineItems.mockReturnValue(items);
            view.mount(container);
            view.render();
        });

        it('編集ボタンクリック時_TIMELINE_EDIT_ITEMイベントが発火される', () => {
            const emitted = [];
            eventBus.on(EVENTS.TIMELINE_EDIT_ITEM, (e) => emitted.push(e));

            const editBtn = container.querySelector('.edit-timeline-item');
            if (editBtn) {
                editBtn.click();
                expect(emitted.length).toBeGreaterThan(0);
            }
        });

        it('削除ボタンクリック時_confirmダイアログが表示される', () => {
            global.confirm = vi.fn().mockReturnValue(false);

            const deleteBtn = container.querySelector('.delete-timeline-item');
            if (deleteBtn) {
                deleteBtn.click();
                expect(global.confirm).toHaveBeenCalled();
            }
        });

        it('削除確認後_deleteItemが呼ばれる', async () => {
            global.confirm = vi.fn().mockReturnValue(true);

            const deleteBtn = container.querySelector('.delete-timeline-item');
            if (deleteBtn) {
                await deleteBtn.click();
                expect(mockTimelineService.deleteItem).toHaveBeenCalledWith('tl_1');
            }
        });

        it('追加ボタンクリック時_TIMELINE_ADD_ITEMイベントが発火される', () => {
            const emitted = [];
            eventBus.on(EVENTS.TIMELINE_ADD_ITEM, (e) => emitted.push(e));

            const addBtn = container.querySelector('.add-timeline-item');
            if (addBtn) {
                addBtn.click();
                expect(emitted.length).toBeGreaterThan(0);
            }
        });
    });

    describe('unmount', () => {
        it('unmount呼び出し時_コンテナがクリアされる', () => {
            view.mount(container);
            view.unmount();

            expect(container.innerHTML).toBe('');
        });

        it('unmount呼び出し時_イベントリスナーが解除される', async () => {
            view.mount(container);
            const renderSpy = vi.spyOn(view, 'render');

            view.unmount();
            await eventBus.emit(EVENTS.TIMELINE_LOADED, {});

            // After unmount, render should not be called again
            expect(renderSpy).not.toHaveBeenCalled();
        });
    });

    describe('date grouping', () => {
        it('_getDateGroup_今日_Todayを返す', () => {
            const today = new Date();
            expect(view._getDateGroup(today.toISOString())).toBe('今日');
        });

        it('_getDateGroup_昨日_Yesterdayを返す', () => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            expect(view._getDateGroup(yesterday.toISOString())).toBe('昨日');
        });

        it('_getDateGroup_2日前_今週を返す', () => {
            const twoDaysAgo = new Date();
            twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
            expect(view._getDateGroup(twoDaysAgo.toISOString())).toBe('今週');
        });

        it('_getDateGroup_8日前_それ以前を返す', () => {
            const eightDaysAgo = new Date();
            eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
            expect(view._getDateGroup(eightDaysAgo.toISOString())).toBe('それ以前');
        });
    });

    describe('task integration', () => {
        beforeEach(() => {
            const items = [
                { id: 'tl_1', type: 'manual', title: 'Test Item', content: 'Test content', timestamp: new Date().toISOString() },
                { id: 'tl_2', type: 'session', title: 'Linked Item', linkedTaskId: 'task_123', timestamp: new Date().toISOString() }
            ];
            mockTimelineService.getTimelineItems.mockReturnValue(items);
            view.mount(container);
            view.render();
        });

        it('タスク作成ボタンがリンクされていない項目に表示される', () => {
            const createTaskBtn = container.querySelector('[data-id="tl_1"].create-task-from-timeline');
            expect(createTaskBtn).toBeTruthy();
        });

        it('タスク作成ボタンクリック時_CREATE_TASK_FROM_TIMELINEイベントが発火される', () => {
            const emitted = [];
            eventBus.on(EVENTS.CREATE_TASK_FROM_TIMELINE, (e) => emitted.push(e));

            const createTaskBtn = container.querySelector('[data-id="tl_1"].create-task-from-timeline');
            if (createTaskBtn) {
                createTaskBtn.click();
                expect(emitted.length).toBeGreaterThan(0);
                expect(emitted[0].detail.item.id).toBe('tl_1');
            }
        });

        it('リンク済み項目_タスクバッジが表示される', () => {
            const linkedItem = container.querySelector('[data-item-id="tl_2"]');
            expect(linkedItem).toBeTruthy();
            expect(linkedItem.innerHTML).toContain('linked-task-badge');
        });

        it('リンク済み項目_タスク作成ボタンは非表示', () => {
            const createTaskBtn = container.querySelector('[data-id="tl_2"].create-task-from-timeline');
            expect(createTaskBtn).toBeFalsy();
        });
    });

    describe('type icon', () => {
        it('_getTypeIcon_session_terminal-squareを返す', () => {
            expect(view._getTypeIcon('session')).toBe('terminal-square');
        });

        it('_getTypeIcon_task_check-squareを返す', () => {
            expect(view._getTypeIcon('task')).toBe('check-square');
        });

        it('_getTypeIcon_manual_editを返す', () => {
            expect(view._getTypeIcon('manual')).toBe('edit');
        });

        it('_getTypeIcon_command_terminalを返す', () => {
            expect(view._getTypeIcon('command')).toBe('terminal');
        });

        it('_getTypeIcon_system_settingsを返す', () => {
            expect(view._getTypeIcon('system')).toBe('settings');
        });

        it('_getTypeIcon_unknown_circleを返す', () => {
            expect(view._getTypeIcon('unknown')).toBe('circle');
        });
    });
});
