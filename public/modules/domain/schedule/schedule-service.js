// @ts-check
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
        this.googleCalendarAuthStatus = null;
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

    async getGoogleCalendarAuthStatus({ force = false } = {}) {
        if (this.googleCalendarAuthStatus && !force) {
            return this.googleCalendarAuthStatus;
        }
        this.googleCalendarAuthStatus = await this.httpClient.get('/api/schedule/google/auth-status');
        return this.googleCalendarAuthStatus;
    }
}
