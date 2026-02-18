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
        this.modalElement.className = 'modal';
        document.body.appendChild(this.modalElement);
    }

    show(sessionId) {
        if (!this.modalElement) return;
        this._sessionId = sessionId || null;
        this._renderContent();
        this.modalElement.classList.add('active');
        this.eventBus.emit(EVENTS.MODAL_OPENED, { modalId: 'goal-seek-modal' });
    }

    hide() {
        if (!this.modalElement) return;
        this.modalElement.classList.remove('active');
        this.eventBus.emit(EVENTS.MODAL_CLOSED, { modalId: 'goal-seek-modal' });
    }

    _renderContent() {
        if (!this.modalElement) return;

        this.modalElement.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3><i data-lucide="target"></i> ゴール設定</h3>
                    <button class="close-modal-btn" id="gs-modal-close"><i data-lucide="x"></i></button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>セッションID</label>
                        <input type="text" id="gs-session-id" class="form-input"
                               value="${this._escapeAttr(this._sessionId || '')}"
                               placeholder="例: session-1234567890" />
                    </div>
                    <div class="form-group">
                        <label>ゴール名 *</label>
                        <input type="text" id="gs-goal-title" class="form-input"
                               placeholder="例: ユーザー認証の実装" />
                    </div>
                    <div class="form-group">
                        <label>説明</label>
                        <textarea id="gs-goal-desc" class="form-input" rows="3"
                                  placeholder="セッションで達成したいことの詳細"></textarea>
                    </div>
                    <div class="form-group">
                        <label>完了条件（1行1項目）</label>
                        <textarea id="gs-goal-criteria" class="form-input" rows="3"
                                  placeholder="テスト通過&#10;ビルド成功&#10;TypeErrorなし"></textarea>
                    </div>
                    <div class="form-group">
                        <label>Manager AI 自動回答レベル</label>
                        <select id="gs-auto-answer" class="form-input">
                            <option value="conservative">控えめ - 確認系のみ自動回答</option>
                            <option value="moderate" selected>標準 - 技術判断は自動回答</option>
                            <option value="aggressive">積極的 - ほぼ全て自動回答</option>
                        </select>
                    </div>
                    <div id="gs-modal-error" style="display:none; color: #e05252; font-size: 0.85rem; margin-top: 8px; padding: 6px 8px; background: rgba(224,82,82,0.12); border-radius: 4px;"></div>
                </div>
                <div class="modal-footer">
                    <button id="gs-modal-cancel" class="btn-secondary">キャンセル</button>
                    <button id="gs-modal-submit" class="btn-primary">ゴール作成</button>
                </div>
            </div>
        `;

        // Lucideアイコンを描画
        if (window.lucide) {
            window.lucide.createIcons();
        }

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
            this._showError(errorEl, 'セッションIDは必須です');
            return;
        }
        if (!title) {
            this._showError(errorEl, 'ゴール名は必須です');
            return;
        }

        const criteria = criteriaText
            ? { commit: criteriaText.split('\n').map(l => l.trim()).filter(Boolean) }
            : undefined;

        try {
            const submitBtn = this.modalElement.querySelector('#gs-modal-submit');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = '作成中...';
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
                submitBtn.textContent = 'ゴール作成';
            }
        }
    }

    _showError(el, message) {
        if (el) {
            el.textContent = message;
            el.style.display = 'block';
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
