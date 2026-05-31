import { expect, test } from '@playwright/test';
// @ts-ignore - pure JS island helper (no DOM / no /modules import)
import { orderTimelineSessions, __resetStickyForTests } from '../../ui-islands/session-list/sessionOrder.js';

/**
 * Story acceptance coverage for story-session-list-sticky-sort.
 *
 * 島(session-list)の timeline ソートに sticky-done 機構を復元したことを、純粋ヘルパ
 * orderTimelineSessions(deriveUi 注入)で検証する。島の SessionList.jsx /
 * SessionListMobile.jsx は本ヘルパをそのまま使う(同一ロジック)。
 * 純 node コンテキスト、ブラウザ未使用。
 */

const mk = (fixtures: Record<string, any>) => (id: string) => fixtures[id] || { hookStatus: null, activity: 'idle' };
const ids = (arr: Array<{ id: string }>) => arr.map((s) => s.id);
const working = (ts: number) => ({ hookStatus: { state: 'running', liveActivity: { updatedAt: ts } } });
const done = (ts: number) => ({ hookStatus: { state: 'done-unread', lastDoneAt: ts } });
const idle = () => ({ hookStatus: { state: 'idle' }, activity: 'idle' });

test.describe('story-session-list-sticky-sort e2e contract', () => {
    test.beforeEach(() => __resetStickyForTests());

    test('story-session-list-sticky-sort ac:1 timeline は favorite → 作業中>完了>idle → 時刻降順 でソートする', () => {
        const out = ids(orderTimelineSessions(
            [{ id: 'c' }, { id: 'b' }, { id: 'a' }], null,
            mk({ a: working(100), b: done(90), c: idle() })
        ));
        expect(out, 'favorite → 作業中>完了>idle → 時刻降順 の順序になる').toEqual(['a', 'b', 'c']);
    });

    test('story-session-list-sticky-sort ac:2 done-unread セッションは既読(idle)後も完了枠(sticky)に留まり最下部へ落ちない', () => {
        const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        orderTimelineSessions(list, null, mk({ a: working(900), b: done(500), c: idle() }));
        // b のインジケータ既読 → idle。sticky で完了枠に留まる
        const out = ids(orderTimelineSessions(list, null, mk({ a: working(900), b: idle(), c: idle() })));
        expect(out, 'done-unread は既読(idle)後も完了枠に sticky で留まり最下部へ落ちない').toEqual(['a', 'b', 'c']);
    });

    test('story-session-list-sticky-sort ac:3 作業中になったら sticky 完了記憶は解除される', () => {
        const list = [{ id: 'b', createdAt: 100 }, { id: 'd', createdAt: 100 }];
        orderTimelineSessions(list, null, mk({ b: done(500), d: idle() }));     // b 完了を記憶
        orderTimelineSessions(list, null, mk({ b: working(800), d: idle() }));  // b 作業中 → 解除
        const out = ids(orderTimelineSessions(list, null, mk({ b: idle(), d: idle() })));
        expect(out, '作業中になったら sticky 完了記憶は解除され、その後の idle で完了枠に残らない').toEqual(['b', 'd']);
    });

    test('story-session-list-sticky-sort ac:4 favorite は activity 優先度より常に上 / 一覧から消えたセッションの sticky はリークしない', () => {
        const favOut = ids(orderTimelineSessions(
            [{ id: 'work' }, { id: 'fav', favorite: true }], null,
            mk({ work: working(900), fav: idle() })
        ));
        expect(favOut, 'favorite は activity 優先度より常に上').toEqual(['fav', 'work']);

        __resetStickyForTests();
        orderTimelineSessions([{ id: 'gone' }, { id: 'x' }], null, mk({ gone: done(500), x: idle() }));
        orderTimelineSessions([{ id: 'x' }], null, mk({ x: idle() })); // gone を除外 → prune
        const leakOut = ids(orderTimelineSessions(
            [{ id: 'gone', createdAt: 100 }, { id: 'x', createdAt: 200 }], null,
            mk({ gone: idle(), x: idle() })
        ));
        expect(leakOut, '一覧から消えたセッションの sticky 完了記憶はリークしない').toEqual(['x', 'gone']);
    });
});
