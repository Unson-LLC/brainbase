import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MessageQueue } from '../../public/modules/core/message-queue.js';

/**
 * WebSocketメッセージキューテスト（CommandMate移植）
 * 切断中のメッセージを保存し、再接続後に自動送信
 */
describe('MessageQueue', () => {
    describe('enqueue()', () => {
        it('メッセージをキューに追加する', () => {
            const queue = new MessageQueue();
            queue.enqueue({ type: 'input', value: 'hello' });

            expect(queue.size()).toBe(1);
        });

        it('最大キューサイズを超えない', () => {
            const queue = new MessageQueue({ maxSize: 3 });
            queue.enqueue({ type: 'input', value: '1' });
            queue.enqueue({ type: 'input', value: '2' });
            queue.enqueue({ type: 'input', value: '3' });
            queue.enqueue({ type: 'input', value: '4' });

            expect(queue.size()).toBe(3);
            // 古いメッセージが捨てられる
            const messages = queue.drain();
            expect(messages[0].value).toBe('2');
        });
    });

    describe('drain()', () => {
        it('全メッセージを取り出してキューを空にする', () => {
            const queue = new MessageQueue();
            queue.enqueue({ type: 'input', value: 'a' });
            queue.enqueue({ type: 'input', value: 'b' });

            const messages = queue.drain();

            expect(messages).toHaveLength(2);
            expect(messages[0].value).toBe('a');
            expect(messages[1].value).toBe('b');
            expect(queue.size()).toBe(0);
        });

        it('空キュー_空配列を返す', () => {
            const queue = new MessageQueue();
            expect(queue.drain()).toEqual([]);
        });
    });

    describe('clear()', () => {
        it('キューを空にする', () => {
            const queue = new MessageQueue();
            queue.enqueue({ type: 'input', value: 'test' });
            queue.clear();

            expect(queue.size()).toBe(0);
        });
    });

    describe('isEmpty()', () => {
        it('空キュー_trueを返す', () => {
            const queue = new MessageQueue();
            expect(queue.isEmpty()).toBe(true);
        });

        it('メッセージあり_falseを返す', () => {
            const queue = new MessageQueue();
            queue.enqueue({ type: 'test' });
            expect(queue.isEmpty()).toBe(false);
        });
    });
});
