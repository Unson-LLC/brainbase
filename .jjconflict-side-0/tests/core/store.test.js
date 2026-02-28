import { describe, it, expect, vi } from 'vitest';
import { Store, appStore } from '../../public/modules/core/store.js';

describe('Store', () => {
    it('should initialize with initial state', () => {
        const store = new Store({ count: 0 });
        expect(store.getState()).toEqual({ count: 0 });
    });

    it('should update state with setState', () => {
        const store = new Store({ count: 0 });
        store.setState({ count: 5 });
        expect(store.getState().count).toBe(5);
    });

    it('should notify subscribers on state change', () => {
        const store = new Store({ count: 0 });
        const listener = vi.fn();

        store.subscribe(listener);
        store.setState({ count: 5 });

        expect(listener).toHaveBeenCalledWith(expect.objectContaining({
            key: 'count',
            value: 5,
            oldValue: 0
        }));
    });

    it('should export global appStore instance', () => {
        expect(appStore).toBeInstanceOf(Store);
        expect(appStore.getState()).toHaveProperty('sessions');
        expect(appStore.getState()).toHaveProperty('tasks');
        expect(appStore.getState()).toHaveProperty('filters');
    });

    // ===== revision機能 =====

    describe('revision', () => {
        it('setState呼び出し時_revisionがインクリメントされる', () => {
            const store = new Store({ count: 0 });
            expect(store.getRevision()).toBe(0);

            store.setState({ count: 1 });
            expect(store.getRevision()).toBe(1);

            store.setState({ count: 2 });
            expect(store.getRevision()).toBe(2);
        });

        it('setState呼び出し時_通知にrevisionが含まれる', () => {
            const store = new Store({ count: 0 });
            const listener = vi.fn();

            store.subscribe(listener);
            store.setState({ count: 5 });

            expect(listener).toHaveBeenCalledWith(expect.objectContaining({
                revision: 1
            }));
        });

        it('setState呼び出し時_通知にisStale関数が含まれる', () => {
            const store = new Store({ count: 0 });
            let firstChange = null;

            store.subscribe((change) => {
                // 最初の変更のみキャプチャ
                if (firstChange === null) {
                    firstChange = change;
                }
            });
            store.setState({ count: 5 });

            expect(typeof firstChange.isStale).toBe('function');
            expect(firstChange.isStale()).toBe(false);

            // さらに状態更新するとisStaleがtrue（最初のchangeは古くなる）
            store.setState({ count: 10 });
            expect(firstChange.isStale()).toBe(true);
        });

        it('isStale使用時_古いイベントを無視できる', async () => {
            const store = new Store({ data: null });
            const results = [];

            store.subscribe(async (change) => {
                // 非同期処理をシミュレート
                await new Promise(r => setTimeout(r, 10));
                if (!change.isStale()) {
                    results.push(change.value);
                }
            });

            store.setState({ data: 'first' });
            store.setState({ data: 'second' });
            store.setState({ data: 'third' });

            // 全ての非同期処理が完了するまで待つ
            await new Promise(r => setTimeout(r, 50));

            // isStaleで古いイベントをスキップしたので'third'のみ
            expect(results).toEqual(['third']);
        });
    });

    // ===== batch機能 =====

    describe('batch()', () => {
        it('batch内の複数setState_通知が1回にまとまる', () => {
            const store = new Store({ a: 0, b: 0, c: 0 });
            const listener = vi.fn();

            store.subscribe(listener);

            store.batch(() => {
                store.setState({ a: 1 });
                store.setState({ b: 2 });
                store.setState({ c: 3 });
            });

            // 通知は1回のみ
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('batch完了時_isBatch:trueで通知される', () => {
            const store = new Store({ a: 0, b: 0 });
            const listener = vi.fn();

            store.subscribe(listener);

            store.batch(() => {
                store.setState({ a: 1 });
                store.setState({ b: 2 });
            });

            expect(listener).toHaveBeenCalledWith(expect.objectContaining({
                isBatch: true,
                key: '_batch'
            }));
        });

        it('batch完了時_valueにマージされた変更が含まれる', () => {
            const store = new Store({ a: 0, b: 0 });
            let capturedChange = null;

            store.subscribe((change) => {
                capturedChange = change;
            });

            store.batch(() => {
                store.setState({ a: 1 });
                store.setState({ b: 2 });
            });

            expect(capturedChange.value).toEqual({ a: 1, b: 2 });
        });

        it('batch完了時_changesに個別の変更が含まれる', () => {
            const store = new Store({ a: 0, b: 0 });
            let capturedChange = null;

            store.subscribe((change) => {
                capturedChange = change;
            });

            store.batch(() => {
                store.setState({ a: 1 });
                store.setState({ b: 2 });
            });

            expect(capturedChange.changes).toHaveLength(2);
        });

        it('batch内でエラー発生_他の通知はキャンセルされる', () => {
            const store = new Store({ a: 0 });
            const listener = vi.fn();

            store.subscribe(listener);

            expect(() => {
                store.batch(() => {
                    store.setState({ a: 1 });
                    throw new Error('Test error');
                });
            }).toThrow('Test error');

            // エラー発生時も蓄積された変更は通知される
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('batchなし_setStateごとに通知される', () => {
            const store = new Store({ a: 0, b: 0 });
            const listener = vi.fn();

            store.subscribe(listener);

            store.setState({ a: 1 });
            store.setState({ b: 2 });

            expect(listener).toHaveBeenCalledTimes(2);
        });
    });

    // ===== subscribeToSelector機能 =====

    describe('subscribeToSelector()', () => {
        it('selector結果変更時_リスナーが呼ばれる', () => {
            const store = new Store({ user: { name: 'Alice', age: 20 } });
            const listener = vi.fn();

            store.subscribeToSelector(
                (state) => state.user.name,
                listener
            );

            store.setState({ user: { name: 'Bob', age: 20 } });

            expect(listener).toHaveBeenCalledWith(expect.objectContaining({
                value: 'Bob',
                oldValue: 'Alice'
            }));
        });

        it('selector結果未変更時_リスナーが呼ばれない', () => {
            const store = new Store({ user: { name: 'Alice', age: 20 } });
            const listener = vi.fn();

            store.subscribeToSelector(
                (state) => state.user.name,
                listener
            );

            // 年齢だけ変更（名前は変わらない）
            store.setState({ user: { name: 'Alice', age: 25 } });

            expect(listener).not.toHaveBeenCalled();
        });

        it('カスタム等価関数_shallow equal使用', () => {
            const store = new Store({ items: [1, 2, 3] });
            const listener = vi.fn();

            // 配列の内容比較
            const shallowEqual = (a, b) => {
                if (a === b) return true;
                if (!Array.isArray(a) || !Array.isArray(b)) return false;
                if (a.length !== b.length) return false;
                return a.every((v, i) => v === b[i]);
            };

            store.subscribeToSelector(
                (state) => state.items,
                listener,
                shallowEqual
            );

            // 同じ内容の新しい配列 → 呼ばれない
            store.setState({ items: [1, 2, 3] });
            expect(listener).not.toHaveBeenCalled();

            // 異なる内容 → 呼ばれる
            store.setState({ items: [1, 2, 3, 4] });
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('subscribeToSelector購読解除_リスナーが呼ばれなくなる', () => {
            const store = new Store({ count: 0 });
            const listener = vi.fn();

            const unsubscribe = store.subscribeToSelector(
                (state) => state.count,
                listener
            );

            store.setState({ count: 1 });
            expect(listener).toHaveBeenCalledTimes(1);

            unsubscribe();
            store.setState({ count: 2 });
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('通知にrevisionとisStaleが含まれる', () => {
            const store = new Store({ count: 0 });
            let capturedChange = null;

            store.subscribeToSelector(
                (state) => state.count,
                (change) => { capturedChange = change; }
            );

            store.setState({ count: 5 });

            expect(capturedChange.revision).toBe(1);
            expect(typeof capturedChange.isStale).toBe('function');
        });
    });
});
