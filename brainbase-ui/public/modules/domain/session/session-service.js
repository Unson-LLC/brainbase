import { httpClient } from '../../core/http-client.js';
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { getProjectPath } from '../../project-mapping.js';
import { createSessionId, buildSessionObject } from '../../session-manager.js';
import { addSession } from '../../state-api.js';

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
     * セッション作成（通常またはworktree）
     * @param {Object} params - セッションパラメータ
     * @param {string} params.project - プロジェクト名
     * @param {string} params.name - セッション名
     * @param {string} params.initialCommand - 初期コマンド
     * @param {boolean} params.useWorktree - worktreeを使用するか
     * @param {string} params.engine - AI Engine ('claude' or 'codex')
     * @returns {Promise<Object>} 作成されたセッション
     */
    async createSession(params) {
        const { project, name, initialCommand = '', useWorktree = false, engine = 'claude' } = params;

        const repoPath = getProjectPath(project);
        const sessionId = createSessionId('session');

        try {
            if (useWorktree) {
                return await this._createWorktreeSession(sessionId, repoPath, name, initialCommand, engine);
            } else {
                return await this._createRegularSession(sessionId, name, repoPath, initialCommand, engine);
            }
        } catch (error) {
            console.error('Failed to create session:', error);
            throw error;
        }
    }

    /**
     * 通常セッション作成
     * @private
     */
    async _createRegularSession(sessionId, name, repoPath, initialCommand, engine) {
        // Start terminal session
        const res = await this.httpClient.post('/api/sessions/start', {
            sessionId,
            initialCommand,
            cwd: repoPath,
            engine
        });

        if (!res || res.error) {
            throw new Error('Failed to start terminal session');
        }

        // Build session object and add to state
        const newSession = buildSessionObject({
            id: sessionId,
            name,
            path: repoPath,
            initialCommand,
            engine,
            intendedState: 'stopped'
        });

        await addSession(newSession);
        await this.loadSessions();

        this.eventBus.emit(EVENTS.SESSION_CREATED, { session: newSession });

        return { sessionId, session: newSession };
    }

    /**
     * Worktreeセッション作成
     * @private
     */
    async _createWorktreeSession(sessionId, repoPath, name, initialCommand, engine) {
        const res = await this.httpClient.post('/api/sessions/create-with-worktree', {
            sessionId,
            repoPath,
            name,
            initialCommand,
            engine
        });

        if (!res || res.error) {
            // Fallback to regular session
            console.warn('Worktree creation failed, falling back to regular session');
            return await this._createRegularSession(sessionId, name, repoPath, initialCommand, engine);
        }

        // If API response doesn't include session object, build it from response data
        let session = res.session;
        if (!session && res.worktreePath && res.branchName) {
            console.log('Building session object from API response');
            session = buildSessionObject({
                id: sessionId,
                name,
                path: res.worktreePath,
                initialCommand,
                engine,
                intendedState: 'stopped',
                worktree: {
                    repo: repoPath,
                    branch: res.branchName
                }
            });

            // Add to state since server may have done it already, but ensure client state is updated
            await addSession(session);
        }

        await this.loadSessions();

        this.eventBus.emit(EVENTS.SESSION_CREATED, { session });

        return { sessionId, session, proxyPath: res.proxyPath };
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
     * アーカイブされたセッション取得
     * @param {string} searchTerm - 検索キーワード
     * @param {string} projectFilter - プロジェクトフィルター
     * @returns {Array} アーカイブされたセッション配列
     */
    getArchivedSessions(searchTerm = '', projectFilter = '') {
        const { sessions } = this.store.getState();
        let archived = (sessions || []).filter(s => s.archived);

        // 検索フィルタ
        if (searchTerm) {
            archived = archived.filter(s =>
                s.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                s.project?.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        // プロジェクトフィルタ
        if (projectFilter) {
            archived = archived.filter(s => s.project === projectFilter);
        }

        // 作成日でソート（新しい順）
        return archived.sort((a, b) => {
            const dateA = new Date(a.createdDate || 0);
            const dateB = new Date(b.createdDate || 0);
            return dateB - dateA;
        });
    }

    /**
     * セッションをアンアーカイブ（復元）
     * @param {string} sessionId - 復元するセッションのID
     */
    async unarchiveSession(sessionId) {
        await this.updateSession(sessionId, { archived: false });
    }

    /**
     * ユニークなプロジェクト一覧取得
     * @returns {Array<string>} プロジェクト名配列
     */
    getUniqueProjects() {
        const { sessions } = this.store.getState();
        const projects = new Set();
        (sessions || []).forEach(s => {
            if (s.project) projects.add(s.project);
        });
        return Array.from(projects).sort();
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
