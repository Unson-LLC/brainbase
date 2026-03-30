import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';
import { escapeHtml, refreshIcons } from '../../ui-helpers.js';
import { LearningCandidateModal } from '../modals/learning-candidate-modal.js';
import { HealthAlertModal } from '../modals/health-alert-modal.js';

/**
 * Inbox（通知）表示のUIコンポーネント
 */
export class InboxView {
    constructor({ inboxService, httpClient }) {
        this.inboxService = inboxService;
        this.httpClient = httpClient;
        this.eventBus = eventBus;
        this.store = appStore;
        this.inboxTriggerBtn = null;
        this.inboxDropdown = null;
        this.inboxListEl = null;
        this.inboxBadge = null;
        this.markAllDoneBtn = null;
        this.inboxItems = [];
        this.inboxOpen = false;
        this._slackIdMap = new Map();
        this._unsubscribers = [];
        this._outsideClickHandler = null;
        this.learningCandidateModal = new LearningCandidateModal({
            onApply: async (item) => this.inboxService.applyLearningCandidate(item.candidateId),
            onReject: async (item) => this.inboxService.rejectLearningCandidate(item.candidateId)
        });
        this.healthAlertModal = new HealthAlertModal();
    }

    /**
     * DOMコンテナにマウント
     */
    mount() {
        this.inboxTriggerBtn = document.getElementById('inbox-trigger-btn');
        this.inboxDropdown = document.getElementById('inbox-dropdown');
        this.inboxListEl = document.getElementById('inbox-list');
        this.inboxBadge = document.getElementById('inbox-badge');
        this.markAllDoneBtn = document.getElementById('mark-all-done-btn');

        this._setupEventListeners();
        this._setupStoreSubscription();
        this._loadSlackMembers();
        this.inboxService.loadInbox();
    }

    /**
     * Slackメンバー情報を読み込み、ID→名前マップを構築
     */
    async _loadSlackMembers() {
        try {
            const members = await this.httpClient.get('/api/config/slack/members', { suppressAuthError: true });
            if (Array.isArray(members)) {
                for (const m of members) {
                    if (m.slack_id && m.brainbase_name) {
                        this._slackIdMap.set(m.slack_id, m.brainbase_name);
                    }
                }
            }
            // メンバー読み込み完了後に再レンダリング
            if (this._slackIdMap.size > 0) {
                this.render();
            }
        } catch (e) {
            console.warn('Failed to load slack members:', e);
        }
    }

    /**
     * メッセージ内のSlack ID（<@U07B19N048G>）を人名に変換
     */
    _convertSlackMentions(message) {
        if (!message || this._slackIdMap.size === 0) return message;
        return message.replace(/<@(U[A-Z0-9]+)>/g, (match, slackId) => {
            const name = this._slackIdMap.get(slackId);
            return name ? `@${name}` : match;
        });
    }

    /**
     * イベントリスナーの設定
     */
    _setupEventListeners() {
        // Toggle inbox dropdown
        if (this.inboxTriggerBtn) {
            this.inboxTriggerBtn.onclick = (e) => {
                e.stopPropagation();
                this.inboxOpen = !this.inboxOpen;
                this.inboxDropdown.classList.toggle('open', this.inboxOpen);
            };
        }

        // Close dropdown on outside click
        this._outsideClickHandler = (e) => {
            if (this.inboxOpen &&
                !this.inboxDropdown.contains(e.target) &&
                !this.inboxTriggerBtn.contains(e.target)) {
                this.inboxOpen = false;
                this.inboxDropdown.classList.remove('open');
            }
        };
        document.addEventListener('click', this._outsideClickHandler);

        // Mark all done button
        if (this.markAllDoneBtn) {
            this.markAllDoneBtn.onclick = async () => {
                await this.inboxService.markAllAsDone();
            };
        }

        // EventBusリスナー
        const unsub = this.eventBus.on(EVENTS.INBOX_LOADED, () => this.render());
        this._unsubscribers.push(unsub);
    }

