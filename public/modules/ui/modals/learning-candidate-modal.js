import { refreshIcons, setSanitizedHtml } from '../../ui-helpers.js';

function isMemoryCandidate(item) {
    return item?.kind === 'memory_candidate' || item?.candidateType === 'memory_candidate' || item?.source === 'memory_candidate';
}

function formatPillar(value) {
    if (value === 'memory') return 'Memory';
    if (value === 'wiki') return 'Wiki';
    if (value === 'skill') return 'スキル';
    return '候補';
}

function formatRiskLevel(value) {
    if (value === 'high') return '高';
    if (value === 'medium') return '中';
    return '低';
}

function formatSourceType(value) {
    if (value === 'review') return 'レビュー';
    if (value === 'explicit_learn') return '明示学習';
    if (value === 'session_log') return 'Claudeログ';
    if (value === 'codex_session_log') return 'Codexログ';
    return '不明';
}

function formatOutcome(value) {
    if (value === 'failure') return '失敗';
    if (value === 'partial') return '部分成功';
    if (value === 'success') return '成功';
    return '不明';
}

function formatMemoryScope(item) {
    const visibility = item.visibility || item.scope || 'unknown';
    const sensitivity = item.sensitivity || 'unknown';
    return `${visibility} / ${sensitivity}`;
}

function getCandidateId(item) {
    return item?.candidateId || item?.candidate_id || item?.id || '';
}

function getOwnerPersonId(item) {
    return item?.ownerPersonId || item?.owner_person_id || '';
}

function getCurrentPersonId(item, fallback) {
    return item?.currentPersonId || item?.current_person_id || fallback || '';
}

function canCurrentUserReview(item, fallbackPersonId) {
    if (!isMemoryCandidate(item)) return true;
    const ownerPersonId = getOwnerPersonId(item);
    const currentPersonId = getCurrentPersonId(item, fallbackPersonId);
    return Boolean(ownerPersonId && currentPersonId && ownerPersonId === currentPersonId);
}

function requiresRedaction(item) {
    return item?.redactionStatus === 'needs_redaction' || item?.redaction_status === 'needs_redaction';
}

function formatDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ja-JP', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

export class LearningCandidateModal {
    /**
     * @param {{
     *   onApply?: Function,
     *   onReject?: Function,
     *   onApplyAll?: Function,
     *   onRejectAll?: Function,
     *   onApproveMemory?: Function,
     *   onRejectMemory?: Function,
     *   onExpireMemory?: Function,
     *   onRequestRedaction?: Function,
     *   currentPersonId?: string|null
     * }} handlers
     */
    constructor({
        onApply,
        onReject,
        onApplyAll,
        onRejectAll,
        onApproveMemory,
        onRejectMemory,
        onExpireMemory,
        onRequestRedaction,
        currentPersonId = null
    }) {
        this.onApply = onApply;
        this.onReject = onReject;
        this.onApplyAll = onApplyAll;
        this.onRejectAll = onRejectAll;
        this.onApproveMemory = onApproveMemory;
        this.onRejectMemory = onRejectMemory;
        this.onExpireMemory = onExpireMemory;
        this.onRequestRedaction = onRequestRedaction;
        this.currentPersonId = currentPersonId;
        this.modalEl = null;
        this.currentItem = null;
        this.boundClose = () => this.close();
    }

