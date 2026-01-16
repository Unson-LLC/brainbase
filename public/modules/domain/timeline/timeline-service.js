import { EVENTS } from '../../core/event-bus.js';
import { TimelineItem, generateTimelineId } from './timeline-item.js';

/**
 * TimelineService
 * タイムラインのビジネスロジック
 */
export class TimelineService {
    constructor({ repository, store, eventBus }) {
        this.repository = repository;
        this.store = store;
        this.eventBus = eventBus;
        this._unsubscribers = [];
    }

    /**
     * 今日のタイムラインを取得
     * @returns {Promise<Object>}
     */
    async loadTimeline() {
        const data = await this.repository.fetchToday();
        this._updateStore(data);
        await this.eventBus.emit(EVENTS.TIMELINE_LOADED, data);
        return data;
    }

    /**
     * 指定日のタイムラインを取得
     * @param {string} date - YYYY-MM-DD 形式
     * @returns {Promise<Object>}
     */
    async loadTimelineByDate(date) {
        const data = await this.repository.fetchByDate(date);
        this._updateStore(data);
        await this.eventBus.emit(EVENTS.TIMELINE_LOADED, data);
        return data;
    }

    /**
     * ストアからタイムライン項目を取得（フィルタ適用）
     * @returns {Array}
     */
    getTimelineItems() {
        const { timeline } = this.store.getState();
        const items = timeline?.items || [];
        const filters = timeline?.filters || {};

        let filtered = items;

        // タイプでフィルタ
        if (filters.type) {
            filtered = filtered.filter(item => item.type === filters.type);
        }

        // タイトル検索
        if (filters.search) {
            const search = filters.search.toLowerCase();
            filtered = filtered.filter(item =>
                item.title?.toLowerCase().includes(search)
            );
        }

        return filtered;
    }

    /**
     * タイムライン項目を作成
     * @param {Object} itemData - 項目データ
     * @returns {Promise<{success: boolean, item?: Object, error?: string}>}
     */
    async createItem(itemData) {
        // IDとタイムスタンプを生成
        const now = new Date().toISOString();
        const item = new TimelineItem({
            id: generateTimelineId(),
            timestamp: now,
            createdAt: now,
            updatedAt: now,
            ...itemData
        });

        const result = await this.repository.createItem(item.toJSON());

        if (result.success) {
            // ストアに追加
            const { timeline } = this.store.getState();
            const items = [...(timeline?.items || []), result.item];
            this.store.setState({
                timeline: { ...timeline, items }
            });
            await this.eventBus.emit(EVENTS.TIMELINE_ITEM_CREATED, { item: result.item });
        }

        return result;
    }

    /**
     * タイムライン項目を更新
     * @param {string} id - 項目ID
     * @param {Object} updates - 更新内容
     * @returns {Promise<{success: boolean, item?: Object, error?: string}>}
     */
    async updateItem(id, updates) {
        const result = await this.repository.updateItem(id, updates);

        if (result.success) {
            // ストアを更新
            const { timeline } = this.store.getState();
            const items = (timeline?.items || []).map(item =>
                item.id === id ? { ...item, ...result.item } : item
            );
            this.store.setState({
                timeline: { ...timeline, items }
            });
            await this.eventBus.emit(EVENTS.TIMELINE_ITEM_UPDATED, { item: result.item });
        }

        return result;
    }

    /**
     * タイムライン項目を削除
     * @param {string} id - 項目ID
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async deleteItem(id) {
        const result = await this.repository.deleteItem(id);

        if (result.success) {
            // ストアから削除
            const { timeline } = this.store.getState();
            const items = (timeline?.items || []).filter(item => item.id !== id);
            this.store.setState({
                timeline: { ...timeline, items }
            });
            await this.eventBus.emit(EVENTS.TIMELINE_ITEM_DELETED, { id });
        }

        return result;
    }

    /**
     * フィルタを設定
     * @param {Object} filters - フィルタ設定
     */
    async setFilter(filters) {
        const { timeline } = this.store.getState();
        this.store.setState({
            timeline: {
                ...timeline,
                filters: { ...timeline.filters, ...filters }
            }
        });
        await this.eventBus.emit(EVENTS.TIMELINE_FILTER_CHANGED, { filters });
    }

