import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MobileInputFocusManager } from '../../../public/modules/ui/mobile-input-focus-manager.js';
import { MobileInputUIController } from '../../../public/modules/ui/mobile-input-ui-controller.js';

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

    it('terminal frameにfocusがあっても入力欄フォーカス扱いにしない', () => {
        const terminalFrame = document.getElementById('terminal-frame');
        Object.defineProperty(document, 'activeElement', {
            configurable: true,
            get: () => terminalFrame
        });

        focusManager.inputFocused = false;
        expect(focusManager.isInputFocused()).toBe(false);
    });
});

describe('MobileInputFocusManager visual viewport sync', () => {
    let focusManager;
    let originalViewport;
    let viewportSpy;

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
        viewportSpy = vi.fn();
        focusManager = new MobileInputFocusManager(elements, {
            onViewportChange: viewportSpy
        });

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
        document.documentElement.style.removeProperty('--vvw');
        document.documentElement.style.removeProperty('--vv-top');
        document.documentElement.style.removeProperty('--vv-left');
        document.body.style.removeProperty('--keyboard-offset');
        document.body.classList.remove('keyboard-open');
    });

    it('syncs visualViewport CSS variables and emits normalized layout payload', () => {
        focusManager.bindViewportResize();

        expect(document.documentElement.style.getPropertyValue('--vvh')).toBe('600px');
        expect(document.documentElement.style.getPropertyValue('--vvw')).toBe('360px');
        expect(document.documentElement.style.getPropertyValue('--vv-top')).toBe('24px');
        expect(document.documentElement.style.getPropertyValue('--vv-left')).toBe('0px');
        expect(viewportSpy).toHaveBeenCalledWith({
            width: 360,
            height: 600,
            offsetTop: 24,
            offsetLeft: 0,
            keyboardOffset: 0,
            keyboardOpen: false
        });
    });
});

describe('MobileInputUIController Enterキー挙動', () => {
    let controller;
    let inputEl;
    let handleSendSpy;

    beforeEach(() => {
        document.body.innerHTML = `
            <textarea id="mobile-dock-input"></textarea>
            <textarea id="mobile-composer-input"></textarea>
            <div id="mobile-input-dock"></div>
            <div id="mobile-composer"></div>
        `;
        inputEl = document.getElementById('mobile-dock-input');

        const mockFocusManager = {
            inputFocused: false,
            setActiveInput: vi.fn(),
            syncKeyboardState: vi.fn(),
            scheduleKeyboardSync: vi.fn(),
            clearKeyboardSync: vi.fn(),
            scrollInputIntoView: vi.fn(),
            getActiveInput: vi.fn(),
        };
        const mockDraftManager = { scheduleDraftSave: vi.fn() };
        const mockClipboardManager = {};
        const mockTerminalInput = { sendInput: vi.fn() };
        const mockSheetManager = {};

        controller = new MobileInputUIController(
            {
                dock: document.getElementById('mobile-input-dock'),
                dockInput: inputEl,
                composer: document.getElementById('mobile-composer'),
                composerInput: document.getElementById('mobile-composer-input'),
            },
            {
                focusManager: mockFocusManager,
                draftManager: mockDraftManager,
                clipboardManager: mockClipboardManager,
                terminalInput: mockTerminalInput,
                sheetManager: mockSheetManager,
            }
        );
        handleSendSpy = vi.spyOn(controller, 'handleSend').mockImplementation(() => {});
        controller.bindInputEventHandlers(inputEl, 'dock');
    });

    it('モバイルではEnterキーで送信されない（改行として扱う）', () => {
        const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: false });
        inputEl.dispatchEvent(event);
        expect(handleSendSpy).not.toHaveBeenCalled();
    });

    it('Shift+Enterでも送信されない', () => {
        const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true });
        inputEl.dispatchEvent(event);
        expect(handleSendSpy).not.toHaveBeenCalled();
    });
});

vi.mock('../../../public/modules/toast.js', () => ({
    showError: vi.fn(),
    showInfo: vi.fn(),
    showSuccess: vi.fn(),
}));

vi.mock('../../../public/modules/core/store.js', () => ({
    appStore: {
        getState: () => ({ currentSessionId: 'test-session' }),
    },
}));

vi.mock('../../../public/modules/core/event-bus.js', () => ({
    eventBus: { emit: vi.fn() },
    EVENTS: { MOBILE_INPUT_SENT: 'mobile:input:sent', MOBILE_INPUT_DRAFT_SAVED: 'mobile:input:draft:saved' },
}));

vi.mock('../../../public/modules/ui-helpers.js', () => ({
    refreshIcons: vi.fn(),
}));

vi.mock('../../../public/modules/utils/local-storage.js', () => ({
    loadJson: vi.fn((key, fallback) => {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        try { return JSON.parse(raw); } catch { return fallback; }
    }),
    saveJson: vi.fn((key, value) => {
        localStorage.setItem(key, JSON.stringify(value));
    }),
}));

