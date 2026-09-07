import { describe, expect, it } from 'vitest';

describe('browser test environment', () => {
    it('provides an isolated localStorage implementation', () => {
        expect(window.localStorage).toBeDefined();
        expect(typeof window.localStorage.clear).toBe('function');
        expect(typeof window.localStorage.getItem).toBe('function');
        expect(typeof window.localStorage.setItem).toBe('function');
        expect(typeof window.localStorage.removeItem).toBe('function');
        expect(typeof window.localStorage.key).toBe('function');

        window.localStorage.clear();
        window.localStorage.setItem('contract-key', 'contract-value');

        expect(window.localStorage.getItem('contract-key')).toBe('contract-value');
        expect(window.localStorage.length).toBe(1);
        expect(window.localStorage.key(0)).toBe('contract-key');
    });
});
