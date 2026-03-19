/**
 * リクエスト重複排除（CommandMate移植）
 *
 * 同一キーの同時リクエストを1つにまとめる（request coalescing）。
 * 最初のリクエストが完了するまで、同じキーの後続リクエストは
 * 最初のリクエストのPromiseを共有する。
 *
 * 用途:
 * - ポーリング中の重複fetch防止
 * - セッション切り替え時の同時API呼び出し削減
 * - 複数UIコンポーネントからの同一データ取得の最適化
 */

export class RequestDeduplicator {
    constructor() {
        /** @type {Map<string, Promise>} */
        this._inflight = new Map();
    }

    /**
     * 重複排除付きリクエスト実行
     * 同一keyのリクエストが進行中なら、そのPromiseを返す
     *
     * @param {string} key - 重複排除キー（URL等）
     * @param {Function} fetchFn - 実際のリクエスト関数 () => Promise
     * @returns {Promise} リクエスト結果
     */
    async dedupe(key, fetchFn) {
        if (this._inflight.has(key)) {
            return this._inflight.get(key);
        }

        const promise = fetchFn().finally(() => {
            this._inflight.delete(key);
        });

        this._inflight.set(key, promise);
        return promise;
    }

    /**
     * 指定キーのリクエストが進行中かどうか
     */
    hasPending(key) {
        return this._inflight.has(key);
    }

    /**
     * 全進行中リクエストをクリア（テスト用）
     */
    clear() {
        this._inflight.clear();
    }
}