describe('MobileInputUIController 二重送信防止', () => {
    let controller;
    let mockTerminalInput;
    let mockFocusManager;

    beforeEach(() => {
        document.body.innerHTML = `
            <textarea id="mobile-dock-input"></textarea>
            <textarea id="mobile-composer-input"></textarea>
            <div id="mobile-input-dock"></div>
            <div id="mobile-composer"></div>
            <button id="dock-send"></button>
            <div id="toast-container"></div>
        `;

        mockTerminalInput = {
            sendInput: vi.fn().mockResolvedValue(undefined),
        };
        mockFocusManager = {
            inputFocused: false,
            setActiveInput: vi.fn(),
            syncKeyboardState: vi.fn(),
            scheduleKeyboardSync: vi.fn(),
            clearKeyboardSync: vi.fn(),
            scrollInputIntoView: vi.fn(),
            getActiveInput: vi.fn(),
            refocusInput: vi.fn(),
        };

        controller = new MobileInputUIController(
            {
                dock: document.getElementById('mobile-input-dock'),
                dockInput: document.getElementById('mobile-dock-input'),
                dockSend: document.getElementById('dock-send'),
                composer: document.getElementById('mobile-composer'),
                composerInput: document.getElementById('mobile-composer-input'),
            },
            {
                focusManager: mockFocusManager,
                draftManager: { scheduleDraftSave: vi.fn(), saveDraftNow: vi.fn(), cancelPendingTimer: vi.fn() },
                clipboardManager: {},
                terminalInput: mockTerminalInput,
                sheetManager: {},
            }
        );
    });

    it('送信中に再度handleSendを呼んでも二重送信されない', async () => {
        let resolveFirst;
        mockTerminalInput.sendInput.mockImplementation(() => new Promise(r => { resolveFirst = r; }));

        const input = document.getElementById('mobile-dock-input');
        input.value = 'test message';

        // 1回目の送信開始（awaitしない）
        const first = controller.handleSend('dock');
        // 2回目の送信（送信中なのでスキップされるべき）
        const second = controller.handleSend('dock');

        resolveFirst();
        await first;
        await second;

        expect(mockTerminalInput.sendInput).toHaveBeenCalledTimes(1);
    });

    it('送信完了後は再送信が可能', async () => {
        const input = document.getElementById('mobile-dock-input');

        input.value = 'first';
        await controller.handleSend('dock');

        input.value = 'second';
        await controller.handleSend('dock');

        expect(mockTerminalInput.sendInput).toHaveBeenCalledTimes(2);
    });

    it('送信失敗後もロック解除され再送信が可能', async () => {
        mockTerminalInput.sendInput
            .mockRejectedValueOnce(new Error('network error'))
            .mockResolvedValueOnce(undefined);

        const input = document.getElementById('mobile-dock-input');

        input.value = 'retry me';
        await controller.handleSend('dock');

        input.value = 'retry me';
        await controller.handleSend('dock');

        expect(mockTerminalInput.sendInput).toHaveBeenCalledTimes(2);
    });

    it('送信中にボタンがdisabledになる', async () => {
        let resolveFirst;
        mockTerminalInput.sendInput.mockImplementation(() => new Promise(r => { resolveFirst = r; }));

        const input = document.getElementById('mobile-dock-input');
        const btn = document.getElementById('dock-send');
        input.value = 'test';

        const sendPromise = controller.handleSend('dock');
        expect(btn.disabled).toBe(true);
        expect(btn.classList.contains('sending')).toBe(true);

        resolveFirst();
        await sendPromise;

        expect(btn.disabled).toBe(false);
        expect(btn.classList.contains('sending')).toBe(false);
    });
});

describe('MobileInputDraftManager ドラフトクリア', () => {
    let draftManager;

    beforeEach(async () => {
        document.body.innerHTML = `
            <textarea id="mobile-dock-input"></textarea>
            <textarea id="mobile-composer-input"></textarea>
        `;

        const { MobileInputDraftManager } = await import('../../../public/modules/ui/mobile-input-draft-manager.js');
        draftManager = new MobileInputDraftManager({
            dockInput: document.getElementById('mobile-dock-input'),
            composerInput: document.getElementById('mobile-composer-input'),
        });
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('空文字の場合localStorageからドラフトが削除される', () => {
        const input = document.getElementById('mobile-dock-input');
        const key = 'bb_mobile_draft:test-session:dock';

        input.value = 'draft text';
        draftManager.saveDraft('dock', input);
        expect(localStorage.getItem(key)).not.toBeNull();

        input.value = '';
        draftManager.saveDraft('dock', input);
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('cancelPendingTimerでペンディングタイマーがキャンセルされる', () => {
        vi.useFakeTimers();
        const input = document.getElementById('mobile-dock-input');
        input.value = 'pending draft';

        draftManager.scheduleDraftSave('dock', input);
        draftManager.cancelPendingTimer('dock');

        vi.advanceTimersByTime(500);
        const key = 'bb_mobile_draft:test-session:dock';
        expect(localStorage.getItem(key)).toBeNull();

        vi.useRealTimers();
    });
});
