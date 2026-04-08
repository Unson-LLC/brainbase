// @ts-check
import { logger } from '../utils/logger.js';

/**
 * Honcho Memory Service (v3 API)
 *
 * Honcho v3 APIとの通信を管理するサービス。
 * 会話履歴の永続化、セマンティック検索、メモリ統合を提供。
 *
 * 概念モデル: Workspace → Peer → Session → Message
 * 全エンティティは get-or-create セマンティクス（冪等POST）。
 *
 * @see https://github.com/plastic-labs/honcho
 */
export class HonchoService {
    /**
     * @param {Object} options
     * @param {string} options.apiUrl - Honcho API URL (e.g., http://127.0.0.1:8000)
     * @param {string} [options.workspaceId='brainbase'] - Workspace識別子
     */
    constructor({ apiUrl, workspaceId = 'brainbase' }) {
        this.apiUrl = apiUrl.replace(/\/$/, '');
        this.workspaceId = workspaceId;
        this._workspace = null;
        this._peerCache = new Map();
        this._initialized = false;
    }

    /**
     * 初期化: Workspaceを取得または作成
     */
    async init() {
        if (this._initialized) return;

        try {
            this._workspace = await this._request('POST', '/v3/workspaces', null, {
                id: this.workspaceId
            });
            this._initialized = true;
            logger.info('HonchoService initialized', {
                workspaceId: this._workspace.id,
                apiUrl: this.apiUrl
            });
        } catch (error) {
            logger.error('HonchoService init failed', { error: error.message });
            throw error;
        }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Peer（ユーザー/エージェント）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * Peerを取得または作成（冪等）
     * @param {string} name - Peer名（Slack ID等）
     * @returns {Promise<Object>} Honcho Peer object
     */
    async getOrCreatePeer(name) {
        await this._ensureInit();

        if (this._peerCache.has(name)) {
            return this._peerCache.get(name);
        }

        const peer = await this._request(
            'POST',
            `/v3/workspaces/${this._workspace.id}/peers`,
            null,
            { name }
        );
        this._peerCache.set(name, peer);
        return peer;
    }

    /**
     * Peer一覧を取得
     * @returns {Promise<Object[]>}
     */
    async listPeers() {
        await this._ensureInit();
        const result = await this._request(
            'POST',
            `/v3/workspaces/${this._workspace.id}/peers/list`
        );
        return result.items || [];
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Session（会話セッション）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * セッションを取得または作成（冪等）
     * @param {string} sessionName - セッション識別子
     * @param {Object} [metadata={}]
     * @returns {Promise<Object>} Honcho Session object
     */
    async getOrCreateSession(sessionName, metadata = {}) {
        await this._ensureInit();
        return await this._request(
            'POST',
            `/v3/workspaces/${this._workspace.id}/sessions`,
            null,
            { id: sessionName, metadata }
        );
    }

    /**
     * セッション一覧を取得
     * @returns {Promise<Object[]>}
     */
    async listSessions() {
        await this._ensureInit();
        const result = await this._request(
            'POST',
            `/v3/workspaces/${this._workspace.id}/sessions/list`
        );
        return result.items || [];
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Message（メッセージ）
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * メッセージをバッチ追加
     * @param {string} sessionId
     * @param {Array<{peerId: string, content: string}>} messages
     * @returns {Promise<Object>}
     */
    async addMessages(sessionId, messages) {
        await this._ensureInit();
        return await this._request(
            'POST',
            `/v3/workspaces/${this._workspace.id}/sessions/${sessionId}/messages`,
            null,
            { messages }
        );
    }

    /**
     * ユーザーメッセージ + AI応答を一括保存（便利メソッド）
     * @param {string} sessionId
     * @param {string} userPeerId - ユーザーのPeer ID
     * @param {string} assistantPeerId - AIのPeer ID
     * @param {string} userContent
     * @param {string} assistantContent
     */
    async saveConversationTurn(sessionId, userPeerId, assistantPeerId, userContent, assistantContent) {
        return await this.addMessages(sessionId, [
            { peer: userPeerId, content: userContent },
            { peer: assistantPeerId, content: assistantContent }
        ]);
    }

    /**
     * セッションのメッセージ履歴を取得
     * @param {string} sessionId
     * @param {number} [limit=50]
     * @returns {Promise<Object[]>}
     */
    async getMessages(sessionId, limit = 50) {
        await this._ensureInit();
        const result = await this._request(
            'POST',
            `/v3/workspaces/${this._workspace.id}/sessions/${sessionId}/messages/list`,
            null,
            { size: limit }
        );
        return result.items || [];
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Context / Search / Dream
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    /**
     * セッションのコンテキストを取得（LLMに渡す用）
     * @param {string} sessionId
     * @param {Object} [options={}]
     * @param {boolean} [options.summary=true]
     * @param {number} [options.tokens=10000]
     * @returns {Promise<Object>}
     */
    async getSessionContext(sessionId, options = {}) {
        await this._ensureInit();
        const { summary = true, tokens = 10000 } = options;
        return await this._request(
            'POST',
            `/v3/workspaces/${this._workspace.id}/sessions/${sessionId}/context`,
            null,
            { summary, tokens }
        );
    }

    /**
     * セマンティック検索
     * @param {string} query - 検索クエリ
     * @returns {Promise<Object>}
     */
    async search(query) {
        await this._ensureInit();
        return await this._request(
            'POST',
            `/v3/workspaces/${this._workspace.id}/search`,
            null,
            { query }
        );
    }

    /**
     * メモリ統合（Dream）をスケジュール
     * @param {string} observerPeerId
     * @param {string} sessionId
     * @returns {Promise<Object>}
     */
    async scheduleDream(observerPeerId, sessionId) {
        await this._ensureInit();
        return await this._request(
            'POST',
            `/v3/workspaces/${this._workspace.id}/schedule_dream`,
            null,
            { observer: observerPeerId, session: sessionId }
        );
    }

    /**
     * キュー処理状態を確認
     * @param {string} observerPeerId
     * @param {string} sessionId
     * @returns {Promise<Object>}
     */
    async queueStatus(observerPeerId, sessionId) {
        await this._ensureInit();
        return await this._request(
            'GET',
            `/v3/workspaces/${this._workspace.id}/queue/status`,
            { observer: observerPeerId, session: sessionId }
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
        workspaceId: process.env.HONCHO_WORKSPACE_ID || 'brainbase'
    });
}
