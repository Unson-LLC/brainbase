import { showSuccess } from '../toast.js';
import { DEFAULT_PIN_SLOTS } from './mobile-input-utils.js';

/**
 * MobileInputSheetManager
 *
 * Clipboard/Snippet/Action Sheetの表示・レンダリングを担当
 *
 * 責務:
 * - Clipboard/Snippet/Actions Sheetの表示
 * - Sheet内のアイテムリストのレンダリング
 * - Sheet内のアイテムクリック処理
 * - Sheet の開閉
 */
export class MobileInputSheetManager {
    constructor(elements, clipboardManager, callbacks) {
        this.elements = elements;
        this.clipboardManager = clipboardManager;
        this.callbacks = callbacks;
    }

    init() {
        this.bindSheets();
    }

    bindSheets() {
        const { sheetOverlay, clipboardSheet, snippetSheet, actionSheet } = this.elements;
        sheetOverlay?.addEventListener('click', () => this.closeSheets());
        clipboardSheet?.querySelector('.mobile-input-sheet-close')?.addEventListener('click', () => this.closeSheets());
        snippetSheet?.querySelector('.mobile-input-sheet-close')?.addEventListener('click', () => this.closeSheets());
        actionSheet?.querySelector('.mobile-input-sheet-close')?.addEventListener('click', () => this.closeSheets());
    }

    openClipboardSheet() {
        this.renderClipboardList();
        this.openSheet(this.elements.clipboardSheet);
    }

    renderClipboardList() {
        const { clipboardList } = this.elements;
        if (!clipboardList) return;
        clipboardList.innerHTML = '';

        if (this.clipboardManager.history.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'mobile-input-empty';
            empty.textContent = '履歴がないよ';
            clipboardList.appendChild(empty);
            return;
        }

        this.clipboardManager.history.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'mobile-input-row';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'mobile-input-row-main';
            button.textContent = item;
            button.addEventListener('click', () => {
                if (this.callbacks.onInsertText) {
                    this.callbacks.onInsertText(item);
                }
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
                    this.clipboardManager.pins[i] = item;
                    this.clipboardManager.savePins();
                    this.clipboardManager.updatePinsUI();
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

        if (!this.clipboardManager.snippets.length) {
            const empty = document.createElement('div');
            empty.className = 'mobile-input-empty';
            empty.textContent = 'スニペットがないよ';
            snippetList.appendChild(empty);
            return;
        }

        this.clipboardManager.snippets.forEach((snippet) => {
            const row = document.createElement('div');
            row.className = 'mobile-input-row';

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'mobile-input-row-main';
            button.textContent = snippet.title || snippet.content;
            button.addEventListener('click', () => {
                if (this.callbacks.onInsertText) {
                    this.callbacks.onInsertText(snippet.content);
                }
                this.closeSheets();
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'mobile-input-delete';
            deleteBtn.textContent = '削除';
            deleteBtn.addEventListener('click', () => {
                this.clipboardManager.snippets = this.clipboardManager.snippets.filter(item => item.id !== snippet.id);
                this.clipboardManager.saveSnippets();
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
}
