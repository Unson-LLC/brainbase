import { appStore } from '../core/store.js';
import { eventBus, EVENTS } from '../core/event-bus.js';
import { showError, showInfo, showSuccess } from '../toast.js';
import {
    findWordBoundaryLeft,
    findWordBoundaryRight
} from './mobile-input-utils.js';

/**
 * MobileInputUIController
 *
 * Dock/Composer のUI制御、カーソル操作、フォーマットを担当
 *
 * 責務:
 * - Dock/Composer のイベントバインディング
 * - カーソル移動（左右上下、単語単位、行単位）
 * - テキストフォーマット（h1, list, quote, code）
 * - 選択モードの切り替え
 * - 送信処理
 * - ネットワーク状態の管理
 */
export class MobileInputUIController {
    constructor(elements, managers) {
        this.elements = elements;
        this.focusManager = managers.focusManager;
        this.draftManager = managers.draftManager;
        this.clipboardManager = managers.clipboardManager;
        this.apiClient = managers.apiClient;
        this.sheetManager = managers.sheetManager;
        this.selectionMode = false;
        this.isOnline = true;
    }

    init() {
        this.bindDock();
        this.bindComposer();
        this.bindNetworkStatus();
        this.updateSendAvailability();
        this.setDockExpanded(false);
    }

    bindDock() {
        const { dockInput, dockSend, dockMore, dockSessions, dockPaste, dockUploadImage, dockCopyTerminal, dockClear, dockEscape, dockShiftTab } = this.elements;
        this.bindInputEventHandlers(dockInput, 'dock', true);  // scrollIntoView有効

        this.bindTouchClickHandler(dockSend, 'dock', dockInput);

        // iOS Safari対応: touchstart + click で確実にタップ検出
        this.bindTapHandler(dockMore, () => {
            this.toggleDockExpanded();
            this.focusManager.refocusInput(dockInput);
        });
        this.bindTapHandler(dockSessions, () => {
            this.handleSessionsSheet();
        });
        this.bindTapHandler(dockPaste, async () => {
            const result = await this.pasteFromClipboard();
            this.processClipboardResult(result);
            this.focusManager.refocusInput(dockInput);
        });
        this.bindTapHandler(dockUploadImage, () => {
            this.handleUploadImage();
            this.focusManager.refocusInput(dockInput);
        });
        this.bindTapHandler(dockCopyTerminal, () => {
            this.handleCopyTerminal();
        });
        this.bindTapHandler(dockClear, () => {
            this.handleClear();
            this.focusManager.refocusInput(dockInput);
        });
        this.bindTapHandler(dockEscape, () => {
            this.handleEscape();
            this.focusManager.refocusInput(dockInput);
        });
        this.bindTapHandler(dockShiftTab, () => {
            this.handleShiftTab();
            this.focusManager.refocusInput(dockInput);
        });

        this.elements.dockClipButtons.forEach((button, index) => {
            this.bindTapHandler(button, async () => {
                const result = await this.handleClipSlot(index);
                this.processClipboardResult(result);
            });
            this.clipboardManager.bindLongPressClear(button, index);
        });

        this.bindCursorButtons(dockInput, this.elements.dock);
    }

