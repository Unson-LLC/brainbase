import { appStore } from '../core/store.js';
import { eventBus, EVENTS } from '../core/event-bus.js';
import { showError, showInfo, showSuccess } from '../toast.js';
import {
    DEFAULT_HISTORY_LIMIT,
    DEFAULT_PIN_SLOTS,
    calcKeyboardOffset,
    findWordBoundaryLeft,
    findWordBoundaryRight,
    normalizeHistory,
    pushHistory
} from './mobile-input-utils.js';

const STORAGE_KEYS = {
    history: 'bb_mobile_clipboard_history',
    pins: 'bb_mobile_clipboard_pins',
    snippets: 'bb_mobile_snippets',
    draft: 'bb_mobile_draft'
};

export class MobileInputController {
    constructor({ httpClient, isMobile }) {
        this.httpClient = httpClient;
        this.isMobile = isMobile;
        this.elements = {};
        this.selectionMode = false;
        this.history = [];
        this.pins = Array.from({ length: DEFAULT_PIN_SLOTS }, () => null);
        this.snippets = [];
        this.draftTimers = {};
        this.isOnline = true;
        this.unsubscribeSession = null;
        this.viewport = null;
        this.viewportHandler = null;
        this.viewportBaseline = 0;
        this.viewportWidth = 0;
        this.keyboardDebug = null;
        this.keyboardDebugDock = null;
        this.keyboardDebugMode = false;
        this.lastKeyboardData = null;
        this.lastKeyboardOffset = 0;
        this.inputFocused = false;
        this.keyboardSyncTimer = null;
    }

    init() {
        if (!this.isMobile || !this.isMobile()) return;
        this.cacheElements();
        if (!this.elements.dock || !this.elements.composer) return;

        this.history = normalizeHistory(this.loadJson(STORAGE_KEYS.history, []), DEFAULT_HISTORY_LIMIT);
        this.pins = this.loadPins();
        this.snippets = this.loadJson(STORAGE_KEYS.snippets, []);

        this.bindDock();
        this.bindComposer();
        this.bindSheets();
        this.bindNetworkStatus();
        this.bindSessionChanges();
        this.bindViewportResize();
        this.bindKeyboardDebug();

        this.updatePinsUI();
        this.restoreDrafts();
        this.updateSendAvailability();
        this.setDockExpanded(false);
    }

