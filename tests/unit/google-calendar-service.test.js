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
                        end: { dateTime: '2026-03-21T11:00:00+09:00' }
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
            calendarId: 'primary'
        }));
    });
});
