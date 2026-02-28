import { describe, it, expect, vi } from 'vitest';
import { EventBus, eventBus, EVENTS } from '../../public/modules/core/event-bus.js';

describe('EventBus', () => {
    it('should emit and receive events', async () => {
        const bus = new EventBus();
        let received = null;

        bus.on('test:event', ({ detail }) => {
            received = detail;
        });

        await bus.emit('test:event', { data: 'hello' });

        expect(received.data).toEqual('hello');
        // トレーサビリティ: _metaが付与される
        expect(received._meta).toBeDefined();
        expect(received._meta.eventId).toMatch(/^evt_/);
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

            expect(result.success).toBe(1);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].message).toBe('fail');
            // トレーサビリティ: metaも含まれる
            expect(result.meta).toBeDefined();
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

            expect(result.success).toBe(0);
            expect(result.errors).toEqual([]);
            // トレーサビリティ: metaが返される
            expect(result.meta).toBeDefined();
            expect(result.meta.eventId).toMatch(/^evt_/);
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
                    meta: expect.objectContaining({
                        eventId: expect.stringMatching(/^evt_/)
                    }),
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

    // ===== トレーサビリティ機能 =====

    describe('Traceability', () => {
        it('emit呼び出し_eventIdが生成される', async () => {
            const bus = new EventBus();
            const received = [];

            bus.on('test:trace', (e) => received.push(e));
            await bus.emit('test:trace', { foo: 'bar' });

            expect(received[0].detail._meta.eventId).toMatch(/^evt_/);
        });

        it('emit呼び出し_correlationIdが生成される', async () => {
            const bus = new EventBus();
            const received = [];

            bus.on('test:trace', (e) => received.push(e));
            await bus.emit('test:trace', { foo: 'bar' });

            expect(received[0].detail._meta.correlationId).toMatch(/^corr_/);
        });

        it('emit呼び出し_timestampが付与される', async () => {
            const bus = new EventBus();
            const received = [];
            const before = Date.now();

            bus.on('test:trace', (e) => received.push(e));
            await bus.emit('test:trace', { foo: 'bar' });

            const after = Date.now();
            expect(received[0].detail._meta.timestamp).toBeGreaterThanOrEqual(before);
            expect(received[0].detail._meta.timestamp).toBeLessThanOrEqual(after);
        });

        it('startCorrelation呼び出し_新しいcorrelationIdが生成される', async () => {
            const bus = new EventBus();
            const received = [];

            bus.on('test:trace', (e) => received.push(e));

            const corrId = bus.startCorrelation();
            await bus.emit('test:trace', { data: 'first' });

            expect(corrId).toMatch(/^corr_/);
            expect(received[0].detail._meta.correlationId).toBe(corrId);
        });

        it('連続emit_causationIdが前のeventIdを参照する', async () => {
            const bus = new EventBus();
            const received = [];

            bus.on('test:trace', (e) => received.push(e));

            bus.startCorrelation();
            await bus.emit('test:trace', { data: 'first' });
            await bus.emit('test:trace', { data: 'second' });

            const first = received[0].detail._meta;
            const second = received[1].detail._meta;

            expect(second.causationId).toBe(first.eventId);
            expect(first.correlationId).toBe(second.correlationId);
        });

        it('emitChained呼び出し_親イベントのcorrelationIdが継承される', async () => {
            const bus = new EventBus();
            const received = [];

            bus.on('parent:event', (e) => received.push(e));
            bus.on('child:event', (e) => received.push(e));

            bus.startCorrelation();
            await bus.emit('parent:event', { data: 'parent' });

            // 別のcorrelationを開始してからemitChainedで親を継承
            bus.startCorrelation(); // 新しいcorrelationId
            const parentEvent = { detail: received[0].detail };
            await bus.emitChained('child:event', { data: 'child' }, parentEvent);

            const parentMeta = received[0].detail._meta;
            const childMeta = received[1].detail._meta;

            // emitChainedで親のcorrelationIdが継承される
            expect(childMeta.correlationId).toBe(parentMeta.correlationId);
        });

        it('getCurrentCorrelationId_現在のcorrelationIdを取得できる', () => {
            const bus = new EventBus();

            expect(bus.getCurrentCorrelationId()).toBeNull();

            const corrId = bus.startCorrelation();
            expect(bus.getCurrentCorrelationId()).toBe(corrId);
        });

        it('emit戻り値_metaが含まれる', async () => {
            const bus = new EventBus();

            const result = await bus.emit('test:trace', { data: 'test' });

            expect(result.meta).toBeDefined();
            expect(result.meta.eventId).toMatch(/^evt_/);
            expect(result.meta.correlationId).toMatch(/^corr_/);
            expect(result.meta.timestamp).toBeGreaterThan(0);
        });
    });
});
