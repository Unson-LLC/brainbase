import { refreshIcons } from '../../ui-helpers.js';

function formatHealthStatus(value) {
    if (value === 'stale') return '更新停止';
    if (value === 'error') return 'エラー';
    if (value === 'unconfigured') return '未設定';
    return '正常';
}

function formatDateTime(value) {
    if (!value) return '未記録';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '未記録';
    return new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

export class HealthAlertModal {
    constructor() {
        this.modalEl = null;
        this.currentItem = null;
        this.boundClose = () => this.close();
    }

    _ensureModal() {
        if (this.modalEl) return;

        const wrapper = document.createElement('div');
        wrapper.id = 'health-alert-modal';
        wrapper.className = 'learning-candidate-modal hidden';
        wrapper.innerHTML = `
            <div class="learning-candidate-modal-backdrop" data-action="close"></div>
            <div class="learning-candidate-modal-dialog learning-candidate-modal-dialog-compact" role="dialog" aria-modal="true" aria-labelledby="health-alert-modal-title">
                <div class="learning-candidate-modal-header learning-candidate-modal-header-warning">
                    <div class="learning-candidate-modal-header-main">
                        <div class="learning-candidate-modal-badges">
                            <span class="learning-pill learning-pill-warning">システム警告</span>
                            <span id="health-alert-status-badge" class="learning-pill learning-pill-danger"></span>
                        </div>
                        <div class="learning-candidate-title-row">
                            <h2 id="health-alert-modal-title" class="learning-candidate-modal-title"></h2>
                        </div>
                        <p id="health-alert-message" class="learning-candidate-source-preview"></p>
                    </div>
                    <button id="health-alert-modal-close" class="learning-candidate-modal-close" aria-label="閉じる">
                        <i data-lucide="x"></i>
                    </button>
                </div>
                <div class="learning-candidate-modal-body">
                    <div class="learning-candidate-meta-grid">
                        <section class="learning-candidate-card">
                            <h3>最終成功</h3>
                            <p id="health-alert-last-success" class="learning-candidate-meta-value"></p>
                        </section>
                        <section class="learning-candidate-card">
                            <h3>予定時刻</h3>
                            <p id="health-alert-expected-run" class="learning-candidate-meta-value"></p>
                        </section>
                    </div>
                    <div class="learning-candidate-meta-grid">
                        <section class="learning-candidate-card">
                            <h3>終了コード</h3>
                            <p id="health-alert-exit-status" class="learning-candidate-meta-value"></p>
                        </section>
                        <section class="learning-candidate-card">
                            <h3>確認コマンド</h3>
                            <p class="learning-candidate-meta-value">launchctl list com.brainbase.learning</p>
                        </section>
                    </div>
                    <section class="learning-candidate-panel">
                        <h3>ログパス</h3>
                        <pre id="health-alert-log-paths" class="learning-candidate-pre"></pre>
                    </section>
                </div>
                <div class="learning-candidate-modal-footer">
                    <button id="health-alert-cancel-btn" class="btn-secondary">閉じる</button>
                </div>
            </div>
        `;

        document.body.appendChild(wrapper);
        this.modalEl = wrapper;

        wrapper.querySelector('[data-action="close"]').addEventListener('click', this.boundClose);
        wrapper.querySelector('#health-alert-modal-close').addEventListener('click', this.boundClose);
        wrapper.querySelector('#health-alert-cancel-btn').addEventListener('click', this.boundClose);
    }

    open(item) {
        this._ensureModal();
        this.currentItem = item;

        this.modalEl.querySelector('#health-alert-status-badge').textContent = formatHealthStatus(item.healthStatus);
        this.modalEl.querySelector('#health-alert-modal-title').textContent = item.title || '学習ジョブの状態に問題があります';
        this.modalEl.querySelector('#health-alert-message').textContent = item.message || '';
        this.modalEl.querySelector('#health-alert-last-success').textContent = formatDateTime(item.lastSuccessAt);
        this.modalEl.querySelector('#health-alert-expected-run').textContent = formatDateTime(item.expectedRunAt);
        this.modalEl.querySelector('#health-alert-exit-status').textContent = item.lastExitStatus == null ? '未記録' : String(item.lastExitStatus);
        this.modalEl.querySelector('#health-alert-log-paths').textContent = [
            `summary: ${item.summaryPath || '未設定'}`,
            `stdout: ${item.stdoutLogPath || '未設定'}`,
            `stderr: ${item.stderrLogPath || '未設定'}`
        ].join('\n');

        this.modalEl.classList.remove('hidden');
        refreshIcons();
    }

    close() {
        if (!this.modalEl) return;
        this.modalEl.classList.add('hidden');
        this.currentItem = null;
    }
}
