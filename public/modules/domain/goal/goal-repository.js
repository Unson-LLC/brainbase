/**
 * GoalSeekRepository
 *
 * Goal Seek機能のデータアクセス層。
 * APIリクエストをラップして、Service層からHTTP詳細を隠蔽。
 */

/**
 * GoalSeekRepository
 * API通信を管理するリポジトリ
 */
export class GoalSeekRepository {
    /**
     * @param {Object} options
     * @param {Object} options.httpClient - HTTPクライアント
     */
    constructor(options = {}) {
        this.httpClient = options.httpClient;
        this.basePath = '/api/goal-seek';
    }

    // ===== Goals =====

    /**
     * ゴール作成
     * @param {Object} goalData - ゴールデータ
     * @returns {Promise<Object>} 作成されたゴール
     */
    async createGoal(goalData) {
        return await this.httpClient.post(`${this.basePath}/goals`, goalData);
    }

    /**
     * ゴール取得
     * @param {string} goalId - ゴールID
     * @returns {Promise<Object>} ゴール
     */
    async getGoal(goalId) {
        return await this.httpClient.get(`${this.basePath}/goals/${goalId}`);
    }

    /**
     * ゴール更新
     * @param {string} goalId - ゴールID
     * @param {Object} updates - 更新内容
     * @returns {Promise<Object>} 更新されたゴール
     */
    async updateGoal(goalId, updates) {
        return await this.httpClient.put(`${this.basePath}/goals/${goalId}`, updates);
    }

    /**
     * ゴール削除
     * @param {string} goalId - ゴールID
     * @returns {Promise<Object>} 削除結果
     */
    async deleteGoal(goalId) {
        return await this.httpClient.delete(`${this.basePath}/goals/${goalId}`);
    }

    /**
     * セッションIDでゴール一覧を取得
     * @param {string} sessionId - セッションID
     * @returns {Promise<Array>} ゴール一覧
     */
    async getGoalsBySession(sessionId) {
        return await this.httpClient.get(`${this.basePath}/goals?sessionId=${sessionId}`);
    }

    // ===== Interventions =====

    /**
     * 介入作成
     * @param {Object} interventionData - 介入データ
     * @returns {Promise<Object>} 作成された介入
     */
    async createIntervention(interventionData) {
        return await this.httpClient.post(`${this.basePath}/interventions`, interventionData);
    }

    /**
     * 介入取得
     * @param {string} interventionId - 介入ID
     * @returns {Promise<Object>} 介入
     */
    async getIntervention(interventionId) {
        return await this.httpClient.get(`${this.basePath}/interventions/${interventionId}`);
    }

    /**
     * 介入更新
     * @param {string} interventionId - 介入ID
     * @param {Object} updates - 更新内容
     * @returns {Promise<Object>} 更新された介入
     */
    async updateIntervention(interventionId, updates) {
        return await this.httpClient.put(`${this.basePath}/interventions/${interventionId}`, updates);
    }

    /**
     * 未処理の介入一覧を取得
     * @returns {Promise<Array>} 未処理の介入一覧
     */
    async getPendingInterventions() {
        return await this.httpClient.get(`${this.basePath}/interventions?status=pending`);
    }

    // ===== Logs =====

    /**
     * ログ作成
     * @param {Object} logData - ログデータ
     * @returns {Promise<Object>} 作成されたログ
     */
    async createLog(logData) {
        return await this.httpClient.post(`${this.basePath}/logs`, logData);
    }

    /**
     * ゴールIDでログ一覧を取得
     * @param {string} goalId - ゴールID
     * @returns {Promise<Array>} ログ一覧
     */
    async getLogsByGoal(goalId) {
        return await this.httpClient.get(`${this.basePath}/logs?goalId=${goalId}`);
    }
}

// デフォルトインスタンス（httpClient注入が必要）
export const goalSeekRepository = new GoalSeekRepository();

export default GoalSeekRepository;
