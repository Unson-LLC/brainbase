import { promisify } from 'util';
import { exec } from 'child_process';
import { logger } from '../utils/logger.js';

/**
 * SessionController
 * セッション関連のHTTPリクエスト処理
 */
export class SessionController {
    constructor(sessionManager, worktreeService, stateStore) {
        this.sessionManager = sessionManager;
        this.worktreeService = worktreeService;
        this.stateStore = stateStore;
        this.execPromise = promisify(exec);
    }

    // ========================================
    // Activity & Status
    // ========================================

    /**
     * POST /api/sessions/report_activity
     * Hookからのactivity報告を受信
     */
    reportActivity = async (req, res) => {
        const { sessionId, status } = req.body;
        if (!sessionId || !status) {
            return res.status(400).json({ error: 'Missing sessionId or status' });
        }

        this.sessionManager.reportActivity(sessionId, status);
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

    // ========================================
    // Process Management
    // ========================================

    /**
     * POST /api/sessions/start
     * ttydプロセスを起動
     */
    start = async (req, res) => {
        const { sessionId, initialCommand, cwd, engine = 'claude' } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        try {
            // セッション開始時に'done'ステータスをクリア
            this.sessionManager.clearDoneStatus(sessionId);

            const result = await this.sessionManager.startTtyd({
                sessionId,
                cwd,
                initialCommand,
                engine
            });
            res.json(result);
        } catch (error) {
            logger.error('Failed to start session', { error, sessionId });
            res.status(500).json({ error: 'Failed to start session' });
        }
    };

    /**
     * POST /api/sessions/:id/stop
     * ttydプロセスを停止（アーカイブせず）
     */
    stop = async (req, res) => {
        const { id } = req.params;

        const stopped = await this.sessionManager.stopTtyd(id);

        if (stopped) {
            // Update intendedState to 'stopped'
            const currentState = this.stateStore.get();
            const updatedSessions = currentState.sessions.map(session =>
                session.id === id ? { ...session, intendedState: 'stopped' } : session
            );

            await this.stateStore.update({
                ...currentState,
                sessions: updatedSessions
            });

            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Session not found or already stopped' });
        }
    };

    /**
     * POST /api/sessions/:id/archive
     * セッションをアーカイブ（worktreeマージチェック、ttyd停止、状態更新）
     */
    archive = async (req, res) => {
        const { id } = req.params;
        const { skipMergeCheck } = req.body;

        const state = this.stateStore.get();
        const session = state.sessions?.find(s => s.id === id);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Check if worktree needs merge
        if (session.worktree && !skipMergeCheck) {
            const status = await this.worktreeService.getStatus(id, session.worktree.repo);
            if (status.needsMerge) {
                return res.json({
                    needsConfirmation: true,
                    status,
                    message: 'Session has unmerged changes'
                });
            }
        }

        // Stop ttyd process (includes TMUX + MCP cleanup via stopTtyd)
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
        const { engine = 'claude' } = req.body;

        const state = this.stateStore.get();
        const session = state.sessions?.find(s => s.id === id);

        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        if (session.intendedState !== 'archived') {
            return res.status(400).json({ error: 'Session is not archived' });
        }

        try {
            // Restore worktree if it existed
            if (session.worktree) {
                const worktreeResult = await this.worktreeService.create(id, session.worktree.repo);
                if (!worktreeResult) {
                    return res.status(500).json({ error: 'Failed to restore worktree' });
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
            logger.error('Failed to restore session', { error, sessionId: id });
            res.status(500).json({ error: 'Failed to restore session' });
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
            logger.error('Failed to send input', { error: err, sessionId: id });
            res.status(500).json({ error: 'Failed to send input' });
        }
    };

    /**
     * GET /api/sessions/:id/content
     * ターミナルコンテンツ（履歴）を取得
     */
    getContent = async (req, res) => {
        const { id } = req.params;

        // 入力検証: lines パラメータの範囲チェック
        const linesRaw = parseInt(req.query.lines);
        const lines = Number.isNaN(linesRaw) ? 500 : Math.min(Math.max(linesRaw, 1), 10000);

        try {
            const content = await this.sessionManager.getContent(id, lines);
            res.json({ content });
        } catch (err) {
            logger.error('Failed to capture content', { error: err, sessionId: id });
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

    // ========================================
    // Worktree Operations
    // ========================================

    /**
     * POST /api/sessions/create-with-worktree
     * worktreeを作成してセッションを開始
     */
    createWithWorktree = async (req, res) => {
        const { sessionId, repoPath, name, initialCommand, engine = 'claude' } = req.body;

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

            // Start ttyd session with worktree as cwd
            const result = await this.sessionManager.startTtyd({
                sessionId,
                cwd: worktreePath,
                initialCommand,
                engine
            });

            // Update state to include worktree info
            const currentState = this.stateStore.get();
            const newSession = {
                id: sessionId,
                name: name || sessionId,
                path: worktreePath,  // 追加: プロジェクト判定に必要
                worktree: {
                    repo: repoPath,
                    path: worktreePath,
                    branch: branchName
                },
                initialCommand,
                engine,
                intendedState: 'active',
                createdAt: new Date().toISOString()
            };

            await this.stateStore.update({
                ...currentState,
                sessions: [...(currentState.sessions || []), newSession]
            });

            res.json({
                success: true,
                port: result.port,
                proxyPath: result.proxyPath,
                worktreePath,
                branchName
            });
        } catch (error) {
            logger.error('Failed to create session with worktree', { error, sessionId, repoPath });
            res.status(500).json({ error: 'Failed to create session with worktree' });
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
            const status = await this.worktreeService.getStatus(id, session.worktree.repo);
            res.json(status);
        } catch (error) {
            logger.error('Failed to get worktree status', { error, sessionId: id });
            res.status(500).json({ error: 'Failed to get worktree status' });
        }
    };

    /**
     * POST /api/sessions/:id/fix-symlinks
     * worktreeのシンボリックリンクを修正
     */
    fixSymlinks = async (req, res) => {
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
            const result = await this.worktreeService.fixSymlinks(id, session.worktree.repo);
            res.json(result);
        } catch (error) {
            logger.error('Failed to fix symlinks', { error, sessionId: id });
            res.status(500).json({ error: 'Failed to fix symlinks' });
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
            logger.error('Failed to merge worktree', { error, sessionId: id });
            res.status(500).json({ error: 'Failed to merge worktree' });
        }
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
            logger.error('Failed to delete worktree', { error, sessionId: id });
            res.status(500).json({ error: 'Failed to delete worktree' });
        }
    };
}