    _ensureModal() {
        if (this.modalEl) return;
        const wrapper = document.createElement('div');
        wrapper.id = 'learning-candidate-modal';
        wrapper.className = 'learning-candidate-modal hidden';
        setSanitizedHtml(wrapper, `
            <div class="learning-candidate-modal-backdrop" data-action="close"></div>
            <div class="learning-candidate-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="learning-candidate-modal-title">
                <div class="learning-candidate-modal-header">
                    <div class="learning-candidate-modal-header-main">
                        <div class="learning-candidate-modal-badges">
                            <span id="learning-candidate-pillar-badge" class="learning-pill learning-pill-primary"></span>
                            <span id="learning-candidate-risk-badge" class="learning-pill learning-pill-risk"></span>
                        </div>
                        <div class="learning-candidate-title-row">
                            <h2 id="learning-candidate-modal-title" class="learning-candidate-modal-title"></h2>
                            <span id="learning-candidate-updated-at" class="learning-candidate-modal-updated-at"></span>
                        </div>
                        <p id="learning-candidate-source-preview" class="learning-candidate-source-preview"></p>
                    </div>
                    <button id="learning-candidate-modal-close" class="learning-candidate-modal-close" aria-label="閉じる">
                        <i data-lucide="x"></i>
                    </button>
                </div>
                <div class="learning-candidate-modal-body">
                    <div class="learning-candidate-meta-grid">
                        <section class="learning-candidate-card">
                            <h3>対象</h3>
                            <p id="learning-candidate-target-ref" class="learning-candidate-meta-value"></p>
                        </section>
                    <section class="learning-candidate-card">
                        <h3>起点</h3>
                        <p id="learning-candidate-source-meta" class="learning-candidate-meta-value"></p>
                    </section>
                    <section class="learning-candidate-card">
                        <h3>統合件数</h3>
                        <p id="learning-candidate-merged-count" class="learning-candidate-meta-value"></p>
                    </section>
                    <section class="learning-candidate-card">
                        <h3>正規化要約</h3>
                        <p id="learning-candidate-canonical-summary" class="learning-candidate-meta-value"></p>
                    </section>
                </div>
                    <section class="learning-candidate-panel">
                        <h3>評価</h3>
                        <pre id="learning-candidate-evaluation" class="learning-candidate-pre"></pre>
                    </section>
                    <section id="learning-candidate-related-panel" class="learning-candidate-panel hidden">
                        <h3>関連候補</h3>
                        <div id="learning-candidate-related-list" class="learning-candidate-related-list"></div>
                    </section>
                    <section class="learning-candidate-panel">
                        <h3>提案内容</h3>
                        <pre id="learning-candidate-proposed-content" class="learning-candidate-pre"></pre>
                    </section>
                </div>
                <div class="learning-candidate-modal-footer">
                    <button id="learning-candidate-cancel-btn" class="btn-secondary">閉じる</button>
                    <button id="learning-candidate-reject-all-btn" class="btn-danger hidden">一括却下</button>
                    <button id="learning-candidate-apply-all-btn" class="btn-primary hidden">一括反映</button>
                    <button id="learning-candidate-request-redaction-btn" class="btn-secondary hidden">差し戻し</button>
                    <button id="learning-candidate-expire-btn" class="btn-secondary hidden">期限切れ</button>
                    <button id="learning-candidate-reject-btn" class="btn-danger">却下</button>
                    <button id="learning-candidate-apply-btn" class="btn-primary">反映する</button>
                </div>
            </div>
        `);

        document.body.appendChild(wrapper);
        this.modalEl = wrapper;

        wrapper.querySelector('[data-action="close"]').addEventListener('click', this.boundClose);
        wrapper.querySelector('#learning-candidate-modal-close').addEventListener('click', this.boundClose);
        wrapper.querySelector('#learning-candidate-cancel-btn').addEventListener('click', this.boundClose);
        wrapper.querySelector('#learning-candidate-apply-btn').addEventListener('click', async () => {
            if (!this.currentItem) return;
            if (isMemoryCandidate(this.currentItem)) {
                await this.onApproveMemory?.(this.currentItem);
            } else {
                await this.onApply?.(this.currentItem);
            }
            this.close();
        });
        wrapper.querySelector('#learning-candidate-reject-btn').addEventListener('click', async () => {
            if (!this.currentItem) return;
            if (isMemoryCandidate(this.currentItem)) {
                await this.onRejectMemory?.(this.currentItem);
            } else {
                await this.onReject?.(this.currentItem);
            }
            this.close();
        });
        wrapper.querySelector('#learning-candidate-apply-all-btn').addEventListener('click', async () => {
            if (!this.currentItem) return;
            await this.onApplyAll?.(this.currentItem.relatedItems || []);
            this.close();
        });
        wrapper.querySelector('#learning-candidate-reject-all-btn').addEventListener('click', async () => {
            if (!this.currentItem) return;
            await this.onRejectAll?.(this.currentItem.relatedItems || []);
            this.close();
        });
        wrapper.querySelector('#learning-candidate-expire-btn').addEventListener('click', async () => {
            if (!this.currentItem) return;
            await this.onExpireMemory?.(this.currentItem);
            this.close();
        });
        wrapper.querySelector('#learning-candidate-request-redaction-btn').addEventListener('click', async () => {
            if (!this.currentItem) return;
            await this.onRequestRedaction?.(this.currentItem);
            this.close();
        });
    }

    open(item) {
        this._ensureModal();
        this._renderItem(item);
        this.modalEl.classList.remove('hidden');
        refreshIcons();
    }

    _renderItem(item) {
        this.currentItem = item;
        if (isMemoryCandidate(item)) {
            this._renderMemoryCandidate(item);
        } else {
            this._renderLearningCandidate(item);
        }

        this._renderRelatedItems(item);
        this._renderActions(item);
    }

    _renderLearningCandidate(item) {
        this.modalEl.querySelector('#learning-candidate-pillar-badge').textContent = formatPillar(item.pillar);
        this.modalEl.querySelector('#learning-candidate-risk-badge').textContent = formatRiskLevel(item.riskLevel);
        this.modalEl.querySelector('#learning-candidate-modal-title').textContent = item.title || '学習候補';
        this.modalEl.querySelector('#learning-candidate-updated-at').textContent = formatDateTime(item.updatedAt);
        this.modalEl.querySelector('#learning-candidate-source-preview').textContent = item.sourcePreview || '学習の要約はまだありません。';
        this.modalEl.querySelector('#learning-candidate-target-ref').textContent = item.targetRef || '未設定';
        this.modalEl.querySelector('#learning-candidate-source-meta').textContent = `${formatSourceType(item.sourceType)} / ${formatOutcome(item.outcome)}`;
        this.modalEl.querySelector('#learning-candidate-merged-count').textContent = String(item.mergedEpisodeCount || 1);
        this.modalEl.querySelector('#learning-candidate-canonical-summary').textContent = item.canonicalSummary || '未設定';
        this.modalEl.querySelector('#learning-candidate-evaluation').textContent = JSON.stringify(item.evaluationSummary || {}, null, 2);
        this.modalEl.querySelector('#learning-candidate-proposed-content').textContent = item.proposedContent || '';
    }

