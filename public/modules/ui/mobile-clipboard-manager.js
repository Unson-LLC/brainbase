import { showInfo, showSuccess } from '../toast.js';
import { DEFAULT_HISTORY_LIMIT, DEFAULT_PIN_SLOTS, normalizeHistory, pushHistory } from './mobile-input-utils.js';

const STORAGE_KEYS = {
    history: 'bb_mobile_clipboard_history',
    pins: 'bb_mobile_clipboard_pins',
    snippets: 'bb_mobile_snippets'
};

/**
 * MobileClipboardManager
 *
 * モバイル入力欄のクリップボード履歴、ピン、スニペットの管理を担当
 *
 * 責務:
 * - クリップボード履歴の管理
 * - ピン（Clip1-3）の保存・クリア
 * - スニペットの追加・削除
 * - テキスト挿入
 */
export class MobileClipboardManager {
    constructor(elements) {
        this.elements = elements;
        this.history = [];
        this.pins = Array.from({ length: DEFAULT_PIN_SLOTS }, () => null);
        this.snippets = [];
    }

    init() {
        this.history = normalizeHistory(this.loadJson(STORAGE_KEYS.history, []), DEFAULT_HISTORY_LIMIT);
        this.pins = this.loadPins();
        this.snippets = this.loadJson(STORAGE_KEYS.snippets, []);
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

    insertTextAtCursor(text, getActiveInputFn) {
        const inputEl = getActiveInputFn ? getActiveInputFn() : this.getDefaultActiveInput();
        if (!inputEl) return;

        const start = inputEl.selectionStart ?? inputEl.value.length;
        const end = inputEl.selectionEnd ?? inputEl.value.length;
        const value = inputEl.value;
        inputEl.value = value.slice(0, start) + text + value.slice(end);
        const nextPos = start + text.length;
        inputEl.setSelectionRange(nextPos, nextPos);
        inputEl.focus();

        // autoResize と scheduleDraftSave はコールバックで呼び出す
        return { inputEl, mode: inputEl === this.elements.composerInput ? 'composer' : 'dock' };
    }

    getDefaultActiveInput() {
        if (this.elements.composer?.classList.contains('active')) {
            return this.elements.composerInput;
        }
        return this.elements.dockInput;
    }

    updatePinsUI() {
        this.elements.dockClipButtons.forEach((button, index) => {
            const pinned = this.pins[index];
            button.textContent = pinned ? `Clip${index + 1}` : `Clip${index + 1}`;
            button.classList.toggle('filled', Boolean(pinned));
            button.setAttribute('title', pinned ? pinned.slice(0, 120) : '空');
        });
    }

    addSnippetFromSelection(getActiveInputFn) {
        const inputEl = getActiveInputFn ? getActiveInputFn() : this.getDefaultActiveInput();
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
}
