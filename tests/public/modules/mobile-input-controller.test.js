import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MobileInputFocusManager } from '../../../public/modules/ui/mobile-input-focus-manager.js';
import { MobileInputUIController } from '../../../public/modules/ui/mobile-input-ui-controller.js';

const mockAppState = vi.hoisted(() => ({
    currentSessionId: 'test-session',
    sessions: []
}));

const mockDraftStorage = vi.hoisted(() => new Map());

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

    it('keyboard-open中も下ナビゲーションバーを表示したままにする', () => {
        const bottomNav = document.createElement('nav');
        bottomNav.id = 'mobile-bottom-nav';
        bottomNav.style.display = 'none';
        document.body.appendChild(bottomNav);
        document.body.classList.add('keyboard-open');
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390);

        focusManager.updateBottomNavVisibility();

        expect(bottomNav.style.display).toBe('flex');
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
        getState: () => mockAppState,
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
        const raw = mockDraftStorage.get(key) ?? null;
        if (!raw) return fallback;
        try { return JSON.parse(raw); } catch { return fallback; }
    }),
    saveJson: vi.fn((key, value) => {
        mockDraftStorage.set(key, JSON.stringify(value));
    }),
}));

describe('MobileInputUIController 二重送信防止', () => {
    let controller;
    let mockTerminalInput;
    let mockFocusManager;

    beforeEach(() => {
        mockAppState.currentSessionId = 'test-session';
        mockAppState.sessions = [];
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
            sendKey: vi.fn().mockResolvedValue(undefined),
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

    it('codexセッションでは送信後にEnterキーも送信する', async () => {
        mockAppState.sessions = [{ id: 'test-session', engine: 'codex' }];
        vi.spyOn(controller, 'waitForSubmitKeyReady').mockResolvedValue(undefined);

        const input = document.getElementById('mobile-dock-input');
        input.value = 'run codex';
        await controller.handleSend('dock');

        expect(mockTerminalInput.sendInput).toHaveBeenCalledWith('test-session', 'run codex');
        expect(mockTerminalInput.sendKey).toHaveBeenCalledWith('test-session', 'Enter');
    });

    it('claudeセッションでは追加Enterを送らない', async () => {
        mockAppState.sessions = [{ id: 'test-session', engine: 'claude' }];

        const input = document.getElementById('mobile-dock-input');
        input.value = 'run claude';
        await controller.handleSend('dock');

        expect(mockTerminalInput.sendInput).toHaveBeenCalledWith('test-session', 'run claude');
        expect(mockTerminalInput.sendKey).not.toHaveBeenCalled();
    });

    it('入力空のearly returnでもボタンが一瞬disabledになりロックは解放される', async () => {
        const input = document.getElementById('mobile-dock-input');
        const btn = document.getElementById('dock-send');
        input.value = '';  // 空入力 → showInfo + early return

        const updateSpy = vi.spyOn(controller, '_updateSendButton');
        await controller.handleSend('dock');

        // 早期 disabled が呼ばれる（true → false）
        expect(updateSpy).toHaveBeenCalledWith('dock', true);
        expect(updateSpy).toHaveBeenCalledWith('dock', false);
        // ボタンは finally で false に戻る
        expect(btn.disabled).toBe(false);
        // _sending lock も解放
        expect(controller._sending).toBe(false);
        // sendInput は呼ばれない（early return）
        expect(mockTerminalInput.sendInput).not.toHaveBeenCalled();
    });

    it('オフライン時のearly returnでもロックは解放される', async () => {
        controller.isOnline = false;
        const input = document.getElementById('mobile-dock-input');
        input.value = 'something';

        await controller.handleSend('dock');

        expect(controller._sending).toBe(false);
        expect(mockTerminalInput.sendInput).not.toHaveBeenCalled();
    });

    it('sessionId未設定のearly returnでもロックは解放される', async () => {
        mockAppState.currentSessionId = null;
        const input = document.getElementById('mobile-dock-input');
        input.value = 'msg';

        await controller.handleSend('dock');

        expect(controller._sending).toBe(false);
        expect(mockTerminalInput.sendInput).not.toHaveBeenCalled();
    });

    it('セッション一覧未ロード時はDOMのdata-engineでcodex判定する', async () => {
        mockAppState.sessions = [];
        document.body.insertAdjacentHTML('beforeend', '<div data-id="test-session" data-engine="codex"></div>');
        vi.spyOn(controller, 'waitForSubmitKeyReady').mockResolvedValue(undefined);

        const input = document.getElementById('mobile-dock-input');
        input.value = 'dom fallback';
        await controller.handleSend('dock');

        expect(mockTerminalInput.sendKey).toHaveBeenCalledWith('test-session', 'Enter');
    });
});

describe('MobileInputDraftManager ドラフトクリア', () => {
    let draftManager;
    let originalWindowLocalStorage;
    let originalGlobalLocalStorage;

    beforeEach(async () => {
        mockDraftStorage.clear();
        mockAppState.currentSessionId = 'test-session';
        mockAppState.sessions = [];
        originalWindowLocalStorage = window.localStorage;
        originalGlobalLocalStorage = globalThis.localStorage;
        const storageShim = {
            getItem: (key) => mockDraftStorage.get(key) ?? null,
            setItem: (key, value) => mockDraftStorage.set(key, String(value)),
            removeItem: (key) => mockDraftStorage.delete(key),
            clear: () => mockDraftStorage.clear()
        };
        Object.defineProperty(window, 'localStorage', { value: storageShim, configurable: true });
        Object.defineProperty(globalThis, 'localStorage', { value: storageShim, configurable: true });
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
        mockDraftStorage.clear();
        Object.defineProperty(window, 'localStorage', { value: originalWindowLocalStorage, configurable: true });
        Object.defineProperty(globalThis, 'localStorage', { value: originalGlobalLocalStorage, configurable: true });
    });

    it('空文字の場合localStorageからドラフトが削除される', () => {
        const input = document.getElementById('mobile-dock-input');
        const key = 'bb_mobile_draft:test-session:dock';

        input.value = 'draft text';
        draftManager.saveDraft('dock', input);
        expect(mockDraftStorage.get(key)).toBeTruthy();

        input.value = '';
        draftManager.saveDraft('dock', input);
        expect(mockDraftStorage.has(key)).toBe(false);
    });

    it('cancelPendingTimerでペンディングタイマーがキャンセルされる', () => {
        vi.useFakeTimers();
        const input = document.getElementById('mobile-dock-input');
        input.value = 'pending draft';

        draftManager.scheduleDraftSave('dock', input);
        draftManager.cancelPendingTimer('dock');

        vi.advanceTimersByTime(500);
        const key = 'bb_mobile_draft:test-session:dock';
        expect(mockDraftStorage.has(key)).toBe(false);

        vi.useRealTimers();
    });

    it('復元先セッションにドラフトがない場合は前セッションの入力を残さない', () => {
        const input = document.getElementById('mobile-dock-input');
        input.value = 'old session text';
        input.setSelectionRange(4, 4);

        draftManager.restoreDraftFor('dock', 'empty-session', input);

        expect(input.value).toBe('');
        expect(input.selectionStart).toBe(0);
        expect(input.selectionEnd).toBe(0);
    });
});
