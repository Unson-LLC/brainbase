/**
 * SessionController
 * セッション関連のHTTPリクエスト処理
 */
import { ZepService } from '../services/zep-service.js';
import { ClaudeLogParser } from '../utils/claude-log-parser.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class SessionController {
    constructor(sessionManager, worktreeService, stateStore) {
        this.sessionManager = sessionManager;
        this.worktreeService = worktreeService;
        this.stateStore = stateStore;
        this.zepService = new ZepService();
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

    // ========================================
    // Process Management
    // ========================================

    /**
     * POST /api/sessions/start
     * ttydプロセスを起動 + ZEPセッション初期化
     */
    start = async (req, res) => {
        const { sessionId, initialCommand, cwd, engine = 'claude', userId = 'ksato' } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        try {
            // セッション開始時に'done'ステータスをクリア
            this.sessionManager.clearDoneStatus(sessionId);

            // ttydプロセス起動（既存）
            const result = await this.sessionManager.startTtyd({
                sessionId,
                cwd,
                initialCommand,
                engine
            });

            // ZEPセッション初期化（新規）
            try {
                const gitBranch = await this.getGitBranch(cwd);
                await this.zepService.initializeSession(sessionId, userId, {
                    engine,
                    cwd,
                    git_branch: gitBranch
                });
            } catch (zepError) {
                // ZEP初期化失敗時はログのみ出力（セッション起動自体は継続）
                console.error('[SessionController] ZEP initialization failed:', zepError);
            }

            res.json(result);
        } catch (error) {
            console.error('Failed to start session:', error);
            res.status(500).json({ error: error.message || 'Failed to allocate port' });
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
                project,
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
            const status = await this.worktreeService.getStatus(id, session.worktree.repo);
            res.json(status);
        } catch (error) {
            console.error('Failed to get worktree status:', error);
            res.status(500).json({ error: error.message });
        }
    };

    /**
     * POST /api/sessions/:id/update-local-main
     * ローカルmainブランチを最新化
     */
    updateLocalMain = async (req, res) => {
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
            const result = await this.worktreeService.updateLocalMain(session.worktree.repo);
            if (!result.success) {
                return res.status(400).json({ error: result.error || 'Failed to update local main' });
            }
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
    // ZEP Integration
    // ========================================

    /**
     * POST /api/sessions/save_to_zep
     * セッション終了時にZEPへ会話履歴を保存
     */
    saveToZep = async (req, res) => {
        const { brainbase_session_id, claude_session_uuid, jsonl_path } = req.body;

        if (!brainbase_session_id || !claude_session_uuid || !jsonl_path) {
            return res.status(400).json({
                error: 'brainbase_session_id, claude_session_uuid, and jsonl_path are required'
            });
        }

        try {
            console.log('[SessionController] Saving to ZEP:', {
                brainbase_session_id,
                claude_session_uuid,
                jsonl_path
            });

            // jsonlファイルから会話履歴を抽出
            const messages = await ClaudeLogParser.extractMessages(jsonl_path);

            // ZEPセッションを確定（brainbase:session-{timestamp} → brainbase:{CLAUDE_UUID}）
            const finalSessionId = await this.zepService.finalizeSession(
                brainbase_session_id,
                claude_session_uuid,
                messages
            );

            res.json({
                success: true,
                zep_session_id: finalSessionId,
                message_count: messages.length
            });
        } catch (error) {
            console.error('[SessionController] Failed to save to ZEP:', error);
            res.status(500).json({ error: error.message });
        }
    };

    /**
     * GET /api/sessions/zep/list
     * ZEPセッション一覧を取得
     */
    listZepSessions = async (req, res) => {
        const { userId = 'ksato' } = req.query;

        try {
            const sessions = await this.zepService.listSessions(userId);
            res.json(sessions);
        } catch (error) {
            console.error('[SessionController] Failed to list ZEP sessions:', error);
            res.status(500).json({ error: error.message });
        }
    };

    /**
     * GET /api/sessions/zep/:sessionId/memory
     * ZEPセッションのメモリを取得
     */
    getZepMemory = async (req, res) => {
        const { sessionId } = req.params;
        const { limit = 50 } = req.query;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        try {
            const memory = await this.zepService.getMemory(sessionId, parseInt(limit));
            res.json(memory);
        } catch (error) {
            console.error('[SessionController] Failed to get ZEP memory:', error);
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
