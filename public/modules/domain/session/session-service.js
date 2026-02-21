import { httpClient } from '../../core/http-client.js';
import { appStore } from '../../core/store.js';
import { eventBus, EVENTS } from '../../core/event-bus.js';
import { createTraceId } from '../../core/trace-id.js';
import { getProjectPath, getProjectFromSession } from '../../project-mapping.js';
import { createSessionId, buildSessionObject } from '../../session-manager.js';
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
        this._lastLoadFingerprint = null;
        this._stateEtag = null;
    }

    _buildLoadFingerprint(sessions, testMode, preferences) {
        return JSON.stringify({
            testMode: Boolean(testMode),
            sessions: (sessions || []).map((session) => ({
                id: session.id,
                name: session.name || null,
                intendedState: session.intendedState || null,
                updatedAt: session.updatedAt || null,
                archivedAt: session.archivedAt || null,
                pausedAt: session.pausedAt || null,
                ttydRunning: session.ttydRunning || false,
                needsRestart: session.runtimeStatus?.needsRestart || false
            })),
            preferences: preferences || {}
        });
    }

    /**
     * セッション一覧取得
     * @returns {Promise<Array>} セッション配列
     */
    async loadSessions() {
        const localSessions = this.store.getState().sessions;
        const shouldUseConditionalGet =
            typeof this._stateEtag === 'string' &&
            this._stateEtag.length > 0 &&
            Array.isArray(localSessions) &&
            localSessions.length > 0;

        const state = shouldUseConditionalGet
            ? await this.httpClient.get('/api/state', {
                allowNotModified: true,
                headers: {
                    'If-None-Match': this._stateEtag
                }
            })
            : await this.httpClient.get('/api/state');
        if (state?.notModified) {
            return localSessions || [];
        }

        if (typeof state?.etag === 'string' && state.etag.length > 0) {
            this._stateEtag = state.etag;
        }

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
            this._stateEtag = null;
            console.log('[Migration] Converted "stopped" sessions to "paused"');
        }

        const fingerprint = this._buildLoadFingerprint(sessions, testMode, preferences);
        if (this._lastLoadFingerprint === fingerprint) {
            return sessions;
        }

        this._lastLoadFingerprint = fingerprint;
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

        try {
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
        const { sessions } = this.store.getState();
        const snapshot = sessions.map(s => ({ ...s }));
        const now = new Date().toISOString();

        // アーカイブ時にarchivedAtを自動設定
        if (updates.intendedState === 'archived' && !updates.archivedAt) {
            updates.archivedAt = now;
        }

        if (!updates.updatedAt) {
            updates.updatedAt = now;
        }

        // 楽観的UI: Store即時更新
        const updatedSessions = sessions.map(s =>
            s.id === sessionId ? { ...s, ...updates } : s
        );
        this.store.setState({ sessions: updatedSessions });
        this.eventBus.emit(EVENTS.SESSION_UPDATED, { sessionId, updates });

        // サーバー同期（バックグラウンド）— PATCHで1件だけ更新
        try {
            await this.httpClient.patch(`/api/state/sessions/${sessionId}`, { ...updates, updatedAt: now });
        } catch (error) {
            // ロールバック
            this.store.setState({ sessions: snapshot });
            throw error;
        }

        return { success: true, sessionId, updates };
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
     * コミットログ取得
     * @param {string} sessionId - セッションID
     * @param {number} [limit=50] - 取得件数
     * @returns {Promise<Object|null>}
     */
    async getCommitLog(sessionId, limit = 50) {
        try {
            return await this.httpClient.get(`/api/sessions/${sessionId}/commit-log?limit=${limit}`);
        } catch (error) {
            console.error('Failed to get commit log:', error);
            return null;
        }
    }

    /**
     * コミット通知タイムスタンプ取得
     * @param {string} sessionId - セッションID
     * @returns {Promise<number>}
     */
    async getCommitNotify(sessionId) {
        try {
            const result = await this.httpClient.get(`/api/sessions/${sessionId}/commit-notify`);
            return Number(result?.lastNotify || 0);
        } catch (error) {
            console.error('Failed to get commit notify timestamp:', error);
            return 0;
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
        const { currentSessionId, sessions } = this.store.getState();
        const wasCurrentSession = currentSessionId === sessionId;

        if (!skipMergeCheck) {
            const result = await this.httpClient.post(
                `/api/sessions/${sessionId}/archive`,
                { skipMergeCheck: false }
            );
            if (result.needsConfirmation) {
                return result;
            }
            // アーカイブ成功済み → Store即座更新（loadSessions不要）
            this._optimisticArchive(sessionId, wasCurrentSession);
            return { success: true };
        }

        // skipMergeCheck=true → 楽観的にUI更新してからサーバー同期
        const snapshot = sessions.map(s => ({ ...s }));
        this._optimisticArchive(sessionId, wasCurrentSession);

        try {
            await this.httpClient.post(
                `/api/sessions/${sessionId}/archive`,
                { skipMergeCheck: true }
            );
        } catch (error) {
            // ロールバック
            this.store.setState({ sessions: snapshot });
            if (wasCurrentSession) {
                this.store.setState({ currentSessionId: sessionId });
            }
            throw error;
        }

        return { success: true };
    }

    /**
     * 楽観的アーカイブ: Store即時更新
     * @param {string} sessionId
     * @param {boolean} wasCurrentSession
     */
    _optimisticArchive(sessionId, wasCurrentSession) {
        const { sessions } = this.store.getState();
        const now = new Date().toISOString();
        const updated = sessions.map(s =>
            s.id === sessionId
                ? { ...s, intendedState: 'archived', archivedAt: now }
                : s
        );
        this.store.setState({ sessions: updated });
        this.eventBus.emit(EVENTS.SESSION_ARCHIVED, { sessionId });

        if (wasCurrentSession) {
            const activeSessions = updated.filter(
                s => s.intendedState !== 'archived' && s.id !== sessionId
            );
            if (activeSessions.length > 0) {
                this.switchSession(activeSessions[0].id);
            } else {
                this.store.setState({ currentSessionId: null });
            }
        }
    }

    /**
     * セッションを統合（pushしてマージ）
     * Jujutsu: bookmarkをpushしてPR作成→マージ
     * @param {string} sessionId - 統合するセッションのID
     * @returns {Promise<{success?: boolean, error?: string, prUrl?: string}>}
     */
    async mergeSession(sessionId) {
        const result = await this.httpClient.post(
            `/api/sessions/${sessionId}/merge`
        );

        if (result.success) {
            await this.loadSessions();
            await this.eventBus.emit(EVENTS.SESSION_ARCHIVED, { sessionId });
        }

        return result;
    }

    /**
     * セッションをアンアーカイブ（復元）
     * restore APIを呼び出し、ttydを再起動してセッションのengineで復元する
     * @param {string} sessionId - 復元するセッションのID
     * @returns {Promise<Object>}
     */
    async unarchiveSession(sessionId) {
        const { sessions } = this.store.getState();
        const snapshot = sessions.map(s => ({ ...s }));
        const traceId = createTraceId('restore');
        const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.eventBus.emit(EVENTS.PERF_SESSION_RESTORE_START, {
            sessionId,
            traceId,
            startedAt
        }).catch(() => {});

        // 楽観的UI: 即座にpaused状態に
        const updated = sessions.map(s =>
            s.id === sessionId
                ? { ...s, intendedState: 'paused', archivedAt: null }
                : s
        );
        this.store.setState({ sessions: updated });

        try {
            await this.httpClient.post(`/api/sessions/${sessionId}/restore`, {}, { traceId });
        } catch (error) {
            this.store.setState({ sessions: snapshot });
            throw error;
        }

        const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.eventBus.emit(EVENTS.PERF_SESSION_RESTORE_READY, {
            sessionId,
            traceId,
            startedAt,
            endedAt,
            durationMs: Math.max(0, Math.round(endedAt - startedAt))
        }).catch(() => {});

        return { success: true };
    }

    /**
     * /api/sessions/status の結果で実行時状態だけを同期
     * /api/state の全件再取得を減らすための軽量更新
     * @param {Object<string, {running?: boolean, proxyPath?: string, port?: number}>} statusMap
     * @returns {boolean} 変更があればtrue
     */
    syncRuntimeStatus(statusMap = {}) {
        const { sessions } = this.store.getState();
        if (!Array.isArray(sessions) || sessions.length === 0) {
            return false;
        }

        let changed = false;
        const updatedSessions = sessions.map((session) => {
            const status = statusMap?.[session.id] || {};
            const running = Boolean(status.running);
            const needsRestart = session.intendedState === 'active' && !running;
            const proxyPath = running
                ? (typeof status.proxyPath === 'string' && status.proxyPath.trim()
                    ? status.proxyPath
                    : `/console/${session.id}`)
                : null;
            const port = running && Number.isFinite(status.port) ? status.port : null;
            const prevRuntime = session.runtimeStatus || {};
            const prevProxyPath = running
                ? (typeof prevRuntime.proxyPath === 'string' && prevRuntime.proxyPath.trim()
                    ? prevRuntime.proxyPath
                    : `/console/${session.id}`)
                : null;
            const prevPort = running && Number.isFinite(prevRuntime.port) ? prevRuntime.port : null;

            if (
                session.ttydRunning === running &&
                prevRuntime.needsRestart === needsRestart &&
                prevProxyPath === proxyPath &&
                prevPort === port
            ) {
                return session;
            }

            changed = true;
            return {
                ...session,
                ttydRunning: running,
                runtimeStatus: {
                    ttydRunning: running,
                    needsRestart,
                    proxyPath,
                    port
                }
            };
        });

        if (changed) {
            this.store.setState({ sessions: updatedSessions });
        }

        return changed;
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
