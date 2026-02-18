import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { waitForElement } from '../../../../public/modules/utils/dom-ready.js';

describe('waitForElement', () => {
    const originalObserver = global.MutationObserver;

    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        document.body.innerHTML = '';
        global.MutationObserver = originalObserver;
    });

    it('resolves immediately when the element already exists', async () => {
        const panel = document.createElement('div');
        panel.id = 'dashboard-panel';
        document.body.appendChild(panel);

        const result = await waitForElement('#dashboard-panel');
        expect(result).toBe(panel);
    });

    it('resolves when the element appears before timeout', async () => {
        const promise = waitForElement('#dynamic-panel', { timeout: 500 });

        setTimeout(() => {
            const panel = document.createElement('div');
            panel.id = 'dynamic-panel';
            document.body.appendChild(panel);
        }, 50);

        const result = await promise;
        expect(result).not.toBeNull();
        expect(result.id).toBe('dynamic-panel');
    });

    it('returns null after timeout and cleans up observers/intervals', async () => {
        const disconnect = vi.fn();
        const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

        class MockObserver {
            constructor() {
                this.disconnect = disconnect;
            }
            observe() {
                // noop for testing timeout path
            }
        }
        global.MutationObserver = MockObserver;

        const result = await waitForElement('#never-there', { timeout: 150 });
        expect(result).toBeNull();
        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(clearIntervalSpy).toHaveBeenCalled();

        clearIntervalSpy.mockRestore();
    });
});
