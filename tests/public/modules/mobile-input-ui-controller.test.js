import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../public/modules/core/store.js', () => {
    let state = {
        currentSessionId: 'session-1',
        ui: {}
    };
    return {
        appStore: {
            getState: () => state,
            setState: (updates) => {
                state = { ...state, ...updates };
            }
        }
    };
});

vi.mock('../../../public/modules/core/event-bus.js', () => ({
    eventBus: {
        emit: vi.fn()
    },
    EVENTS: {
        MOBILE_INPUT_OPENED: 'mobile-input:opened',
        MOBILE_INPUT_CLOSED: 'mobile-input:closed',
        MOBILE_INPUT_SENT: 'mobile-input:sent'
    }
}));

vi.mock('../../../public/modules/toast.js', () => ({
    showError: vi.fn(),
    showInfo: vi.fn(),
    showSuccess: vi.fn()
}));

import { MobileInputUIController } from '../../../public/modules/ui/mobile-input-ui-controller.js';

describe('MobileInputUIController cursor keys', () => {
    let ui;
    let elements;
    let managers;

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="dock">
                <button id="dock-up" data-mobile-cursor="up">↑</button>
                <textarea id="dock-input"></textarea>
            </div>
            <div id="composer">
                <button id="composer-left" data-mobile-cursor="left">←</button>
                <textarea id="composer-input"></textarea>
            </div>
        `;

        elements = {
            dock: document.getElementById('dock'),
            dockInput: document.getElementById('dock-input'),
            composer: document.getElementById('composer'),
            composerInput: document.getElementById('composer-input')
        };

        managers = {
            focusManager: {
                refocusInput: vi.fn(),
                getActiveInput: () => elements.dockInput
            },
            draftManager: {
                scheduleDraftSave: vi.fn()
            },
            clipboardManager: {},
            apiClient: {
                sendKey: vi.fn().mockResolvedValue({ success: true })
            },
            sheetManager: null
        };

        ui = new MobileInputUIController(elements, managers);
    });

    it('Dockの上キー押下時_ターミナルへUpキーを送信する', async () => {
        ui.bindCursorButtons(elements.dockInput, elements.dock);

        document.getElementById('dock-up').click();
        await vi.waitFor(() => {
            expect(managers.apiClient.sendKey).toHaveBeenCalledWith('session-1', 'Up');
        });
    });

    it('Composerの左キー押下時_入力欄カーソルを移動しターミナル送信しない', () => {
        elements.composerInput.value = 'abc';
        elements.composerInput.setSelectionRange(2, 2);

        ui.bindCursorButtons(elements.composerInput, elements.composer);

        document.getElementById('composer-left').click();

        expect(managers.apiClient.sendKey).not.toHaveBeenCalled();
        expect(elements.composerInput.selectionStart).toBe(1);
        expect(elements.composerInput.selectionEnd).toBe(1);
    });
});
