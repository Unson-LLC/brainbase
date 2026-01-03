import { eventBus, EVENTS } from '../../core/event-bus.js';
import { appStore } from '../../core/store.js';

/**
 * Inbox（通知）表示のUIコンポーネント
 */
export class InboxView {
    constructor({ inboxService }) {
        this.inboxService = inboxService;
        this.eventBus = eventBus;
        this.store = appStore;
        this.inboxTriggerBtn = null;
        this.inboxDropdown = null;
        this.inboxListEl = null;
        this.inboxBadge = null;
        this.markAllDoneBtn = null;
        this.inboxItems = [];
        this.inboxOpen = false;
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
        this.inboxService.loadInbox();
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
        document.addEventListener('click', (e) => {
            if (this.inboxOpen &&
                !this.inboxDropdown.contains(e.target) &&
                !this.inboxTriggerBtn.contains(e.target)) {
                this.inboxOpen = false;
                this.inboxDropdown.classList.remove('open');
            }
        });

        // Mark all done button
        if (this.markAllDoneBtn) {
            this.markAllDoneBtn.onclick = async () => {
                await this.inboxService.markAllAsDone();
            };
        }

        // EventBusリスナー
        this.eventBus.on(EVENTS.INBOX_LOADED, () => this.render());
    }

    /**
     * Store変更の購読設定
     */
    _setupStoreSubscription() {
        this.store.subscribe((change) => {
            if (change.key === 'inbox') {
                this.render();
            }
        });
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
                const message = this._escapeHtml(item.message || '');
                const slackUrl = this._escapeHtml(item.slackUrl || '');

                return `
                    <div class="inbox-item" data-id="${escapedId}">
                        <div class="inbox-item-message">${message}</div>
                        <div class="inbox-item-meta">
                            <span class="inbox-item-sender">${sender}</span>
                            <span class="inbox-item-channel">#${channel}</span>
                        </div>
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
        this.inboxTriggerBtn = null;
        this.inboxDropdown = null;
        this.inboxListEl = null;
        this.inboxBadge = null;
        this.markAllDoneBtn = null;
        this.inboxItems = [];
        this.inboxOpen = false;
    }
}
