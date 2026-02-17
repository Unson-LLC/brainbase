/**
 * GoalSeekModal V2
 *
 * ゴール設定モーダル
 * - セッション選択
 * - ゴールタイトル/説明入力
 * - 完了条件（チェックリスト）
 * - Manager AI設定（autoAnswerLevel）
 */
import { eventBus, EVENTS } from '../../core/event-bus.js';

export class GoalSeekModal {
    constructor({ eventBus: bus = eventBus, goalSeekService, browserNotificationService } = {}) {
        this.eventBus = bus;
        this.service = goalSeekService;
        this.browserNotificationService = browserNotificationService;
        this.modalElement = null;
        this._unsubscribers = [];
        this._sessionId = null;
    }

    mount() {
        this.modalElement = document.getElementById('goal-seek-modal');
        if (!this.modalElement) {
            this._createModalElement();
        }
        this._renderContent();
        this._attachEventHandlers();
    }

    _createModalElement() {
        this.modalElement = document.createElement('div');
        this.modalElement.id = 'goal-seek-modal';
        this.modalElement.className = 'modal-overlay hidden';
        document.body.appendChild(this.modalElement);
    }

    show(sessionId) {
        if (!this.modalElement) return;
        this._sessionId = sessionId || null;
        this._renderContent();
        this.modalElement.classList.remove('hidden');
        this.modalElement.classList.add('active');
        this.eventBus.emit(EVENTS.MODAL_OPENED, { modalId: 'goal-seek-modal' });
    }

    hide() {
        if (!this.modalElement) return;
        this.modalElement.classList.remove('active');
        this.modalElement.classList.add('hidden');
        this.eventBus.emit(EVENTS.MODAL_CLOSED, { modalId: 'goal-seek-modal' });
    }

    _renderContent() {
        if (!this.modalElement) return;

        this.modalElement.innerHTML = `
            <div class="modal-content gs-modal">
                <div class="modal-header">
                    <h3>Set Goal for Session</h3>
                    <button class="modal-close-btn" id="gs-modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="gs-form-group">
                        <label class="gs-label">Session ID</label>
                        <input type="text" id="gs-session-id" class="gs-input"
                               value="${this._escapeAttr(this._sessionId || '')}"
                               placeholder="e.g. session-1234567890" />
                    </div>
                    <div class="gs-form-group">
                        <label class="gs-label">Goal Title *</label>
                        <input type="text" id="gs-goal-title" class="gs-input"
                               placeholder="e.g. Implement user authentication" />
                    </div>
                    <div class="gs-form-group">
                        <label class="gs-label">Description</label>
                        <textarea id="gs-goal-desc" class="gs-textarea" rows="3"
                                  placeholder="Detailed description of what the session should accomplish"></textarea>
                    </div>
                    <div class="gs-form-group">
                        <label class="gs-label">Completion Criteria (one per line)</label>
                        <textarea id="gs-goal-criteria" class="gs-textarea" rows="3"
                                  placeholder="Tests pass\nCode compiles\nNo TypeErrors"></textarea>
                    </div>
                    <div class="gs-form-group">
                        <label class="gs-label">Auto-Answer Level</label>
                        <select id="gs-auto-answer" class="gs-select">
                            <option value="conservative">Conservative - Only confirmations</option>
                            <option value="moderate" selected>Moderate - Technical decisions auto</option>
                            <option value="aggressive">Aggressive - Almost everything auto</option>
                        </select>
                    </div>
                    <div id="gs-modal-error" class="gs-error hidden"></div>
                </div>
                <div class="modal-footer">
                    <button id="gs-modal-cancel" class="btn-secondary">Cancel</button>
                    <button id="gs-modal-submit" class="btn-primary">Create Goal</button>
                </div>
            </div>
        `;

        // Reattach handlers after render
        this._attachEventHandlers();
    }

    _attachEventHandlers() {
        if (!this.modalElement) return;

        // Remove old
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];

        const closeBtn = this.modalElement.querySelector('#gs-modal-close');
        if (closeBtn) {
            const h = () => this.hide();
            closeBtn.addEventListener('click', h);
            this._unsubscribers.push(() => closeBtn.removeEventListener('click', h));
        }

        const cancelBtn = this.modalElement.querySelector('#gs-modal-cancel');
        if (cancelBtn) {
            const h = () => this.hide();
            cancelBtn.addEventListener('click', h);
            this._unsubscribers.push(() => cancelBtn.removeEventListener('click', h));
        }

        const submitBtn = this.modalElement.querySelector('#gs-modal-submit');
        if (submitBtn) {
            const h = () => this._handleSubmit();
            submitBtn.addEventListener('click', h);
            this._unsubscribers.push(() => submitBtn.removeEventListener('click', h));
        }

        // Backdrop click
        const backdropH = (e) => {
            if (e.target === this.modalElement) this.hide();
        };
        this.modalElement.addEventListener('click', backdropH);
        this._unsubscribers.push(() => this.modalElement.removeEventListener('click', backdropH));
    }

    async _handleSubmit() {
        const sessionId = this.modalElement.querySelector('#gs-session-id')?.value?.trim();
        const title = this.modalElement.querySelector('#gs-goal-title')?.value?.trim();
        const description = this.modalElement.querySelector('#gs-goal-desc')?.value?.trim();
        const criteriaText = this.modalElement.querySelector('#gs-goal-criteria')?.value?.trim();
        const autoAnswerLevel = this.modalElement.querySelector('#gs-auto-answer')?.value;

        const errorEl = this.modalElement.querySelector('#gs-modal-error');

        if (!sessionId) {
            this._showError(errorEl, 'Session ID is required');
            return;
        }
        if (!title) {
            this._showError(errorEl, 'Goal title is required');
            return;
        }

        const criteria = criteriaText
            ? { commit: criteriaText.split('\n').map(l => l.trim()).filter(Boolean) }
            : undefined;

        try {
            const submitBtn = this.modalElement.querySelector('#gs-modal-submit');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Creating...';
            }

            await this.service.createGoal({
                sessionId,
                title,
                description: description || undefined,
                criteria,
                managerConfig: { autoAnswerLevel }
            });

            this.hide();
        } catch (err) {
            this._showError(errorEl, err.message);
            const submitBtn = this.modalElement.querySelector('#gs-modal-submit');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Create Goal';
            }
        }
    }

    _showError(el, message) {
        if (el) {
            el.textContent = message;
            el.classList.remove('hidden');
        }
    }

    _escapeAttr(str) {
        if (!str) return '';
        return str.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    unmount() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        this.modalElement = null;
    }
}