    /**
     * Store変更の購読設定
     */
    _setupStoreSubscription() {
        const unsub = this.store.subscribe((change) => {
            if (change.key === 'inbox') {
                this.render();
            }
        });
        this._unsubscribers.push(unsub);
    }


    /**
     * Inboxをレンダリング
     */
    render() {
        // Storeからinboxデータを取得
        const { inbox } = this.store.getState();
        this.inboxItems = inbox || [];

        // Always show inbox button (UX improvement)
        if (this.inboxTriggerBtn) {
            this.inboxTriggerBtn.style.display = 'flex';
        }

        // Update badge count
        if (this.inboxBadge) {
            this.inboxBadge.textContent = this.inboxItems.length;
            // Hide badge if no items
            this.inboxBadge.style.display = this.inboxItems.length > 0 ? 'inline-flex' : 'none';
        }

        // Show empty state if no items
        if (this.inboxItems.length === 0) {
            if (this.inboxListEl) {
                this.inboxListEl.innerHTML = '<div class="inbox-empty">通知はありません</div>';
            }
            if (this.markAllDoneBtn) {
                this.markAllDoneBtn.style.display = 'none';
            }
            if (this.inboxDropdown) {
                this.inboxDropdown.classList.remove('open');
            }
            this.inboxOpen = false;
            return;
        }

        if (this.inboxListEl) {
            const healthAlertItems = this.inboxItems.filter((item) => item.kind === 'health_alert');
            const learningItems = this.inboxItems.filter((item) => item.kind === 'learning');
            const notificationItems = this.inboxItems.filter((item) => item.kind === 'notification');

            if (this.markAllDoneBtn) {
                this.markAllDoneBtn.style.display = notificationItems.length > 0 ? 'inline-flex' : 'none';
            }

            const renderNotification = (item) => {
                const escapedId = escapeHtml(item.id || '');
                const sender = escapeHtml(item.sender || '');
                const channel = escapeHtml(item.channel || '');
                const convertedMessage = this._convertSlackMentions(item.message || '');
                const message = escapeHtml(convertedMessage);
                const slackUrl = escapeHtml(item.slackUrl || '');
                const date = escapeHtml(item.date || '');
                const time = escapeHtml(item.time || '');
                const datetime = date && time ? `${date} ${time}` : (date || time || '');

                return `
                    <div class="inbox-item" data-id="${escapedId}">
                        <div class="inbox-item-header">
                            <span class="inbox-item-sender">${sender}</span>
                            <span class="inbox-item-channel">#${channel}</span>
                            ${datetime ? `<span class="inbox-item-time">${datetime}</span>` : ''}
                        </div>
                        <div class="inbox-item-message">${message}</div>
                        <div class="inbox-item-footer">
                            ${item.slackUrl ? `<a href="${slackUrl}" target="_blank" class="inbox-slack-link">Slackで開く</a>` : ''}
                            <button class="inbox-done-btn" data-id="${escapedId}">確認済み</button>
                        </div>
                    </div>
                `;
            };

            const renderLearning = (item) => {
                const escapedId = escapeHtml(item.candidateId || item.id || '');
                const pillar = escapeHtml(item.pillar === 'skill' ? 'スキル' : 'Wiki');
                const risk = escapeHtml(item.riskLevel === 'high' ? '高' : item.riskLevel === 'medium' ? '中' : '低');
                const title = escapeHtml(item.title || '学習候補');
                const preview = escapeHtml(item.sourcePreview || '');
                const mergedLabel = Number(item.mergedEpisodeCount || 1) > 1
                    ? `<span class="inbox-learning-pill inbox-learning-pill-merged">+${Number(item.mergedEpisodeCount) - 1}件統合</span>`
                    : '';
                const updatedAt = escapeHtml(item.updatedAt ? new Intl.DateTimeFormat('ja-JP', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }).format(new Date(item.updatedAt)) : '');
                return `
                    <button class="inbox-item inbox-learning-item" data-learning-id="${escapedId}" type="button">
                        <div class="inbox-learning-badges">
                            <span class="inbox-learning-pill inbox-learning-pill-primary">${pillar}</span>
                            <span class="inbox-learning-pill inbox-learning-pill-risk">${risk}</span>
                            ${mergedLabel}
                            ${updatedAt ? `<span class="inbox-item-time">${updatedAt}</span>` : ''}
                        </div>
                        <div class="inbox-learning-title">${title}</div>
                        <div class="inbox-learning-preview">${preview || '学習候補の要約はまだありません'}</div>
                    </button>
                `;
            };

            const renderHealthAlert = (item) => {
                const escapedId = escapeHtml(item.id || '');
                const title = escapeHtml(item.title || '学習ジョブの状態に問題があります');
                const message = escapeHtml(item.message || '');
                const updatedAt = escapeHtml(item.updatedAt ? new Intl.DateTimeFormat('ja-JP', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                }).format(new Date(item.updatedAt)) : '');
                return `
                    <button class="inbox-item inbox-health-alert-item" data-health-id="${escapedId}" type="button">
                        <div class="inbox-learning-badges">
                            <span class="inbox-learning-pill inbox-health-pill">システム警告</span>
                            ${updatedAt ? `<span class="inbox-item-time">${updatedAt}</span>` : ''}
                        </div>
                        <div class="inbox-learning-title">${title}</div>
                        <div class="inbox-learning-preview">${message}</div>
                    </button>
                `;
            };