    /**
     * ストアを更新（内部メソッド）
     * @param {Object} data - タイムラインデータ
     * @private
     */
    _updateStore(data) {
        const { timeline } = this.store.getState();
        this.store.setState({
            timeline: {
                ...timeline,
                items: data.items || [],
                date: data.date
            }
        });
    }

    /**
     * 自動記録を開始
     * SESSION_CREATED, TASK_COMPLETED などのイベントをリッスンして自動的に項目を作成
     */
    startAutoRecording() {
        // SESSION_CREATED イベント
        const unsub1 = this.eventBus.onAsync(EVENTS.SESSION_CREATED, async (event) => {
            const { sessionId, name } = event.detail;
            await this._createAutoItem({
                type: 'session',
                title: `Session started: ${name || sessionId}`,
                sessionId,
                metadata: { source: 'auto' }
            });
        });
        this._unsubscribers.push(unsub1);

        // SESSION_PAUSED イベント
        const unsub2 = this.eventBus.onAsync(EVENTS.SESSION_PAUSED, async (event) => {
            const { sessionId } = event.detail;
            await this._createAutoItem({
                type: 'session',
                title: `Session paused: ${sessionId}`,
                sessionId,
                metadata: { source: 'auto' }
            });
        });
        this._unsubscribers.push(unsub2);

        // SESSION_ARCHIVED イベント
        const unsub3 = this.eventBus.onAsync(EVENTS.SESSION_ARCHIVED, async (event) => {
            const { sessionId } = event.detail;
            await this._createAutoItem({
                type: 'session',
                title: `Session archived: ${sessionId}`,
                sessionId,
                metadata: { source: 'auto' }
            });
        });
        this._unsubscribers.push(unsub3);

        // TASK_COMPLETED イベント
        const unsub4 = this.eventBus.onAsync(EVENTS.TASK_COMPLETED, async (event) => {
            const { taskId, title } = event.detail;
            await this._createAutoItem({
                type: 'task',
                title: `Task completed: ${title || taskId}`,
                linkedTaskId: taskId,
                metadata: { source: 'auto' }
            });
        });
        this._unsubscribers.push(unsub4);
    }

    /**
     * 自動記録を停止
     */
    stopAutoRecording() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
    }

    /**
     * 自動記録用の項目作成（内部メソッド）
     * @param {Object} itemData - 項目データ
     * @private
     */
    async _createAutoItem(itemData) {
        try {
            await this.createItem(itemData);
        } catch (error) {
            console.error('Failed to create auto timeline item:', error);
        }
    }

    /**
     * タイムライン項目をタスクにリンク
     * @param {string} timelineItemId - タイムライン項目ID
     * @param {string} taskId - タスクID
     * @returns {Promise<{success: boolean, item?: Object, error?: string}>}
     */
    async linkToTask(timelineItemId, taskId) {
        const result = await this.updateItem(timelineItemId, { linkedTaskId: taskId });

        if (result.success) {
            await this.eventBus.emit(EVENTS.TIMELINE_TASK_LINKED, {
                timelineItemId,
                taskId,
                item: result.item
            });
        }

        return result;
    }

    /**
     * タイムライン項目のタスクリンクを解除
     * @param {string} timelineItemId - タイムライン項目ID
     * @returns {Promise<{success: boolean, item?: Object, error?: string}>}
     */
    async unlinkFromTask(timelineItemId) {
        const result = await this.updateItem(timelineItemId, { linkedTaskId: null });

        if (result.success) {
            await this.eventBus.emit(EVENTS.TIMELINE_TASK_UNLINKED, {
                timelineItemId,
                item: result.item
            });
        }

        return result;
    }
}
