// @ts-check
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';
import { LearningCandidateModal } from '../modals/learning-candidate-modal.js';

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
        this.reviewBtnEl = null;
        this.memoryCandidateModal = new LearningCandidateModal({
            currentPersonId: null,
            onApproveMemory: async (item) => this._approveMemoryCandidate(item),
            onRejectMemory: async (item) => this._rejectMemoryCandidate(item),
            onExpireMemory: async (item) => this._expireMemoryCandidate(item),
            onRequestRedaction: async (item) => this._requestMemoryCandidateRedaction(item)
        });

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
        this._ensureReviewButton();

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
        if (this.reviewBtnEl) {
            this.reviewBtnEl.onclick = () => this._handleMemoryReview();
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
            const data = /** @type {CustomEvent} */ (e).detail;
            this._appendMessage('mana', data.reply);
            this._sending = false;
            this._updateSendState();
        });

        const unsub2 = this.eventBus.on(EVENTS.MANA_CAPTURED, (e) => {
            const data = /** @type {CustomEvent} */ (e).detail;
            this._appendMessage('system', `Captured: ${data.title}`);
        });

        this._unsubscribers.push(unsub1, unsub2);
    }

    _addWelcomeMessage() {
        this._appendMessage('mana', 'manaだよ！課題やアイデアが浮かんだらメモってね。何でも話しかけてOK');
    }

    _ensureReviewButton() {
        if (!this.panelEl || this.reviewBtnEl) return;
        const header = this.panelEl.querySelector('.mana-chat-header');
        if (!header) return;
        const button = document.createElement('button');
        button.id = 'mana-memory-review-btn';
        button.type = 'button';
        button.className = 'mana-memory-review-btn';
        button.title = 'Memory review';
        button.textContent = 'Review';
        const minimizeBtn = header.querySelector('#mana-chat-minimize');
        header.insertBefore(button, minimizeBtn || null);
        this.reviewBtnEl = button;
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

        if (text === '/memory-review' || text === '/memory') {
            await this._handleMemoryReview();
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

    _getCurrentPersonId() {
        return this.store.getState().auth?.access?.personId
            || this.store.getState().auth?.access?.person_id
            || null;
    }

    _normalizeMemoryCandidate(item) {
        const currentPersonId = this._getCurrentPersonId();
        return {
            ...item,
            kind: 'memory_candidate',
            candidateId: item.candidate_id || item.id,
            ownerPersonId: item.owner_person_id,
            currentPersonId,
            updatedAt: item.updated_at,
            sourceSystem: item.source_system,
            subjectType: item.subject_type,
            subjectId: item.subject_id,
            promotionStatus: item.promotion_status,
            redactionStatus: item.redaction_status,
            requiresApproval: item.requires_approval,
            evidenceIds: item.evidence_ids,
            permissionSnapshot: item.permission_snapshot
        };
    }

    async _handleMemoryReview() {
        const currentPersonId = this._getCurrentPersonId();
        if (!currentPersonId) {
            this._appendMessage('system', 'ログイン状態を確認できません。');
            return;
        }

        this._sending = true;
        this._updateSendState();
        try {
            const candidates = await this.manaChatService.listMemoryCandidates({
                owner_person_id: currentPersonId,
                status: 'pending_approval',
                include_promoted: false
            });
            const normalized = candidates.map((item) => this._normalizeMemoryCandidate(item));
            if (normalized.length === 0) {
                this._appendMessage('system', '承認待ちのMemory Candidateはありません。');
                return;
            }
            this.memoryCandidateModal.currentPersonId = currentPersonId;
            this.memoryCandidateModal.open({
                ...normalized[0],
                relatedItems: normalized
            });
        } catch (err) {
            this._appendMessage('system', 'Memory Candidateの取得に失敗しました。');
        } finally {
            this._sending = false;
            this._updateSendState();
        }
    }

    async _approveMemoryCandidate(item) {
        const candidateId = item.candidateId || item.candidate_id || item.id;
        await this.manaChatService.approveMemoryCandidate(candidateId, {
            actor_person_id: this._getCurrentPersonId(),
            decision_owner_person_id: item.ownerPersonId || item.owner_person_id,
            reason: 'approved_from_mana_review'
        });
        this._appendMessage('system', 'Memory Candidateを承認しました。');
    }

    async _rejectMemoryCandidate(item) {
        const candidateId = item.candidateId || item.candidate_id || item.id;
        await this.manaChatService.rejectMemoryCandidate(candidateId, {
            actor_person_id: this._getCurrentPersonId(),
            decision_owner_person_id: item.ownerPersonId || item.owner_person_id,
            reason: 'rejected_from_mana_review'
        });
        this._appendMessage('system', 'Memory Candidateを却下しました。');
    }

    async _expireMemoryCandidate(item) {
        const candidateId = item.candidateId || item.candidate_id || item.id;
        await this.manaChatService.expireMemoryCandidate(candidateId, {
            actor_person_id: this._getCurrentPersonId(),
            decision_owner_person_id: item.ownerPersonId || item.owner_person_id,
            reason: 'expired_from_mana_review'
        });
        this._appendMessage('system', 'Memory Candidateを期限切れにしました。');
    }

    async _requestMemoryCandidateRedaction(item) {
        const candidateId = item.candidateId || item.candidate_id || item.id;
        await this.manaChatService.requestMemoryCandidateRedaction(candidateId, {
            actor_person_id: this._getCurrentPersonId(),
            decision_owner_person_id: item.ownerPersonId || item.owner_person_id
        });
        this._appendMessage('system', 'Memory Candidateをredaction差し戻しにしました。');
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
        const avatar = document.createElement('span');
        avatar.className = 'mana-avatar';
        avatar.textContent = 'm';
        const dots = document.createElement('span');
        dots.className = 'mana-typing-dots';
        dots.appendChild(document.createElement('span'));
        dots.appendChild(document.createElement('span'));
        dots.appendChild(document.createElement('span'));
        el.append(avatar, dots);
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
            this.sendBtnEl.replaceChildren();
            if (this._sending) {
                const spinner = document.createElement('span');
                spinner.className = 'mana-send-spinner';
                this.sendBtnEl.appendChild(spinner);
            } else {
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('width', '16');
                svg.setAttribute('height', '16');
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.setAttribute('fill', 'none');
                svg.setAttribute('stroke', 'currentColor');
                svg.setAttribute('stroke-width', '2.5');
                const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path1.setAttribute('d', 'M22 2L11 13');
                const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path2.setAttribute('d', 'M22 2L15 22L11 13L2 9L22 2Z');
                svg.append(path1, path2);
                this.sendBtnEl.appendChild(svg);
            }
        }
        if (this.captureBtnEl) {
            this.captureBtnEl.disabled = this._sending;
        }
    }

    _appendFormattedText(parent, text) {
        const value = String(text || '');
        const codeBlockPattern = /```([\s\S]*?)```/g;
        let lastIndex = 0;
        let match;

        while ((match = codeBlockPattern.exec(value)) !== null) {
            this._appendInlineFormattedText(parent, value.slice(lastIndex, match.index));
            const pre = document.createElement('pre');
            pre.className = 'mana-code-block';
            pre.textContent = match[1];
            parent.appendChild(pre);
            lastIndex = match.index + match[0].length;
        }

        this._appendInlineFormattedText(parent, value.slice(lastIndex));
    }

    _appendInlineFormattedText(parent, text) {
        const inlinePattern = /(`[^`]+`|\*\*.+?\*\*|\n)/g;
        let lastIndex = 0;
        let match;

        while ((match = inlinePattern.exec(text)) !== null) {
            this._appendText(parent, text.slice(lastIndex, match.index));
            const token = match[0];
            if (token === '\n') {
                parent.appendChild(document.createElement('br'));
            } else if (token.startsWith('`')) {
                const code = document.createElement('code');
                code.className = 'mana-inline-code';
                code.textContent = token.slice(1, -1);
                parent.appendChild(code);
            } else {
                const strong = document.createElement('strong');
                strong.textContent = token.slice(2, -2);
                parent.appendChild(strong);
            }
            lastIndex = match.index + token.length;
        }

        this._appendText(parent, text.slice(lastIndex));
    }

    _appendText(parent, text) {
        if (!text) return;
        parent.appendChild(document.createTextNode(text));
    }

    _renderMessages() {
        if (!this.messagesEl) return;

        this.messagesEl.replaceChildren();
        for (const message of this.messages) {
            const item = document.createElement('div');
            const text = document.createElement('span');
            text.className = 'mana-msg-text';

            if (message.sender === 'user') {
                item.className = 'mana-msg mana-msg--user';
            } else if (message.sender === 'mana') {
                item.className = 'mana-msg mana-msg--mana';
                const avatar = document.createElement('span');
                avatar.className = 'mana-avatar';
                avatar.textContent = 'm';
                item.appendChild(avatar);
            } else {
                item.className = 'mana-msg mana-msg--system';
            }

            this._appendFormattedText(text, message.text);
            item.appendChild(text);
            this.messagesEl.appendChild(item);
        }

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
