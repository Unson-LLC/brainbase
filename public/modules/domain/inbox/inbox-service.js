import { httpClient as defaultHttpClient } from '../../core/http-client.js';
import { appStore as defaultAppStore } from '../../core/store.js';
import { eventBus as defaultEventBus, EVENTS } from '../../core/event-bus.js';

/**
 * Inboxのビジネスロジック
 * InboxViewから抽出したInbox管理機能を集約
 */
export class InboxService {
    constructor({ httpClient = defaultHttpClient, store = defaultAppStore, eventBus = defaultEventBus } = {}) {
        this.httpClient = httpClient;
        this.store = store;
        this.eventBus = eventBus;
    }

    /**
     * Inbox一覧取得
     * @returns {Promise<Array>} Inboxアイテム配列
     */
    async loadInbox() {
        const items = await this.httpClient.get('/api/inbox/pending');
        this.store.setState({ inbox: items });
        await this.eventBus.emit(EVENTS.INBOX_LOADED, { items });
        return items;
    }

    /**
     * Inboxアイテムを確認済みにする
     * @param {string} itemId - 確認済みにするアイテムのID
     * @returns {Promise<{success: boolean, itemId: string, eventResult: Object}>}
     */
    async markAsDone(itemId) {
        await this._refreshInboxAfter(() => this.httpClient.post(`/api/inbox/${itemId}/done`));
        const eventResult = await this.eventBus.emit(EVENTS.INBOX_ITEM_COMPLETED, { itemId });
        return { success: true, itemId, eventResult };
    }

    /**
     * すべてのInboxアイテムを確認済みにする
     * @returns {Promise<{success: boolean, count: number}>}
     */
    async markAllAsDone() {
        const beforeCount = this.getInboxCount();
        await this._refreshInboxAfter(() => this.httpClient.post('/api/inbox/mark-all-done'));
        return { success: true, count: beforeCount };
    }

    /**
     * 現在のInboxアイテム数を取得
     * @returns {number} Inboxアイテム数
     */
    getInboxCount() {
        const { inbox = [] } = this.store.getState();
        return inbox.length;
    }

    /**
     * ミューテーション後に最新状態とイベントを同期
     * @param {Function} mutationFn - Inbox状態を変更する非同期処理
     * @returns {Promise<Array>} リフレッシュ後のInbox配列
     */
    async _refreshInboxAfter(mutationFn) {
        await mutationFn();
        return this.loadInbox();
    }
}
