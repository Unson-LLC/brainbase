import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScheduleParser } from '../../lib/schedule-parser.js';

describe('ScheduleParser', () => {
    let tempDir;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'brainbase-schedule-parser-'));
    });

    afterEach(async () => {
        if (tempDir) {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });

    it('Google Calendarイベントをローカル予定へマージする', async () => {
        const parser = new ScheduleParser(tempDir, {
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
                        completed: false
                    }
                ])
            }
        });

        await fs.writeFile(path.join(tempDir, '2026-03-17.md'), '10:00 - 11:00 開発\n', 'utf-8');

        const schedule = await parser.getSchedule('2026-03-17');

        expect(schedule.items).toHaveLength(2);
        expect(schedule.items[0]).toEqual(expect.objectContaining({
            task: '朝会',
            source: 'google-calendar'
        }));
        expect(schedule.items[1]).toEqual(expect.objectContaining({
            task: '開発'
        }));
    });

    it('Google Calendarイベントだけでも予定を返す', async () => {
        const parser = new ScheduleParser(tempDir, {
            googleCalendarService: {
                isConfigured: () => true,
                listEventsForDate: vi.fn().mockResolvedValue([
                    {
                        id: 'gcal:primary:event-2',
                        start: null,
                        end: null,
                        title: '祝日',
                        source: 'google-calendar',
                        calendarId: 'primary',
                        completed: false,
                        allDay: true
                    }
                ])
            }
        });

        const schedule = await parser.getSchedule('2026-03-17');

        expect(schedule.events).toHaveLength(1);
        expect(schedule.events[0]).toEqual(expect.objectContaining({
            title: '祝日',
            allDay: true
        }));
        expect(schedule.items[0]).toEqual(expect.objectContaining({
            task: '祝日',
            allDay: true
        }));
    });
});
