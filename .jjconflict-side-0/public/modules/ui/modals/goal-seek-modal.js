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
import { showSuccess, showError } from '../../toast.js';

export class GoalSeekModal {
    constructor({ eventBus: bus = eventBus, goalSeekService, browserNotificationService } = {}) {
        this.eventBus = bus;
        this.service = goalSeekService;
        this.browserNotificationService = browserNotificationService;
        this.modalElement = null;
        this._unsubscribers = [];
        this._sessionId = null;
        this._goalId = null;
        this._mode = 'CREATE'; // 'CREATE' | 'UPDATE'
        this._currentGoal = null;
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

    async show(sessionId, goalId = null) {
        if (!this.modalElement) return;
        this._sessionId = sessionId || null;
        this._goalId = goalId;
        this._mode = goalId ? 'UPDATE' : 'CREATE';

        let errorMessage = null;

        // UPDATE modeの場合、既存ゴールを取得
        if (this._mode === 'UPDATE') {
            try {
                const goal = await this.service.getGoal(goalId);
                this._currentGoal = goal;
            } catch (err) {
                console.error('[GoalSeekModal] Failed to load goal:', err);
                this._currentGoal = null;
                errorMessage = err.message;
            }
        } else {
            this._currentGoal = null;
        }

        try {
            this._renderContent();
        } catch (err) {
            console.error('[GoalSeekModal] render error:', err);
        }

        // エラーがあれば表示（_renderContent()の後）
        if (errorMessage) {
            this._showErrorInModal(errorMessage);
        }

        this.modalElement.classList.add('active');
        this.eventBus.emit(EVENTS.MODAL_OPENED, { modalId: 'goal-seek-modal' });
    }

    _showErrorInModal(message) {
        if (!this.modalElement) return;
        const errorEl = this.modalElement.querySelector('#gs-modal-error');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
    }

    hide() {
        if (!this.modalElement) return;
        this.modalElement.classList.remove('active');
        this.eventBus.emit(EVENTS.MODAL_CLOSED, { modalId: 'goal-seek-modal' });
    }

    _renderContent() {
        if (!this.modalElement) return;

        // モードに応じたラベル
        const title = this._mode === 'CREATE' ? 'ゴール作成' : 'ゴール編集';
        const submitLabel = this._mode === 'CREATE' ? 'ゴール作成' : '更新';

        // フォームプリフィル値（UPDATE modeの場合）
        const goalTitle = this._currentGoal?.title || '';
        const goalDesc = this._currentGoal?.description || '';
        const goalCriteria = this._currentGoal?.criteria?.commit?.join('\n') || '';
        const autoAnswerLevel = this._currentGoal?.managerConfig?.autoAnswerLevel || 'moderate';

        this.modalElement.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h3 id="gs-modal-title"><i data-lucide="target"></i> ${title}</h3>
                    <button class="close-modal-btn" id="gs-modal-close"><i data-lucide="x"></i></button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>セッションID</label>
                        <input type="text" id="gs-session-id" class="form-input"
                               value="${this._escapeAttr(this._sessionId || '')}"
                               placeholder="例: session-1234567890"
                               readonly
                               style="background-color: rgba(255,255,255,0.05); cursor: not-allowed;" />
                    </div>
                    <div class="form-group">
                        <label>ゴール名 *</label>
                        <input type="text" id="gs-goal-title" class="form-input"
                               value="${this._escapeAttr(goalTitle)}"
                               placeholder="例: ユーザー認証の実装" />
                    </div>
                    <div class="form-group">
                        <label>説明</label>
                        <textarea id="gs-goal-desc" class="form-input" rows="3"
                                  placeholder="セッションで達成したいことの詳細">${this._escapeAttr(goalDesc)}</textarea>
                    </div>
                    <div class="form-group">
                        <label>完了条件（1行1項目）</label>
                        <textarea id="gs-goal-criteria" class="form-input" rows="3"
                                  placeholder="テスト通過&#10;ビルド成功&#10;TypeErrorなし">${this._escapeAttr(goalCriteria)}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Manager AI 自動回答レベル</label>
                        <select id="gs-auto-answer" class="form-input">
                            <option value="conservative" ${autoAnswerLevel === 'conservative' ? 'selected' : ''}>控えめ - 確認系のみ自動回答</option>
                            <option value="moderate" ${autoAnswerLevel === 'moderate' ? 'selected' : ''}>標準 - 技術判断は自動回答</option>
                            <option value="aggressive" ${autoAnswerLevel === 'aggressive' ? 'selected' : ''}>積極的 - ほぼ全て自動回答</option>
                        </select>
                    </div>
                    <div id="gs-modal-error" style="display:none; color: #e05252; font-size: 0.85rem; margin-top: 8px; padding: 6px 8px; background: rgba(224,82,82,0.12); border-radius: 4px;"></div>
                </div>
                <div class="modal-footer">
                    ${this._mode === 'UPDATE' ? '<button id="gs-modal-delete" class="btn-danger">削除</button>' : ''}
                    <button id="gs-modal-cancel" class="btn-secondary">キャンセル</button>
                    <button id="gs-modal-submit" class="btn-primary">${submitLabel}</button>
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

        // DELETE button (UPDATE modeのみ存在)
        const deleteBtn = this.modalElement.querySelector('#gs-modal-delete');
        if (deleteBtn) {
            const h = () => this._handleDelete();
            deleteBtn.addEventListener('click', h);
            this._unsubscribers.push(() => deleteBtn.removeEventListener('click', h));
        }

        // Backdrop click
        const backdropH = (e) => {
            if (e.target === this.modalElement) this.hide();
        };
        this.modalElement.addEventListener('click', backdropH);
        this._unsubscribers.push(() => this.modalElement.removeEventListener('click', backdropH));
    }

    async _handleSubmit() {
        const sessionId = this._sessionId;
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

        if (!this.service) {
            this._showError(errorEl, 'GoalSeekServiceが初期化されていません');
            console.error('[GoalSeekModal] this.service is null/undefined');
            return;
        }

        const submitBtn = this.modalElement.querySelector('#gs-modal-submit');
        try {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = this._mode === 'CREATE' ? '作成中...' : '更新中...';
            }

            if (this._mode === 'CREATE') {
                // CREATE mode
                await this.service.createGoal({
                    sessionId,
                    title,
                    description: description || undefined,
                    criteria,
                    managerConfig: { autoAnswerLevel }
                });
                showSuccess(`ゴール「${title}」を作成しました`);
            } else {
                // UPDATE mode
                await this.service.updateGoal(this._goalId, {
                    sessionId,
                    title,
                    description: description || undefined,
                    criteria,
                    managerConfig: { autoAnswerLevel }
                });
                showSuccess(`ゴール「${title}」を更新しました`);
            }

            this.hide();
        } catch (err) {
            console.error(`[GoalSeekModal] ${this._mode === 'CREATE' ? 'createGoal' : 'updateGoal'} error:`, err);
            this._showError(errorEl, err.message);
            showError(`ゴール${this._mode === 'CREATE' ? '作成' : '更新'}に失敗しました: ${err.message}`);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = this._mode === 'CREATE' ? 'ゴール作成' : '更新';
            }
        }
    }

    async _handleDelete() {
        if (!this._currentGoal) {
            console.error('[GoalSeekModal] _currentGoal is null');
            return;
        }

        const confirmed = window.confirm(`ゴール「${this._currentGoal.title}」を削除しますか？`);
        if (!confirmed) {
            return;
        }

        const deleteBtn = this.modalElement.querySelector('#gs-modal-delete');
        try {
            if (deleteBtn) {
                deleteBtn.disabled = true;
                deleteBtn.textContent = '削除中...';
            }

            await this.service.deleteGoal(this._goalId);

            this.hide();
            showSuccess('ゴールを削除しました');
        } catch (err) {
            console.error('[GoalSeekModal] deleteGoal error:', err);
            const errorEl = this.modalElement.querySelector('#gs-modal-error');
            this._showError(errorEl, err.message);
            showError(`ゴール削除に失敗しました: ${err.message}`);
            if (deleteBtn) {
                deleteBtn.disabled = false;
                deleteBtn.textContent = '削除';
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
