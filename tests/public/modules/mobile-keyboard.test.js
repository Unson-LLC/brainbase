import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initMobileKeyboard } from '../../../public/modules/mobile-keyboard.js';

describe('initMobileKeyboard terminal slide', () => {
    let originalViewport;
    let originalUserAgent;

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="mobile-input-dock"></div>
            <div class="console-area"></div>
        `;

        originalViewport = window.visualViewport;
        window.visualViewport = {
            height: 600,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn()
        };

        originalUserAgent = navigator.userAgent;
        Object.defineProperty(navigator, 'userAgent', {
            configurable: true,
            value: 'iPhone'
        });
    });

    afterEach(() => {
        window.visualViewport = originalViewport;
        Object.defineProperty(navigator, 'userAgent', {
            configurable: true,
            value: originalUserAgent
        });
    });

    it('skips terminal slide when mobile dock exists', () => {
        initMobileKeyboard();
        expect(window.visualViewport.addEventListener).not.toHaveBeenCalled();
    });
});
