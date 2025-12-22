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
     * スケジュール取得
     * @returns {Promise<Object>} スケジュールデータ
     */
    async loadSchedule() {
        const schedule = await this.httpClient.get('/api/schedule/today');
        this.store.setState({ schedule });
        this.eventBus.emit(EVENTS.SCHEDULE_LOADED, schedule);
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
}
