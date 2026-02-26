/**
 * SessionController
 * セッション関連のHTTPリクエスト処理
 */
import { exec } from 'child_process';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class SessionController {
    constructor(sessionManager, worktreeService, stateStore) {
        this.sessionManager = sessionManager;
        this.worktreeService = worktreeService;
        this.stateStore = stateStore;
        this._commitNotifyMap = new Map(); // sessionId → timestamp
    }

    /**
     * State更新をリトライ付きで実行
     * @param {Function} updateFn - 状態更新関数（currentState => newState）
     * @param {number} maxRetries - 最大リトライ回数
     * @returns {Promise<Object>} - 更新後の状態
     */
    async _updateStateWithRetry(updateFn, maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const currentState = this.stateStore.get();
                const newState = updateFn(currentState);
                await this.stateStore.update(newState);
                return newState;
            } catch (err) {
                if (err.message.includes('State conflict') && i < maxRetries - 1) {
                    console.warn(`[SessionController] Retry ${i + 1}/${maxRetries} due to conflict`);
                    await new Promise(resolve => setTimeout(resolve, 100 * (i + 1))); // Exponential backoff
                    continue;
                }
                throw err;
            }
        }
    }

    // ========================================
    // Activity & Status
    // ========================================

    /**
     * POST /api/sessions/report_activity
     * Hookからのactivity報告を受信
     */
    reportActivity = async (req, res) => {
        const { sessionId, status, reportedAt } = req.body;
        if (!sessionId || !status) {
            return res.status(400).json({ error: 'Missing sessionId or status' });
        }

        this.sessionManager.reportActivity(sessionId, status, reportedAt);
        res.json({ success: true });
    };

    /**
     * GET /api/sessions/status
     * セッション状態を取得
     */
    getStatus = (req, res) => {
        const status = this.sessionManager.getSessionStatus();
        res.json(status);
    };

    /**
     * GET /api/sessions/:id
     * 特定セッションの情報を取得
     */
    get = (req, res) => {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        const state = this.stateStore.get();
        const session = state.sessions?.find(s => s.id === id);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Add runtime status
        const runtimeStatus = this.sessionManager.getRuntimeStatus(session);

        res.json({
            ...session,
            runtimeStatus
        });
    };

    // ========================================
    // Process Management
    // ========================================

    /**
     * POST /api/sessions/start
     * ttydプロセスを起動
     */
    start = async (req, res) => {
        const { sessionId, initialCommand, cwd, engine } = req.body;
        console.log(`[DEBUG] /api/sessions/start called: sessionId=${sessionId}, referer=${req.headers.referer}, userAgent=${req.headers['user-agent']?.substring(0, 50)}`);
        console.log(`[DEBUG] Request stack:`, new Error().stack?.split('\n').slice(1, 4).join(' <- '));

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        try {
            // セッション開始時に'done'ステータスをクリア
            this.sessionManager.clearDoneStatus(sessionId);

            const startOptions = { sessionId };
            if (typeof cwd === 'string' && cwd.trim()) {
                startOptions.cwd = cwd;
            }
            if (typeof initialCommand === 'string') {
                startOptions.initialCommand = initialCommand;
            }
            if (typeof engine === 'string' && engine.trim()) {
                startOptions.engine = engine;
            }

            // ttydプロセス起動
            const result = await this.sessionManager.startTtyd(startOptions);

            // intendedState を active に更新（engine も反映）（リトライ付き）
            await this._updateStateWithRetry((currentState) => {
                const updatedSessions = (currentState.sessions || []).map(session => {
                    if (session.id !== sessionId) return session;
                    const updates = { ...session, intendedState: 'active', updatedAt: new Date().toISOString() };
                    if (startOptions.engine) {
                        updates.engine = startOptions.engine;
                    }
                    return updates;
                });
                return { ...currentState, sessions: updatedSessions };
            });

            res.json(result);
        } catch (error) {
            console.error('Failed to start session:', error);
            res.status(500).json({ error: error.message || 'Failed to allocate port' });
        }
    };

    /**
     * POST /api/sessions/:id/stop
     * ttydプロセスを停止（アーカイブせず）
     * Body: { preserveTmux?: boolean } - trueならtmuxを残してttydのみ停止（PTYリーク修復用）
     */
    stop = async (req, res) => {
        const { id } = req.params;
        const { preserveTmux = false } = req.body || {};

        try {
            const stopped = await this.sessionManager.stopTtyd(id, { preserveTmux });

            if (stopped) {
                // preserveTmux=true は「ttydだけ再起動」用途なので intendedState は変えない
                if (!preserveTmux) {
                    const now = new Date().toISOString();
                    await this._updateStateWithRetry((currentState) => {
                        const updatedSessions = (currentState.sessions || []).map(session =>
                            session.id === id
                                ? { ...session, intendedState: 'paused', pausedAt: now, updatedAt: now }
                                : session
                        );
                        return { ...currentState, sessions: updatedSessions };
                    });
                }

                res.json({ success: true });
            } else {
                res.status(404).json({ error: 'Session not found or already stopped' });
            }
        } catch (error) {
            console.error(`[stop] Error stopping session ${id}:`, error);
            res.status(500).json({ error: 'Failed to stop session', detail: error.message });
        }
    };

    /**
     * POST /api/sessions/:id/archive
     * セッションをアーカイブ（workspace統合チェック、ttyd停止、状態更新）
     */
    archive = async (req, res) => {
        const { id } = req.params;
        const { skipMergeCheck } = req.body;

        try {
            const state = this.stateStore.get();
            const session = state.sessions?.find(s => s.id === id);

            if (!session) {
                return res.status(404).json({ error: 'Session not found' });
            }

            // Check if workspace needs integration (Jujutsu: push needed)
            if (session.worktree?.repo && !skipMergeCheck) {
                const status = await this.worktreeService.getStatus(
                    id,
                    session.worktree.repo,
                    session.worktree.startCommit || null
                );
                if (status.needsIntegration || status.needsMerge) {
                    return res.json({
                        needsConfirmation: true,
                        status,
                        message: 'Workspace has changes not pushed to remote'
                    });
                }
            }

            // Stop ttyd process first (release port)
            try {
                await this.sessionManager.stopTtyd(id);
            } catch (ttydError) {
                console.error(`[archive] Failed to stop ttyd for ${id}:`, ttydError.message);
            }

            // Archive: Update intendedState to archived (リトライ付き)
            await this._updateStateWithRetry((currentState) => {
                const updatedSessions = currentState.sessions.map(s =>
                    s.id === id ? { ...s, intendedState: 'archived', archivedAt: new Date().toISOString() } : s
                );
                return { ...currentState, sessions: updatedSessions };
            });

            res.json({ success: true });
        } catch (error) {
            console.error(`[archive] Error archiving session ${id}:`, error);
            res.status(500).json({ error: 'Failed to archive session', detail: error.message });
        }
    };

    /**
     * POST /api/sessions/:id/restore
     * アーカイブされたセッションを復元（worktree再作成、ttyd起動）
     */
    restore = async (req, res) => {
        const { id } = req.params;
        const { engine: requestEngine } = req.body;

        const state = this.stateStore.get();
        const session = state.sessions?.find(s => s.id === id);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (session.intendedState !== 'archived') {
            return res.status(400).json({ error: 'Session is not archived' });
        }

        // リクエストで指定されたengine > セッションに保存されたengine > デフォルトclaude
        const engine = requestEngine || session.engine || 'claude';

        try {
            // Restore worktree if it existed
            if (session.worktree?.repo) {
                const worktreeResult = await this.worktreeService.create(id, session.worktree.repo);
                if (!worktreeResult) {
                    return res.status(500).json({
                        error: 'Failed to restore worktree',
                        detail: 'worktreeService.create returned null'
                    });
                }
            }

            // セッション復元時に'done'ステータスをクリア
            this.sessionManager.clearDoneStatus(id);

            // Start ttyd session
            const cwd = session.worktree?.path || session.cwd;
            const result = await this.sessionManager.startTtyd({
                sessionId: id,
                cwd,
                initialCommand: session.initialCommand,
                engine
            });

            // Update state to active (archivedAt も除去、engine も反映)（リトライ付き）
            await this._updateStateWithRetry((currentState) => {
                const updatedSessions = currentState.sessions.map(s => {
                    if (s.id !== id) return s;
                    const { archivedAt, ...rest } = s;
                    return { ...rest, intendedState: 'active', engine };
                });
                return { ...currentState, sessions: updatedSessions };
            });

            res.json({
                success: true,
                port: result.port,
                proxyPath: result.proxyPath
            });
        } catch (error) {
            console.error('Failed to restore session:', error);
            res.status(500).json({ error: error.message });
        }
    };

    // ========================================
    // Terminal I/O
    // ========================================

    /**
     * POST /api/sessions/:id/input
     * ターミナルに入力を送信
     */
    sendInput = async (req, res) => {
        const { id } = req.params;
        const { input, type } = req.body;

        try {
            await this.sessionManager.sendInput(id, input, type);
            res.json({ success: true });
        } catch (err) {
            console.error(`Failed to send input to ${id}:`, err.message);
            res.status(500).json({ error: err.message || 'Failed to send input' });
        }
    };

    /**
     * GET /api/sessions/:id/content
     * ターミナルコンテンツ（履歴）を取得
     */
    getContent = async (req, res) => {
        const { id } = req.params;
        const lines = parseInt(req.query.lines) || 500;

        try {
            const content = await this.sessionManager.getContent(id, lines);
            res.json({ content });
        } catch (err) {
            res.status(500).json({ error: 'Failed to capture content' });
        }
    };

    /**
     * GET /api/sessions/:id/output
     * ターミナル出力と選択肢を取得
     */
    getOutput = async (req, res) => {
        const { id } = req.params;

        try {
            const result = await this.sessionManager.getOutput(id);
            res.json(result);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    };

    /**
     * POST /api/sessions/:id/scroll
     * tmux copy-mode scroll
     */
    scroll = async (req, res) => {
        const { id } = req.params;
        const { direction, steps } = req.body;

        try {
            await this.sessionManager.scrollSession(id, direction, steps);
            res.json({ success: true });
        } catch (err) {
            console.error(`Failed to scroll ${id}:`, err.message);
            res.status(500).json({ error: err.message || 'Failed to scroll' });
        }
    };

    /**
     * POST /api/sessions/:id/select_pane
     * tmux select-pane (U/D/L/R)
     */
    selectPane = async (req, res) => {
        const { id } = req.params;
        const { direction } = req.body;

        try {
            await this.sessionManager.selectPane(id, direction);
            res.json({ success: true });
        } catch (err) {
            console.error(`Failed to select pane for ${id}:`, err.message);
            res.status(500).json({ error: err.message || 'Failed to select pane' });
        }
    };

    /**
     * POST /api/sessions/:id/exit_copy_mode
     * tmux copy-mode exit
     */
    exitCopyMode = async (req, res) => {
        const { id } = req.params;

        try {
            await this.sessionManager.exitCopyMode(id);
            res.json({ success: true });
        } catch (err) {
            console.error(`Failed to exit copy mode for ${id}:`, err.message);
            res.status(500).json({ error: err.message || 'Failed to exit copy mode' });
        }
    };

    // ========================================
    // Worktree Operations
    // ========================================

    /**
     * POST /api/sessions/create-with-worktree
     * worktreeを作成してセッションを開始
     */
    createWithWorktree = async (req, res) => {
        const { sessionId, repoPath, name, initialCommand, engine = 'claude', project } = req.body;

        if (!sessionId || !repoPath) {
            return res.status(400).json({ error: 'sessionId and repoPath are required' });
        }

        // Validate engine
        if (!['claude', 'codex'].includes(engine)) {
            return res.status(400).json({ error: 'engine must be "claude" or "codex"' });
        }

        try {
            // Create worktree
            const worktreeResult = await this.worktreeService.create(sessionId, repoPath);

            if (!worktreeResult) {
                return res.status(500).json({ error: 'Failed to create worktree. Is this a git repository?' });
            }

            const { worktreePath, branchName } = worktreeResult;

            // セッション作成時に'done'ステータスをクリア
            this.sessionManager.clearDoneStatus(sessionId);

            // Update state BEFORE starting ttyd.
            // This allows ttyd start to persist pid/port and login_script.sh to resolve correct CWD.
            const now = new Date().toISOString();
            const newSession = {
                id: sessionId,
                name: name || sessionId,
                path: worktreePath,  // 追加: プロジェクト判定に必要
                project,
                worktree: {
                    repo: repoPath,
                    path: worktreePath,
                    branch: branchName,
                    startCommit: worktreeResult.startCommit
                },
                initialCommand,
                engine,
                intendedState: 'active',
                createdAt: now,
                updatedAt: now
            };

            await this._updateStateWithRetry((currentState) => ({
                ...currentState,
                sessions: [...(currentState.sessions || []).filter(s => s.id !== sessionId), newSession]
            }));

            let result;
            try {
                // Start ttyd session with worktree as cwd
                result = await this.sessionManager.startTtyd({
                    sessionId,
                    cwd: worktreePath,
                    initialCommand,
                    engine
                });
            } catch (error) {
                // Roll back state + workspace on failure (best-effort)
                try {
                    await this._updateStateWithRetry((currentState) => ({
                        ...currentState,
                        sessions: (currentState.sessions || []).filter(s => s.id !== sessionId)
                    }));
                } catch (rollbackError) {
                    console.error(`[createWithWorktree] Rollback failed:`, rollbackError);
                }
                this.worktreeService.remove(sessionId, repoPath).catch(() => {});
                throw error;
            }

            res.json({
                success: true,
                port: result.port,
                proxyPath: result.proxyPath,
                worktreePath,
                branchName
            });
        } catch (error) {
            console.error('Failed to create session with worktree:', error);
            res.status(500).json({ error: error.message });
        }
    };

    /**
     * GET /api/sessions/:id/worktree-status
     * worktree状態を取得
     */
    getWorktreeStatus = async (req, res) => {
        const { id } = req.params;

        // Get session from state
        const state = this.stateStore.get();
        const session = state.sessions?.find(s => s.id === id);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (!session.worktree?.repo) {
            return res.status(400).json({ error: 'Session does not have a worktree' });
        }

        try {
            const status = await this.worktreeService.getStatus(
                id,
                session.worktree.repo,
                session.worktree.startCommit || null
            );
            res.json(status);
        } catch (error) {
            console.error('Failed to get worktree status:', error);
            res.status(500).json({ error: error.message });
        }
    };

    /**
     * GET /api/sessions/:id/context
     * セッションの実行コンテキストを取得（UI表示用）
     */
    getContext = async (req, res) => {
        const { id } = req.params;
        const state = this.stateStore.get();
        const session = state.sessions?.find(s => s.id === id);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const repoPath = session.worktree?.repo || null;
        const workspacePath = session.worktree?.path || session.path || null;
        const fallbackRepoName = repoPath ? path.basename(repoPath) : null;
        const context = {
            sessionId: session.id,
            sessionName: session.name || null,
            engine: session.engine || null,
            repo: fallbackRepoName,
            repoPath,
            workspacePath,
            bookmark: session.id,
            dirty: false,
            changesNotPushed: 0,
            hasWorkingCopyChanges: false,
            bookmarkPushed: false,
            prStatus: session.merged ? 'merged' : 'none',
            prUrl: session.mergedPrUrl || null,
            merged: Boolean(session.merged),
            mergedAt: session.mergedAt || null,
            baseBranch: null
        };

        if (!repoPath) {
            return res.json(context);
        }

        try {
            const status = await this.worktreeService.getStatus(
                id,
                repoPath,
                session.worktree?.startCommit || null
            );

            const changesNotPushed = status.changesNotPushed || 0;
            const hasWorkingCopyChanges = Boolean(status.hasWorkingCopyChanges);
            const dirty = hasWorkingCopyChanges || changesNotPushed > 0;
            const prStatus = session.merged
                ? 'merged'
                : (changesNotPushed > 0 || status.bookmarkPushed ? 'open_or_pending' : 'none');

            res.json({
                ...context,
                repo: status.repoName || context.repo,
                bookmark: status.bookmarkName || context.bookmark,
                dirty,
                changesNotPushed,
                hasWorkingCopyChanges,
                bookmarkPushed: Boolean(status.bookmarkPushed),
                prStatus,
                baseBranch: status.mainBranch || null
            });
        } catch (error) {
            console.error('Failed to get session context:', error);
            res.json(context);
        }
    };

    /**
     * POST /api/sessions/:id/update-local-main
     * ローカルmainブランチを最新化
     */
    updateLocalMain = async (req, res) => {
        const { id } = req.params;
        const { autoStash = false } = req.body || {};

        // Get session from state
        const state = this.stateStore.get();
        const session = state.sessions?.find(s => s.id === id);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (!session.worktree?.repo) {
            return res.status(400).json({ error: 'Session does not have a worktree' });
        }

        try {
            const result = await this.worktreeService.updateLocalMain(session.worktree.repo, { autoStash });
            res.json(result);
        } catch (error) {
            console.error('Failed to update local main:', error);
            res.status(500).json({ error: error.message });
        }
    };

    /**
     * POST /api/sessions/:id/merge
     * worktreeをmainブランチにマージ
     */
    merge = async (req, res) => {
        const { id } = req.params;

        // Get session from state
        const state = this.stateStore.get();
        const session = state.sessions?.find(s => s.id === id);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (!session.worktree?.repo) {
            return res.status(400).json({ error: 'Session does not have a worktree' });
        }

        try {
            const result = await this.worktreeService.merge(id, session.worktree.repo, session.name);

            if (result.success) {
                const mergedAt = result.mergedAt || new Date().toISOString();
                // Update session to mark as merged (リトライ付き)
                await this._updateStateWithRetry((currentState) => {
                    const updatedSessions = (currentState.sessions || []).map(s =>
                        s.id === id
                            ? {
                                ...s,
                                merged: true,
                                mergedAt,
                                mergedPrUrl: result.prUrl || null
                            }
                            : s
                    );
                    return { ...currentState, sessions: updatedSessions };
                });
            }

            res.json(result);
        } catch (error) {
            console.error('Failed to merge worktree:', error);
            res.status(500).json({ error: error.message });
        }
    };

    /**
     * GET /api/sessions/:id/commit-log
     * コミットログを取得
     */
    getCommitLog = async (req, res) => {
        const { id } = req.params;
        const limit = parseInt(req.query.limit) || 50;

        const state = this.stateStore.get();
        const session = state.sessions?.find(s => s.id === id);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        try {
            let result;
            if (session.worktree?.repo) {
                result = await this.worktreeService.getCommitLog(
                    id,
                    session.worktree.repo,
                    limit
                );
            } else if (session.path) {
                result = await this.worktreeService.getCommitLogByPath(
                    session.path,
                    limit
                );
            } else {
                return res.status(400).json({ error: 'Session does not have a repository path' });
            }
            res.json(result);
        } catch (error) {
            console.error('Failed to get commit log:', error);
            res.status(500).json({ error: error.message });
        }
    };

    /**
     * POST /api/sessions/:id/commit-notify
     * コミット通知を受信（CLIから呼ばれる）
     */
    commitNotify = async (req, res) => {
        this._commitNotifyMap.set(req.params.id, Date.now());
        res.json({ ok: true });
    };

    /**
     * GET /api/sessions/:id/commit-notify
     * コミット通知のタイムスタンプを取得（フロントからポーリング）
     */
    getCommitNotify = async (req, res) => {
        const ts = this._commitNotifyMap.get(req.params.id) || 0;
        res.json({ lastNotify: ts });
    };

    /**
     * DELETE /api/sessions/:id/worktree
     * worktreeを削除
     */
    deleteWorktree = async (req, res) => {
        const { id } = req.params;

        // Get session from state
        const state = this.stateStore.get();
        const session = state.sessions?.find(s => s.id === id);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (!session.worktree?.repo) {
            return res.status(400).json({ error: 'Session does not have a worktree' });
        }

        try {
            const success = await this.worktreeService.remove(id, session.worktree.repo);

            if (success) {
                // Remove worktree info from session state (リトライ付き)
                await this._updateStateWithRetry((currentState) => {
                    const updatedSessions = currentState.sessions.map(s => {
                        if (s.id === id) {
                            const { worktree, ...rest } = s;
                            return rest;
                        }
                        return s;
                    });
                    return { ...currentState, sessions: updatedSessions };
                });

                res.json({ success: true });
            } else {
                res.status(500).json({ error: 'Failed to delete worktree' });
            }
        } catch (error) {
            console.error('Failed to delete worktree:', error);
            res.status(500).json({ error: error.message });
        }
    };

    // ========================================
    // Helper Methods
    // ========================================

    /**
     * Gitブランチ名を取得
     * @param {string} cwd - 作業ディレクトリ
     * @returns {Promise<string|null>}
     */
    async getGitBranch(cwd) {
        if (!cwd) {
            return null;
        }

        try {
            const { stdout } = await execAsync('git branch --show-current', { cwd });
            return stdout.trim() || 'main';
        } catch (error) {
            console.error('[SessionController] Failed to get git branch:', error);
            return null;
        }
    }
}