    cacheElements() {
        this.elements = {
            dock: document.getElementById('mobile-input-dock'),
            dockInput: document.getElementById('mobile-dock-input'),
            dockSend: document.getElementById('mobile-dock-send'),
            dockMore: document.getElementById('mobile-dock-more'),
            dockExpand: document.getElementById('mobile-dock-expand'),
            dockPaste: document.getElementById('mobile-dock-paste'),
            dockClipboard: document.getElementById('mobile-dock-clipboard'),
            dockSnippets: document.getElementById('mobile-dock-snippets'),
            dockSnippetAdd: document.getElementById('mobile-dock-snippet-add'),
            dockUploadImage: document.getElementById('mobile-dock-upload-image'),
            dockCopyTerminal: document.getElementById('mobile-dock-copy-terminal'),
            dockClear: document.getElementById('mobile-dock-clear'),
            dockEscape: document.getElementById('mobile-dock-escape'),
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

    bindDock() {
        const { dockInput, dockSend, dockMore, dockExpand, dockClipboard, dockSnippets, dockSnippetAdd, dockPaste, dockUploadImage, dockCopyTerminal, dockClear, dockEscape } = this.elements;
        dockInput?.addEventListener('focus', () => {
            this.inputFocused = true;
            this.setActiveInput(dockInput);
            this.syncKeyboardState();
            this.scheduleKeyboardSync();
            this.scrollInputIntoView(dockInput);
        });
        dockInput?.addEventListener('blur', () => {
            this.inputFocused = false;
            this.syncKeyboardState();
            this.clearKeyboardSync();
        });
        dockInput?.addEventListener('input', () => {
            this.autoResize(dockInput);
            this.scheduleDraftSave('dock', dockInput);
        });

        dockSend?.addEventListener('click', () => {
            this.handleSend('dock');
            // Early return（セッション未選択等）の場合は入力欄が残るのでrefocus必要
            this.refocusInput(dockInput);
        });
        dockMore?.addEventListener('click', () => {
            this.toggleDockExpanded();
            this.refocusInput(dockInput);
        });
        dockExpand?.addEventListener('click', () => this.openComposer());
        dockPaste?.addEventListener('click', () => {
            this.pasteFromClipboard();
            this.refocusInput(dockInput);
        });
        dockClipboard?.addEventListener('click', () => this.openClipboardSheet());
        dockSnippets?.addEventListener('click', () => this.openSnippetSheet());
        dockSnippetAdd?.addEventListener('click', () => {
            this.addSnippetFromSelection();
            this.refocusInput(dockInput);
        });
        dockUploadImage?.addEventListener('click', () => {
            this.handleUploadImage();
            this.refocusInput(dockInput);
        });
        dockCopyTerminal?.addEventListener('click', () => {
            this.handleCopyTerminal();
            // モーダルが開くので refocus 不要
        });
        dockClear?.addEventListener('click', () => {
            this.handleClear();
            this.refocusInput(dockInput);
        });
        dockEscape?.addEventListener('click', () => {
            this.handleEscape();
            this.refocusInput(dockInput);
        });

        this.elements.dockClipButtons.forEach((button, index) => {
            button.addEventListener('click', () => this.handleClipSlot(index));
            this.bindLongPressClear(button, index);
        });

        this.bindCursorButtons(dockInput, this.elements.dock);
    }

    bindComposer() {
        const {
            composer,
            composerInput,
            composerSend,
            composerBack,
            composerPaste,
            composerClipboard,
            composerSnippets,
            composerActions,
            composerSelectToggle
        } = this.elements;

        composerInput?.addEventListener('focus', () => {
            this.inputFocused = true;
            this.setActiveInput(composerInput);
            this.syncKeyboardState();
            this.scheduleKeyboardSync();
        });
        composerInput?.addEventListener('blur', () => {
            this.inputFocused = false;
            this.syncKeyboardState();
            this.clearKeyboardSync();
        });
        composerInput?.addEventListener('input', () => {
            this.autoResize(composerInput);
            this.scheduleDraftSave('composer', composerInput);
        });

        composerSend?.addEventListener('click', () => {
            this.handleSend('composer');
            // Early return（セッション未選択等）の場合は入力欄が残るのでrefocus必要
            this.refocusInput(composerInput);
        });
        composerBack?.addEventListener('click', () => this.closeComposer(true));
        composerPaste?.addEventListener('click', () => this.pasteFromClipboard());
        composerClipboard?.addEventListener('click', () => this.openClipboardSheet());
        composerSnippets?.addEventListener('click', () => this.openSnippetSheet());
        composerActions?.addEventListener('click', () => this.openActionSheet());
        composerSelectToggle?.addEventListener('click', () => this.toggleSelectionMode(composerSelectToggle));

        composer?.addEventListener('click', (event) => {
            if (event.target === composer) {
                this.closeComposer(true);
            }
        });

        this.bindCursorButtons(composerInput, this.elements.composer);
        this.bindFormatButtons(this.elements.composer);
    }

    bindSheets() {
        const { sheetOverlay, clipboardSheet, snippetSheet, actionSheet } = this.elements;
        sheetOverlay?.addEventListener('click', () => this.closeSheets());
        clipboardSheet?.querySelector('.mobile-input-sheet-close')?.addEventListener('click', () => this.closeSheets());
        snippetSheet?.querySelector('.mobile-input-sheet-close')?.addEventListener('click', () => this.closeSheets());
        actionSheet?.querySelector('.mobile-input-sheet-close')?.addEventListener('click', () => this.closeSheets());
    }

    bindNetworkStatus() {
        this.isOnline = navigator.onLine;
        this.updateNetworkState();
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.updateNetworkState();
        });
        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.updateNetworkState();
        });
    }

    bindViewportResize() {
        if (!window.visualViewport) return;
        this.viewport = window.visualViewport;

        const update = () => {
            const viewportWidth = this.viewport.width || 0;
            if (!this.viewportBaseline || viewportWidth !== this.viewportWidth) {
                this.viewportBaseline = this.viewport.height;
                this.viewportWidth = viewportWidth;
            } else if (this.viewport.height > this.viewportBaseline) {
                this.viewportBaseline = this.viewport.height;
            }

            const baseline = this.viewportBaseline || this.viewport.height;
            const heightDelta = Math.max(0, baseline - this.viewport.height);
            const rawOffset = calcKeyboardOffset(baseline, this.viewport.height, this.viewport.offsetTop);
            const dockRect = this.elements.dock?.getBoundingClientRect();
            const visualHeight = this.viewport.height || window.innerHeight;
            // getBoundingClientRect() returns document coordinates, so adjust for visualViewport.offsetTop
            const dockGap = dockRect ? Math.round(visualHeight - (dockRect.bottom - this.viewport.offsetTop)) : 0;
            let offset = rawOffset > 0 ? rawOffset : heightDelta;
            const focusOpen = this.isInputFocused();
            // 安定化: offset が大きい場合は確実にキーボードが表示されている
            // offset が小さくてもフォーカスがあればキーボード表示中と判断
            let keyboardOpen = offset > 20 || (offset > 0 && focusOpen) || focusOpen;
            if (focusOpen && offset > 0) {
                // dockGap > 0: Dock is above visualViewport bottom -> reduce offset
                // dockGap < 0: Dock is below visualViewport bottom -> increase offset
                offset = Math.max(0, offset - dockGap);
            }
            // FIXME: この処理が逆効果になっている可能性
            // offset=0の時にdockGapを足すと、Dockがさらに上に浮いてしまう
            // if (focusOpen && offset === 0 && dockGap > 0) {
            //     offset = dockGap;
            //     keyboardOpen = true;
            // }
            document.body.style.setProperty('--keyboard-offset', `${offset}px`);
            document.documentElement.style.setProperty('--vvh', `${Math.round(this.viewport.height)}px`);
            document.documentElement.style.setProperty('--vv-top', `${Math.round(this.viewport.offsetTop || 0)}px`);
            document.documentElement.style.setProperty('--vv-left', `${Math.round(this.viewport.offsetLeft || 0)}px`);
            document.body.classList.toggle('keyboard-open', keyboardOpen);
            this.lastKeyboardOffset = offset;
            this.lastKeyboardData = { baseline, heightDelta, rawOffset, offset, keyboardOpen, dockGap, visualHeight };
            this.updateKeyboardDebug(this.lastKeyboardData);
        };

        this.viewportHandler = update;
        update();
        this.viewport.addEventListener('resize', update);
        this.viewport.addEventListener('scroll', update);
    }

    bindKeyboardDebug() {
        const params = new URLSearchParams(window.location.search);
        if (!params.has('kbdDebug') && localStorage.getItem('bb_keyboard_debug') !== '1') return;
        this.keyboardDebugMode = true;

        const panel = document.createElement('div');
        panel.className = 'keyboard-debug-panel';
        panel.style.position = 'fixed';
        panel.style.top = '8px';
        panel.style.right = '8px';
        panel.style.zIndex = '2005';
        panel.style.padding = '6px 8px';
        panel.style.borderRadius = '8px';
        panel.style.background = 'rgba(0, 0, 0, 0.75)';
        panel.style.color = '#a7f3d0';
        panel.style.fontSize = '10px';
        panel.style.fontFamily = 'monospace';
        panel.style.pointerEvents = 'none';
        panel.textContent = 'keyboard debug';
        document.body.appendChild(panel);
        this.keyboardDebug = panel;

        if (this.elements.dock) {
            const dockPanel = document.createElement('div');
            dockPanel.className = 'keyboard-debug-dock';
            dockPanel.textContent = 'keyboard debug';
            this.elements.dock.prepend(dockPanel);
            this.keyboardDebugDock = dockPanel;
        }
    }

    updateKeyboardDebug(data) {
        if (!this.keyboardDebug || !this.viewport) return;
        const dockRect = this.elements.dock?.getBoundingClientRect();
        const consoleRect = document.querySelector('.console-area')?.getBoundingClientRect();
        const mainRect = document.querySelector('.main-content')?.getBoundingClientRect();
        const bodyStyles = window.getComputedStyle(document.body);
        const mobileOffset = bodyStyles.getPropertyValue('--mobile-input-offset').trim();
        const keyboardOffset = bodyStyles.getPropertyValue('--keyboard-offset').trim();
        const visualHeight = data.visualHeight || this.viewport.height || window.innerHeight;
        const dockGap = typeof data.dockGap === 'number'
            ? data.dockGap
            : (dockRect ? Math.round(visualHeight - (dockRect.bottom - this.viewport.offsetTop)) : 0);
        const focused = this.isInputFocused();
        const lines = [
            `inner=${window.innerHeight}`,
            `vvH=${Math.round(this.viewport.height)}`,
            `vvTop=${Math.round(this.viewport.offsetTop || 0)}`,
            `vvB=${Math.round(visualHeight)}`,
            `base=${Math.round(data.baseline || 0)}`,
            `delta=${Math.round(data.heightDelta || 0)}`,
            `raw=${Math.round(data.rawOffset || 0)}`,
            `off=${Math.round(data.offset || 0)}`,
            `open=${data.keyboardOpen ? '1' : '0'}`,
            `focus=${focused ? '1' : '0'}`,
            `dockGap=${dockGap}`,
            `dockH=${dockRect ? Math.round(dockRect.height) : 0}`,
            `consoleH=${consoleRect ? Math.round(consoleRect.height) : 0}`,
            `mainH=${mainRect ? Math.round(mainRect.height) : 0}`,
            `mobOff=${mobileOffset || '0'}`,
            `keyOff=${keyboardOffset || '0'}`
        ];
        this.keyboardDebug.textContent = lines.join(' ');
        if (this.keyboardDebugDock) {
            this.keyboardDebugDock.textContent = lines.join(' ');
        }
    }

    syncKeyboardState() {
        if (this.viewportHandler) {
            this.viewportHandler();
        }
        const focused = this.isInputFocused();
        if (focused) {
            document.body.classList.add('keyboard-open');
        } else if (this.lastKeyboardOffset === 0) {
            document.body.classList.remove('keyboard-open');
        }
        if (this.lastKeyboardData) {
            this.updateKeyboardDebug(this.lastKeyboardData);
        }
    }

    bindSessionChanges() {
        this.unsubscribeSession = appStore.subscribeToSelector(
            state => state.currentSessionId,
            () => {
                this.saveDraftNow('dock');
                this.saveDraftNow('composer');
                this.restoreDrafts();
                this.updateSendAvailability();
            }
        );
    }

    bindCursorButtons(inputEl, container) {
        const root = container || document;
        const buttons = root.querySelectorAll('[data-mobile-cursor]');
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                const action = button.getAttribute('data-mobile-cursor');
                if (action === 'enter') {
                    this.sendEnterKey();
                    this.refocusInput(inputEl);
                } else {
                    this.moveCursor(inputEl, action);
                    this.refocusInput(inputEl);
                }
            });
        });
    }

    bindFormatButtons(container) {
        const root = container || document;
        const buttons = root.querySelectorAll('[data-mobile-format]');
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                const format = button.getAttribute('data-mobile-format');
                this.applyFormat(format);
            });
        });
    }

    setActiveInput(inputEl) {
        this.activeInput = inputEl;
        if (this.viewport) {
            const viewportWidth = this.viewport.width || 0;
            if (!this.viewportBaseline || viewportWidth !== this.viewportWidth || this.viewport.height > this.viewportBaseline) {
                this.viewportBaseline = this.viewport.height;
                this.viewportWidth = viewportWidth;
            }
        }
    }

    isInputFocused() {
        const active = document.activeElement;
        const terminalFrame = document.getElementById('terminal-frame');
        return this.inputFocused || active === this.elements.dockInput || active === this.elements.composerInput || active === terminalFrame;
    }

    scheduleKeyboardSync() {
        this.clearKeyboardSync();
        this.keyboardSyncTimer = window.setTimeout(() => {
            this.syncKeyboardState();
        }, 280);
    }

    clearKeyboardSync() {
        if (this.keyboardSyncTimer) {
            window.clearTimeout(this.keyboardSyncTimer);
            this.keyboardSyncTimer = null;
        }
    }

    getActiveInput() {
        if (this.elements.composer?.classList.contains('active')) {
            return this.elements.composerInput;
        }
        return this.activeInput || this.elements.dockInput;
    }

    openComposer() {
        const { composer, composerInput, dockInput } = this.elements;
        if (!composer || !composerInput) return;

        composer.classList.add('active');
        document.body.classList.add('mobile-composer-open');
        this.setDockExpanded(false);

        if (!composerInput.value && dockInput?.value) {
            composerInput.value = dockInput.value;
        }

        this.autoResize(composerInput);
        composerInput.focus();
        this.selectionMode = false;
        this.updateSelectionToggle();

        eventBus.emit(EVENTS.MOBILE_INPUT_OPENED, { mode: 'composer' });
        this.updateStoreState({ composerOpen: true, mode: 'composer' });
    }

    closeComposer(syncToDock) {
        const { composer, composerInput, dockInput } = this.elements;
        if (!composer) return;

        if (syncToDock && dockInput && composerInput) {
            dockInput.value = composerInput.value;
            this.autoResize(dockInput);
            this.scheduleDraftSave('dock', dockInput);
        }

        composer.classList.remove('active');
        document.body.classList.remove('mobile-composer-open');
        eventBus.emit(EVENTS.MOBILE_INPUT_CLOSED, { mode: 'composer' });
        this.updateStoreState({ composerOpen: false, mode: 'dock' });
    }

    toggleDockExpanded() {
        const isExpanded = this.elements.dock?.classList.contains('expanded');
        this.setDockExpanded(!isExpanded);
    }

    setDockExpanded(expanded) {
        const { dock, dockMore } = this.elements;
        if (!dock || !dockMore) return;
        dock.classList.toggle('expanded', expanded);
        dock.classList.toggle('compact', !expanded);
        document.body.classList.toggle('mobile-input-expanded', expanded);
        dockMore.textContent = expanded ? 'Less' : 'More';
    }

    async handleSend(mode) {
        const inputEl = mode === 'composer' ? this.elements.composerInput : this.elements.dockInput;
        if (!inputEl) return;

        const rawValue = inputEl.value;
        if (!rawValue || rawValue.trim().length === 0) {
            showInfo('入力が空だよ');
            return;
        }

        if (!this.isOnline) {
            showInfo('オフライン中は送信できないよ');
            return;
        }

        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) {
            showInfo('セッションを選択してね');
            return;
        }

        const payload = rawValue.endsWith('\n') ? rawValue.slice(0, -1) : rawValue;

        try {
            await this.httpClient.post(`/api/sessions/${sessionId}/input`, {
                input: payload,
                type: 'text'
            });
            await this.httpClient.post(`/api/sessions/${sessionId}/input`, {
                input: 'Enter',
                type: 'key'
            });

            inputEl.value = '';
            this.autoResize(inputEl);
            this.saveDraftNow(mode);
            eventBus.emit(EVENTS.MOBILE_INPUT_SENT, { mode, sessionId });
            showSuccess('送信したよ');

            // 送信後も入力欄にフォーカスを維持（連続入力のため）
            setTimeout(() => {
                inputEl.focus();
                this.scrollInputIntoView(inputEl);
            }, 100);
        } catch (error) {
            console.error('Failed to send mobile input:', error);
            showError('送信に失敗したよ');
        }
    }

    moveCursor(inputEl, action) {
        if (!inputEl) return;

        const value = inputEl.value || '';
        let start = inputEl.selectionStart ?? 0;
        let end = inputEl.selectionEnd ?? 0;

        const directionMap = {
            left: -1,
            'word-left': -1,
            'line-start': -1,
            right: 1,
            'word-right': 1,
            'line-end': 1
        };
        const direction = directionMap[action] ?? 1;

        let newPos = start;
        if (!this.selectionMode) {
            const base = direction < 0 ? start : end;
            newPos = this.resolveCursorPosition(value, base, action);
            inputEl.setSelectionRange(newPos, newPos);
        } else {
            if (direction < 0) {
                const newStart = this.resolveCursorPosition(value, start, action);
                inputEl.setSelectionRange(newStart, end);
            } else {
                const newEnd = this.resolveCursorPosition(value, end, action);
                inputEl.setSelectionRange(start, newEnd);
            }
        }

        inputEl.focus();
        this.scheduleDraftSave(inputEl === this.elements.composerInput ? 'composer' : 'dock', inputEl);
    }

    resolveCursorPosition(text, index, action) {
        switch (action) {
            case 'left':
                return Math.max(0, index - 1);
            case 'right':
                return Math.min(text.length, index + 1);
            case 'up':
                return this.findLineUp(text, index);
            case 'down':
                return this.findLineDown(text, index);
            case 'word-left':
                return findWordBoundaryLeft(text, index);
            case 'word-right':
                return findWordBoundaryRight(text, index);
            case 'line-start':
                return this.findLineStart(text, index);
            case 'line-end':
                return this.findLineEnd(text, index);
            default:
                return index;
        }
    }

    findLineStart(text, index) {
        const prevBreak = text.lastIndexOf('\n', Math.max(0, index - 1));
        return prevBreak === -1 ? 0 : prevBreak + 1;
    }

    findLineEnd(text, index) {
        const nextBreak = text.indexOf('\n', index);
        return nextBreak === -1 ? text.length : nextBreak;
    }

    findLineUp(text, index) {
        // Find current line start
        const currentLineStart = this.findLineStart(text, index);
        const columnOffset = index - currentLineStart;

        // If already on first line, stay at start
        if (currentLineStart === 0) {
            return 0;
        }

        // Find previous line start
        const prevLineStart = this.findLineStart(text, currentLineStart - 1);
        const prevLineEnd = currentLineStart - 1; // \n position
        const prevLineLength = prevLineEnd - prevLineStart;

        // Move to same column on previous line, or line end if shorter
        return prevLineStart + Math.min(columnOffset, prevLineLength);
    }

    findLineDown(text, index) {
        // Find current line start and end
        const currentLineStart = this.findLineStart(text, index);
        const currentLineEnd = this.findLineEnd(text, index);
        const columnOffset = index - currentLineStart;

        // If already on last line, stay at end
        if (currentLineEnd === text.length) {
            return text.length;
        }

        // Find next line start and end
        const nextLineStart = currentLineEnd + 1; // after \n
        const nextLineEnd = this.findLineEnd(text, nextLineStart);
        const nextLineLength = nextLineEnd - nextLineStart;

        // Move to same column on next line, or line end if shorter
        return nextLineStart + Math.min(columnOffset, nextLineLength);
    }

    toggleSelectionMode(buttonEl) {
        this.selectionMode = !this.selectionMode;
        this.updateSelectionToggle();
        if (buttonEl) {
            buttonEl.classList.toggle('active', this.selectionMode);
        }
    }

    updateSelectionToggle() {
        const { dockSelectToggle, composerSelectToggle } = this.elements;
        [dockSelectToggle, composerSelectToggle].forEach(button => {
            if (button) {
                button.classList.toggle('active', this.selectionMode);
            }
        });
        this.updateStoreState({ selectionMode: this.selectionMode });
    }

    applyFormat(format) {
        const inputEl = this.elements.composerInput;
        if (!inputEl || !format) return;

        const value = inputEl.value;
        const start = inputEl.selectionStart ?? 0;
        const end = inputEl.selectionEnd ?? 0;
        const selection = value.slice(start, end);

        let updated = value;
        let cursorStart = start;
        let cursorEnd = end;

        if (format === 'h1') {
            const { lineStart, lineEnd } = this.getLineRange(value, start, end);
            const line = value.slice(lineStart, lineEnd);
            const prefix = line.startsWith('# ') ? '' : '# ';
            updated = value.slice(0, lineStart) + prefix + line + value.slice(lineEnd);
            cursorStart = lineStart + prefix.length;
            cursorEnd = cursorStart + line.length;
        } else if (format === 'list') {
            const { lineStart, lineEnd } = this.getLineRange(value, start, end);
            const segment = value.slice(lineStart, lineEnd);
            const lines = segment.split('\n');
            const updatedLines = lines.map(line => (line.startsWith('- ') ? line : `- ${line}`));
            const newSegment = updatedLines.join('\n');
            updated = value.slice(0, lineStart) + newSegment + value.slice(lineEnd);
            cursorStart = lineStart;
            cursorEnd = lineStart + newSegment.length;
        } else if (format === 'quote') {
            const { lineStart, lineEnd } = this.getLineRange(value, start, end);
            const segment = value.slice(lineStart, lineEnd);
            const lines = segment.split('\n');
            const updatedLines = lines.map(line => (line.startsWith('> ') ? line : `> ${line}`));
            const newSegment = updatedLines.join('\n');
            updated = value.slice(0, lineStart) + newSegment + value.slice(lineEnd);
            cursorStart = lineStart;
            cursorEnd = lineStart + newSegment.length;
        } else if (format === 'code') {
            const wrapped = selection ? `\n\n\`\`\`\n${selection}\n\`\`\`\n` : '\n\n\`\`\`\n\n\`\`\`\n';
            updated = value.slice(0, start) + wrapped + value.slice(end);
            cursorStart = start + wrapped.length - 4;
            cursorEnd = cursorStart;
        }

        inputEl.value = updated;
        inputEl.setSelectionRange(cursorStart, cursorEnd);
        this.autoResize(inputEl);
        this.scheduleDraftSave('composer', inputEl);
    }

    getLineRange(text, start, end) {
        const rangeStart = this.findLineStart(text, start);
        const rangeEnd = this.findLineEnd(text, end);
        return { lineStart: rangeStart, lineEnd: rangeEnd };
    }

    async handleClipSlot(index) {
        const pinned = this.pins[index];
        if (pinned) {
            this.insertTextAtCursor(pinned);
            return;
        }

        const clipboard = await this.readClipboardText();
        if (!clipboard) return;

        this.pins[index] = clipboard;
        this.savePins();
        this.updatePinsUI();
        showSuccess('クリップを保存したよ');
    }

    bindLongPressClear(button, index) {
        let timer = null;
        const clear = () => {
            if (!this.pins[index]) return;
            this.pins[index] = null;
            this.savePins();
            this.updatePinsUI();
            showInfo('クリップをクリアしたよ');
        };

        button.addEventListener('touchstart', () => {
            timer = setTimeout(clear, 600);
        });
        button.addEventListener('touchend', () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        });
        button.addEventListener('touchcancel', () => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        });
    }

    async readClipboardText() {
        if (!navigator.clipboard || !navigator.clipboard.readText) {
            showInfo('クリップボード読み取りに対応してないよ');
            return '';
        }

        try {
            const text = await navigator.clipboard.readText();
            if (!text) {
                showInfo('クリップボードが空だよ');
            } else {
                this.history = pushHistory(this.history, text, DEFAULT_HISTORY_LIMIT);
                this.saveHistory();
            }
            return text;
        } catch (error) {
            console.error('Failed to read clipboard:', error);
            showInfo('クリップボードの読み取りに失敗したよ');
            return '';
        }
    }

    async pasteFromClipboard() {
        const text = await this.readClipboardText();
        if (!text) return;
        this.insertTextAtCursor(text);
    }

    insertTextAtCursor(text) {
        const inputEl = this.getActiveInput();
        if (!inputEl) return;

        const start = inputEl.selectionStart ?? inputEl.value.length;
        const end = inputEl.selectionEnd ?? inputEl.value.length;
        const value = inputEl.value;
        inputEl.value = value.slice(0, start) + text + value.slice(end);
        const nextPos = start + text.length;
        inputEl.setSelectionRange(nextPos, nextPos);
        inputEl.focus();
        this.autoResize(inputEl);
        this.scheduleDraftSave(inputEl === this.elements.composerInput ? 'composer' : 'dock', inputEl);
    }

    updatePinsUI() {
        this.elements.dockClipButtons.forEach((button, index) => {
            const pinned = this.pins[index];
            button.textContent = pinned ? `Clip${index + 1}` : `Clip${index + 1}`;
            button.classList.toggle('filled', Boolean(pinned));
            button.setAttribute('title', pinned ? pinned.slice(0, 120) : '空');
        });
    }

    openClipboardSheet() {
        this.renderClipboardList();
        this.openSheet(this.elements.clipboardSheet);
    }

    renderClipboardList() {
        const { clipboardList } = this.elements;
        if (!clipboardList) return;
        clipboardList.innerHTML = '';

        if (this.history.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'mobile-input-empty';
            empty.textContent = '履歴がないよ';
            clipboardList.appendChild(empty);
            return;
        }

        this.history.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'mobile-input-row';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'mobile-input-row-main';
            button.textContent = item;
            button.addEventListener('click', () => {
                this.insertTextAtCursor(item);
                this.closeSheets();
            });

            const pinWrap = document.createElement('div');
            pinWrap.className = 'mobile-input-row-actions';
            for (let i = 0; i < DEFAULT_PIN_SLOTS; i += 1) {
                const pinButton = document.createElement('button');
                pinButton.type = 'button';
                pinButton.className = 'mobile-input-pin';
                pinButton.textContent = `P${i + 1}`;
                pinButton.addEventListener('click', () => {
                    this.pins[i] = item;
                    this.savePins();
                    this.updatePinsUI();
                    showSuccess(`P${i + 1}に保存したよ`);
                });
                pinWrap.appendChild(pinButton);
            }

            row.appendChild(button);
            row.appendChild(pinWrap);
            clipboardList.appendChild(row);
        });
    }

    openSnippetSheet() {
        this.renderSnippetList();
        this.openSheet(this.elements.snippetSheet);
    }

    renderSnippetList() {
        const { snippetList } = this.elements;
        if (!snippetList) return;
        snippetList.innerHTML = '';

        if (!this.snippets.length) {
            const empty = document.createElement('div');
            empty.className = 'mobile-input-empty';
            empty.textContent = 'スニペットがないよ';
            snippetList.appendChild(empty);
            return;
        }

        this.snippets.forEach((snippet) => {
            const row = document.createElement('div');
            row.className = 'mobile-input-row';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'mobile-input-row-main';
            button.textContent = snippet.title || snippet.content;
            button.addEventListener('click', () => {
                this.insertTextAtCursor(snippet.content);
                this.closeSheets();
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'mobile-input-delete';
            deleteBtn.textContent = '削除';
            deleteBtn.addEventListener('click', () => {
                this.snippets = this.snippets.filter(item => item.id !== snippet.id);
                this.saveSnippets();
                this.renderSnippetList();
            });

            row.appendChild(button);
            row.appendChild(deleteBtn);
            snippetList.appendChild(row);
        });
    }

    openActionSheet() {
        this.renderActionList();
        this.openSheet(this.elements.actionSheet);
    }

    renderActionList() {
        const { actionList } = this.elements;
        if (!actionList) return;
        actionList.innerHTML = '';

        const actions = [
            { id: 'mobile-paste-btn', label: 'ペースト' },
            { id: 'mobile-upload-image-btn', label: '画像アップロード' },
            { id: 'mobile-send-escape-btn', label: 'Escape' },
            { id: 'mobile-send-clear-btn', label: 'クリア' },
            { id: 'mobile-copy-terminal-btn', label: 'コピー' },
            { id: 'mobile-send-shift-tab-btn', label: 'プラン' },
            { id: 'mobile-toggle-keyboard-btn', label: 'キーボード' },
            { id: 'mobile-hard-reset-btn', label: 'リセット' }
        ];

        actions.forEach(action => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'mobile-input-action';
            button.textContent = action.label;
            button.addEventListener('click', () => {
                document.getElementById(action.id)?.click();
                this.closeSheets();
            });
            actionList.appendChild(button);
        });
    }

    openSheet(sheetEl) {
        if (!sheetEl) return;
        this.elements.sheetOverlay?.classList.add('active');
        sheetEl.classList.add('active');
    }

    closeSheets() {
        this.elements.sheetOverlay?.classList.remove('active');
        [this.elements.clipboardSheet, this.elements.snippetSheet, this.elements.actionSheet].forEach(sheet => {
            sheet?.classList.remove('active');
        });
    }

    addSnippetFromSelection() {
        const inputEl = this.getActiveInput();
        if (!inputEl) return;

        const start = inputEl.selectionStart ?? 0;
        const end = inputEl.selectionEnd ?? 0;
        const selection = inputEl.value.slice(start, end).trim();
        const content = selection || inputEl.value.trim();

        if (!content) {
            showInfo('スニペットにする文字がないよ');
            return;
        }

        const title = content.split('\n')[0].slice(0, 24);
        const snippet = {
            id: `snippet_${Date.now()}`,
            title,
            content
        };

        this.snippets = [snippet, ...this.snippets].slice(0, 20);
        this.saveSnippets();
        showSuccess('スニペット追加したよ');
    }

    updateNetworkState() {
        this.updateSendAvailability();
        const { composerNetwork } = this.elements;
        if (composerNetwork) {
            composerNetwork.textContent = this.isOnline ? 'Online' : 'Offline';
            composerNetwork.classList.toggle('offline', !this.isOnline);
        }
        this.updateStoreState({ online: this.isOnline });
    }

    updateSendAvailability() {
        const disabled = !this.isOnline || !appStore.getState().currentSessionId;
        if (this.elements.dockSend) this.elements.dockSend.disabled = disabled;
        if (this.elements.composerSend) this.elements.composerSend.disabled = disabled;
    }

    autoResize(inputEl) {
        if (!inputEl) return;
        inputEl.style.height = 'auto';
        inputEl.style.height = `${inputEl.scrollHeight}px`;
    }

    scheduleDraftSave(mode, inputEl) {
        if (!inputEl) return;
        if (this.draftTimers[mode]) {
            clearTimeout(this.draftTimers[mode]);
        }
        this.draftTimers[mode] = setTimeout(() => {
            this.saveDraft(mode, inputEl);
        }, 400);
    }

    saveDraftNow(mode) {
        const inputEl = mode === 'composer' ? this.elements.composerInput : this.elements.dockInput;
        if (!inputEl) return;
        this.saveDraft(mode, inputEl);
    }

    saveDraft(mode, inputEl) {
        const sessionId = appStore.getState().currentSessionId || 'general';
        const payload = {
            value: inputEl.value,
            selectionStart: inputEl.selectionStart ?? 0,
            selectionEnd: inputEl.selectionEnd ?? 0,
            updatedAt: Date.now()
        };
        this.saveJson(`${STORAGE_KEYS.draft}:${sessionId}:${mode}`, payload);
        eventBus.emit(EVENTS.MOBILE_INPUT_DRAFT_SAVED, { mode, sessionId });
    }

    restoreDrafts() {
        const sessionId = appStore.getState().currentSessionId || 'general';
        this.restoreDraftFor('dock', sessionId, this.elements.dockInput);
        this.restoreDraftFor('composer', sessionId, this.elements.composerInput);
        if (this.elements.dockInput) {
            this.autoResize(this.elements.dockInput);
        }
    }

    restoreDraftFor(mode, sessionId, inputEl) {
        if (!inputEl) return;
        const draft = this.loadJson(`${STORAGE_KEYS.draft}:${sessionId}:${mode}`, null);
        if (!draft) return;
        inputEl.value = draft.value || '';
        const start = draft.selectionStart ?? 0;
        const end = draft.selectionEnd ?? start;
        inputEl.setSelectionRange(start, end);
    }

    loadPins() {
        const stored = this.loadJson(STORAGE_KEYS.pins, []);
        if (!Array.isArray(stored)) {
            return Array.from({ length: DEFAULT_PIN_SLOTS }, () => null);
        }
        const result = stored.slice(0, DEFAULT_PIN_SLOTS);
        while (result.length < DEFAULT_PIN_SLOTS) {
            result.push(null);
        }
        return result;
    }

    savePins() {
        this.saveJson(STORAGE_KEYS.pins, this.pins);
    }

    saveHistory() {
        this.saveJson(STORAGE_KEYS.history, this.history);
    }

    saveSnippets() {
        this.saveJson(STORAGE_KEYS.snippets, this.snippets);
    }

    loadJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            return JSON.parse(raw);
        } catch (error) {
            console.warn('Failed to load storage:', key, error);
            return fallback;
        }
    }

    saveJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn('Failed to save storage:', key, error);
        }
    }

    updateStoreState(partial) {
        const ui = appStore.getState().ui || {};
        const mobileInput = ui.mobileInput || {};
        appStore.setState({
            ui: {
                ...ui,
                mobileInput: {
                    ...mobileInput,
                    ...partial
                }
            }
        });
    }

    async sendEnterKey() {
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) {
            showInfo('セッションを選択してね');
            return;
        }

        try {
            await this.httpClient.post(`/api/sessions/${sessionId}/input`, {
                input: 'Enter',
                type: 'key'
            });
        } catch (error) {
            console.error('Failed to send Enter key:', error);
            showError('Enterキーの送信に失敗したよ');
        }
    }

    handleUploadImage() {
        const imageFileInput = document.getElementById('image-file-input');
        imageFileInput?.click();
    }

    async handleCopyTerminal() {
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) {
            showInfo('セッションを選択してね');
            return;
        }

        try {
            const res = await fetch(`/api/sessions/${sessionId}/content?lines=500`);
            if (!res.ok) throw new Error('Failed to fetch content');

            const { content } = await res.json();

            const copyTerminalModal = document.getElementById('copy-terminal-modal');
            const terminalContentDisplay = document.getElementById('terminal-content-display');

            if (terminalContentDisplay && copyTerminalModal) {
                terminalContentDisplay.textContent = content;
                copyTerminalModal.classList.add('active');
                if (window.lucide) window.lucide.createIcons();

                // Scroll to bottom
                setTimeout(() => {
                    terminalContentDisplay.scrollTop = terminalContentDisplay.scrollHeight;
                }, 50);
            }
        } catch (error) {
            console.error('Failed to get terminal content:', error);
            showError('ターミナル内容の取得に失敗したよ');
        }
    }

    async handleClear() {
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) {
            showInfo('セッションを選択してね');
            return;
        }

        try {
            await this.httpClient.post(`/api/sessions/${sessionId}/input`, {
                input: 'C-l',
                type: 'key'
            });
        } catch (error) {
            console.error('Failed to send Clear:', error);
            showError('クリアコマンドの送信に失敗したよ');
        }
    }

    async handleEscape() {
        const sessionId = appStore.getState().currentSessionId;
        if (!sessionId) {
            showInfo('セッションを選択してね');
            return;
        }

        try {
            await this.httpClient.post(`/api/sessions/${sessionId}/input`, {
                input: 'Escape',
                type: 'key'
            });
        } catch (error) {
            console.error('Failed to send Escape:', error);
            showError('Escapeキーの送信に失敗したよ');
        }
    }

    scrollInputIntoView(inputEl) {
        if (!inputEl) return;

        // iOS Safari では focus() だけでは自動スクロールしないため、明示的に scrollIntoView を呼ぶ
        // behavior: "smooth" でスムーズにスクロール
        // block: "end" で画面の最下部に配置
        setTimeout(() => {
            inputEl.scrollIntoView({
                behavior: "smooth",
                block: "end",
                inline: "nearest"
            });
        }, 100);
    }

    refocusInput(inputEl) {
        if (!inputEl) return;

        // iOS Safari でボタンタップ後に入力欄にフォーカスを戻す
        // setTimeout を使うことでボタンのクリックイベントが完了してからフォーカスを当てる
        setTimeout(() => {
            inputEl.focus();
            this.scrollInputIntoView(inputEl);
        }, 150);
    }

    destroy() {
        if (this.unsubscribeSession) {
            this.unsubscribeSession();
            this.unsubscribeSession = null;
        }
        if (this.viewport && this.viewportHandler) {
            this.viewport.removeEventListener('resize', this.viewportHandler);
            this.viewport.removeEventListener('scroll', this.viewportHandler);
        }
        if (this.keyboardDebug) {
            this.keyboardDebug.remove();
            this.keyboardDebug = null;
        }
    }
}
