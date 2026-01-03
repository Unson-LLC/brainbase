import { describe, it, expect, vi } from 'vitest';
import { EventBus, eventBus, EVENTS } from '../../public/modules/core/event-bus.js';

describe('EventBus', () => {
    it('should emit and receive events', () => {
        const bus = new EventBus();
        let received = null;

        bus.on('test:event', ({ detail }) => {
            received = detail;
        });

        bus.emit('test:event', { data: 'hello' });

        expect(received).toEqual({ data: 'hello' });
    });

    it('should unsubscribe correctly', () => {
        const bus = new EventBus();
        const listener = vi.fn();

        const unsubscribe = bus.on('test:event', listener);
        bus.emit('test:event', { data: 'first' });

        unsubscribe();
        bus.emit('test:event', { data: 'second' });

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should export global eventBus instance', () => {
        expect(eventBus).toBeInstanceOf(EventBus);
    });

    it('should have all required event constants', () => {
        expect(EVENTS.TASK_LOADED).toBe('task:loaded');
        expect(EVENTS.TASK_COMPLETED).toBe('task:completed');
        expect(EVENTS.SESSION_CHANGED).toBe('session:changed');
        expect(EVENTS.INBOX_TOGGLED).toBe('inbox:toggled');
    });

    // ===== 非同期エラーハンドリング（TDD Red Phase） =====

    describe('onAsync()', () => {
        it('onAsync登録_emit呼び出し_非同期ハンドラーが実行される', async () => {
            const bus = new EventBus();
            let called = false;

            bus.onAsync('test:async', async (event) => {
                called = true;
                expect(event.detail.data).toBe('test');
            });

            await bus.emit('test:async', { data: 'test' });
            expect(called).toBe(true);
        });

        it('非同期ハンドラーでエラー_他のハンドラーは実行継続', async () => {
            const bus = new EventBus();
            const results = [];

            bus.onAsync('test:error', async () => {
                results.push('handler1');
            });
            bus.onAsync('test:error', async () => {
                throw new Error('Handler 2 failed');
            });
            bus.onAsync('test:error', async () => {
                results.push('handler3');
            });

            const { success, errors } = await bus.emit('test:error', {});

            expect(results).toEqual(['handler1', 'handler3']);
            expect(success).toBe(2);
            expect(errors).toHaveLength(1);
            expect(errors[0].message).toBe('Handler 2 failed');
        });

        it('emit戻り値_成功数とエラー配列を返す', async () => {
            const bus = new EventBus();

            bus.onAsync('test:result', async () => {});
            bus.onAsync('test:result', async () => { throw new Error('fail'); });

            const result = await bus.emit('test:result', {});

            expect(result).toEqual({
                success: 1,
                errors: [expect.objectContaining({ message: 'fail' })]
            });
        });

        it('offAsync呼び出し_ハンドラーが解除される', async () => {
            const bus = new EventBus();
            const handler = vi.fn();

            const unsubscribe = bus.onAsync('test:unsub', handler);
            await bus.emit('test:unsub', { data: 'first' });

            unsubscribe();
            await bus.emit('test:unsub', { data: 'second' });

            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('同期リスナーと非同期リスナーの併用_両方とも実行される', async () => {
            const bus = new EventBus();
            const syncResults = [];
            const asyncResults = [];

            bus.on('test:mixed', ({ detail }) => {
                syncResults.push(detail.data);
            });
            bus.onAsync('test:mixed', async (event) => {
                asyncResults.push(event.detail.data);
            });

            await bus.emit('test:mixed', { data: 'test' });

            expect(syncResults).toEqual(['test']);
            expect(asyncResults).toEqual(['test']);
        });

        it('非同期ハンドラーなし_空の結果を返す', async () => {
            const bus = new EventBus();

            const result = await bus.emit('test:empty', {});

            expect(result).toEqual({
                success: 0,
                errors: []
            });
        });

        it('エラー発生時_console.errorが呼ばれる', async () => {
            const bus = new EventBus();
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            bus.onAsync('test:console', async () => {
                throw new Error('Test error');
            });

            await bus.emit('test:console', { data: 'test' });

            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining('EventBus[test:console]'),
                expect.objectContaining({
                    event: 'test:console',
                    detail: { data: 'test' },
                    errors: expect.arrayContaining([
                        expect.objectContaining({
                            message: 'Test error'
                        })
                    ])
                })
            );

            consoleErrorSpy.mockRestore();
        });

        it('複数の非同期ハンドラーがエラー_全エラーが収集される', async () => {
            const bus = new EventBus();

            bus.onAsync('test:multi-error', async () => {
                throw new Error('Error 1');
            });
            bus.onAsync('test:multi-error', async () => {
                throw new Error('Error 2');
            });
            bus.onAsync('test:multi-error', async () => {
                throw new Error('Error 3');
            });

            const { success, errors } = await bus.emit('test:multi-error', {});

            expect(success).toBe(0);
            expect(errors).toHaveLength(3);
            expect(errors.map(e => e.message)).toEqual(['Error 1', 'Error 2', 'Error 3']);
        });
    });
});
