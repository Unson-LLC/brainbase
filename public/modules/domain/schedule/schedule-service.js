import { httpClient } from '../../core/http-client.js';
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { sessionDataCache } from '../../core/session-data-cache.js';

const SCHEDULE_CACHE_SCOPE = 'global';

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
     * スケジュール取得
     * @returns {Promise<Object>} スケジュールデータ
     */
    async loadSchedule() {
        // キャッシュチェック
        const cached = sessionDataCache.get('schedule', SCHEDULE_CACHE_SCOPE);
        if (cached) {
            console.log('[ScheduleService] Cache hit');
            this.store.setState({ schedule: cached });
            await this.eventBus.emit(EVENTS.SCHEDULE_LOADED, cached);
            return cached;
        }

        // キャッシュミス: API呼び出し
        const startTime = performance.now();
        const schedule = await this.httpClient.get('/api/schedule/today');
        const duration = performance.now() - startTime;
        console.log(`[ScheduleService] API loaded in ${duration.toFixed(2)}ms`);

        // キャッシュに保存（TTL: 1時間）
        sessionDataCache.set('schedule', SCHEDULE_CACHE_SCOPE, schedule);

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
        const { schedule } = this.store.getState();
        return schedule?.items || [];
    }

    /**
     * Kiro形式イベント取得（ID付き）
     * @returns {Array} イベント配列
     */
    getEvents() {
        const { schedule } = this.store.getState();
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
        const date = this._getTodayDate();
        const event = await this.httpClient.post(`/api/schedule/${date}/events`, {
            ...eventData,
            source: eventData.source || 'manual'
        });
        sessionDataCache.invalidateType('schedule', SCHEDULE_CACHE_SCOPE);
        await this._refreshAndNotify();
        return event;
    }

    /**
     * イベント更新
     * @param {string} eventId
     * @param {Object} updates
     * @returns {Promise<Object>} 更新されたイベント
     */
    async updateEvent(eventId, updates) {
        const date = this._getTodayDate();
        const event = await this.httpClient.put(`/api/schedule/${date}/events/${eventId}`, updates);
        sessionDataCache.invalidateType('schedule', SCHEDULE_CACHE_SCOPE);
        await this._refreshAndNotify();
        return event;
    }

    /**
     * イベント削除
     * @param {string} eventId
     * @returns {Promise<void>}
     */
    async deleteEvent(eventId) {
        const date = this._getTodayDate();
        await this.httpClient.delete(`/api/schedule/${date}/events/${eventId}`);
        sessionDataCache.invalidateType('schedule', SCHEDULE_CACHE_SCOPE);
        await this._refreshAndNotify();
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
