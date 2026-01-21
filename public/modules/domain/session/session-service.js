import { httpClient } from '../../core/http-client.js';
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { getProjectPath, getProjectFromSession } from '../../project-mapping.js';
import { createSessionId, buildSessionObject } from '../../session-manager.js';
import { addSession } from '../../state-api.js';

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
                return { ...session, intendedState: 'paused' };
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
     * @returns {Promise<Object>} 作成されたセッション
     */
    async createSession(params) {
        const { project, name, initialCommand = '', useWorktree = false, engine = 'claude' } = params;

        const repoPath = getProjectPath(project);
        const sessionId = createSessionId('session');

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
            project,
            initialCommand,
            engine,
            intendedState: 'active'
        });

        await addSession(newSession);
        await this.loadSessions();

        await this.eventBus.emit(EVENTS.SESSION_CREATED, { session: newSession });

        return { sessionId, session: newSession };
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
            project
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
        const state = await this.httpClient.get('/api/state');
        const updatedSessions = state.sessions.filter(s => s.id !== sessionId);
        await this.httpClient.post('/api/state', { ...state, sessions: updatedSessions });
        await this.loadSessions();
        const eventResult = await this.eventBus.emit(EVENTS.SESSION_DELETED, { sessionId });
        return { success: true, sessionId, eventResult };
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
            filtered = filtered.filter(s => s.intendedState !== 'archived');
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
     * セッションをアーカイブ（worktreeマージチェック付き）
     * @param {string} sessionId - アーカイブするセッションのID
     * @param {Object} options - オプション
     * @param {boolean} options.skipMergeCheck - マージチェックをスキップするか
     * @returns {Promise<{success?: boolean, needsConfirmation?: boolean, status?: Object}>}
     */
    async archiveSession(sessionId, options = {}) {
        const { skipMergeCheck = false } = options;

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
        return { success: true };
    }

    /**
     * セッションをアンアーカイブ（復元）
     * @param {string} sessionId - 復元するセッションのID
     */
    async unarchiveSession(sessionId) {
        await this.updateSession(sessionId, { intendedState: 'active' });
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

        // 同じセッションへの切り替えは何もしない
        if (currentSessionId === sessionId) {
            return null;
        }

        // currentSessionIdを更新
        this.store.setState({ currentSessionId: sessionId });

        // SESSION_CHANGEDイベントを発火（app.jsでターミナルiframe切り替え用）
        const eventResult = await this.eventBus.emit(EVENTS.SESSION_CHANGED, { sessionId });
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
                engine: session.engine || 'claude'
            });
        } catch (error) {
            console.error(`Failed to start ttyd for session ${sessionId}:`, error);
        }

        // intendedState を active に変更
        await this.updateSession(sessionId, { intendedState: 'active' });

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
