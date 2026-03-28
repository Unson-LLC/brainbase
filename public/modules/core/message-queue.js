// @ts-check
/**
 * WebSocketメッセージキュー（CommandMate移植）
 *
 * 切断中に送信されたメッセージを一時保存し、
 * 再接続後にdrain()で一括送信する。
 *
 * maxSizeで上限を制限し、古いメッセージから捨てる。
 */

const DEFAULT_MAX_SIZE = 50;

export class MessageQueue {
    /**
     * @param {Object} [options]
     * @param {number} [options.maxSize=50] - 最大キューサイズ
     */
    constructor(options = {}) {
        this._maxSize = options.maxSize || DEFAULT_MAX_SIZE;
        this._queue = [];
    }

    /**
     * メッセージをキューに追加
     * maxSize超過時は古いメッセージを削除
     */
    enqueue(message) {
        this._queue.push(message);
        while (this._queue.length > this._maxSize) {
            this._queue.shift();
        }
    }

    /**
     * 全メッセージを取り出してキューを空にする
     * @returns {Array} キューに保存されていたメッセージ
     */
    drain() {
        const messages = [...this._queue];
        this._queue = [];
        return messages;
    }

    /**
     * キューを空にする（メッセージを返さない）
     */
    clear() {
        this._queue = [];
    }

    /**
     * キューサイズを返す
     */
    size() {
        return this._queue.length;
    }

    /**
     * キューが空かどうか
     */
    isEmpty() {
        return this._queue.length === 0;
    }
}
