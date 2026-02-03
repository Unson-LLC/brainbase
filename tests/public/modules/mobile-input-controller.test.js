import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MobileInputController } from '../../../public/modules/ui/mobile-input-controller.js';

describe('MobileInputController focus tracking', () => {
    let controller;

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="mobile-input-dock"></div>
            <textarea id="mobile-dock-input"></textarea>
            <div id="mobile-composer"></div>
            <textarea id="mobile-composer-input"></textarea>
        `;

        controller = new MobileInputController({
            httpClient: {},
            isMobile: () => true
        });
        controller.cacheElements();
        controller.bindDock();
        controller.bindComposer();
    });

    it('sets inputFocused true on focus and false on blur', () => {
        const dockInput = document.getElementById('mobile-dock-input');

        dockInput.dispatchEvent(new FocusEvent('focus'));
        expect(controller.inputFocused).toBe(true);

        dockInput.dispatchEvent(new FocusEvent('blur'));
        expect(controller.inputFocused).toBe(false);
    });

    it('treats inputFocused as focused even if activeElement is not input', () => {
        Object.defineProperty(document, 'activeElement', {
            configurable: true,
            get: () => document.body
        });

        controller.inputFocused = true;

        expect(controller.isInputFocused()).toBe(true);
    });
});

describe('MobileInputController visual viewport sync', () => {
    let controller;
    let originalViewport;

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="mobile-input-dock"></div>
            <textarea id="mobile-dock-input"></textarea>
        `;

        controller = new MobileInputController({
            httpClient: {},
            isMobile: () => true
        });
        controller.cacheElements();

        originalViewport = window.visualViewport;
        window.visualViewport = {
            width: 360,
            height: 600,
            offsetTop: 24,
            offsetLeft: 0,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn()
        };
    });

    afterEach(() => {
        window.visualViewport = originalViewport;
        document.documentElement.style.removeProperty('--vvh');
        document.documentElement.style.removeProperty('--vv-top');
        document.documentElement.style.removeProperty('--vv-left');
    });

    it('syncs --vvh/--vv-top/--vv-left from visualViewport', () => {
        controller.bindViewportResize();

        expect(document.documentElement.style.getPropertyValue('--vvh')).toBe('600px');
        expect(document.documentElement.style.getPropertyValue('--vv-top')).toBe('24px');
        expect(document.documentElement.style.getPropertyValue('--vv-left')).toBe('0px');
    });
});
