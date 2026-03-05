/**
 * SessionController
 * セッション関連のHTTPリクエスト処理
 */
import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);
const MAX_TREE_DEPTH = 3;
const DEFAULT_TREE_DEPTH = 2;
const MAX_TREE_ENTRIES = 200;
const EXCLUDED_DIRS = new Set(['.git', '.jj', '.worktrees', 'node_modules']);

export class SessionController {
    constructor(sessionManager, worktreeService, stateStore) {
        this.sessionManager = sessionManager;
        this.worktreeService = worktreeService;
        this.stateStore = stateStore;
        this.progressMap = new Map();  // sessionId -> {phase, percent, message, timestamp}
        this._commitNotifyMap = new Map(); // sessionId -> timestamp
    }

    _parseTreeDepth(rawDepth) {
        const parsed = Number.parseInt(rawDepth, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TREE_DEPTH;
        return Math.min(parsed, MAX_TREE_DEPTH);
    }

    _normalizeRelativePath(rawPath) {
        if (typeof rawPath !== 'string' || rawPath === '') return '';
        if (rawPath.includes('\0')) {
            throw new Error('Invalid path');
        }
        const trimmed = rawPath.trim();
        if (trimmed.startsWith('/') || trimmed.startsWith('\\')) {
            throw new Error('Invalid path');
        }
        const normalized = trimmed.replace(/\\/g, '/').replace(/^\/+/, '');
        if (normalized.includes('..')) {
            throw new Error('Invalid path');
        }
        return normalized;
    }

    _isWithinRoot(rootPath, targetPath) {
        const relative = path.relative(rootPath, targetPath);
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    }

    async _hasVisibleChildren(absPath) {
        const children = await fs.readdir(absPath, { withFileTypes: true });
        return children.some((child) => {
            if (child.isDirectory()) {
                return !child.name.startsWith('.') && !EXCLUDED_DIRS.has(child.name);
            }
            return !child.name.startsWith('.');
        });
    }

    async _readTree(absPath, relativeBase, depth) {
        const entries = await fs.readdir(absPath, { withFileTypes: true });
        const visible = entries
            .filter((entry) => {
                if (entry.name.startsWith('.')) return false;
                if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) return false;
                return true;
            })
            .sort((a, b) => {
                if (a.isDirectory() !== b.isDirectory()) {
                    return a.isDirectory() ? -1 : 1;
                }
                return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            });

        const truncated = visible.length > MAX_TREE_ENTRIES;
        const selected = visible.slice(0, MAX_TREE_ENTRIES);
        const nodes = [];

        for (const entry of selected) {
            const relPath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                const childAbsPath = path.join(absPath, entry.name);
                let children;
                let hasChildren = false;

                if (depth > 1) {
                    const childResult = await this._readTree(childAbsPath, relPath, depth - 1);
                    children = childResult.nodes;
                    hasChildren = children.length > 0 || childResult.truncated;
                } else {
                    hasChildren = await this._hasVisibleChildren(childAbsPath);
                }

                nodes.push({
                    name: entry.name,
                    relativePath: relPath,
                    type: 'directory',
                    hasChildren,
                    ...(Array.isArray(children) && children.length > 0 ? { children } : {})
                });
                continue;
            }

            nodes.push({
                name: entry.name,
                relativePath: relPath,
                type: 'file',
                hasChildren: false
            });
        }

        return { nodes, truncated };
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
     * POST /api/sessions/:id/clear-done
     * セッションのdoneステータスをクリア（既読化）
     */
    clearDone = (req, res) => {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        this.sessionManager.clearDoneStatus(id);
        res.json({ success: true });
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

        const runtimeStatus = this.sessionManager.getRuntimeStatus(session);
        res.json({
            ...session,
            runtimeStatus
        });
    };

    /**
     * プログレス更新
     * @param {string} sessionId - セッションID
     * @param {string} phase - フェーズ名
     * @param {number} percent - 進捗率（0-100）
     * @param {string} message - メッセージ
     */
    _updateProgress(sessionId, phase, percent, message) {
        this.progressMap.set(sessionId, {
            phase,
            percent,
            message,
            timestamp: Date.now()
        });
    }

