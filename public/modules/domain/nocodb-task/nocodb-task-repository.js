// @ts-check
/**
 * NocoDBTaskRepository
 * NocoDB APIとの通信を抽象化
 */
export class NocoDBTaskRepository {
    constructor({ httpClient }) {
        this.http = httpClient;
    }

    hasBearerAuth() {
        return Boolean(this.http.hasBearerAuth?.());
    }

    async fetchCanonicalTasks(cursor = null) {
        const search = new URLSearchParams({ limit: '50' });
        if (cursor) search.set('cursor', cursor);
        return this.http.get(`/api/companion/tasks?${search.toString()}`);
    }

    async createCanonicalTask(payload, idempotencyKey) {
        return this.http.post('/api/companion/tasks', payload, { headers: { 'Idempotency-Key': idempotencyKey } });
    }

    async updateCanonicalTask(taskId, payload, idempotencyKey) {
        return this.http.patch(`/api/companion/tasks/${encodeURIComponent(taskId)}`, payload, { headers: { 'Idempotency-Key': idempotencyKey } });
    }

    async transitionCanonicalTask(taskId, payload, idempotencyKey) {
        return this.http.post(`/api/companion/tasks/${encodeURIComponent(taskId)}/transitions`, payload, { headers: { 'Idempotency-Key': idempotencyKey } });
    }

    async deleteCanonicalTask(taskId, expectedVersion, idempotencyKey) {
        return this.http.delete(`/api/companion/tasks/${encodeURIComponent(taskId)}`, {
            headers: { 'Idempotency-Key': idempotencyKey },
            body: JSON.stringify({ expected_version: expectedVersion })
        });
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
     * タスクを作成
     * @param {Object} payload - 作成データ
     * @returns {Promise<Object>}
     */
    async createTask(payload) {
        const response = await this.http.post('/api/nocodb/tasks', payload);
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