            const sections = [];
            if (healthAlertItems.length > 0) {
                sections.push(`
                    <div class="inbox-section">
                        <div class="inbox-section-title">システム警告</div>
                        ${healthAlertItems.map(renderHealthAlert).join('')}
                    </div>
                `);
            }
            if (learningItems.length > 0) {
                sections.push(`
                    <div class="inbox-section">
                        <div class="inbox-section-title">学習候補</div>
                        ${learningItems.map(renderLearning).join('')}
                    </div>
                `);
            }
            if (notificationItems.length > 0) {
                sections.push(`
                    <div class="inbox-section">
                        <div class="inbox-section-title">通知</div>
                        ${notificationItems.map(renderNotification).join('')}
                    </div>
                `);
            }

            this.inboxListEl.innerHTML = sections.join('');

            // Add event listeners to done buttons
            this.inboxListEl.querySelectorAll('.inbox-done-btn').forEach(btn => {
                btn.onclick = async (e) => {
                    e.stopPropagation();
                    await this.inboxService.markAsDone(btn.dataset.id);
                };
            });

            this.inboxListEl.querySelectorAll('[data-learning-id]').forEach((button) => {
                button.onclick = () => {
                    const item = this.inboxItems.find((candidate) => candidate.candidateId === button.dataset.learningId);
                    if (item) {
                        this.learningCandidateModal.open(item);
                    }
                };
            });

            this.inboxListEl.querySelectorAll('[data-health-id]').forEach((button) => {
                button.onclick = () => {
                    const item = this.inboxItems.find((candidate) => candidate.id === button.dataset.healthId);
                    if (item) {
                        this.healthAlertModal.open(item);
                    }
                };
            });

            // Re-init lucide icons
            refreshIcons();
        }
    }



    /**
     * クリーンアップ
     */
    unmount() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];

        if (this.inboxTriggerBtn) {
            this.inboxTriggerBtn.onclick = null;
        }
        if (this.markAllDoneBtn) {
            this.markAllDoneBtn.onclick = null;
        }
        if (this._outsideClickHandler) {
            document.removeEventListener('click', this._outsideClickHandler);
            this._outsideClickHandler = null;
        }

        this.inboxTriggerBtn = null;
        this.inboxDropdown = null;
        this.inboxListEl = null;
        this.inboxBadge = null;
        this.markAllDoneBtn = null;
        this.inboxItems = [];
        this.inboxOpen = false;
    }
}
