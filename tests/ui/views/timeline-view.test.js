import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TimelineView } from '../../../public/modules/ui/views/timeline-view.js';
import { ScheduleService } from '../../../public/modules/domain/schedule/schedule-service.js';
import { eventBus, EVENTS } from '../../../public/modules/core/event-bus.js';
import { appStore } from '../../../public/modules/core/store.js';

// ScheduleServiceをモック化
vi.mock('../../../public/modules/domain/schedule/schedule-service.js', () => {
    return {
        ScheduleService: class MockScheduleService {
            constructor() {
                this.loadSchedule = vi.fn();
                this.getTimeline = vi.fn(() => []);
                this.getEvents = vi.fn(() => []);
                this.getGoogleCalendarAuthStatus = vi.fn().mockResolvedValue({
                    provider: 'gog',
                    configured: true,
                    installed: false,
                    connected: false,
                    defaultAccount: null,
                    calendarIds: ['primary'],
                    reason: 'missing_binary',
                    setupCommands: ['brew install steipete/tap/gogcli']
                });
            }
        }
    };
});

describe('TimelineView', () => {
    let timelineView;
    let mockScheduleService;
    let container;

    beforeEach(() => {
        // DOM準備
        document.body.innerHTML = `
            <button id="google-calendar-connect-btn"></button>
            <div id="google-calendar-diagnostics" hidden></div>
            <button id="add-schedule-btn"></button>
            <div id="test-container"></div>
        `;
        container = document.getElementById('test-container');

        // モックサービス
        mockScheduleService = new ScheduleService();
        timelineView = new TimelineView({ scheduleService: mockScheduleService });

        // ストア初期化
        appStore.setState({
            schedule: { items: [] }
        });

        vi.clearAllMocks();
    });

    describe('mount', () => {
        it('should mount to container element', () => {
            timelineView.mount(container);

            expect(timelineView.container).toBe(container);
        });

        it('should render on mount', () => {
            const mockEvents = [
                { start: '10:00', end: '11:00', title: 'Meeting' }
            ];
            mockScheduleService.getTimeline.mockReturnValue(mockEvents);

            timelineView.mount(container);

            expect(container.innerHTML).not.toBe('');
        });
    });

    describe('render', () => {
        beforeEach(() => {
            timelineView.mount(container);
        });

        it('should display empty state when no events', () => {
            mockScheduleService.getTimeline.mockReturnValue([]);

            timelineView.render();

            expect(container.innerHTML).toContain('予定なし');
        });

        it('should render timeline events', () => {
            const mockEvents = [
                { start: '10:00', end: '11:00', title: 'Meeting 1' },
                { start: '14:00', end: '15:00', title: 'Meeting 2' }
            ];
            mockScheduleService.getTimeline.mockReturnValue(mockEvents);

            timelineView.render();

            expect(container.innerHTML).toContain('Meeting 1');
            expect(container.innerHTML).toContain('Meeting 2');
        });

        it('should display current time marker', () => {
            const mockEvents = [
                { start: '10:00', end: '11:00', title: 'Past Meeting' },
                { start: '23:00', end: '23:59', title: 'Future Meeting' }
            ];
            mockScheduleService.getTimeline.mockReturnValue(mockEvents);

            timelineView.render();

            expect(container.innerHTML).toContain('現在');
        });

        it('should highlight current event', () => {
            // Mock current time to be 10:30
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2025-12-22T10:30:00'));

            const mockEvents = [
                { start: '10:00', end: '11:00', title: 'Current Meeting' },
                { start: '14:00', end: '15:00', title: 'Future Meeting' }
            ];
            mockScheduleService.getTimeline.mockReturnValue(mockEvents);

            timelineView.render();

            const currentEvent = container.querySelector('.is-current');
            expect(currentEvent).toBeTruthy();
            expect(currentEvent.textContent).toContain('Current Meeting');

            vi.useRealTimers();
        });

        it('should display all-day events', () => {
            const mockEvents = [
                { allDay: true, title: 'All Day Event' }
            ];
            mockScheduleService.getTimeline.mockReturnValue(mockEvents);

            timelineView.render();

            expect(container.innerHTML).toContain('終日');
            expect(container.innerHTML).toContain('All Day Event');
        });

        it('should display work time events with special class', () => {
            const mockEvents = [
                { start: '10:00', end: '11:00', title: 'Work Session', isWorkTime: true }
            ];
            mockScheduleService.getTimeline.mockReturnValue(mockEvents);

            timelineView.render();

            const workTimeElement = container.querySelector('.is-worktime');
            expect(workTimeElement).toBeTruthy();
        });

        it('should display today tasks section', () => {
            const mockEvents = [
                { isTask: true, task: 'Complete report' },
                { isTask: true, task: 'Review code' }
            ];
            mockScheduleService.getTimeline.mockReturnValue(mockEvents);

            timelineView.render();

            expect(container.innerHTML).toContain('今日のタスク');
            expect(container.innerHTML).toContain('Complete report');
            expect(container.innerHTML).toContain('Review code');
        });

        it('should render google calendar badge for imported events', () => {
            const mockEvents = [
                { id: 'gcal:primary:1', start: '10:00', end: '11:00', title: 'Google Meeting', source: 'google-calendar' }
            ];
            mockScheduleService.getEvents.mockReturnValue(mockEvents);

            timelineView.render();

            expect(container.innerHTML).toContain('Google Meeting');
            expect(container.innerHTML).toContain('timeline-source-badge');
            expect(container.querySelector('.is-google-calendar')).toBeTruthy();
        });
    });

    describe('google calendar auth controls', () => {
        beforeEach(() => {
            timelineView.mount(container);
        });

        it('should show diagnostics when google calendar is not ready', async () => {
            mockScheduleService.getGoogleCalendarAuthStatus.mockResolvedValue({
                provider: 'gog',
                configured: true,
                installed: false,
                connected: false,
                defaultAccount: null,
                calendarIds: ['primary'],
                reason: 'missing_binary',
                setupCommands: ['brew install steipete/tap/gogcli']
            });

            await timelineView._refreshGoogleCalendarAuthStatus(true);
            await timelineView._handleGoogleCalendarButtonClick({ preventDefault() {} });

            const diagnostics = document.getElementById('google-calendar-diagnostics');
            expect(diagnostics.hidden).toBe(false);
            expect(diagnostics.textContent).toContain('gog が見つからない');
            expect(diagnostics.textContent).toContain('brew install steipete/tap/gogcli');
        });

        it('should refresh schedule when diagnostics refresh succeeds', async () => {
            mockScheduleService.getGoogleCalendarAuthStatus.mockResolvedValue({
                provider: 'gog',
                configured: true,
                installed: true,
                connected: true,
                defaultAccount: 'gyaru@example.com',
                calendarIds: ['primary'],
                reason: 'ready',
                setupCommands: []
            });

            await timelineView._refreshGoogleCalendarAuthStatus(true);
            await timelineView._handleGoogleCalendarButtonClick({ preventDefault() {} });
            await timelineView._handleGoogleCalendarDiagnosticsClick({
                preventDefault() {},
                target: document.getElementById('google-calendar-diagnostics').querySelector('#google-calendar-refresh-btn')
            });

            expect(mockScheduleService.loadSchedule).toHaveBeenCalled();
        });
    });

    describe('event subscriptions', () => {
        beforeEach(() => {
            timelineView.mount(container);
        });

        it('should re-render on SCHEDULE_LOADED event', () => {
            const renderSpy = vi.spyOn(timelineView, 'render');

            eventBus.emit(EVENTS.SCHEDULE_LOADED, { items: [] });

            expect(renderSpy).toHaveBeenCalled();
        });

        it('should re-render on SCHEDULE_UPDATED event', () => {
            const renderSpy = vi.spyOn(timelineView, 'render');

            eventBus.emit(EVENTS.SCHEDULE_UPDATED, { items: [] });

            expect(renderSpy).toHaveBeenCalled();
        });
    });
});
