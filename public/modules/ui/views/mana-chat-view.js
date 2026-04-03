// @ts-check
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';
import { escapeHtml } from '../../ui-helpers.js';

/**
 * manaチャットフローティングウィジェット
 * 右下固定バブル → クリックでパネル展開
 */
export class ManaChatView {
    /**
     * @param {{ manaChatService: import('../../domain/mana/mana-chat-service.js').ManaChatService }} deps
     */
    constructor({ manaChatService }) {
        this.manaChatService = manaChatService;
        this.eventBus = eventBus;
        this.store = appStore;

        // DOM refs
        /** @type {HTMLElement | null} */
        this.bubbleEl = null;
        /** @type {HTMLElement | null} */
        this.panelEl = null;
        /** @type {HTMLElement | null} */
        this.messagesEl = null;
        /** @type {HTMLInputElement | null} */
        this.inputEl = null;
        /** @type {HTMLButtonElement | null} */
        this.sendBtnEl = null;
        /** @type {HTMLButtonElement | null} */
        this.captureBtnEl = null;

        // State
        this.panelOpen = false;
        this.messages = [];
        this._sending = false;
        this._unsubscribers = [];
    }

    mount() {
        this.bubbleEl = document.getElementById('mana-chat-bubble');
        this.panelEl = document.getElementById('mana-chat-panel');
        this.messagesEl = document.getElementById('mana-chat-messages');
        this.inputEl = /** @type {HTMLInputElement | null} */ (document.getElementById('mana-chat-input'));
        this.sendBtnEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('mana-chat-send'));
        this.captureBtnEl = /** @type {HTMLButtonElement | null} */ (document.getElementById('mana-capture-btn'));

        if (!this.bubbleEl || !this.panelEl) return;

        this._setupEventListeners();
        this._addWelcomeMessage();
    }

    _setupEventListeners() {
        // Bubble click → toggle panel
        if (this.bubbleEl) {
            this.bubbleEl.onclick = () => this.toggle();
        }

        // Minimize button in header
        const minimizeBtn = document.getElementById('mana-chat-minimize');
        if (minimizeBtn) {
            minimizeBtn.onclick = () => {
                this.panelOpen = false;
                this.panelEl.classList.remove('open');
            };
        }

        // Send button
        if (this.sendBtnEl) {
            this.sendBtnEl.onclick = () => this._handleSend();
        }

        // Capture button (quick capture)
        if (this.captureBtnEl) {
            this.captureBtnEl.onclick = () => this._handleCapture();
        }

        // Enter to send
        if (this.inputEl) {
            this.inputEl.onkeydown = (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this._handleSend();
                }
            };
        }

        // Close on outside click
        this._outsideClickHandler = (e) => {
            if (this.panelOpen &&
                this.panelEl && !this.panelEl.contains(e.target) &&
                this.bubbleEl && !this.bubbleEl.contains(e.target)) {
                this.panelOpen = false;
                this.panelEl.classList.remove('open');
            }
        };
        document.addEventListener('click', this._outsideClickHandler);

        // EventBus
        const unsub1 = this.eventBus.on(EVENTS.MANA_CHAT_RESPONSE, /** @param {CustomEvent<{ reply: string }>} e */ (e) => {
            const data = e.detail;
            this._appendMessage('mana', data.reply);
            this._sending = false;
            this._updateSendState();
        });

        const unsub2 = this.eventBus.on(EVENTS.MANA_CAPTURED, /** @param {CustomEvent<{ title: string }>} e */ (e) => {
            const data = e.detail;
            this._appendMessage('system', `Captured: ${data.title}`);
        });

        this._unsubscribers.push(unsub1, unsub2);
    }

    _addWelcomeMessage() {
        this._appendMessage('mana', 'やっほー！manaだよ。課題やアイデアが浮かんだら即メモってね。何か話しかけてもOKだよ〜');
    }

    toggle() {
        this.panelOpen = !this.panelOpen;
        if (this.panelEl) {
            this.panelEl.classList.toggle('open', this.panelOpen);
        }
        if (this.panelOpen && this.inputEl) {
            setTimeout(() => this.inputEl.focus(), 100);
        }
    }

    async _handleSend() {
        if (!this.inputEl || this._sending) return;
        const text = this.inputEl.value.trim();
        if (!text) return;

        this.inputEl.value = '';
        this._appendMessage('user', text);

        // Check for capture commands: "/capture xxx" or "これ課題: xxx"
        const captureMatch = text.match(/^\/capture\s+(.+)$/) || text.match(/^これ課題[:：]\s*(.+)$/);
        if (captureMatch) {
            await this._doCapture(captureMatch[1]);
            return;
        }

        // Regular chat
        this._sending = true;
        this._updateSendState();
        this._appendMessage('system', '...');

        try {
            await this.manaChatService.chat(text, this._getHistory());
        } catch (err) {
            this._appendMessage('system', 'ごめん、エラー発生。もう一回试试て？');
            this._sending = false;
            this._updateSendState();
        }
    }

    async _handleCapture() {
        if (!this.inputEl) return;
        const text = this.inputEl.value.trim();
        if (!text) {
            this.inputEl.placeholder = 'キャプチャ内容を入力...';
            this.inputEl.focus();
            return;
        }
        this.inputEl.value = '';
        await this._doCapture(text);
    }

    async _doCapture(text) {
        this._appendMessage('user', `Memo: ${text}`);
        this._sending = true;
        this._updateSendState();

        try {
            await this.manaChatService.capture(text);
            this._sending = false;
            this._updateSendState();
        } catch (err) {
            this._appendMessage('system', 'キャプチャ失敗。もう一回试试て？');
            this._sending = false;
            this._updateSendState();
        }
    }

    _getHistory() {
        return this.messages.slice(-10).map(m => ({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: m.text
        }));
    }

    _appendMessage(sender, text) {
        this.messages.push({ sender, text, timestamp: Date.now() });
        this._renderMessages();
    }

    _updateSendState() {
        if (this.sendBtnEl) {
            this.sendBtnEl.disabled = this._sending;
        }
        if (this.captureBtnEl) {
            this.captureBtnEl.disabled = this._sending;
        }
    }

    _renderMessages() {
        if (!this.messagesEl) return;

        this.messagesEl.innerHTML = this.messages.map(m => {
            const escaped = escapeHtml(m.text);
            const cls = `mana-msg mana-msg--${m.sender}`;
            return `<div class="${cls}"><span class="mana-msg-text">${escaped}</span></div>`;
        }).join('');

        // Auto-scroll to bottom
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    unmount() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        if (this._outsideClickHandler) {
            document.removeEventListener('click', this._outsideClickHandler);
        }
        this.bubbleEl = null;
        this.panelEl = null;
        this.messagesEl = null;
        this.inputEl = null;
    }
}
