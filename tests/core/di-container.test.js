import { describe, it, expect, vi } from 'vitest';
import { DIContainer } from '../../public/modules/core/di-container.js';

describe('DIContainer', () => {
    it('should register and resolve services', () => {
        const container = new DIContainer();
        container.register('testService', () => ({ name: 'Test' }));

        const service = container.get('testService');
        expect(service).toEqual({ name: 'Test' });
    });

    it('should return singleton instance', () => {
        const container = new DIContainer();
        container.register('counter', () => ({ count: 0 }));

        const instance1 = container.get('counter');
        const instance2 = container.get('counter');

        expect(instance1).toBe(instance2);
    });

    it('should support dependency injection', () => {
        const container = new DIContainer();

        container.register('logger', () => ({
            log: (msg) => msg
        }));

        container.register('service', (c) => ({
            logger: c.get('logger'),
            doSomething: () => 'done'
        }));

        const service = container.get('service');
        expect(service.logger).toBeDefined();
        expect(service.logger.log('test')).toBe('test');
    });

    it('should throw on missing service', () => {
        const container = new DIContainer();

        expect(() => container.get('nonexistent')).toThrow(
            'Service "nonexistent" not found'
        );
    });

    it('should detect circular dependencies', () => {
        const container = new DIContainer();

        container.register('a', (c) => c.get('b'));
        container.register('b', (c) => c.get('a'));

        expect(() => container.get('a')).toThrow('Circular dependency detected');
    });

    // ===== validate機能 =====

    describe('validate()', () => {
        it('validate呼び出し時_全サービスが正常解決_trueが返される', () => {
            const container = new DIContainer();
            container.register('serviceA', () => ({ name: 'A' }));
            container.register('serviceB', (c) => ({
                name: 'B',
                a: c.get('serviceA')
            }));

            expect(container.validate()).toBe(true);
        });

        it('validate呼び出し時_依存エラーあり_例外がスローされる', () => {
            const container = new DIContainer();
            container.register('serviceA', () => ({ name: 'A' }));
            container.register('serviceB', (c) => {
                c.get('nonexistent'); // 存在しないサービス
                return { name: 'B' };
            });

            expect(() => container.validate()).toThrow('DI validation failed');
        });

        it('validate呼び出し時_複数エラー_全エラーがメッセージに含まれる', () => {
            const container = new DIContainer();
            container.register('serviceA', (c) => c.get('missing1'));
            container.register('serviceB', (c) => c.get('missing2'));

            try {
                container.validate();
            } catch (error) {
                expect(error.message).toContain('serviceA');
                expect(error.message).toContain('serviceB');
            }
        });

        it('validate呼び出し時_循環依存検出_例外がスローされる', () => {
            const container = new DIContainer();
            container.register('a', (c) => c.get('b'));
            container.register('b', (c) => c.get('a'));

            expect(() => container.validate()).toThrow('DI validation failed');
        });
    });

    // ===== freeze機能 =====

    describe('freeze()', () => {
        it('freeze呼び出し後_registerがエラーをスローする', () => {
            const container = new DIContainer();
            container.register('serviceA', () => ({ name: 'A' }));
            container.freeze();

            expect(() => container.register('serviceB', () => ({ name: 'B' })))
                .toThrow('Cannot register "serviceB": container is frozen');
        });

        it('freeze呼び出し後_既存サービスは取得可能', () => {
            const container = new DIContainer();
            container.register('serviceA', () => ({ name: 'A' }));
            container.freeze();

            expect(container.get('serviceA')).toEqual({ name: 'A' });
        });

        it('isFrozen呼び出し時_フリーズ状態を返す', () => {
            const container = new DIContainer();
            expect(container.isFrozen()).toBe(false);

            container.freeze();
            expect(container.isFrozen()).toBe(true);
        });
    });

    // ===== dispose機能 =====

    describe('dispose()', () => {
        it('dispose呼び出し時_サービスのdisposeが呼ばれる', () => {
            const container = new DIContainer();
            const disposeFn = vi.fn();

            container.register('serviceA', () => ({
                name: 'A',
                dispose: disposeFn
            }));

            // サービスをインスタンス化
            container.get('serviceA');

            // dispose呼び出し
            container.dispose();

            expect(disposeFn).toHaveBeenCalledTimes(1);
        });

        it('dispose呼び出し時_disposeメソッドがないサービスはスキップ', () => {
            const container = new DIContainer();
            const disposeFn = vi.fn();

            container.register('serviceA', () => ({ name: 'A' })); // disposeなし
            container.register('serviceB', () => ({
                name: 'B',
                dispose: disposeFn
            }));

            container.get('serviceA');
            container.get('serviceB');
            container.dispose();

            expect(disposeFn).toHaveBeenCalledTimes(1);
        });

        it('dispose呼び出し時_サービスMapがクリアされる', () => {
            const container = new DIContainer();
            container.register('serviceA', () => ({ name: 'A' }));
            container.get('serviceA');

            container.dispose();

            expect(container.has('serviceA')).toBe(false);
        });

        it('dispose呼び出し時_freezeが解除される', () => {
            const container = new DIContainer();
            container.register('serviceA', () => ({ name: 'A' }));
            container.freeze();

            expect(container.isFrozen()).toBe(true);
            container.dispose();
            expect(container.isFrozen()).toBe(false);
        });

        it('dispose中にエラー発生_他のサービスのdisposeは継続される', () => {
            const container = new DIContainer();
            const disposeA = vi.fn(() => { throw new Error('A failed'); });
            const disposeB = vi.fn();
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            container.register('serviceA', () => ({
                name: 'A',
                dispose: disposeA
            }));
            container.register('serviceB', () => ({
                name: 'B',
                dispose: disposeB
            }));

            container.get('serviceA');
            container.get('serviceB');
            container.dispose();

            expect(disposeA).toHaveBeenCalledTimes(1);
            expect(disposeB).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

            consoleErrorSpy.mockRestore();
        });
    });
});
