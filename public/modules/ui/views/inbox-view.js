import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';

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
            const members = await this.httpClient.get('/api/config/slack/members');
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
            if (this.inboxDropdown) {
                this.inboxDropdown.classList.remove('open');
            }
            this.inboxOpen = false;
            return;
        }

        if (this.inboxListEl) {
            this.inboxListEl.innerHTML = this.inboxItems.map(item => {
                const escapedId = this._escapeHtml(item.id || '');
                const sender = this._escapeHtml(item.sender || '');
                const channel = this._escapeHtml(item.channel || '');
                // Slack ID（<@U07B19N048G>）を人名に変換してからエスケープ
                const convertedMessage = this._convertSlackMentions(item.message || '');
                const message = this._escapeHtml(convertedMessage);
                const slackUrl = this._escapeHtml(item.slackUrl || '');
                // 日付と時刻（APIから取得、なければタイトルから抽出）
                const date = this._escapeHtml(item.date || '');
                const time = this._escapeHtml(item.time || '');
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
            }).join('');

            // Add event listeners to done buttons
            this.inboxListEl.querySelectorAll('.inbox-done-btn').forEach(btn => {
                btn.onclick = async (e) => {
                    e.stopPropagation();
                    await this.inboxService.markAsDone(btn.dataset.id);
                };
            });

            // Re-init lucide icons
            if (window.lucide) {
                window.lucide.createIcons();
            }
        }
    }


    /**
     * HTMLエスケープ
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
