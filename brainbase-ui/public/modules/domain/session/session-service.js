import { httpClient } from '../../core/http-client.js';
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';

/**
 * セッションのビジネスロジック
 * app.jsから抽出したセッション管理機能を集約
 */
export class SessionService {
    constructor() {
        this.httpClient = httpClient;
        this.store = appStore;
        this.eventBus = eventBus;
    }

    /**
     * セッション一覧取得
     * @returns {Promise<Array>} セッション配列
     */
    async loadSessions() {
        const state = await this.httpClient.get('/api/state');
        const sessions = state.sessions || [];
        this.store.setState({ sessions });
        this.eventBus.emit(EVENTS.SESSION_LOADED, { sessions });
        return sessions;
    }

    /**
     * セッション作成
     * @param {Object} sessionData - 作成するセッションデータ
     */
    async createSession(sessionData) {
        const state = await this.httpClient.get('/api/state');
        const sessions = state.sessions || [];
        const newSession = {
            id: this._generateSessionId(),
            ...sessionData,
            createdDate: new Date().toISOString()
        };
        const updatedSessions = [...sessions, newSession];
        await this.httpClient.post('/api/state', { ...state, sessions: updatedSessions });
        await this.loadSessions();
        this.eventBus.emit(EVENTS.SESSION_CREATED, { session: newSession });
    }

    /**
     * セッション更新
     * @param {string} sessionId - セッションID
     * @param {Object} updates - 更新内容
     */
    async updateSession(sessionId, updates) {
        const state = await this.httpClient.get('/api/state');
        const updatedSessions = state.sessions.map(s =>
            s.id === sessionId ? { ...s, ...updates } : s
        );
        await this.httpClient.post('/api/state', { ...state, sessions: updatedSessions });
        await this.loadSessions();
        this.eventBus.emit(EVENTS.SESSION_UPDATED, { sessionId, updates });
    }

    /**
     * セッション削除
     * @param {string} sessionId - 削除するセッションのID
     */
    async deleteSession(sessionId) {
        const state = await this.httpClient.get('/api/state');
        const updatedSessions = state.sessions.filter(s => s.id !== sessionId);
        await this.httpClient.post('/api/state', { ...state, sessions: updatedSessions });
        await this.loadSessions();
        this.eventBus.emit(EVENTS.SESSION_DELETED, { sessionId });
    }

    /**
     * フィルタリング済みセッション取得
     * @returns {Array} フィルタリング後のセッション配列
     */
    getFilteredSessions() {
        const { sessions, filters } = this.store.getState();
        const { sessionFilter, showArchivedSessions } = filters;

        let filtered = sessions || [];

        // テキストフィルタ（名前、プロジェクト名で検索）
        if (sessionFilter) {
            filtered = filtered.filter(s =>
                s.name?.includes(sessionFilter) ||
                s.project?.includes(sessionFilter) ||
                s.path?.includes(sessionFilter)
            );
        }

        // アーカイブフィルタ
        if (!showArchivedSessions) {
            filtered = filtered.filter(s => !s.archived);
        }

        return filtered;
    }

    /**
     * アクティブセッション取得
     * currentSessionIdで指定されているセッション
     * @returns {Object|null} アクティブセッション
     */
    getActiveSession() {
        const { sessions, currentSessionId } = this.store.getState();
        if (!currentSessionId) return null;
        return sessions.find(s => s.id === currentSessionId) || null;
    }

    /**
     * セッションID生成
     * @private
     * @returns {string} ユニークなセッションID
     */
    _generateSessionId() {
        return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}
