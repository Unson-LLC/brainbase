import { describe, it, expect, beforeEach } from 'vitest';
import {
    orderTimelineSessions,
    sessionSortPriority,
    __resetStickyForTests
} from '../../ui-islands/session-list/sessionOrder.js';

/**
 * timeline ソートの sticky-done 機構の回帰テスト。
 *
 * 島移行(PR #895)で vanilla の _timelineAttentionSortBySessionId が脱落し、
 * done-unread セッションがインジケータ既読で idle に落ちた瞬間に最下部へジャンプして
 * リストが再シャッフルする退行が起きていた。sticky 復元の挙動を固定する。
 */
describe('sessionOrder (timeline sticky-done)', () => {
    beforeEach(() => __resetStickyForTests());

    // deriveUi スタブ: id -> uiState(fixture) を返す
    const mk = (fixtures) => (id) => fixtures[id] || { hookStatus: null, activity: 'idle' };
    const ids = (arr) => arr.map((s) => s.id);

    const working = (ts) => ({ hookStatus: { state: 'running', liveActivity: { updatedAt: ts } } });
    const done = (ts) => ({ hookStatus: { state: 'done-unread', lastDoneAt: ts } });
    const idle = () => ({ hookStatus: { state: 'idle' }, activity: 'idle' });

    it('基本: 作業中 > 完了未読 > idle、同一tier内は時刻降順', () => {
        const list = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];
        const deriveUi = mk({ a: working(100), b: done(90), c: idle() });
        expect(ids(orderTimelineSessions(list, null, deriveUi))).toEqual(['a', 'b', 'c']);
    });

    it('sticky-done: 完了→既読(idle)になっても完了枠(tier2)に留まり最下部へ落ちない', () => {
        const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        // 1回目: b が done-unread(完了時刻 500)、c は idle
        let deriveUi = mk({ a: working(900), b: done(500), c: idle() });
        expect(ids(orderTimelineSessions(list, null, deriveUi))).toEqual(['a', 'b', 'c']);

        // 2回目: b のインジケータが既読 → idle に落ちた。sticky が無いと b は tier3 へ落ちて
        // c との時刻比較で最下部に行きうる。sticky 機構で b は tier2・完了時刻500を維持し、
        // 依然 c(idle) より上に留まる。
        deriveUi = mk({ a: working(900), b: idle(), c: idle() });
        expect(ids(orderTimelineSessions(list, null, deriveUi)), 'b は完了枠に sticky 維持').toEqual(['a', 'b', 'c']);
    });

    it('作業中になったら sticky 解除: 完了記憶がクリアされ、その後の idle では tier3 に落ちる', () => {
        const list = [{ id: 'b' }, { id: 'd' }];
        // b: done(500) を記憶
        orderTimelineSessions(list, null, mk({ b: done(500), d: idle() }));
        // b: 作業中になる → sticky 解除
        orderTimelineSessions(list, null, mk({ b: working(800), d: idle() }));
        // b: idle に落ちる(完了記憶は解除済み) → d(idle, createdAt 比較)と同 tier3
        const out = ids(orderTimelineSessions(list, null, mk({ b: idle(), d: idle() })));
        // 両方 tier3。timestamp が無いので 0 同士 → 安定順(入力順 b,d)を維持。b が完了枠に
        // 留まっていない(= sticky 解除済み)ことが要点。
        expect(out).toEqual(['b', 'd']);
    });

    it('favorite は activity 優先度より常に上', () => {
        const list = [{ id: 'work' }, { id: 'fav', favorite: true }];
        const deriveUi = mk({ work: working(900), fav: idle() });
        expect(ids(orderTimelineSessions(list, null, deriveUi))).toEqual(['fav', 'work']);
    });

    it('一覧から消えたセッションの sticky 記憶は破棄される(リーク防止)', () => {
        // gone を done で記憶 → 次回 list から外す → 再登場時に古い完了記憶を持ち越さない
        orderTimelineSessions([{ id: 'gone' }, { id: 'x' }], null, mk({ gone: done(500), x: idle() }));
        // gone を一覧から除外 → prune される
        orderTimelineSessions([{ id: 'x' }], null, mk({ x: idle() }));
        // gone が idle で再登場 → 完了記憶が残っていれば tier2 で x より上になってしまう。
        // prune 済みなら gone は tier3。createdAt で比較(gone=100 < x=200 → x が上)。
        const out = ids(orderTimelineSessions(
            [{ id: 'gone', createdAt: 100 }, { id: 'x', createdAt: 200 }],
            null,
            mk({ gone: idle(), x: idle() })
        ));
        expect(out, 'prune 済みなので gone は完了枠に残らない').toEqual(['x', 'gone']);
    });

    it('sessionSortPriority: state 優先、無ければ activity フォールバック', () => {
        expect(sessionSortPriority({ hookStatus: { state: 'running' } })).toBe(1);
        expect(sessionSortPriority({ hookStatus: { state: 'done-unread' } })).toBe(2);
        expect(sessionSortPriority({ hookStatus: { state: 'idle' } })).toBe(3);
        expect(sessionSortPriority({ activity: 'thinking' })).toBe(1);
        expect(sessionSortPriority({ activity: 'done-unread' })).toBe(2);
        expect(sessionSortPriority({ activity: 'idle' })).toBe(3);
    });
});
