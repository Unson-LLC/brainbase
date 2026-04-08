// @ts-check
import { logger } from '../utils/logger.js';

/**
 * Honcho Memory Service
 *
 * Honcho APIとの通信を管理するサービス。
 * 会話履歴の永続化、セマンティック検索、ユーザーメモリを提供。
 *
 * @see https://github.com/plastic-labs/honcho
 */
export class HonchoService {
    /**
     * @param {Object} options
     * @param {string} options.apiUrl - Honcho API URL (e.g., http://127.0.0.1:8000)
     * @param {string} [options.appName='brainbase'] - アプリケーション名
     */
    constructor({ apiUrl, appName = 'brainbase' }) {
        this.apiUrl = apiUrl.replace(/\/$/, '');
        this.appName = appName;
        this.appId = null;
        this._initialized = false;
    }

    /**
     * 初期化: アプリケーションを取得または作成
     */
    async init() {
        if (this._initialized) return;

        try {
            // 既存アプリを検索
            const apps = await this._request('GET', '/v1/apps', { name: this.appName });
            if (apps.items?.length > 0) {
                this.appId = apps.items[0].id;
            } else {
                // 新規作成
                const app = await this._request('POST', '/v1/apps', null, { name: this.appName });
                this.appId = app.id;
            }

            this._initialized = true;
            logger.info('HonchoService initialized', { appId: this.appId, apiUrl: this.apiUrl });
        } catch (error) {
            logger.error('HonchoService init failed', { error: error.message });
            throw error;
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // User（ユーザー）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * ユーザーを取得または作成
     * @param {string} userId - ユーザー識別子（Slack ID等）
     * @returns {Promise<Object>} Honcho User object
     */
    async getOrCreateUser(userId) {
        await this._ensureInit();

        try {
            return await this._request('GET', `/v1/apps/${this.appId}/users/${userId}`);
        } catch (error) {
            if (error.status === 404) {
                return await this._request('POST', `/v1/apps/${this.appId}/users`, null, {
                    name: userId
                });
            }
            throw error;
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Session（会話セッション）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * セッション作成
     * @param {string} userId
     * @param {Object} [metadata={}]
     * @returns {Promise<Object>} Honcho Session object
     */
    async createSession(userId, metadata = {}) {
        await this._ensureInit();
        const user = await this.getOrCreateUser(userId);
        return await this._request('POST', `/v1/apps/${this.appId}/users/${user.id}/sessions`, null, {
            metadata
        });
    }

    /**
     * アクティブなセッション一覧を取得
     * @param {string} userId
     * @returns {Promise<Object[]>}
     */
    async getSessions(userId) {
        await this._ensureInit();
        const user = await this.getOrCreateUser(userId);
        const result = await this._request('GET', `/v1/apps/${this.appId}/users/${user.id}/sessions`);
        return result.items || [];
    }

    /**
     * 最新のアクティブセッションを取得（なければ作成）
     * @param {string} userId
     * @param {Object} [metadata={}]
     * @returns {Promise<Object>}
     */
    async getOrCreateSession(userId, metadata = {}) {
        const sessions = await this.getSessions(userId);
        const active = sessions.find(s => !s.is_active === false);
        if (active) return active;
        return await this.createSession(userId, metadata);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Message（メッセージ）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * メッセージを保存
     * @param {string} userId
     * @param {string} sessionId
     * @param {boolean} isUser - true=ユーザー, false=AI
     * @param {string} content
     * @returns {Promise<Object>}
     */
    async saveMessage(userId, sessionId, isUser, content) {
        await this._ensureInit();
        const user = await this.getOrCreateUser(userId);
        return await this._request(
            'POST',
            `/v1/apps/${this.appId}/users/${user.id}/sessions/${sessionId}/messages`,
            null,
            { is_user: isUser, content }
        );
    }

    /**
     * セッションのメッセージ履歴を取得
     * @param {string} userId
     * @param {string} sessionId
     * @param {number} [limit=50]
     * @returns {Promise<Object[]>}
     */
    async getMessages(userId, sessionId, limit = 50) {
        await this._ensureInit();
        const user = await this.getOrCreateUser(userId);
        const result = await this._request(
            'GET',
            `/v1/apps/${this.appId}/users/${user.id}/sessions/${sessionId}/messages`,
            { size: limit }
        );
        return result.items || [];
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Metamessage（メタメッセージ / 要約・推論結果）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * メタメッセージを作成（要約、推論結果等）
     * @param {string} userId
     * @param {string} sessionId
     * @param {string} messageId - 関連するメッセージID
     * @param {string} metamessageType - タイプ（例: 'summary', 'derived'）
     * @param {string} content
     * @returns {Promise<Object>}
     */
    async createMetamessage(userId, sessionId, messageId, metamessageType, content) {
        await this._ensureInit();
        const user = await this.getOrCreateUser(userId);
        return await this._request(
            'POST',
            `/v1/apps/${this.appId}/users/${user.id}/sessions/${sessionId}/metamessages`,
            null,
            { message_id: messageId, metamessage_type: metamessageType, content }
        );
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ヘルスチェック
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * Honcho APIの接続確認
     * @returns {Promise<boolean>}
     */
    async healthCheck() {
        try {
            const response = await fetch(`${this.apiUrl}/docs`);
            return response.ok;
        } catch {
            return false;
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Internal
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async _ensureInit() {
        if (!this._initialized) await this.init();
    }

    /**
     * @param {string} method
     * @param {string} path
     * @param {Object|null} [params=null] - Query parameters
     * @param {Object|null} [body=null] - Request body
     * @returns {Promise<Object>}
     */
    async _request(method, path, params = null, body = null) {
        let url = `${this.apiUrl}${path}`;

        if (params) {
            const searchParams = new URLSearchParams();
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined && value !== null) {
                    searchParams.set(key, String(value));
                }
            }
            const qs = searchParams.toString();
            if (qs) url += `?${qs}`;
        }

        const options = {
            method,
            headers: { 'Content-Type': 'application/json' }
        };

        if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);

        if (!response.ok) {
            const error = new Error(`Honcho API error: ${response.status} ${response.statusText}`);
            error.status = response.status;
            try {
                error.body = await response.text();
            } catch { /* ignore */ }
            throw error;
        }

        return await response.json();
    }
}

/**
 * HonchoServiceのシングルトンインスタンスを作成
 * @returns {HonchoService|null}
 */
export function createHonchoService() {
    const apiUrl = process.env.HONCHO_API_URL;
    if (!apiUrl) {
        logger.info('HonchoService disabled: HONCHO_API_URL not set');
        return null;
    }

    return new HonchoService({
        apiUrl,
        appName: process.env.HONCHO_APP_NAME || 'brainbase'
    });
}
