import { httpClient } from '../../core/http-client.js';
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { getTerminalViewerId, getTerminalViewerLabel } from '../../core/terminal-viewer.js';
import { getProjectPath, getProjectFromSession } from '../../project-mapping.js';
import { createSessionId, buildSessionObject, generateSessionName } from '../../session-manager.js';
import { addSession, removeSession } from '../../state-api.js';

/**
 * セッションのビジネスロジック
 * app.jsから抽出したセッション管理機能を集約
 *
 * Auto-Claude RecoveryManager pattern:
 * - セッション作成時に前回の失敗情報を確認
 * - スタック検出時にSTUCK_DETECTEDイベントを発火
 */
export class SessionService {
    /**
     * @param {Object} options - オプション
     * @param {Object} options.recoveryService - RecoveryService（オプション）
     */
    constructor(options = {}) {
        this.httpClient = httpClient;
        this.store = appStore;
        this.eventBus = eventBus;
        this.recoveryService = options.recoveryService || null;
        this._pendingDeletes = new Map();
        this.viewerId = getTerminalViewerId();
        this.viewerLabel = getTerminalViewerLabel();
    }

    /**
     * セッション一覧取得
     * @returns {Promise<Array>} セッション配列
     */
    async loadSessions() {
        const state = await this.httpClient.get('/api/state');
        let sessions = state.sessions || [];
        const testMode = state.testMode || false;
        const storedPreferences = state.preferences || {};
        const currentPreferences = this.store.getState().preferences || {};
        const preferences = {
            ...currentPreferences,
            ...storedPreferences,
            user: {
                ...(currentPreferences.user || {}),
                ...(storedPreferences.user || {})
            }
        };

        // マイグレーション: stopped状態をpausedに変換
        let migrationNeeded = false;
        sessions = sessions.map(session => {
            if (session.intendedState === 'stopped') {
                migrationNeeded = true;
                return {
                    ...session,
                    intendedState: 'paused',
                    pausedReason: session.pausedReason || 'migrated_from_stopped'
                };
            }
            return session;
        });

        // 変換が発生した場合、state.jsonに保存
        if (migrationNeeded) {
            await this.httpClient.post('/api/state', { ...state, sessions });
            console.log('[Migration] Converted "stopped" sessions to "paused"');
        }

        this.store.setState({ sessions, testMode, preferences });
        await this.eventBus.emit(EVENTS.SESSION_LOADED, { sessions, testMode });
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
     * @param {string} params.sessionId - セッションID（オプション、指定しない場合は自動生成）
     * @returns {Promise<Object>} 作成されたセッション
     */
    async createSession(params) {
        const { project, initialCommand = '', useWorktree = false, engine = 'claude' } = params;
        let { name, sessionId } = params;

        const repoPath = getProjectPath(project);
        // sessionIdが指定されていない場合は自動生成
        if (!sessionId) {
            sessionId = createSessionId('session');
        }

        // 名前が空の場合、自動生成: {project}-{MMDD}-{連番}
        if (!name || !name.trim()) {
            const existingSessions = this.store.getState().sessions || [];
            name = generateSessionName(project, existingSessions);
        }

        // Auto-Claude RecoveryManager pattern: 前回の失敗情報を確認
        let recoveryHints = null;
        if (this.recoveryService) {
            recoveryHints = await this.recoveryService.checkPreviousFailures(sessionId);

            // スタック検出時はイベントを発火
            if (this.recoveryService.isStuck(sessionId)) {
                await this.eventBus.emit(EVENTS.STUCK_DETECTED, {
                    sessionId,
                    attemptCount: recoveryHints?.attemptCount || 0,
                    lastError: recoveryHints?.lastError
                });
                console.warn(`[RecoveryManager] Session ${sessionId} is stuck after ${recoveryHints?.attemptCount} attempts`);
            }
        }

        try {
            let result;
            if (useWorktree) {
                result = await this._createWorktreeSession(sessionId, repoPath, name, initialCommand, engine, project);
            } else {
                result = await this._createRegularSession(sessionId, name, repoPath, initialCommand, engine, project);
            }

            // セッション作成成功時にrecoveryHintsを付加
            if (recoveryHints) {
                result.recoveryHints = recoveryHints;
            }

            return result;
        } catch (error) {
            // Auto-Claude RecoveryManager pattern: 失敗を記録
            if (this.recoveryService) {
                await this.recoveryService.recordFailure(sessionId, {
                    message: error.message,
                    type: 'session_creation_failed',
                    context: { project, name, useWorktree, engine }
                });
            }
            console.error('Failed to create session:', error);
            throw error;
        }
    }

    /**
     * 通常セッション作成
     * @private
     */
    async _createRegularSession(sessionId, name, repoPath, initialCommand, engine, project) {
        // Build session object and add to state first.
        // This allows the server to persist ttydProcess info and login_script.sh to resolve the correct CWD.
        const newSession = buildSessionObject({
            id: sessionId,
            name,
            path: repoPath,
            project,
            initialCommand,
            engine,
            intendedState: 'active'
        });

        await addSession(newSession);

        let startResult = null;

        try {
            // Start terminal session
            const res = await this.httpClient.post('/api/sessions/start', {
                sessionId,
                initialCommand,
                cwd: repoPath,
                engine,
                viewerId: this.viewerId,
                viewerLabel: this.viewerLabel
            });

            if (!res || res.error) {
                throw new Error('Failed to start terminal session');
            }

            startResult = res;
        } catch (error) {
            // Roll back state on failure (best-effort)
            try {
                await removeSession(sessionId);
                await this.loadSessions();
            } catch (_) {
                // ignore rollback errors
            }
            throw error;
        }

        await this.loadSessions();

        await this.eventBus.emit(EVENTS.SESSION_CREATED, { session: newSession });

        return { sessionId, session: newSession, proxyPath: startResult?.proxyPath || null };
    }

    /**
     * Worktreeセッション作成
     * @private
     */
    async _createWorktreeSession(sessionId, repoPath, name, initialCommand, engine, project) {
        const res = await this.httpClient.post('/api/sessions/create-with-worktree', {
            sessionId,
            repoPath,
            name,
            initialCommand,
            engine,
            project,
            viewerId: this.viewerId,
            viewerLabel: this.viewerLabel
        });

        if (!res || res.error) {
            // Fallback to regular session
            const reason = res?.error || 'Worktree creation failed';
            console.warn('Worktree creation failed, falling back to regular session:', reason);
            await this.eventBus.emit(EVENTS.SESSION_WORKTREE_FALLBACK, {
                sessionId,
                project,
                repoPath,
                reason
            });
            return await this._createRegularSession(sessionId, name, repoPath, initialCommand, engine);
        }

        // サーバーサイドで既にセッションを追加しているため、
        // クライアントサイドでは loadSessions を呼び出して状態を更新するだけ
        await this.loadSessions();

        // セッション情報を取得（サーバーから返されたものまたは状態から取得）
        const sessions = this.store.getState().sessions;
        const session = sessions.find(s => s.id === sessionId);

        await this.eventBus.emit(EVENTS.SESSION_CREATED, { session });

        return { sessionId, session, proxyPath: res.proxyPath };
    }

    /**
     * プログレス取得
     * @param {string} sessionId - セッションID
     * @param {number} currentPercent - 現在の進捗率
     * @returns {Promise<{phase: string, percent: number, message: string, timestamp: number}>}
     */
    async getProgress(sessionId, currentPercent = 0) {
        const res = await this.httpClient.get(`/api/sessions/${sessionId}/progress?current=${currentPercent}`);
        return res;
    }

    /**
     * セッション更新
     * @param {string} sessionId - セッションID
     * @param {Object} updates - 更新内容
     * @returns {Promise<{success: boolean, sessionId: string, updates: Object, eventResult: Object}>}
     */
    async updateSession(sessionId, updates) {
        const state = await this.httpClient.get('/api/state');
        const now = new Date().toISOString();

        // アーカイブ時にarchivedAtを自動設定
        if (updates.intendedState === 'archived' && !updates.archivedAt) {
            updates.archivedAt = now;
        }

        if (!updates.updatedAt) {
            updates.updatedAt = now;
        }

        const updatedSessions = state.sessions.map(s =>
            s.id === sessionId ? { ...s, ...updates } : s
        );
        await this.httpClient.post('/api/state', { ...state, sessions: updatedSessions });
        await this.loadSessions();
        const eventResult = await this.eventBus.emit(EVENTS.SESSION_UPDATED, { sessionId, updates });
        return { success: true, sessionId, updates, eventResult };
    }

    /**
     * セッション削除
     * @param {string} sessionId - 削除するセッションのID
     * @returns {Promise<{success: boolean, sessionId: string, eventResult: Object}>}
     */
    async deleteSession(sessionId) {
        if (this._pendingDeletes.has(sessionId)) {
            return this._pendingDeletes.get(sessionId);
        }

        const deletePromise = (async () => {
            const stateBeforeDelete = this.store.getState();
            const previousSessions = stateBeforeDelete.sessions || [];
            const previousCurrentSessionId = stateBeforeDelete.currentSessionId || null;
            const previousFilters = stateBeforeDelete.filters || {};

            const optimisticSessions = previousSessions.filter((session) => session.id !== sessionId);
            const nextCurrentSessionId = this._resolveNextSessionIdAfterDelete(
                optimisticSessions,
                sessionId,
                previousCurrentSessionId,
                previousFilters
            );

            // 楽観的更新: 先にUIから削除して体感速度を上げる
            this.store.setState({
                sessions: optimisticSessions,
                currentSessionId: nextCurrentSessionId
            });

            const eventResult = await this.eventBus.emit(EVENTS.SESSION_DELETED, {
                sessionId,
                optimistic: true
            });

            try {
                const state = await this.httpClient.get('/api/state');
                const updatedSessions = (state.sessions || []).filter((session) => session.id !== sessionId);
                await this.httpClient.post('/api/state', { ...state, sessions: updatedSessions });
                await this.loadSessions();
                return { success: true, sessionId, eventResult };
            } catch (error) {
                this.store.setState({
                    sessions: previousSessions,
                    currentSessionId: previousCurrentSessionId
                });
                await this.eventBus.emit(EVENTS.SESSION_LOADED, {
                    sessions: previousSessions,
                    rollback: true
                });
                throw error;
            }
        })();

        this._pendingDeletes.set(sessionId, deletePromise);
        try {
            return await deletePromise;
        } finally {
            this._pendingDeletes.delete(sessionId);
        }
    }

    _resolveNextSessionIdAfterDelete(sessions, deletingSessionId, currentSessionId, filters = {}) {
        if (currentSessionId !== deletingSessionId) {
            return currentSessionId;
        }

        const activeSessions = this._getFilteredSessionsForState(sessions, filters)
            .filter((session) => session.intendedState !== 'archived');

        return activeSessions.length > 0 ? activeSessions[0].id : null;
    }

    _getFilteredSessionsForState(sessions, filters = {}) {
        const { sessionFilter = '', showArchivedSessions = false } = filters;
        let filtered = sessions || [];

        if (sessionFilter) {
            filtered = filtered.filter((session) =>
                session.name?.includes(sessionFilter) ||
                session.project?.includes(sessionFilter) ||
                session.path?.includes(sessionFilter)
            );
        }

        if (!showArchivedSessions) {
            filtered = filtered.filter((session) => session.intendedState !== 'archived');
        }

        return filtered;
    }

    /**
     * フィルタリング済みセッション取得
     * @returns {Array} フィルタリング後のセッション配列
     */
    getFilteredSessions() {
        const { sessions, filters } = this.store.getState();
        return this._getFilteredSessionsForState(sessions, filters);
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
        console.log('[DEBUG] getArchivedSessions - Total sessions:', sessions?.length);

        let archived = (sessions || []).filter(s => s.intendedState === 'archived');
        console.log('[DEBUG] getArchivedSessions - Archived sessions:', archived.length);

        // 検索フィルタ
        if (searchTerm) {
            archived = archived.filter(s => {
                const project = getProjectFromSession(s);
                return s.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                       project?.toLowerCase().includes(searchTerm.toLowerCase());
            });
            console.log('[DEBUG] getArchivedSessions - After search filter:', archived.length);
        }

        // プロジェクトフィルタ
        if (projectFilter) {
            archived = archived.filter(s => {
                const project = getProjectFromSession(s);
                return project === projectFilter;
            });
            console.log('[DEBUG] getArchivedSessions - After project filter:', archived.length);
        }

        // アーカイブ日時でソート（新しい順）
        const sorted = archived.sort((a, b) => {
            // 日付の優先順位: archivedAt > createdDate > createdAt > セッションIDから抽出
            const getDateValue = (s) => {
                let dateValue = s.archivedAt || s.createdDate || s.createdAt;

                // セッションIDから日付を抽出
                if (!dateValue && s.id) {
                    const match = s.id.match(/session-(\d{13})/);
                    if (match) {
                        dateValue = parseInt(match[1], 10);
                    }
                }

                return dateValue || 0;
            };

            const dateA = new Date(getDateValue(a));
            const dateB = new Date(getDateValue(b));
            return dateB - dateA;
        });

        console.log('[DEBUG] getArchivedSessions - Returning:', sorted.length, 'sessions');
        return sorted;
    }

    /**
     * セッションコンテキスト取得
     * @param {string} sessionId - セッションID
     * @returns {Promise<Object|null>}
     */
    async getSessionContext(sessionId) {
        try {
            return await this.httpClient.get(`/api/sessions/${sessionId}/context`);
        } catch (error) {
            console.error('Failed to get session context:', error);
            return null;
        }
    }

    /**
     * セッションのフォルダツリーを取得
     * @param {string} sessionId - セッションID
     * @param {string} query - クエリ文字列（例: ?path=public&depth=1）
     * @returns {Promise<Object>}
     */
    async getSessionFolderTree(sessionId, query = '') {
        const suffix = typeof query === 'string' ? query : '';
        return await this.httpClient.get(`/api/sessions/${sessionId}/folder-tree${suffix}`);
    }

    /**
     * ファイルをデフォルトアプリで開く
     * @param {string} relativePath - セッションCWDからの相対パス
     * @param {string|null} cwd - セッションの作業ディレクトリ
     * @returns {Promise<Object>}
     */
    async openFileInDefaultApp(relativePath, cwd = null, sessionId = null) {
        return await this.httpClient.post('/api/open-file', {
            path: relativePath,
            mode: 'file',
            cwd,
            sessionId
        });
    }

    /**
     * Worktree状態取得
     * @param {string} sessionId - セッションID
     * @returns {Promise<Object|null>}
     */
    async getWorktreeStatus(sessionId) {
        try {
            return await this.httpClient.get(`/api/sessions/${sessionId}/worktree-status`);
        } catch (error) {
            console.error('Failed to get worktree status:', error);
            return null;
        }
    }

    /**
     * ローカルmainブランチ更新
     * @param {string} sessionId - セッションID
     * @returns {Promise<Object>}
     */
    async updateLocalMain(sessionId, options = {}) {
        return await this.httpClient.post(`/api/sessions/${sessionId}/update-local-main`, options);
    }

    /**
     * セッションをアーカイブ（worktreeマージチェック付き）
     * @param {string} sessionId - アーカイブするセッションのID
     * @param {Object} options - オプション
     * @param {boolean} options.skipMergeCheck - マージチェックをスキップするか
     * @returns {Promise<{success?: boolean, needsConfirmation?: boolean, status?: Object}>}
     */
    async archiveSession(sessionId, options = {}) {
        const { skipMergeCheck = false } = options;

        // アーカイブ前に現在表示中のセッションかチェック
        const { currentSessionId } = this.store.getState();
        const wasCurrentSession = currentSessionId === sessionId;

        const result = await this.httpClient.post(
            `/api/sessions/${sessionId}/archive`,
            { skipMergeCheck }
        );

        if (result.needsConfirmation) {
            // 呼び出し元で警告表示が必要
            return result;
        }

        await this.loadSessions();
        await this.eventBus.emit(EVENTS.SESSION_ARCHIVED, { sessionId });

        // 現在表示中のセッションをアーカイブした場合、次のアクティブセッションに切り替え
        if (wasCurrentSession) {
            const activeSessions = this.getFilteredSessions()
                .filter(s => s.intendedState !== 'archived' && s.id !== sessionId);
            if (activeSessions.length > 0) {
                await this.switchSession(activeSessions[0].id);
            } else {
                // アクティブセッションがない場合はcurrentSessionIdをクリア
                this.store.setState({ currentSessionId: null });
            }
        }

        return { success: true };
    }

    /**
     * セッションを統合（pushしてマージ）
     * Jujutsu: bookmarkをpushしてPR作成→マージ
     * @param {string} sessionId - 統合するセッションのID
     * @returns {Promise<{success?: boolean, error?: string, prUrl?: string}>}
     */
    async mergeSession(sessionId) {
        // マージ前に現在表示中のセッションかチェック
        const { currentSessionId } = this.store.getState();
        const wasCurrentSession = currentSessionId === sessionId;

        const result = await this.httpClient.post(
            `/api/sessions/${sessionId}/merge`
        );

        if (result.success) {
            await this.loadSessions();
            await this.eventBus.emit(EVENTS.SESSION_ARCHIVED, { sessionId });

            // 現在表示中のセッションをマージした場合、次のアクティブセッションに切り替え
            if (wasCurrentSession) {
                const activeSessions = this.getFilteredSessions()
                    .filter(s => s.intendedState !== 'archived' && s.id !== sessionId);
                if (activeSessions.length > 0) {
                    await this.switchSession(activeSessions[0].id);
                } else {
                    this.store.setState({ currentSessionId: null });
                }
            }
        }

        return result;
    }

    async askAiToResolveIntegration(sessionId, status) {
        const result = await this.httpClient.post(
            `/api/sessions/${sessionId}/ask-ai-integration`,
            { status }
        );

        return result;
    }

    /**
     * セッションをアンアーカイブ（復元）
     * restore APIを呼び出し、ttydを再起動してセッションのengineで復元する
     * @param {string} sessionId - 復元するセッションのID
     * @returns {Promise<Object>}
     */
    async unarchiveSession(sessionId) {
        const result = await this.httpClient.post(
            `/api/sessions/${sessionId}/restore`
        );

        await this.loadSessions();
        return result;
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
     * セッション切り替え
     * currentSessionIdを更新（intendedStateは変更しない）
     * @param {string} sessionId - 切り替え先のセッションID
     * @returns {Promise<{success: boolean, sessionId: string, eventResult: Object}|null>}
     */
    async switchSession(sessionId) {
        const { currentSessionId } = this.store.getState();
        const previousSessionId = currentSessionId;

        // 同じセッションへの切り替えは何もしない
        if (currentSessionId === sessionId) {
            return null;
        }

        // currentSessionIdを更新
        this.store.setState({ currentSessionId: sessionId });

        // SESSION_CHANGEDイベントを発火（app.jsでターミナルiframe切り替え用）
        const eventResult = await this.eventBus.emit(EVENTS.SESSION_CHANGED, {
            sessionId,
            previousSessionId
        });
        return { success: true, sessionId, eventResult };
    }

    /**
     * セッションを一時停止
     * active → paused に変更し、TTYDプロセスを停止
     * @param {string} sessionId - 一時停止するセッションID
     * @returns {Promise<{success: boolean, sessionId: string, eventResult: Object}>}
     */
    async pauseSession(sessionId) {
        // TTYDプロセスを停止
        try {
            await this.httpClient.post(`/api/sessions/${sessionId}/stop`);
        } catch (error) {
            console.error(`Failed to stop ttyd for session ${sessionId}:`, error);
        }

        // Phase 2: intendedState を paused に変更 + pausedAt タイムスタンプ設定
        await this.updateSession(sessionId, {
            intendedState: 'paused',
            pausedReason: 'manual',
            pausedAt: new Date().toISOString()
        });

        const eventResult = await this.eventBus.emit(EVENTS.SESSION_PAUSED, { sessionId });
        return { success: true, sessionId, eventResult };
    }

    /**
     * セッションを再開
     * paused → active に変更し、TTYDプロセスを起動
     * @param {string} sessionId - 再開するセッションID
     * @returns {Promise<{success: boolean, sessionId: string, eventResult: Object}|null>}
     */
    async resumeSession(sessionId) {
        const { sessions } = this.store.getState();
        const session = sessions.find(s => s.id === sessionId);

        if (!session) {
            console.error(`Session ${sessionId} not found`);
            return null;
        }

        // TTYDプロセスを起動
        try {
            await this.httpClient.post('/api/sessions/start', {
                sessionId,
                cwd: session.path,
                initialCommand: session.initialCommand || '',
                engine: session.engine || 'claude',
                viewerId: this.viewerId,
                viewerLabel: this.viewerLabel
            });
        } catch (error) {
            console.error(`Failed to start ttyd for session ${sessionId}:`, error);
        }

        // intendedState を active に変更
        await this.updateSession(sessionId, {
            intendedState: 'active',
            pausedReason: null
        });

        const eventResult = await this.eventBus.emit(EVENTS.SESSION_RESUMED, { sessionId });
        return { success: true, sessionId, eventResult };
    }

    /**
     * セッションの並び順を保存
     * @param {Array} sessions - 並び替えられたセッション配列
     */
    async saveSessionOrder(sessions) {
        try {
            // Get current state from backend
            const state = await this.httpClient.get('/api/state');

            // Update sessions array with new order
            const updatedState = {
                ...state,
                sessions
            };

            // Save to backend
            await this.httpClient.post('/api/state', updatedState);

            console.log('Session order saved successfully');
        } catch (error) {
            console.error('Failed to save session order:', error);
            throw error;
        }
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
