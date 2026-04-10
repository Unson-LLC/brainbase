// @ts-check
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';

/**
 * manaチャットフローティングウィジェット
 * assistant-ui参考のUX改善版
 */
export class ManaChatView {
    constructor({ manaChatService }) {
        this.manaChatService = manaChatService;
        this.eventBus = eventBus;
        this.store = appStore;

        this.bubbleEl = null;
        this.panelEl = null;
        this.messagesEl = null;
        this.inputEl = null;
        this.sendBtnEl = null;
        this.captureBtnEl = null;

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

        const loginPrompt = document.getElementById('mana-login-prompt');
        if (loginPrompt) loginPrompt.remove();

        if (this.inputEl) { this.inputEl.disabled = false; this.inputEl.placeholder = 'manaに話しかける...'; }
        if (this.sendBtnEl) this.sendBtnEl.disabled = false;
        if (this.captureBtnEl) this.captureBtnEl.disabled = false;

        this._setupEventListeners();
        this._addWelcomeMessage();
    }

    _setupEventListeners() {
        if (this.bubbleEl) {
            this.bubbleEl.onclick = () => this.toggle();
        }

        const minimizeBtn = document.getElementById('mana-chat-minimize');
        if (minimizeBtn) {
            minimizeBtn.onclick = () => {
                this.panelOpen = false;
                this.panelEl.classList.remove('open');
            };
        }

        if (this.sendBtnEl) {
            this.sendBtnEl.onclick = () => this._handleSend();
        }

        if (this.captureBtnEl) {
            this.captureBtnEl.onclick = () => this._handleCapture();
        }

        if (this.inputEl) {
            let isComposing = false;
            let compositionJustEnded = false;
            this.inputEl.addEventListener('compositionstart', () => { isComposing = true; });
            this.inputEl.addEventListener('compositionend', () => {
                isComposing = false;
                compositionJustEnded = true;
                setTimeout(() => { compositionJustEnded = false; }, 250);
            });
            this.inputEl.onkeydown = (e) => {
                if (e.key === 'Enter' && !e.shiftKey && !isComposing && !e.isComposing && !compositionJustEnded) {
                    e.preventDefault();
                    this._handleSend();
                }
            };
        }

        this._outsideClickHandler = (e) => {
            if (this.panelOpen &&
                this.panelEl && !this.panelEl.contains(e.target) &&
                this.bubbleEl && !this.bubbleEl.contains(e.target)) {
                this.panelOpen = false;
                this.panelEl.classList.remove('open');
            }
        };
        document.addEventListener('click', this._outsideClickHandler);

        const unsub1 = this.eventBus.on(EVENTS.MANA_CHAT_RESPONSE, (e) => {
            this._removeTypingIndicator();
            const data = e.detail;
            this._appendMessage('mana', data.reply);
            this._sending = false;
            this._updateSendState();
        });

        const unsub2 = this.eventBus.on(EVENTS.MANA_CAPTURED, (e) => {
            const data = e.detail;
            this._appendMessage('system', `Captured: ${data.title}`);
        });

        this._unsubscribers.push(unsub1, unsub2);
    }

    _addWelcomeMessage() {
        this._appendMessage('mana', 'manaだよ！課題やアイデアが浮かんだらメモってね。何でも話しかけてOK');
    }

    toggle() {
        this.panelOpen = !this.panelOpen;
        if (this.panelEl) {
            this.panelEl.classList.toggle('open', this.panelOpen);
        }
        if (this.panelOpen && this.inputEl) {
            setTimeout(() => this.inputEl.focus(), 150);
        }
    }

    async _handleSend() {
        if (!this.inputEl || this._sending) return;
        const text = this.inputEl.value.trim();
        if (!text) return;

        this.inputEl.value = '';
        this._appendMessage('user', text);

        const captureMatch = text.match(/^\/capture\s+(.+)$/) || text.match(/^これ課題[:：]\s*(.+)$/);
        if (captureMatch) {
            await this._doCapture(captureMatch[1]);
            return;
        }

        this._sending = true;
        this._updateSendState();
        this._showTypingIndicator();

        try {
            await this.manaChatService.chat(text, this._getHistory());
        } catch (err) {
            this._removeTypingIndicator();
            this._appendMessage('system', 'エラーが発生しました。もう一度お試しください。');
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
            this._appendMessage('system', 'キャプチャに失敗しました。');
            this._sending = false;
            this._updateSendState();
        }
    }

    _getHistory() {
        return this.messages
            .filter(m => m.sender !== 'system')
            .slice(-10)
            .map(m => ({
                role: m.sender === 'user' ? 'user' : 'assistant',
                content: m.text
            }));
    }

    _showTypingIndicator() {
        if (!this.messagesEl) return;
        const el = document.createElement('div');
        el.className = 'mana-msg mana-msg--mana mana-typing';
        el.id = 'mana-typing-indicator';
        el.innerHTML = '<span class="mana-avatar">m</span><span class="mana-typing-dots"><span></span><span></span><span></span></span>';
        this.messagesEl.appendChild(el);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    _removeTypingIndicator() {
        document.getElementById('mana-typing-indicator')?.remove();
    }

    _appendMessage(sender, text) {
        this.messages.push({ sender, text, timestamp: Date.now() });
        this._renderMessages();
    }

    _updateSendState() {
        if (this.sendBtnEl) {
            this.sendBtnEl.disabled = this._sending;
            this.sendBtnEl.innerHTML = this._sending
                ? '<span class="mana-send-spinner"></span>'
                : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>';
        }
        if (this.captureBtnEl) {
            this.captureBtnEl.disabled = this._sending;
        }
    }

    _formatText(text) {
        let html = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // Code blocks
        html = html.replace(/```([\s\S]*?)```/g, '<pre class="mana-code-block">$1</pre>');
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code class="mana-inline-code">$1</code>');
        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Line breaks
        html = html.replace(/\n/g, '<br>');

        return html;
    }

    _renderMessages() {
        if (!this.messagesEl) return;

        this.messagesEl.innerHTML = this.messages.map(m => {
            const formatted = this._formatText(m.text);
            if (m.sender === 'user') {
                return `<div class="mana-msg mana-msg--user"><span class="mana-msg-text">${formatted}</span></div>`;
            }
            if (m.sender === 'mana') {
                return `<div class="mana-msg mana-msg--mana"><span class="mana-avatar">m</span><span class="mana-msg-text">${formatted}</span></div>`;
            }
            return `<div class="mana-msg mana-msg--system"><span class="mana-msg-text">${formatted}</span></div>`;
        }).join('');

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