    _renderMemoryCandidate(item) {
        const memory = item.memory || {};
        this.modalEl.querySelector('#learning-candidate-pillar-badge').textContent = formatPillar('memory');
        this.modalEl.querySelector('#learning-candidate-risk-badge').textContent = formatMemoryScope(item);
        this.modalEl.querySelector('#learning-candidate-modal-title').textContent = memory.summary || item.title || 'Memory Candidate';
        this.modalEl.querySelector('#learning-candidate-updated-at').textContent = formatDateTime(item.updatedAt || item.updated_at);
        this.modalEl.querySelector('#learning-candidate-source-preview').textContent = memory.summary || item.sourcePreview || 'Memory candidate';
        this.modalEl.querySelector('#learning-candidate-target-ref').textContent = `${item.subjectType || item.subject_type || 'subject'}:${item.subjectId || item.subject_id || '未設定'}`;
        this.modalEl.querySelector('#learning-candidate-source-meta').textContent = `${item.sourceSystem || item.source_system || 'source'} / ${item.promotionStatus || item.promotion_status || 'candidate'}`;
        this.modalEl.querySelector('#learning-candidate-merged-count').textContent = String((item.evidenceIds || item.evidence_ids || []).length || 1);
        this.modalEl.querySelector('#learning-candidate-canonical-summary').textContent = memory.kind || item.visibility || 'memory';
        this.modalEl.querySelector('#learning-candidate-evaluation').textContent = JSON.stringify({
            permission_snapshot: item.permissionSnapshot || item.permission_snapshot || {},
            redaction_status: item.redactionStatus || item.redaction_status || 'none',
            requires_approval: item.requiresApproval ?? item.requires_approval ?? true
        }, null, 2);
        this.modalEl.querySelector('#learning-candidate-proposed-content').textContent = JSON.stringify(memory, null, 2);
    }

    _renderRelatedItems(item) {
        const relatedItems = Array.isArray(item.relatedItems) ? item.relatedItems : [];
        const panel = this.modalEl.querySelector('#learning-candidate-related-panel');
        const list = this.modalEl.querySelector('#learning-candidate-related-list');
        list.replaceChildren();

        if (relatedItems.length === 0) {
            panel.classList.add('hidden');
            return;
        }

        panel.classList.remove('hidden');
        for (const related of relatedItems) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'learning-candidate-related-item';
            button.dataset.relatedCandidateId = getCandidateId(related);
            button.textContent = related.title || related.targetRef || getCandidateId(related) || '関連候補';
            button.addEventListener('click', () => this._renderItem({
                ...related,
                relatedItems
            }));
            list.appendChild(button);
        }
    }

    _renderActions(item) {
        const applyBtn = this.modalEl.querySelector('#learning-candidate-apply-btn');
        const rejectBtn = this.modalEl.querySelector('#learning-candidate-reject-btn');
        const applyAllBtn = this.modalEl.querySelector('#learning-candidate-apply-all-btn');
        const rejectAllBtn = this.modalEl.querySelector('#learning-candidate-reject-all-btn');
        const expireBtn = this.modalEl.querySelector('#learning-candidate-expire-btn');
        const requestRedactionBtn = this.modalEl.querySelector('#learning-candidate-request-redaction-btn');
        const relatedItems = Array.isArray(item.relatedItems) ? item.relatedItems : [];
        const isMemory = isMemoryCandidate(item);
        const canReview = canCurrentUserReview(item, this.currentPersonId);
        const redactionBlocked = requiresRedaction(item);

        applyAllBtn.classList.toggle('hidden', isMemory || relatedItems.length < 2);
        rejectAllBtn.classList.toggle('hidden', isMemory || relatedItems.length < 2);
        expireBtn.classList.toggle('hidden', !isMemory || !canReview);
        requestRedactionBtn.classList.toggle('hidden', !isMemory || !canReview);
        applyBtn.classList.toggle('hidden', isMemory && !canReview);
        rejectBtn.classList.toggle('hidden', isMemory && !canReview);

        applyBtn.textContent = isMemory ? '承認' : '反映する';
        rejectBtn.textContent = '却下';
        applyBtn.disabled = Boolean(isMemory && redactionBlocked);
        applyBtn.title = isMemory && redactionBlocked ? 'redaction required' : '';
    }

    close() {
        if (!this.modalEl) return;
        this.modalEl.classList.add('hidden');
        this.currentItem = null;
    }
}
