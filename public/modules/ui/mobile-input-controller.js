import { appStore } from '../core/store.js';
import { MobileInputFocusManager } from './mobile-input-focus-manager.js';
import { MobileInputDraftManager } from './mobile-input-draft-manager.js';
import { MobileClipboardManager } from './mobile-clipboard-manager.js';
import { MobileInputApiClient } from './mobile-input-api-client.js';
import { MobileInputSheetManager } from './mobile-input-sheet-manager.js';
import { MobileInputUIController } from './mobile-input-ui-controller.js';

export class MobileInputController {
    constructor({ httpClient, isMobile }) {
        this.httpClient = httpClient;
        this.isMobile = isMobile;
        this.elements = {};
        this.unsubscribeSession = null;
        this.focusManager = null;
        this.draftManager = null;
        this.clipboardManager = null;
        this.apiClient = null;
        this.sheetManager = null;
        this.uiController = null;
    }

    init() {
        if (!this.isMobile || !this.isMobile()) return;
        this.cacheElements();
        if (!this.elements.dock || !this.elements.composer) return;

        // マネージャーの初期化
        this.focusManager = new MobileInputFocusManager(this.elements);
        this.focusManager.init();
        this.draftManager = new MobileInputDraftManager(this.elements);
        this.clipboardManager = new MobileClipboardManager(this.elements);
        this.clipboardManager.init();
        this.apiClient = new MobileInputApiClient(this.httpClient);

        // UIコントローラーを先に初期化（sheetManagerのコールバックで使用するため）
        this.uiController = new MobileInputUIController(
            this.elements,
            {
                focusManager: this.focusManager,
                draftManager: this.draftManager,
                clipboardManager: this.clipboardManager,
                apiClient: this.apiClient,
                sheetManager: null  // 後で設定
            }
        );

        this.sheetManager = new MobileInputSheetManager(
            this.elements,
            this.clipboardManager,
            {
                onInsertText: (text) => this.uiController.insertTextAtCursor(text),
                onClose: () => this.sheetManager.closeSheets()
            }
        );
        this.sheetManager.init();

        // uiControllerにsheetManagerを設定
        this.uiController.sheetManager = this.sheetManager;
        this.uiController.init();

        this.bindSessionChanges();

        this.clipboardManager.updatePinsUI();
        this.draftManager.restoreDrafts();
        if (this.elements.dockInput) {
            this.uiController.autoResize(this.elements.dockInput);
        }
    }

    cacheElements() {
        this.elements = {
            dock: document.getElementById('mobile-input-dock'),
            dockInput: document.getElementById('mobile-dock-input'),
            dockSend: document.getElementById('mobile-dock-send'),
            dockMore: document.getElementById('mobile-dock-more'),
            dockSessions: document.getElementById('mobile-dock-sessions'),
            dockPaste: document.getElementById('mobile-dock-paste'),
            dockUploadImage: document.getElementById('mobile-dock-upload-image'),
            dockCopyTerminal: document.getElementById('mobile-dock-copy-terminal'),
            dockClear: document.getElementById('mobile-dock-clear'),
            dockEscape: document.getElementById('mobile-dock-escape'),
            dockShiftTab: document.getElementById('mobile-dock-shift-tab'),
            dockClipButtons: Array.from(document.querySelectorAll('[data-clip-slot="dock"]')),
            composer: document.getElementById('mobile-composer'),
            composerInput: document.getElementById('mobile-composer-input'),
            composerSend: document.getElementById('mobile-composer-send'),
            composerBack: document.getElementById('mobile-composer-back'),
            composerPaste: document.getElementById('mobile-composer-paste'),
            composerClipboard: document.getElementById('mobile-composer-clipboard'),
            composerSnippets: document.getElementById('mobile-composer-snippets'),
            composerActions: document.getElementById('mobile-composer-actions'),
            composerSelectToggle: document.getElementById('mobile-composer-select-toggle'),
            composerNetwork: document.getElementById('mobile-composer-network'),
            clipboardSheet: document.getElementById('mobile-clipboard-sheet'),
            snippetSheet: document.getElementById('mobile-snippet-sheet'),
            actionSheet: document.getElementById('mobile-action-sheet'),
            sheetOverlay: document.getElementById('mobile-input-sheet-overlay'),
            clipboardList: document.getElementById('mobile-clipboard-list'),
            snippetList: document.getElementById('mobile-snippet-list'),
            actionList: document.getElementById('mobile-action-list')
        };
    }

    getActiveInput() {
        return this.focusManager.getActiveInput();
    }

    bindSessionChanges() {
        this.unsubscribeSession = appStore.subscribeToSelector(
            state => state.currentSessionId,
            () => {
                this.draftManager.saveDraftNow('dock');
                this.draftManager.saveDraftNow('composer');
                this.draftManager.restoreDrafts();
                this.uiController.updateSendAvailability();
            }
        );
    }

    /**
     * 外部からテキスト挿入するための公開API
     * @param {string} text
     * @returns {boolean} 挿入成功時true
     */
    insertTextAtCursor(text) {
        if (!this.uiController || typeof this.uiController.insertTextAtCursor !== 'function') {
            return false;
        }
        this.uiController.insertTextAtCursor(text);
        return true;
    }

    destroy() {
        if (this.unsubscribeSession) {
            this.unsubscribeSession();
            this.unsubscribeSession = null;
        }
        if (this.focusManager) {
            this.focusManager.destroy();
        }
    }
}
