/**
 * NocoDBTaskRepository
 * NocoDB APIとの通信を抽象化
 */
export class NocoDBTaskRepository {
    constructor({ httpClient }) {
        this.http = httpClient;
    }

    /**
     * 全プロジェクトからタスクを取得
     * @returns {Promise<{records: Array, projects: Array}>}
     */
    async fetchAllTasks() {
        const response = await this.http.get('/api/nocodb/tasks');
        return response;
    }

    /**
     * タスクを更新
     * @param {string} recordId - NocoDBレコードID
     * @param {string} baseId - NocoDBベースID
     * @param {Object} fields - 更新フィールド
     * @returns {Promise<Object>}
     */
    async updateTask(recordId, baseId, fields) {
        const response = await this.http.put(`/api/nocodb/tasks/${recordId}`, {
            baseId,
            fields
        });
        return response;
    }

    /**
     * タスクを削除
     * @param {string} recordId - NocoDBレコードID
     * @param {string} baseId - NocoDBベースID
     * @returns {Promise<Object>}
     */
    async deleteTask(recordId, baseId) {
        const response = await this.http.delete(`/api/nocodb/tasks/${recordId}`, {
            body: JSON.stringify({ baseId })
        });
        return response;
    }
}
