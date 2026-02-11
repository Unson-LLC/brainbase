import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MobileInputFocusManager } from '../../../public/modules/ui/mobile-input-focus-manager.js';

describe('MobileInputFocusManager focus tracking', () => {
    let focusManager;
    let elements;
    const originalActiveElement = Object.getOwnPropertyDescriptor(document, 'activeElement');

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="mobile-input-dock"></div>
            <textarea id="mobile-dock-input"></textarea>
            <div id="mobile-composer"></div>
            <textarea id="mobile-composer-input"></textarea>
            <iframe id="terminal-frame"></iframe>
        `;

        elements = {
            dock: document.getElementById('mobile-input-dock'),
            dockInput: document.getElementById('mobile-dock-input'),
            composer: document.getElementById('mobile-composer'),
            composerInput: document.getElementById('mobile-composer-input')
        };
        focusManager = new MobileInputFocusManager(elements);
    });

    afterEach(() => {
        if (originalActiveElement) {
            Object.defineProperty(document, 'activeElement', originalActiveElement);
        }
        document.body.classList.remove('keyboard-open');
        document.body.style.removeProperty('--keyboard-offset');
    });

    it('inputFocusedフラグを参照してフォーカス判定できる', () => {
        focusManager.inputFocused = true;
        expect(focusManager.isInputFocused()).toBe(true);

        focusManager.inputFocused = false;
        expect(focusManager.isInputFocused()).toBe(false);
    });

    it('activeElementがinputでなくてもinputFocused=trueならtrueを返す', () => {
        Object.defineProperty(document, 'activeElement', {
            configurable: true,
            get: () => document.body
        });

        focusManager.inputFocused = true;
        expect(focusManager.isInputFocused()).toBe(true);
    });
});

describe('MobileInputFocusManager visual viewport sync', () => {
    let focusManager;
    let originalViewport;

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="mobile-input-dock" style="height: 48px;"></div>
            <textarea id="mobile-dock-input"></textarea>
            <div id="mobile-composer"></div>
            <textarea id="mobile-composer-input"></textarea>
        `;

        const elements = {
            dock: document.getElementById('mobile-input-dock'),
            dockInput: document.getElementById('mobile-dock-input'),
            composer: document.getElementById('mobile-composer'),
            composerInput: document.getElementById('mobile-composer-input')
        };
        focusManager = new MobileInputFocusManager(elements);

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
        document.body.style.removeProperty('--keyboard-offset');
        document.body.classList.remove('keyboard-open');
    });

    it('syncs --vvh/--vv-top/--vv-left from visualViewport', () => {
        focusManager.bindViewportResize();

        expect(document.documentElement.style.getPropertyValue('--vvh')).toBe('600px');
        expect(document.documentElement.style.getPropertyValue('--vv-top')).toBe('24px');
        expect(document.documentElement.style.getPropertyValue('--vv-left')).toBe('0px');
    });
});
