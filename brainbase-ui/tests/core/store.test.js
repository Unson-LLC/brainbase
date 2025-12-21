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

        expect(listener).toHaveBeenCalledWith({
            key: 'count',
            value: 5,
            oldValue: 0
        });
    });

    it('should export global appStore instance', () => {
        expect(appStore).toBeInstanceOf(Store);
        expect(appStore.getState()).toHaveProperty('sessions');
        expect(appStore.getState()).toHaveProperty('tasks');
        expect(appStore.getState()).toHaveProperty('filters');
    });
});
