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
});
