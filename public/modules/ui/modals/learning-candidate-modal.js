import { escapeHtml, refreshIcons } from '../../ui-helpers.js';

function formatPillar(value) {
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
    constructor({ onApply, onReject }) {
        this.onApply = onApply;
        this.onReject = onReject;
        this.modalEl = null;
        this.currentItem = null;
        this.boundClose = () => this.close();
    }

    _ensureModal() {
        if (this.modalEl) return;
        const wrapper = document.createElement('div');
        wrapper.id = 'learning-candidate-modal';
        wrapper.className = 'learning-candidate-modal hidden';
        wrapper.innerHTML = `
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
                    <section class="learning-candidate-panel">
                        <h3>提案内容</h3>
                        <pre id="learning-candidate-proposed-content" class="learning-candidate-pre"></pre>
                    </section>
                </div>
                <div class="learning-candidate-modal-footer">
                    <button id="learning-candidate-cancel-btn" class="btn-secondary">閉じる</button>
                    <button id="learning-candidate-reject-btn" class="btn-danger">却下</button>
                    <button id="learning-candidate-apply-btn" class="btn-primary">反映する</button>
                </div>
            </div>
        `;

        document.body.appendChild(wrapper);
        this.modalEl = wrapper;

        wrapper.querySelector('[data-action="close"]').addEventListener('click', this.boundClose);
        wrapper.querySelector('#learning-candidate-modal-close').addEventListener('click', this.boundClose);
        wrapper.querySelector('#learning-candidate-cancel-btn').addEventListener('click', this.boundClose);
        wrapper.querySelector('#learning-candidate-apply-btn').addEventListener('click', async () => {
            if (!this.currentItem) return;
            await this.onApply?.(this.currentItem);
            this.close();
        });
        wrapper.querySelector('#learning-candidate-reject-btn').addEventListener('click', async () => {
            if (!this.currentItem) return;
            await this.onReject?.(this.currentItem);
            this.close();
        });
    }

    open(item) {
        this._ensureModal();
        this.currentItem = item;

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
        this.modalEl.classList.remove('hidden');
        refreshIcons();
    }

    close() {
        if (!this.modalEl) return;
        this.modalEl.classList.add('hidden');
        this.currentItem = null;
    }
}
