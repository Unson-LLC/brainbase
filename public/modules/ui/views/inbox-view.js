import { httpClient } from '../../core/http-client.js';

/**
 * Inbox（通知）表示のUIコンポーネント
 */
export class InboxView {
    constructor() {
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
        this.loadInbox();
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
                await this.markAllInboxDone();
            };
        }
    }

    /**
     * Inboxデータを読み込み
     */
    async loadInbox() {
        try {
            const res = await fetch(`/api/inbox/pending?t=${Date.now()}`);
            if (res.ok) {
                this.inboxItems = await res.json();
                this.render();
            } else {
                console.error("Failed to fetch inbox:", res.status);
            }
        } catch (error) {
            console.error('Failed to load inbox:', error);
            if (this.inboxListEl) {
                this.inboxListEl.innerHTML = '<div class="error">Failed to load inbox</div>';
            }
        }
    }

    /**
     * Inboxをレンダリング
     */
    render() {
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
                const sender = item.sender || '';
                const channel = item.channel || '';
                const message = item.message || '';

                return `
                    <div class="inbox-item" data-id="${item.id}">
                        <div class="inbox-item-message">${this._escapeHtml(message)}</div>
                        <div class="inbox-item-meta">
                            <span class="inbox-item-sender">${sender}</span>
                            <span class="inbox-item-channel">#${channel}</span>
                        </div>
                        <div class="inbox-item-footer">
                            ${item.slackUrl ? `<a href="${item.slackUrl}" target="_blank" class="inbox-slack-link">Slackで開く</a>` : ''}
                            <button class="inbox-done-btn" data-id="${item.id}">確認済み</button>
                        </div>
                    </div>
                `;
            }).join('');

            // Add event listeners to done buttons
            this.inboxListEl.querySelectorAll('.inbox-done-btn').forEach(btn => {
                btn.onclick = async (e) => {
                    e.stopPropagation();
                    await this.markInboxItemDone(btn.dataset.id);
                };
            });

            // Re-init lucide icons
            if (window.lucide) {
                window.lucide.createIcons();
            }
        }
    }

    /**
     * 個別アイテムを確認済みにする
     */
    async markInboxItemDone(itemId) {
        try {
            const res = await fetch(`/api/inbox/${encodeURIComponent(itemId)}/done`, {
                method: 'POST'
            });
            if (res.ok) {
                // Animate removal
                const itemEl = this.inboxListEl.querySelector(`[data-id="${itemId}"]`);
                if (itemEl) {
                    itemEl.classList.add('fade-out');
                    setTimeout(() => {
                        this.loadInbox();
                    }, 300);
                } else {
                    this.loadInbox();
                }
            } else {
                console.error('Failed to mark inbox item done');
            }
        } catch (error) {
            console.error('Failed to mark inbox item done:', error);
        }
    }

    /**
     * すべてのアイテムを確認済みにする
     */
    async markAllInboxDone() {
        try {
            const res = await fetch('/api/inbox/mark-all-done', {
                method: 'POST'
            });
            if (res.ok) {
                console.log('All inbox items marked as done');
                this.loadInbox();
            } else {
                console.error('Failed to mark all inbox done');
            }
        } catch (error) {
            console.error('Failed to mark all inbox done:', error);
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
