import { describe, expect, it, vi } from 'vitest';

import { ScheduleParser } from '../../lib/schedule-parser.js';

describe('ScheduleParser', () => {
    it('Google Calendarイベントを予定として返す', async () => {
        const parser = new ScheduleParser({
            googleCalendarService: {
                isConfigured: () => true,
                listEventsForDate: vi.fn().mockResolvedValue([
                    {
                        id: 'gcal:primary:event-1',
                        start: '09:00',
                        end: '10:00',
                        title: '朝会',
                        source: 'google-calendar',
                        calendarId: 'primary',
                        completed: false,
                        attendees: [
                            { email: 'sato@example.com', responseStatus: 'accepted' }
                        ]
                    }
                ])
            }
        });

        const schedule = await parser.getSchedule('2026-03-17');

        expect(schedule.events).toHaveLength(1);
        expect(schedule.items).toHaveLength(1);
        expect(schedule.items[0]).toEqual(expect.objectContaining({
            task: '朝会',
            source: 'google-calendar',
            attendees: [
                { email: 'sato@example.com', responseStatus: 'accepted' }
            ]
        }));
    });

    it('終日イベントを時間指定イベントより先頭に並べる', async () => {
        const parser = new ScheduleParser({
            googleCalendarService: {
                isConfigured: () => true,
                listEventsForDate: vi.fn().mockResolvedValue([
                    {
                        id: 'gcal:primary:event-1',
                        start: '09:00',
                        end: '10:00',
                        title: '朝会',
                        source: 'google-calendar',
                        calendarId: 'primary'
                    },
                    {
                        id: 'gcal:primary:event-2',
                        start: null,
                        end: null,
                        title: '祝日',
                        source: 'google-calendar',
                        calendarId: 'primary',
                        allDay: true
                    }
                ])
            }
        });

        const schedule = await parser.getSchedule('2026-03-17');

        expect(schedule.events.map((e) => e.title)).toEqual(['祝日', '朝会']);
        expect(schedule.items[0]).toEqual(expect.objectContaining({
            task: '祝日',
            allDay: true
        }));
    });

    it('Google Calendar未設定なら空の予定を返す', async () => {
        const parser = new ScheduleParser();

        const schedule = await parser.getSchedule('2026-03-17');

        expect(schedule).toEqual(expect.objectContaining({
            date: '2026-03-17',
            events: [],
            items: [],
            raw: null,
            message: 'No schedule for this date'
        }));
    });

    it('Google Calendar取得に失敗しても空の予定でフォールバックする', async () => {
        const parser = new ScheduleParser({
            googleCalendarService: {
                isConfigured: () => true,
                listEventsForDate: vi.fn().mockRejectedValue(new Error('gog not installed'))
            }
        });

        const schedule = await parser.getSchedule('2026-03-17');

        expect(schedule.events).toEqual([]);
        expect(schedule.items).toEqual([]);
    });
});
