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
            this._updateTimelineItems(items => [...items, result.item]);
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
            this._updateTimelineItems(items =>
                items.map(item => (item.id === id ? { ...item, ...result.item } : item))
            );
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
            this._updateTimelineItems(items => items.filter(item => item.id !== id));
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
     * タイムライン項目配列を更新（内部メソッド）
     * @param {Function} updater - items配列を受け取り新配列を返す関数
     * @private
     */
    _updateTimelineItems(updater) {
        const { timeline } = this.store.getState();
        const currentItems = timeline?.items || [];
        const items = updater(currentItems);
        this.store.setState({
            timeline: { ...timeline, items }
        });
    }

    /**
     * 自動記録を開始
     * SESSION_CREATED, TASK_COMPLETED などのイベントをリッスンして自動的に項目を作成
     */
    startAutoRecording() {
        this._registerAutoEvent(EVENTS.SESSION_CREATED, ({ sessionId, name }) => ({
            type: 'session',
            title: `Session started: ${name || sessionId}`,
            sessionId,
            metadata: { source: 'auto' }
        }));

        this._registerAutoEvent(EVENTS.SESSION_PAUSED, ({ sessionId }) => ({
            type: 'session',
            title: `Session paused: ${sessionId}`,
            sessionId,
            metadata: { source: 'auto' }
        }));

        this._registerAutoEvent(EVENTS.SESSION_ARCHIVED, ({ sessionId }) => ({
            type: 'session',
            title: `Session archived: ${sessionId}`,
            sessionId,
            metadata: { source: 'auto' }
        }));

        this._registerAutoEvent(EVENTS.TASK_COMPLETED, ({ taskId, title }) => ({
            type: 'task',
            title: `Task completed: ${title || taskId}`,
            linkedTaskId: taskId,
            metadata: { source: 'auto' }
        }));
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
     * 自動記録用イベントを登録
     * @param {string} eventName
     * @param {Function} buildItemData - detailを受けて項目データを返却
     * @private
     */
    _registerAutoEvent(eventName, buildItemData) {
        const unsub = this.eventBus.onAsync(eventName, async (event) => {
            const itemData = buildItemData(event.detail || {});
            if (!itemData) {
                return;
            }
            await this._createAutoItem(itemData);
        });
        this._unsubscribers.push(unsub);
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