    /**
     * iOS Safari対応: touchstart + click で確実にタップ検出
     * touchstartでpreventDefault()してフォーカス維持、clickで実際の処理
     */
    bindTapHandler(element, handler) {
        if (!element) return;

        let touchHandled = false;

        element.addEventListener('touchstart', (e) => {
            touchHandled = false;
        }, { passive: true });

        element.addEventListener('touchend', (e) => {
            e.preventDefault();
            if (!touchHandled) {
                touchHandled = true;
                handler();
            }
        }, { passive: false });

        element.addEventListener('click', (e) => {
            if (touchHandled) {
                touchHandled = false;
                return;
            }
            handler();
        });
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

        this.bindInputEventHandlers(composerInput, 'composer', false);  // scrollIntoView無効

        this.bindTouchClickHandler(composerSend, 'composer', composerInput);
        composerBack?.addEventListener('click', () => this.closeComposer(true));
        composerPaste?.addEventListener('click', async () => {
            const result = await this.pasteFromClipboard();
            this.processClipboardResult(result);
        });
        composerClipboard?.addEventListener('click', () => this.sheetManager.openClipboardSheet());
        composerSnippets?.addEventListener('click', () => this.sheetManager.openSnippetSheet());
        composerActions?.addEventListener('click', () => this.sheetManager.openActionSheet());
        composerSelectToggle?.addEventListener('click', () => this.toggleSelectionMode(composerSelectToggle));

        composer?.addEventListener('click', (event) => {
            if (event.target === composer) {
                this.closeComposer(true);
            }
        });

        this.bindCursorButtons(composerInput, this.elements.composer);
        this.bindFormatButtons(this.elements.composer);
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

    bindCursorButtons(inputEl, container) {
        const root = container || document;
        const buttons = root.querySelectorAll('[data-mobile-cursor]');
        buttons.forEach(button => {
            button.addEventListener('click', () => {
                const action = button.getAttribute('data-mobile-cursor');
                if (action === 'enter') {
                    this.sendEnterKey();
                    this.focusManager.refocusInput(inputEl);
                } else {
                    this.moveCursor(inputEl, action);
                    this.focusManager.refocusInput(inputEl);
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

    /**
     * iOS Safari対応: touchstart/clickイベントを統一処理
     *
     * iOS Safariでは以下の理由で touchstart + click 両方が必要：
     * - touchstart: ユーザージェスチャーコンテキスト内でフォーカス維持
     * - click: Android/デスクトップブラウザ対応
     * - フラグ管理: 二重実行防止（タッチデバイスで両方発火するため）
     *
     * @param {HTMLElement} button - 対象ボタン
     * @param {string} mode - 'dock' または 'composer'
     * @param {HTMLElement} focusInput - フォーカス戻し対象
     */
    bindTouchClickHandler(button, mode, focusInput) {
        if (!button) return;

        let touchHandled = false;

        button.addEventListener('touchstart', (e) => {
            e.preventDefault();                    // フォーカスが外れるのを防ぐ
            touchHandled = true;
            this.handleSend(mode);
            this.focusManager.refocusInput(focusInput);
        }, { passive: false });

        button.addEventListener('click', () => {
            if (touchHandled) {                    // 重複実行防止
                touchHandled = false;
                return;
            }
            this.handleSend(mode);
            this.focusManager.refocusInput(focusInput);
        });
    }

    /**
     * input要素の標準イベントハンドラを統一
     *
     * focus/blur/input の3つのイベントを一括バインド:
     * - focus: キーボード同期開始、アクティブ入力設定
     * - blur: キーボード同期停止
     * - input: 自動リサイズ、ドラフト自動保存
     *
     * @param {HTMLElement} inputEl - 対象input要素
     * @param {string} mode - 'dock' または 'composer'
     * @param {boolean} includeScrollIntoView - focus時に scrollIntoView を呼ぶか
     */
    bindInputEventHandlers(inputEl, mode, includeScrollIntoView = false) {
        if (!inputEl) return;

        inputEl.addEventListener('focus', () => {
            this.focusManager.inputFocused = true;
            this.focusManager.setActiveInput(inputEl);
            this.focusManager.syncKeyboardState();
            this.focusManager.scheduleKeyboardSync();
            if (includeScrollIntoView) {
                this.focusManager.scrollInputIntoView(inputEl);
            }
        });

        inputEl.addEventListener('blur', () => {
            this.focusManager.inputFocused = false;
            this.focusManager.syncKeyboardState();
            this.focusManager.clearKeyboardSync();
        });

        inputEl.addEventListener('input', () => {
            this.autoResize(inputEl);
            this.draftManager.scheduleDraftSave(mode, inputEl);
        });
    }

    getActiveInput() {
        return this.focusManager.getActiveInput();
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
            this.draftManager.scheduleDraftSave('dock', dockInput);
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

        // iOS Safariのユーザージェスチャーコンテキスト内で確実にfocusする
        // async処理後のsetTimeout()ではコンテキストが切れてfocus()が効かないため
        inputEl.focus();

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

        // DEBUG: 送信先セッションIDと入力内容をログ出力
        console.log('[mobile-input] Sending to sessionId:', sessionId);
        console.log('[mobile-input] Payload:', payload);

        try {
            await this.apiClient.sendInput(sessionId, payload);

            inputEl.value = '';
            this.autoResize(inputEl);
            this.draftManager.saveDraftNow(mode);
            eventBus.emit(EVENTS.MOBILE_INPUT_SENT, { mode, sessionId });
            showSuccess('送信したよ');

            // 送信後も入力欄にフォーカスを維持（連続入力のため）
            setTimeout(() => {
                inputEl.focus();
                this.focusManager.scrollInputIntoView(inputEl);
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
        this.draftManager.scheduleDraftSave(inputEl === this.elements.composerInput ? 'composer' : 'dock', inputEl);
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
        this.draftManager.scheduleDraftSave('composer', inputEl);
    }

    getLineRange(text, start, end) {
        const rangeStart = this.findLineStart(text, start);
        const rangeEnd = this.findLineEnd(text, end);
        return { lineStart: rangeStart, lineEnd: rangeEnd };
    }

    async handleClipSlot(index) {
        await this.clipboardManager.handleClipSlot(index);
        // handleClipSlot内でinsertTextAtCursorが呼ばれているが、
        // その後のautoResizeとscheduleDraftSaveが必要なので、
        // insertTextAtCursorの戻り値を返す
        // 実際にはhandleClipSlotの中でinsertTextAtCursorが呼ばれた時の情報を返す必要がある
        // ここでは簡略化のため、getActiveInput()で現在の入力欄を返す
        const inputEl = this.getActiveInput();
        return inputEl ? { inputEl, mode: inputEl === this.elements.composerInput ? 'composer' : 'dock' } : null;
    }

    async pasteFromClipboard() {
        await this.clipboardManager.pasteFromClipboard();
        const inputEl = this.getActiveInput();
        return inputEl ? { inputEl, mode: inputEl === this.elements.composerInput ? 'composer' : 'dock' } : null;
    }

    insertTextAtCursor(text) {
        const result = this.clipboardManager.insertTextAtCursor(text, () => this.getActiveInput());
        this.processClipboardResult(result);
    }

    processClipboardResult(result) {
        if (!result || !result.inputEl) return;
        this.autoResize(result.inputEl);
        this.draftManager.scheduleDraftSave(result.mode, result.inputEl);
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
            await this.apiClient.sendKey(sessionId, 'Enter');
        } catch (error) {
            console.error('Failed to send Enter key:', error);
            showError('Enterキーの送信に失敗したよ');
        }
    }

    handleUploadImage() {
        console.log('[mobile-input] handleUploadImage called');
        const imageFileInput = document.getElementById('image-file-input');
        if (!imageFileInput) {
            console.error('[mobile-input] image-file-input not found');
            showError('画像アップロード要素が見つからない');
            return;
        }
        imageFileInput.click();
    }

    async handleCopyTerminal() {
        console.log('[mobile-input] handleCopyTerminal called');
        const sessionId = appStore.getState().currentSessionId;
        console.log('[mobile-input] sessionId:', sessionId);
        if (!sessionId) {
            showInfo('セッションを選択してね');
            return;
        }

        try {
            const content = await this.apiClient.fetchTerminalContent(sessionId);

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
        console.log('[mobile-input] handleClear called');
        const sessionId = appStore.getState().currentSessionId;
        console.log('[mobile-input] sessionId:', sessionId);
        if (!sessionId) {
            showInfo('セッションを選択してね');
            return;
        }

        try {
            await this.apiClient.sendKey(sessionId, 'C-l');
            showSuccess('画面クリア送信');
        } catch (error) {
            console.error('Failed to send Clear:', error);
            showError('クリアコマンドの送信に失敗したよ');
        }
    }

    async handleEscape() {
        console.log('[mobile-input] handleEscape called');
        const sessionId = appStore.getState().currentSessionId;
        console.log('[mobile-input] sessionId:', sessionId);
        if (!sessionId) {
            showInfo('セッションを選択してね');
            return;
        }

        try {
            await this.apiClient.sendKey(sessionId, 'Escape');
            showSuccess('Escape送信');
        } catch (error) {
            console.error('Failed to send Escape:', error);
            showError('Escapeキーの送信に失敗したよ');
        }
    }

    async handleShiftTab() {
        console.log('[mobile-input] handleShiftTab called');
        const sessionId = appStore.getState().currentSessionId;
        console.log('[mobile-input] sessionId:', sessionId);
        if (!sessionId) {
            showInfo('セッションを選択してね');
            return;
        }

        try {
            await this.apiClient.sendKey(sessionId, 'S-Tab');
            showSuccess('Shift+Tab送信');
        } catch (error) {
            console.error('Failed to send Shift+Tab:', error);
            showError('Shift+Tabキーの送信に失敗したよ');
        }
    }

    handleSessionsSheet() {
        console.log('[mobile-input] handleSessionsSheet called');
        // bottom navのセッションボタンをトリガーしてセッション一覧を開く
        const mobileSessionsBtn = document.getElementById('mobile-sessions-btn');
        if (mobileSessionsBtn) {
            mobileSessionsBtn.click();
        }
    }
}
