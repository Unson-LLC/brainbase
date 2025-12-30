import { describe, it, expect } from 'vitest';
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
});
