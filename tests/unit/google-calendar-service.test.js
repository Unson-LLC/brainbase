import { describe, expect, it, vi } from 'vitest';

import { GoogleCalendarService } from '../../server/services/google-calendar-service.js';

function createExecFileMock(handlers) {
    return vi.fn(async (_command, args) => {
        const key = args.join(' ');
        if (!(key in handlers)) {
            throw new Error(`Unexpected command: ${key}`);
        }

        const result = handlers[key];
        if (result instanceof Error) {
            throw result;
        }

        return {
            stdout: typeof result === 'string' ? result : JSON.stringify(result),
            stderr: ''
        };
    });
}

describe('GoogleCalendarService', () => {
    it('getAuthStatus呼び出し時_gog未導入_missing_binaryを返す', async () => {
        const service = new GoogleCalendarService({
            execFileImpl: vi.fn(async () => {
                throw new Error('gog not found');
            })
        });

        const status = await service.getAuthStatus();

        expect(status.installed).toBe(false);
        expect(status.connected).toBe(false);
        expect(status.reason).toBe('missing_binary');
    });

    it('getAuthStatus呼び出し時_credentials未設定_no_credentialsを返す', async () => {
        const execFileMock = createExecFileMock({
            '--version': 'v0.9.0',
            'auth status --json --no-input': {
                account: {
                    credentials_exists: false,
                    email: ''
                }
            }
        });
        const service = new GoogleCalendarService({ execFileImpl: execFileMock });

        const status = await service.getAuthStatus();

        expect(status.installed).toBe(true);
        expect(status.connected).toBe(false);
        expect(status.reason).toBe('no_credentials');
    });

    it('getAuthStatus呼び出し時_default accountあり_readyを返す', async () => {
        const execFileMock = createExecFileMock({
            '--version': 'v0.9.0',
            'auth status --json --no-input': {
                account: {
                    credentials_exists: true,
                    email: 'gyaru@example.com'
                }
            }
        });
        const service = new GoogleCalendarService({ execFileImpl: execFileMock });

        const status = await service.getAuthStatus();

        expect(status.connected).toBe(true);
        expect(status.defaultAccount).toBe('gyaru@example.com');
        expect(status.reason).toBe('ready');
    });

    it('listEventsForDate呼び出し時_timedとall-dayを正規化する', async () => {
        const execFileMock = createExecFileMock({
            '--version': 'v0.9.0',
            'auth status --json --no-input': {
                account: {
                    credentials_exists: true,
                    email: 'gyaru@example.com'
                }
            },
            'calendar events primary --from 2026-03-21 --to 2026-03-22 --json --no-input --max 200': {
                items: [
                    {
                        id: 'evt-1',
                        summary: '定例MTG',
                        start: { dateTime: '2026-03-21T10:00:00+09:00' },
                        end: { dateTime: '2026-03-21T11:00:00+09:00' },
                        attendees: [
                            {
                                email: 'sato@example.com',
                                responseStatus: 'accepted',
                                organizer: true
                            },
                            {
                                displayName: '田中',
                                email: 'tanaka@example.com',
                                responseStatus: 'needsAction'
                            },
                            {
                                responseStatus: 'accepted'
                            }
                        ]
                    },
                    {
                        id: 'evt-2',
                        summary: '祝日',
                        start: { date: '2026-03-21' },
                        end: { date: '2026-03-22' }
                    }
                ]
            }
        });
        const service = new GoogleCalendarService({ execFileImpl: execFileMock });

        const events = await service.listEventsForDate('2026-03-21');

        expect(events).toHaveLength(2);
        expect(events[0]).toEqual(expect.objectContaining({
            title: '祝日',
            allDay: true,
            source: 'google-calendar'
        }));
        expect(events[1]).toEqual(expect.objectContaining({
            title: '定例MTG',
            start: '10:00',
            end: '11:00',
            startDateTime: '2026-03-21T10:00:00+09:00',
            endDateTime: '2026-03-21T11:00:00+09:00',
            calendarEventId: 'evt-1',
            calendarId: 'primary',
            attendees: [
                {
                    email: 'sato@example.com',
                    responseStatus: 'accepted',
                    organizer: true
                },
                {
                    displayName: '田中',
                    email: 'tanaka@example.com',
                    responseStatus: 'needsAction'
                }
            ]
        }));
    });

    it('story-meeting-workflow-calendar-input-v1 S-003 S-004 listEvents呼び出し時_accountと会議入力情報を正規化する', async () => {
        const execFileMock = createExecFileMock({
            '--version': 'v0.9.0',
            'auth status --json --no-input': {
                account: {
                    credentials_exists: true,
                    email: 'gyaru@example.com'
                }
            },
            'calendar events primary --from 2026-06-22T00:00:00+09:00 --to 2026-06-23T00:00:00+09:00 --json --no-input --max 200 --account k.sato@sales-tailor.jp': {
                items: [
                    {
                        id: 'evt-3',
                        iCalUID: 'uid-3@example.com',
                        summary: '商談準備MTG',
                        description: '事前確認 https://meet.google.com/abc-defg-hij',
                        location: 'オンライン',
                        htmlLink: 'https://calendar.google.com/event?eid=evt-3',
                        organizer: {
                            email: 'owner@example.com',
                            displayName: 'Owner'
                        },
                        start: { dateTime: '2026-06-22T14:00:00+09:00' },
                        end: { dateTime: '2026-06-22T14:30:00+09:00' },
                        attendees: [
                            { email: 'sato@example.com', responseStatus: 'accepted' }
                        ]
                    }
                ]
            }
        });
        const service = new GoogleCalendarService({ execFileImpl: execFileMock });

        const events = await service.listEvents({
            from: '2026-06-22T00:00:00+09:00',
            to: '2026-06-23T00:00:00+09:00',
            account: 'k.sato@sales-tailor.jp'
        });

        expect(events).toEqual([
            expect.objectContaining({
                id: 'gcal:primary:evt-3',
                calendarEventId: 'evt-3',
                iCalUID: 'uid-3@example.com',
                account: 'k.sato@sales-tailor.jp',
                title: '商談準備MTG',
                start: '14:00',
                end: '14:30',
                startDateTime: '2026-06-22T14:00:00+09:00',
                endDateTime: '2026-06-22T14:30:00+09:00',
                description: '事前確認 https://meet.google.com/abc-defg-hij',
                location: 'オンライン',
                htmlLink: 'https://calendar.google.com/event?eid=evt-3',
                conferenceUrl: 'https://meet.google.com/abc-defg-hij',
                organizer: {
                    email: 'owner@example.com',
                    displayName: 'Owner'
                },
                attendees: [
                    {
                        email: 'sato@example.com',
                        responseStatus: 'accepted'
                    }
                ]
            })
        ]);
    });

    it('story-meeting-workflow-calendar-input-v1 FM-003 listEventsWithDiagnostics呼び出し時_calendar単位の失敗をskippedCalendarsへ残す', async () => {
        const execFileMock = createExecFileMock({
            '--version': 'v0.9.0',
            'auth status --json --no-input': {
                account: {
                    credentials_exists: true,
                    email: 'gyaru@example.com'
                }
            },
            'calendar events primary --from 2026-06-22T00:00:00+09:00 --to 2026-06-23T00:00:00+09:00 --json --no-input --max 200 --account k.sato@sales-tailor.jp': {
                items: [
                    {
                        id: 'evt-ok',
                        summary: '取得できたMTG',
                        start: { dateTime: '2026-06-22T10:00:00+09:00' },
                        end: { dateTime: '2026-06-22T11:00:00+09:00' }
                    }
                ]
            },
            'calendar events team --from 2026-06-22T00:00:00+09:00 --to 2026-06-23T00:00:00+09:00 --json --no-input --max 200 --account k.sato@sales-tailor.jp': new Error('calendar forbidden')
        });
        const service = new GoogleCalendarService({
            calendarIds: ['primary', 'team'],
            execFileImpl: execFileMock
        });

        const result = await service.listEventsWithDiagnostics({
            from: '2026-06-22T00:00:00+09:00',
            to: '2026-06-23T00:00:00+09:00',
            account: 'k.sato@sales-tailor.jp'
        });

        expect(result.events).toEqual([
            expect.objectContaining({
                calendarEventId: 'evt-ok',
                title: '取得できたMTG'
            })
        ]);
        expect(result.skippedCalendars).toEqual([
            {
                calendar_id: 'team',
                reason: 'calendar_fetch_failed',
                message: 'calendar forbidden'
            }
        ]);
    });
});
