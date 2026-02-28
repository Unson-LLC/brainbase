/**
 * TimelineRepository
 * Timeline APIとの通信を抽象化
 */
export class TimelineRepository {
    constructor({ httpClient }) {
        this.http = httpClient;
    }

    /**
     * 今日のタイムラインを取得
     * @returns {Promise<Object>} { date, items, version }
     */
    async fetchToday() {
        const response = await this.http.get('/api/timeline/today');
        return response;
    }

    /**
     * 指定日のタイムラインを取得
     * @param {string} date - YYYY-MM-DD 形式
     * @returns {Promise<Object>} { date, items, version }
     */
    async fetchByDate(date) {
        const response = await this.http.get(`/api/timeline?date=${date}`);
        return response;
    }

    /**
     * 指定IDの項目を取得
     * @param {string} id - 項目ID
     * @returns {Promise<Object|null>}
     */
    async fetchItem(id) {
        try {
            const response = await this.http.get(`/api/timeline/${id}`);
            return response;
        } catch (error) {
            if (error.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * タイムライン項目を作成
     * @param {Object} item - 項目データ
     * @returns {Promise<{success: boolean, item?: Object, error?: string}>}
     */
    async createItem(item) {
        try {
            const response = await this.http.post('/api/timeline', item);
            return { success: true, item: response };
        } catch (error) {
            if (error.status === 409) {
                return { success: false, error: 'duplicate' };
            }
            throw error;
        }
    }

    /**
     * タイムライン項目を更新
     * @param {string} id - 項目ID
     * @param {Object} updates - 更新内容
     * @returns {Promise<{success: boolean, item?: Object, error?: string}>}
     */
    async updateItem(id, updates) {
        try {
            const response = await this.http.put(`/api/timeline/${id}`, updates);
            return { success: true, item: response };
        } catch (error) {
            if (error.status === 404) {
                return { success: false, error: 'not_found' };
            }
            throw error;
        }
    }

    /**
     * タイムライン項目を削除
     * @param {string} id - 項目ID
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async deleteItem(id) {
        try {
            await this.http.delete(`/api/timeline/${id}`);
            return { success: true };
        } catch (error) {
            if (error.status === 404) {
                return { success: false, error: 'not_found' };
            }
            throw error;
        }
    }
}
