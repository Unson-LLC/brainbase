// @ts-check
import { httpClient } from '../../core/http-client.js';
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * manaチャットサービス
 * 課題キャプチャ + manaチャットのAPIクライアント
 */
export class ManaChatService {
    constructor() {
        this.httpClient = httpClient;
        this.store = appStore;
        this.eventBus = eventBus;
    }

    /**
     * 課題/タスクを即キャプチャ
     * @param {string} content - キャプチャ内容
     * @param {'task'|'issue'|'memo'|'idea'} [type] - 種別
     * @returns {Promise<Object>} キャプチャ結果
     */
    async capture(content, type) {
        const response = await this.httpClient.post('/api/brainbase/mana/capture', {
            content,
            type: type || 'issue'
        });

        // Store更新
        const { mana } = this.store.getState();
        const captures = [...(mana?.captures || []), response];
        this.store.setState({ mana: { ...mana, captures } });

        // Event発火
        await this.eventBus.emit(EVENTS.MANA_CAPTURED, response);

        return response;
    }

    /**
     * manaにチャットメッセージ送信
     * @param {string} message - ユーザーメッセージ
     * @param {Array} [history] - 会話履歴
     * @returns {Promise<Object>} レスポンス
     */
    async chat(message, history) {
        const response = await this.httpClient.post('/api/brainbase/mana/chat', {
            message,
            history
        });

        // Event発火
        await this.eventBus.emit(EVENTS.MANA_CHAT_RESPONSE, response);

        return response;
    }

    /**
     * キャプチャ済みタスク一覧取得
     * @returns {Promise<Array>} キャプチャ一覧
     */
    async getCaptures() {
        const response = await this.httpClient.get('/api/brainbase/mana/captures');

        const items = response.items || [];

        // Store更新
        const { mana } = this.store.getState();
        this.store.setState({ mana: { ...mana, captures: items } });

        // Event発火
        await this.eventBus.emit(EVENTS.MANA_CAPTURES_LOADED, { items });

        return items;
    }
}
