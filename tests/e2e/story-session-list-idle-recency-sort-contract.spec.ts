import { expect, test } from '@playwright/test';
// @ts-ignore - pure JS island helper (no DOM / no /modules import)
import { orderTimelineSessions, sessionSortTimestamp, __resetStickyForTests } from '../../ui-islands/session-list/sessionOrder.js';

/**
 * Story acceptance coverage for story-session-list-idle-recency-sort.
 *
 * 島(session-list)の timeline ソートで、idle(無印) セッションが存在しない lastActivityAt →
 * ISO 文字列 createdAt に落ちて文字列比較が NaN になり時系列が無視されていた退行を、純粋ヘルパ
 * sessionSortTimestamp / orderTimelineSessions(deriveUi 注入)で検証する。
 * 純 node コンテキスト、ブラウザ未使用。
 */

const ids = (arr: Array<{ id: string }>) => arr.map((s) => s.id);
const idleUi = () => ({ hookStatus: null, activity: 'idle' });
const deriveIdle = () => idleUi();
const working = (ts: number) => ({ hookStatus: { state: 'running', liveActivity: { updatedAt: ts } } });
const done = (ts: number) => ({ hookStatus: { state: 'done-unread', lastDoneAt: ts } });
const idle = () => ({ hookStatus: { state: 'idle' }, activity: 'idle' });
const mk = (fixtures: Record<string, any>) => (id: string) => fixtures[id] || { hookStatus: null, activity: 'idle' };

test.describe('story-session-list-idle-recency-sort e2e contract', () => {
    test.beforeEach(() => __resetStickyForTests());

    test('story-session-list-idle-recency-sort ac:1 idle(無印) セッションは直近活動時刻の降順(時系列)で並ぶ', () => {
        // createdAt が ISO 文字列でも、直近活動時刻の降順で並ぶ(挿入順固定にならない)
        const list = [
            { id: 'old', createdAt: '2026-05-01T00:00:00.000Z' },
            { id: 'new', createdAt: '2026-06-01T00:00:00.000Z' },
            { id: 'mid', createdAt: '2026-05-15T00:00:00.000Z' }
        ];
        const out = ids(orderTimelineSessions(list, null, deriveIdle));
        expect(out, 'idle(無印) セッションは直近活動時刻の降順(時系列)で並ぶ').toEqual(['new', 'mid', 'old']);
    });

    test('story-session-list-idle-recency-sort ac:2 sessionSortTimestamp は ISO 文字列の createdAt を epoch ミリ秒の数値で返す', () => {
        const ts = sessionSortTimestamp({ createdAt: '2026-06-01T02:09:00.000Z' }, idleUi());
        expect(typeof ts, 'sessionSortTimestamp は ISO 文字列の createdAt を epoch ミリ秒の数値で返す').toBe('number');
        expect(ts).toBe(Date.parse('2026-06-01T02:09:00.000Z'));
    });

    test('story-session-list-idle-recency-sort ac:3 idle セッションは createdAt より埋め込み hookStatus の直近活動時刻を優先する', () => {
        const recentTs = Date.parse('2026-06-01T02:00:00.000Z');
        const staleTs = Date.parse('2026-05-20T00:00:00.000Z');
        const list = [
            // 作成は新しいが活動は古い
            { id: 'fresh', createdAt: '2026-05-30T00:00:00.000Z', hookStatus: { lastActivityAt: staleTs } },
            // 作成は古いが直近まで稼働
            { id: 'recent', createdAt: '2026-03-01T00:00:00.000Z', hookStatus: { lastWorkingAt: recentTs } }
        ];
        const out = ids(orderTimelineSessions(list, null, deriveIdle));
        expect(out, 'idle セッションは createdAt より埋め込み hookStatus の直近活動時刻を優先する').toEqual(['recent', 'fresh']);
    });

    test('story-session-list-idle-recency-sort ac:4 既存の優先度tier(作業中>完了>idle)と sticky-done と favorite-first は不変', () => {
        // tier: 作業中 > 完了未読 > idle
        const tier = ids(orderTimelineSessions(
            [{ id: 'c' }, { id: 'b' }, { id: 'a' }], null,
            mk({ a: working(100), b: done(90), c: idle() })
        ));
        expect(tier, '優先度tier(作業中>完了>idle)は不変').toEqual(['a', 'b', 'c']);

        // sticky-done: 完了→既読(idle)でも完了枠に留まる
        const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        orderTimelineSessions(list, null, mk({ a: working(900), b: done(500), c: idle() }));
        const sticky = ids(orderTimelineSessions(list, null, mk({ a: working(900), b: idle(), c: idle() })));
        expect(sticky, 'sticky-done は不変').toEqual(['a', 'b', 'c']);

        // favorite-first
        __resetStickyForTests();
        const fav = ids(orderTimelineSessions(
            [{ id: 'work' }, { id: 'fav', favorite: true }], null,
            mk({ work: working(900), fav: idle() })
        ));
        expect(fav, 'favorite-first は不変').toEqual(['fav', 'work']);
    });
});
