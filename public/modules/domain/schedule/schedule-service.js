import { httpClient } from '../../core/http-client.js';
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * スケジュールのビジネスロジック
 */
export class ScheduleService {
    constructor() {
        this.httpClient = httpClient;
        this.store = appStore;
        this.eventBus = eventBus;
    }

    /**
     * 今日の日付を YYYY-MM-DD 形式で取得
     * @returns {string}
     */
    _getTodayDate() {
        return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    }

    /**
     * 今日の日付でイベントAPIエンドポイントを生成
     * @param {string} [eventId]
     * @returns {string}
     */
    _getTodayEventsEndpoint(eventId) {
        const basePath = `/api/schedule/${this._getTodayDate()}/events`;
        return eventId ? `${basePath}/${eventId}` : basePath;
    }

    /**
     * スケジュール状態を取得
     * @returns {Object|null}
     */
    _getScheduleState() {
        const { schedule } = this.store.getState();
        return schedule || null;
    }

    /**
     * イベントの変更系リクエスト共通処理
     * @param {Function} requestExecutor
     * @returns {Promise<*>}
     */
    async _mutateTodayEvent(requestExecutor) {
        const result = await requestExecutor();
        await this._refreshAndNotify();
        return result;
    }

    /**
     * スケジュール取得
     * @returns {Promise<Object>} スケジュールデータ
     */
    async loadSchedule() {
        const schedule = await this.httpClient.get('/api/schedule/today');
        this.store.setState({ schedule });
        await this.eventBus.emit(EVENTS.SCHEDULE_LOADED, schedule);
        return schedule;
    }

    /**
     * スケジュールを再読み込みして通知
     */
    async _refreshAndNotify() {
        await this.loadSchedule();
        await this.eventBus.emit(EVENTS.SCHEDULE_UPDATED, this.getTimeline());
    }

    /**
     * タイムライン用イベント取得
     * @returns {Array} イベント配列
     */
    getTimeline() {
        const schedule = this._getScheduleState();
        return schedule?.items || [];
    }

    /**
     * Kiro形式イベント取得（ID付き）
     * @returns {Array} イベント配列
     */
    getEvents() {
        const schedule = this._getScheduleState();
        return schedule?.events || [];
    }

    /**
     * IDでイベントを検索
     * @param {string} eventId
     * @returns {Object|undefined}
     */
    findEventById(eventId) {
        return this.getEvents().find(e => e.id === eventId);
    }

    /**
     * イベント追加
     * @param {Object} eventData - { start, end, title }
     * @returns {Promise<Object>} 作成されたイベント
     */
    async addEvent(eventData) {
        const payload = {
            ...eventData,
            source: eventData.source || 'manual'
        };
        return this._mutateTodayEvent(() =>
            this.httpClient.post(this._getTodayEventsEndpoint(), payload)
        );
    }

    /**
     * イベント更新
     * @param {string} eventId
     * @param {Object} updates
     * @returns {Promise<Object>} 更新されたイベント
     */
    async updateEvent(eventId, updates) {
        return this._mutateTodayEvent(() =>
            this.httpClient.put(this._getTodayEventsEndpoint(eventId), updates)
        );
    }

    /**
     * イベント削除
     * @param {string} eventId
     * @returns {Promise<void>}
     */
    async deleteEvent(eventId) {
        await this._mutateTodayEvent(() =>
            this.httpClient.delete(this._getTodayEventsEndpoint(eventId))
        );
    }

    /**
     * イベント完了/未完了トグル
     * @param {string} eventId
     * @returns {Promise<Object>} 更新されたイベント
     */
    async toggleEventComplete(eventId) {
        const event = this.findEventById(eventId);
        if (!event) {
            throw new Error('Event not found');
        }
        return this.updateEvent(eventId, { completed: !event.completed });
    }
}
