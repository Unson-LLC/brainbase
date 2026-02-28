import { httpClient } from '../../core/http-client.js';
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * Inboxのビジネスロジック
 * InboxViewから抽出したInbox管理機能を集約
 */
export class InboxService {
    constructor() {
        this.httpClient = httpClient;
        this.store = appStore;
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
        await this.httpClient.post(`/api/inbox/${itemId}/done`);
        await this.loadInbox(); // リロード
        const eventResult = await this.eventBus.emit(EVENTS.INBOX_ITEM_COMPLETED, { itemId });
        return { success: true, itemId, eventResult };
    }

    /**
     * すべてのInboxアイテムを確認済みにする
     * @returns {Promise<{success: boolean, count: number}>}
     */
    async markAllAsDone() {
        const beforeCount = this.getInboxCount();
        await this.httpClient.post('/api/inbox/mark-all-done');
        await this.loadInbox(); // リロード
        return { success: true, count: beforeCount };
    }

    /**
     * 現在のInboxアイテム数を取得
     * @returns {number} Inboxアイテム数
     */
    getInboxCount() {
        const { inbox } = this.store.getState();
        return inbox ? inbox.length : 0;
    }
}
