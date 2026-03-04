import { describe, it, expect, beforeEach } from 'vitest';
import { KiroScheduleParser } from '../../lib/kiro-schedule-parser.js';

describe('KiroScheduleParser', () => {
    let parser;

    beforeEach(() => {
        parser = new KiroScheduleParser();
    });

    describe('parseEvent', () => {
        it('時間付きイベント行をパースできる', () => {
            const line = '- [ ] 10:00-11:00 定例MTG';
            const result = parser.parseEvent(line);

            expect(result).not.toBeNull();
            expect(result.start).toBe('10:00');
            expect(result.end).toBe('11:00');
            expect(result.title).toBe('定例MTG');
            expect(result.completed).toBe(false);
        });

        it('完了済みイベントをパースできる', () => {
            const line = '- [x] 09:00-09:30 朝会';
            const result = parser.parseEvent(line);

            expect(result).not.toBeNull();
            expect(result.completed).toBe(true);
        });

        it('終了時間なしのイベントをパースできる', () => {
            const line = '- [ ] 14:00 クライアント来訪';
            const result = parser.parseEvent(line);

            expect(result).not.toBeNull();
            expect(result.start).toBe('14:00');
            expect(result.end).toBeNull();
            expect(result.title).toBe('クライアント来訪');
        });

        it('時間のない行はnullを返す', () => {
            const line = '- [ ] 買い物';
            const result = parser.parseEvent(line);

            expect(result).toBeNull();
        });
    });

    describe('parseMetadata', () => {
        it('メタデータ行をパースできる', () => {
            const line = '  - _ID: event-123_';
            const result = parser.parseMetadata(line);

            expect(result).toEqual({ ID: 'event-123' });
        });

        it('Source メタデータをパースできる', () => {
            const line = '  - _Source: google-calendar_';
            const result = parser.parseMetadata(line);

            expect(result).toEqual({ Source: 'google-calendar' });
        });

        it('CalendarId メタデータをパースできる', () => {
            const line = '  - _CalendarId: primary_';
            const result = parser.parseMetadata(line);

            expect(result).toEqual({ CalendarId: 'primary' });
        });
    });

    describe('parseFile', () => {
        it('複数イベントをパースできる', () => {
            const content = `- [ ] 10:00-11:00 定例MTG
  - _ID: event-1_
  - _Source: google-calendar_
- [x] 14:00-15:00 打ち合わせ
  - _ID: event-2_
  - _Source: manual_`;

            const events = parser.parseFile(content);

            expect(events).toHaveLength(2);
            expect(events[0].id).toBe('event-1');
            expect(events[0].start).toBe('10:00');
            expect(events[0].end).toBe('11:00');
            expect(events[0].title).toBe('定例MTG');
            expect(events[0].source).toBe('google-calendar');
            expect(events[0].completed).toBe(false);

            expect(events[1].id).toBe('event-2');
            expect(events[1].completed).toBe(true);
            expect(events[1].source).toBe('manual');
        });

        it('空のコンテンツは空配列を返す', () => {
            const events = parser.parseFile('');
            expect(events).toEqual([]);
        });

        it('CalendarId を含むイベントをパースできる', () => {
            const content = `- [ ] 10:00-11:00 会議
  - _ID: event-1_
  - _Source: google-calendar_
  - _CalendarId: work@example.com_`;

            const events = parser.parseFile(content);

            expect(events[0].calendarId).toBe('work@example.com');
        });
    });

    describe('serializeEvent', () => {
        it('イベントをMarkdown形式にシリアライズできる', () => {
            const event = {
                id: 'event-123',
                start: '10:00',
                end: '11:00',
                title: '定例MTG',
                source: 'google-calendar',
                calendarId: 'primary',
                completed: false
            };

            const result = parser.serializeEvent(event);

            expect(result).toContain('- [ ] 10:00-11:00 定例MTG');
            expect(result).toContain('_ID: event-123_');
            expect(result).toContain('_Source: google-calendar_');
            expect(result).toContain('_CalendarId: primary_');
        });

        it('完了済みイベントは[x]でシリアライズされる', () => {
            const event = {
                id: 'event-123',
                start: '10:00',
                end: '11:00',
                title: '定例MTG',
                source: 'manual',
                completed: true
            };

            const result = parser.serializeEvent(event);

            expect(result).toContain('- [x] 10:00-11:00 定例MTG');
        });

        it('終了時間なしのイベントをシリアライズできる', () => {
            const event = {
                id: 'event-123',
                start: '14:00',
                end: null,
                title: 'クライアント来訪',
                source: 'manual',
                completed: false
            };

            const result = parser.serializeEvent(event);

            expect(result).toContain('- [ ] 14:00 クライアント来訪');
        });

        it('CalendarIdがない場合は出力しない', () => {
            const event = {
                id: 'event-123',
                start: '10:00',
                end: '11:00',
                title: '定例MTG',
                source: 'manual',
                completed: false
            };

            const result = parser.serializeEvent(event);

            expect(result).not.toContain('CalendarId');
        });
    });

    describe('generateId', () => {
        it('event-プレフィックス付きのIDを生成する', () => {
            const id = parser.generateId();

            expect(id).toMatch(/^event-\d+$/);
        });

        it('連続呼び出しでユニークなIDを生成する', () => {
            const id1 = parser.generateId();
            const id2 = parser.generateId();
            const id3 = parser.generateId();

            expect(id1).not.toBe(id2);
            expect(id2).not.toBe(id3);
        });
    });

    describe('findEventById', () => {
        it('IDでイベントを検索できる', () => {
            const content = `- [ ] 10:00-11:00 定例MTG
  - _ID: event-1_
  - _Source: google-calendar_
- [ ] 14:00-15:00 打ち合わせ
  - _ID: event-2_
  - _Source: manual_`;

            const result = parser.findEventById(content, 'event-2');

            expect(result).not.toBeNull();
            expect(result.event.id).toBe('event-2');
            expect(result.startLine).toBe(3); // 0-indexed
        });

        it('存在しないIDはnullを返す', () => {
            const content = `- [ ] 10:00-11:00 定例MTG
  - _ID: event-1_`;

            const result = parser.findEventById(content, 'event-999');

            expect(result).toBeNull();
        });
    });

    describe('removeEvent', () => {
        it('イベントを削除できる', () => {
            const content = `- [ ] 10:00-11:00 定例MTG
  - _ID: event-1_
  - _Source: google-calendar_
- [ ] 14:00-15:00 打ち合わせ
  - _ID: event-2_
  - _Source: manual_`;

            const result = parser.removeEvent(content, 'event-1');

            expect(result.removedEvent).not.toBeNull();
            expect(result.content).not.toContain('event-1');
            expect(result.content).toContain('event-2');
        });
    });

    describe('appendEvent', () => {
        it('イベントを追加できる', () => {
            const content = `- [ ] 10:00-11:00 定例MTG
  - _ID: event-1_
  - _Source: manual_`;

            const newEvent = {
                id: 'event-2',
                start: '14:00',
                end: '15:00',
                title: '打ち合わせ',
                source: 'google-calendar',
                completed: false
            };

            const result = parser.appendEvent(content, newEvent);

            expect(result).toContain('event-1');
            expect(result).toContain('event-2');
            expect(result).toContain('14:00-15:00 打ち合わせ');
        });
    });

    describe('isDuplicate', () => {
        it('同じイベントを重複として検出できる', () => {
            const existingEvents = [
                { id: 'event-1', start: '10:00', title: '定例MTG', source: 'google-calendar', calendarId: 'primary' }
            ];

            const newEvent = {
                start: '10:00',
                title: '定例MTG',
                source: 'google-calendar',
                calendarId: 'primary'
            };

            expect(parser.isDuplicate(existingEvents, newEvent)).toBe(true);
        });

        it('異なるイベントは重複ではない', () => {
            const existingEvents = [
                { id: 'event-1', start: '10:00', title: '定例MTG', source: 'google-calendar', calendarId: 'primary' }
            ];

            const newEvent = {
                start: '14:00',
                title: '打ち合わせ',
                source: 'google-calendar',
                calendarId: 'primary'
            };

            expect(parser.isDuplicate(existingEvents, newEvent)).toBe(false);
        });

        it('手動イベントは重複チェックしない', () => {
            const existingEvents = [
                { id: 'event-1', start: '10:00', title: '定例MTG', source: 'manual' }
            ];

            const newEvent = {
                start: '10:00',
                title: '定例MTG',
                source: 'google-calendar',
                calendarId: 'primary'
            };

            expect(parser.isDuplicate(existingEvents, newEvent)).toBe(false);
        });
    });
});