    /**
     * GET /api/sessions/:id/progress
     * プログレス取得（Long Polling）
     */
    getProgress = async (req, res) => {
        const { id } = req.params;
        const currentPercent = parseInt(req.query.current) || 0;

        const startTime = Date.now();
        const timeout = 30000;
        const interval = 100;

        const checkProgress = () => {
            const progress = this.progressMap.get(id);

            if (progress && progress.percent > currentPercent) {
                return res.json(progress);
            }

            if (progress && progress.percent >= 100) {
                this.progressMap.delete(id);
                return res.json(progress);
            }

            if (Date.now() - startTime > timeout) {
                return res.json({ phase: 'timeout', percent: currentPercent, message: 'Timeout' });
            }

            setTimeout(checkProgress, interval);
        };

        checkProgress();
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

        // アーカイブ済みセッションの起動を拒否（自動再接続による意図しない復活を防止）
        const currentState = this.stateStore.get();
        const targetSession = (currentState.sessions || []).find(s => s.id === sessionId);
        if (targetSession?.intendedState === 'archived') {
            console.log(`[start] Rejected: session ${sessionId} is archived`);
            return res.status(409).json({ error: 'Session is archived. Use restore to reactivate.' });
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

            // intendedState を active に更新（restore と同様）
            const currentState = this.stateStore.get();
            const updatedSessions = (currentState.sessions || []).map(session =>
                session.id === sessionId
                    ? { ...session, intendedState: 'active', updatedAt: new Date().toISOString() }
                    : session
            );
            await this.stateStore.update({
                ...currentState,
                sessions: updatedSessions
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

        const stopped = await this.sessionManager.stopTtyd(id, { preserveTmux });

        if (stopped) {
            // preserveTmux=true は「ttydだけ再起動」用途なので intendedState は変えない
            if (!preserveTmux) {
                const currentState = this.stateStore.get();
                const now = new Date().toISOString();
                const updatedSessions = (currentState.sessions || []).map(session =>
                    session.id === id
                        ? { ...session, intendedState: 'paused', pausedAt: now, updatedAt: now }
                        : session
                );

                await this.stateStore.update({
                    ...currentState,
                    sessions: updatedSessions
                });
            }

            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Session not found or already stopped' });
        }
    };

    /**
     * POST /api/sessions/:id/archive
     * セッションをアーカイブ（workspace統合チェック、ttyd停止、状態更新）
     */
    archive = async (req, res) => {
        const { id } = req.params;
        const { skipMergeCheck } = req.body;

        const state = this.stateStore.get();
        const session = state.sessions?.find(s => s.id === id);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Check if workspace needs integration (Jujutsu: push needed)
        if (session.worktree && !skipMergeCheck) {
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
        await this.sessionManager.stopTtyd(id);

        // Archive: Update intendedState to archived
        const updatedSessions = state.sessions.map(s =>
            s.id === id ? { ...s, intendedState: 'archived', archivedAt: new Date().toISOString() } : s
        );

        const newState = await this.stateStore.update({
            ...state,
            sessions: updatedSessions
        });

        res.json({ success: true, state: newState });
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
            if (session.worktree) {
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

            // Update state to active
            const updatedSessions = state.sessions.map(s =>
                s.id === id ? { ...s, intendedState: 'active' } : s
            );

            await this.stateStore.update({
                ...state,
                sessions: updatedSessions
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
            // skipFetchオプション（デフォルト: true）
            const skipFetch = req.body.skipFetch !== undefined ? req.body.skipFetch : true;

            this._updateProgress(sessionId, 'creating_workspace', 10, 'Workspace作成中...');

            // Create worktree
            const worktreeResult = await this.worktreeService.create(sessionId, repoPath, { skipFetch });

            if (!worktreeResult) {
                return res.status(500).json({ error: 'Failed to create worktree. Is this a git repository?' });
            }

            const { worktreePath, branchName } = worktreeResult;

            this._updateProgress(sessionId, 'setup_environment', 40, '環境セットアップ中...');

            // セッション作成時に'done'ステータスをクリア
            this.sessionManager.clearDoneStatus(sessionId);

            // Update state BEFORE starting ttyd.
            // This allows ttyd start to persist pid/port and login_script.sh to resolve correct CWD.
            const now = new Date().toISOString();
            const currentState = this.stateStore.get();
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

            this._updateProgress(sessionId, 'starting_terminal', 60, 'ターミナル起動中...');

            // state更新とttyd起動を並列実行
            const [stateResult, ttydResult] = await Promise.allSettled([
                this.stateStore.update({
                    ...currentState,
                    sessions: [...(currentState.sessions || []).filter(s => s.id !== sessionId), newSession]
                }),
                this.sessionManager.startTtyd({
                    sessionId,
                    cwd: worktreePath,
                    initialCommand,
                    engine
                })
            ]);

            // ttyd起動失敗時はロールバック
            if (ttydResult.status === 'rejected') {
                console.error('[createWithWorktree] ttyd start failed:', ttydResult.reason);
                const rollbackState = this.stateStore.get();
                await this.stateStore.update({
                    ...rollbackState,
                    sessions: (rollbackState.sessions || []).filter(s => s.id !== sessionId)
                });
                this.worktreeService.remove(sessionId, repoPath).catch(() => {});
                throw ttydResult.reason;
            }

            // state更新失敗時は警告のみ
            if (stateResult.status === 'rejected') {
                console.warn('[createWithWorktree] state update failed (session is usable):', stateResult.reason);
            }

            const result = ttydResult.value;

            this._updateProgress(sessionId, 'starting_claude', 80, 'Claude起動中...');

            this._updateProgress(sessionId, 'initializing', 90, '初期化中...');

            res.json({
                success: true,
                port: result.port,
                proxyPath: result.proxyPath,
                worktreePath,
                branchName
            });
        } catch (error) {
            this._updateProgress(sessionId, 'error', 0, error.message);
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

        if (!session.worktree) {
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
     * GET /api/sessions/:id/folder-tree
     * セッションワークスペースのフォルダツリーを取得
     */
    getFolderTree = async (req, res) => {
        const { id } = req.params;
        const rawPath = req.query.path || '';
        const depth = this._parseTreeDepth(req.query.depth);
        const state = this.stateStore.get();
        const session = state.sessions?.find((s) => s.id === id);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const rootPath = session.worktree?.path || session.path;
        if (!rootPath) {
            return res.status(400).json({ error: 'Session does not have workspace path' });
        }

        try {
            const relativePath = this._normalizeRelativePath(rawPath);
            const targetPath = path.resolve(rootPath, relativePath);

            if (!this._isWithinRoot(rootPath, targetPath)) {
                return res.status(400).json({ error: 'Invalid path: outside session workspace' });
            }

            const stat = await fs.stat(targetPath);
            if (!stat.isDirectory()) {
                return res.status(400).json({ error: 'Target path is not a directory' });
            }

            const { nodes, truncated } = await this._readTree(targetPath, relativePath, depth);
            res.json({
                sessionId: id,
                rootPath,
                baseRelativePath: relativePath,
                nodes,
                truncated,
                truncatedPath: truncated ? relativePath : null
            });
        } catch (error) {
            if (error.code === 'ENOENT') {
                return res.status(404).json({ error: 'Directory not found' });
            }
            if (error.message === 'Invalid path') {
                return res.status(400).json({ error: 'Invalid path' });
            }
            console.error('Failed to get folder tree:', error);
            res.status(500).json({ error: error.message || 'Failed to get folder tree' });
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

        if (!session.worktree) {
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

        if (!session.worktree) {
            return res.status(400).json({ error: 'Session does not have a worktree' });
        }

        try {
            const result = await this.worktreeService.merge(id, session.worktree.repo, session.name);

            if (result.success) {
                // Update session to mark as merged
                const updatedSessions = state.sessions.map(s =>
                    s.id === id ? { ...s, merged: true, mergedAt: new Date().toISOString() } : s
                );

                await this.stateStore.update({
                    ...state,
                    sessions: updatedSessions
                });
            }

            res.json(result);
        } catch (error) {
            console.error('Failed to merge worktree:', error);
            res.status(500).json({ error: error.message });
        }
    };

    /**
     * POST /api/sessions/:id/ask-ai-integration
     * AIに統合確認と対処を依頼
     */
    askAiIntegration = async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;

        const state = this.stateStore.get();
        const session = state.sessions?.find(s => s.id === id);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        try {
            // jj状態を取得
            const { execSync } = require('child_process');
            const workspacePath = session.worktree?.path || '/Users/ksato/workspace';

            const jjStatus = execSync('jj status', { cwd: workspacePath, encoding: 'utf-8' });
            const jjLog = execSync('jj log -r @ -r @- -r @-- --limit 5', { cwd: workspacePath, encoding: 'utf-8' });
            const jjBookmarks = execSync('jj bookmark list', { cwd: workspacePath, encoding: 'utf-8' });

            // Claude Codeに送信するメッセージを構築
            const message = `[システム自動送信]

ユーザーがアーカイブしようとしたが、以下の警告が出ました：

${status.changesNotPushed > 0 ? `- ${status.changesNotPushed}件のchangeがremoteにpushされてません` : ''}
${status.hasWorkingCopyChanges ? '- working copyに未完了のchangeがあります' : ''}
${!status.bookmarkPushed && status.bookmarkName ? `- bookmark '${status.bookmarkName}' はローカルのみに存在します` : ''}

現在の状態：
=== jj status ===
${jjStatus}

=== jj log ===
${jjLog}

=== jj bookmark list ===
${jjBookmarks}

セッション情報：
- session-id: ${id}
- プロジェクト: ${session.name || 'unson'}
- パス: ${workspacePath}

この状況を分析して、必要な対処（マージ、push、統合など）を実行してください。`;

            // メッセージをクリップボードにコピー（macOS）
            const { execSync: exec } = require('child_process');
            exec(`echo "${message.replace(/"/g, '\\"')}" | pbcopy`, { encoding: 'utf-8' });

            res.json({
                success: true,
                message: 'AIへの依頼内容をクリップボードにコピーしました。Claude Codeのチャット画面でペーストして送信してください。',
                clipboardContent: message
            });
        } catch (error) {
            console.error('Failed to ask AI for integration:', error);
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

        if (!session.worktree) {
            return res.status(400).json({ error: 'Session does not have a worktree' });
        }

        try {
            const result = await this.worktreeService.getCommitLog(
                id,
                session.worktree.repo,
                limit
            );
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

        if (!session.worktree) {
            return res.status(400).json({ error: 'Session does not have a worktree' });
        }

        try {
            const success = await this.worktreeService.remove(id, session.worktree.repo);

            if (success) {
                // Remove worktree info from session state
                const updatedSessions = state.sessions.map(s => {
                    if (s.id === id) {
                        const { worktree, ...rest } = s;
                        return rest;
                    }
                    return s;
                });

                await this.stateStore.update({
                    ...state,
                    sessions: updatedSessions
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
