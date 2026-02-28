import fs from 'fs/promises';
import path from 'path';

/**
 * タイムラインのファイルストレージ
 * _timeline/YYYY-MM-DD.json 形式で保存
 */
export class TimelineStorage {
    constructor(timelineDir) {
        this.timelineDir = timelineDir;
    }

    /**
     * 日付を YYYY-MM-DD 形式に変換（JST）
     * @param {Date|string} [date] - 日付（省略時は今日）
     * @returns {string}
     */
    _formatDate(date) {
        const d = date ? new Date(date) : new Date();
        return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    }

    /**
     * 日付からファイルパスを取得
     * @param {string} dateStr - YYYY-MM-DD 形式
     * @returns {string}
     */
    _getFilePath(dateStr) {
        return path.join(this.timelineDir, `${dateStr}.json`);
    }

    /**
     * ディレクトリが存在しない場合は作成
     */
    async _ensureDir() {
        try {
            await fs.mkdir(this.timelineDir, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    }

    /**
     * 指定日のタイムラインを読み込み
     * @param {string} [dateStr] - YYYY-MM-DD 形式（省略時は今日）
     * @returns {Promise<Object>}
     */
    async loadTimeline(dateStr) {
        const date = dateStr || this._formatDate();
        const filePath = this._getFilePath(date);

        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);
            return {
                date,
                items: data.items || [],
                version: data.version || '1.0.0'
            };
        } catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    date,
                    items: [],
                    version: '1.0.0'
                };
            }
            console.error('Error reading timeline file:', error);
            throw error;
        }
    }

    /**
     * 今日のタイムラインを取得
     * @returns {Promise<Object>}
     */
    async getTodayTimeline() {
        return this.loadTimeline(this._formatDate());
    }

    /**
     * タイムラインを保存
     * @param {string} dateStr - YYYY-MM-DD 形式
     * @param {Array} items - タイムライン項目配列
     * @returns {Promise<void>}
     */
    async saveTimeline(dateStr, items) {
        await this._ensureDir();
        const filePath = this._getFilePath(dateStr);
        const data = {
            date: dateStr,
            items,
            version: '1.0.0',
            updatedAt: new Date().toISOString()
        };
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    }

    /**
     * 項目を追加（重複チェック付き）
     * @param {Object} item - タイムライン項目
     * @param {number} [dedupeWindowMs=5000] - 重複判定の時間窓（ミリ秒）
     * @returns {Promise<{success: boolean, item?: Object, reason?: string}>}
     */
    async addItem(item, dedupeWindowMs = 5000) {
        const dateStr = this._formatDate(item.timestamp);
        const timeline = await this.loadTimeline(dateStr);

        // 重複チェック: 同じtype + timestamp（dedupeWindowMs以内）
        const isDuplicate = timeline.items.some(existing => {
            if (existing.type !== item.type) return false;
            const existingTime = new Date(existing.timestamp).getTime();
            const newTime = new Date(item.timestamp).getTime();
            return Math.abs(existingTime - newTime) < dedupeWindowMs;
        });

        if (isDuplicate) {
            return { success: false, reason: 'duplicate' };
        }

        timeline.items.push(item);
        await this.saveTimeline(dateStr, timeline.items);
        return { success: true, item };
    }

    /**
     * 項目を更新
     * @param {string} id - 項目ID
     * @param {Object} updates - 更新内容
     * @returns {Promise<{success: boolean, item?: Object, reason?: string}>}
     */
    async updateItem(id, updates) {
        // IDからタイムスタンプを抽出して日付を特定
        const timestampMatch = id.match(/^tl_(\d+)_/);
        if (!timestampMatch) {
            return { success: false, reason: 'invalid_id' };
        }

        const timestamp = parseInt(timestampMatch[1], 10);
        const dateStr = this._formatDate(new Date(timestamp));
        const timeline = await this.loadTimeline(dateStr);

        const index = timeline.items.findIndex(item => item.id === id);
        if (index === -1) {
            return { success: false, reason: 'not_found' };
        }

        const updatedItem = {
            ...timeline.items[index],
            ...updates,
            updatedAt: new Date().toISOString()
        };
        timeline.items[index] = updatedItem;

        await this.saveTimeline(dateStr, timeline.items);
        return { success: true, item: updatedItem };
    }

    /**
     * 項目を削除
     * @param {string} id - 項目ID
     * @returns {Promise<{success: boolean, reason?: string}>}
     */
    async deleteItem(id) {
        // IDからタイムスタンプを抽出して日付を特定
        const timestampMatch = id.match(/^tl_(\d+)_/);
        if (!timestampMatch) {
            return { success: false, reason: 'invalid_id' };
        }

        const timestamp = parseInt(timestampMatch[1], 10);
        const dateStr = this._formatDate(new Date(timestamp));
        const timeline = await this.loadTimeline(dateStr);

        const index = timeline.items.findIndex(item => item.id === id);
        if (index === -1) {
            return { success: false, reason: 'not_found' };
        }

        timeline.items.splice(index, 1);
        await this.saveTimeline(dateStr, timeline.items);
        return { success: true };
    }

    /**
     * 項目をID指定で取得
     * @param {string} id - 項目ID
     * @returns {Promise<Object|null>}
     */
    async getItem(id) {
        const timestampMatch = id.match(/^tl_(\d+)_/);
        if (!timestampMatch) {
            return null;
        }

        const timestamp = parseInt(timestampMatch[1], 10);
        const dateStr = this._formatDate(new Date(timestamp));
        const timeline = await this.loadTimeline(dateStr);

        return timeline.items.find(item => item.id === id) || null;
    }
}
