/**
 * SessionManager
 * セッション管理とttyd/tmuxプロセス管理を担当
 */
import { spawn } from 'child_process';
import net from 'net';
import path from 'path';
import { TerminalOutputParser } from './terminal-output-parser.js';

export class SessionManager {
    /**
     * @param {Object} options - 設定オプション
     * @param {string} options.serverDir - server.jsのディレクトリ（__dirname）
     * @param {Function} options.execPromise - util.promisify(exec)
     * @param {Object} options.stateStore - StateStoreインスタンス
     * @param {Object} options.worktreeService - WorktreeServiceインスタンス（Phase 2）
     */
    constructor({ serverDir, execPromise, stateStore, worktreeService }) {
        this.serverDir = serverDir;
        this.execPromise = execPromise;
        this.stateStore = stateStore;
        this.worktreeService = worktreeService;  // Phase 2: Worktree削除用

        // セッション状態
        this.activeSessions = new Map(); // sessionId -> { port, process }
        this.hookStatus = new Map(); // sessionId -> { status: 'working'|'done', timestamp }
        this.nextPort = 3001;

        // ターミナル出力パーサー
        this.outputParser = new TerminalOutputParser();

        // 許可されたキー
        this.ALLOWED_KEYS = ['M-Enter', 'C-c', 'C-d', 'C-l', 'Enter', 'Escape', 'Up', 'Down', 'Tab', 'S-Tab', 'BTab'];
    }

    /**
     * 永続化された状態からhookStatusを復元
     */
    async restoreHookStatus() {
        const state = this.stateStore.get();
        if (state.sessions) {
            state.sessions.forEach(session => {
                if (session.hookStatus) {
                    this.hookStatus.set(session.id, session.hookStatus);
                }
            });
        }
    }

    /**
     * 孤立したttydプロセスをクリーンアップ
     *
     * BUG FIX: 以前は`pkill ttyd`で全プロセスを殺していたが、
     * これはactiveセッションのttydも殺してしまう。
     *
     * 修正後: activeSessionsに登録されていないttydプロセスのみ殺す
     */
    async cleanupOrphans() {
        try {
            console.log('[cleanupOrphans] Checking for orphaned ttyd processes...');

            // 1. 全てのttydプロセスを取得
            const { stdout } = await this.execPromise('ps aux | grep ttyd | grep -v grep').catch(() => ({ stdout: '' }));
            if (!stdout.trim()) {
                console.log('[cleanupOrphans] No ttyd processes found');
                return;
            }

            const lines = stdout.trim().split('\n');
            console.log(`[cleanupOrphans] Found ${lines.length} ttyd process(es)`);

            // 2. activeSessionsのPIDを取得
            const activePids = new Set();
            for (const [sessionId, sessionData] of this.activeSessions) {
                if (sessionData.process && sessionData.process.pid) {
                    activePids.add(sessionData.process.pid);
                    console.log(`[cleanupOrphans] Active session ${sessionId}: PID ${sessionData.process.pid}`);
                }
            }

            // 3. 孤立したttydプロセスのみ殺す
            let orphansKilled = 0;
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parseInt(parts[1], 10);

                if (!activePids.has(pid)) {
                    console.log(`[cleanupOrphans] Killing orphaned ttyd process: PID ${pid}`);
                    await this.execPromise(`kill ${pid}`).catch(() => {});
                    orphansKilled++;
                } else {
                    console.log(`[cleanupOrphans] Keeping active ttyd process: PID ${pid}`);
                }
            }

            console.log(`[cleanupOrphans] Cleaned up ${orphansKilled} orphaned ttyd process(es)`);
        } catch (err) {
            console.error('[cleanupOrphans] Error:', err);
        }
    }

    /**
     * 空きポートを検索
     * @param {number} startPort - 検索開始ポート
     * @returns {Promise<number>} 空きポート番号
     */
    findFreePort(startPort) {
        return new Promise((resolve, reject) => {
            const server = net.createServer();
            server.listen(startPort, () => {
                server.close(() => resolve(startPort));
            });
            server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    resolve(this.findFreePort(startPort + 1));
                } else {
                    reject(err);
                }
            });
        });
    }

    /**
     * セッション状態を取得（Hook報告ベース）
     * @returns {Object} sessionId -> {isWorking, isDone}
     */
    getSessionStatus() {
        const status = {};

        // hookStatusでループ（ttyd停止後も'done'を保持するため）
        for (const [sessionId, hookData] of this.hookStatus) {
            let isWorking = false;
            let isDone = false;

            if (hookData.status === 'working') isWorking = true;
            else if (hookData.status === 'done') isDone = true;

            status[sessionId] = { isWorking, isDone };
        }

        return status;
    }

    /**
     * Activity報告を記録
     * @param {string} sessionId - セッションID
     * @param {string} status - ステータス（'working' | 'done'）
     */
    reportActivity(sessionId, status) {
        console.log(`[Hook] Received status update from ${sessionId}: ${status}`);
        const hookStatusData = {
            status,
            timestamp: Date.now()
        };

        this.hookStatus.set(sessionId, hookStatusData);

        // Update persisted state
        const currentState = this.stateStore.get();
        const updatedSessions = currentState.sessions.map(session =>
            session.id === sessionId ? { ...session, hookStatus: hookStatusData } : session
        );

        this.stateStore.update({
            ...currentState,
            sessions: updatedSessions
        });
    }

    /**
     * セッションの'done'ステータスをクリア（セッションが開かれたとき）
     * @param {string} sessionId - セッションID
     */
    clearDoneStatus(sessionId) {
        const hookData = this.hookStatus.get(sessionId);
        if (hookData && hookData.status === 'done') {
            this.hookStatus.delete(sessionId);

            // Update persisted state
            const currentState = this.stateStore.get();
            const updatedSessions = currentState.sessions.map(session => {
                if (session.id === sessionId) {
                    const { hookStatus, ...rest } = session;
                    return rest;
                }
                return session;
            });

            this.stateStore.update({
                ...currentState,
                sessions: updatedSessions
            });
        }
    }

    /**
     * セッションがアクティブかチェック
     * @param {string} sessionId - セッションID
     * @returns {boolean}
     */
    isActive(sessionId) {
        return this.activeSessions.has(sessionId);
    }

    /**
     * activeSessionsの参照を取得（ttyd proxyで使用）
     * @returns {Map} activeSessions Map
     */
    getActiveSessions() {
        return this.activeSessions;
    }

    /**
     * ttydプロセスを起動
     * @param {Object} options - 起動オプション
     * @param {string} options.sessionId - セッションID
     * @param {string} options.cwd - 作業ディレクトリ
     * @param {string} options.initialCommand - 初期コマンド
     * @param {string} options.engine - エンジン（'claude' | 'codex'）
     * @returns {Promise<{port: number, proxyPath: string}>}
     */
    async startTtyd({ sessionId, cwd, initialCommand, engine = 'claude' }) {
        // Validate engine
        if (!['claude', 'codex'].includes(engine)) {
            throw new Error('engine must be "claude" or "codex"');
        }

        // Check if already running
        if (this.activeSessions.has(sessionId)) {
            return {
                port: this.activeSessions.get(sessionId).port,
                proxyPath: `/console/${sessionId}`
            };
        }

        // Allocate new port
        const port = await this.findFreePort(this.nextPort);
        this.nextPort = port + 1;

        console.log(`Starting ttyd for session '${sessionId}' on port ${port} with engine '${engine}'...`);
        if (cwd) console.log(`Working directory: ${cwd}`);

        // Spawn ttyd with Base Path
        const scriptPath = path.join(this.serverDir, 'login_script.sh');
        const customIndexPath = path.join(this.serverDir, 'custom_ttyd_index.html');
        // IMPORTANT: ttyd base path must match the proxy route
        const basePath = `/console/${sessionId}`;

        const args = [
            '-p', port.toString(),
            '-W',
            '-b', basePath, // Set Base Path
            '-I', customIndexPath, // Custom HTML with keyboard shortcuts and mobile scroll support
            '-t', 'disableLeaveAlert=true', // Disable "Leave site?" alert
            '-t', 'enableClipboard=true',   // Enable clipboard access for copy/paste
            '-t', 'fontSize=14',            // Readable font size for mobile
            '-t', 'fontFamily=Menlo', // Use Menlo font (macOS default monospace with Japanese support)
            '-t', 'scrollback=5000',        // Larger scrollback buffer
            '-t', 'scrollSensitivity=3',    // Touch scroll sensitivity for mobile
            'bash',
            scriptPath,
            sessionId
        ];

        if (initialCommand) {
            args.push(initialCommand);
        } else {
            args.push(''); // Empty initial command
        }
        args.push(engine); // Add engine as 3rd argument

        // Options for spawn
        const spawnOptions = {
            stdio: 'pipe',
            env: {
                ...process.env,  // Inherit parent process environment
                LANG: 'en_US.UTF-8',
                LC_ALL: 'en_US.UTF-8'
            }
        };

        // Set CWD if provided
        if (cwd) {
            spawnOptions.cwd = cwd;
        }

        const ttyd = spawn('ttyd', args, spawnOptions);

        ttyd.stdout.on('data', (data) => {
            console.log(`[ttyd:${sessionId}] ${data}`);
        });

        ttyd.stderr.on('data', (data) => {
            console.error(`[ttyd:${sessionId}] ${data}`);
        });

        ttyd.on('error', (err) => {
            console.error(`Failed to start ttyd for ${sessionId}:`, err);
        });

        ttyd.on('exit', async (code) => {
            console.log(`ttyd for ${sessionId} exited with code ${code}`);

            // クリーンアップ: TMUXセッションとMCPプロセスを削除
            await this.cleanupSessionResources(sessionId);

            this.activeSessions.delete(sessionId);
        });

        this.activeSessions.set(sessionId, { port, process: ttyd });

        // Give ttyd a moment to bind to the port and verify it's still running
        await new Promise((resolve, reject) => {
            setTimeout(() => {
                if (this.activeSessions.has(sessionId)) {
                    resolve();
                } else {
                    reject(new Error('Session failed to start (process exited)'));
                }
            }, 500);
        });

        return { port, proxyPath: basePath };
    }

    /**
     * ttydプロセスを停止
     * @param {string} sessionId - セッションID
     * @returns {Promise<boolean>} 停止成功時true
     */
    async stopTtyd(sessionId) {
        if (this.activeSessions.has(sessionId)) {
            const sessionData = this.activeSessions.get(sessionId);
            console.log(`Stopping ttyd process for session ${sessionId} (port ${sessionData.port})`);

            try {
                sessionData.process.kill('SIGTERM');
                // Give it a moment to terminate gracefully
                await new Promise(resolve => setTimeout(resolve, 500));

                // Force kill if still running
                if (!sessionData.process.killed) {
                    sessionData.process.kill('SIGKILL');
                }
            } catch (err) {
                console.error(`Error killing ttyd process for ${sessionId}:`, err.message);
            }

            this.activeSessions.delete(sessionId);
            // hookStatusは保持（'done'ステータスを保持するため）
            // this.hookStatus.delete(sessionId);
            return true;
        }
        return false;
    }

    /**
     * セッションのリソースをクリーンアップ（TMUX + MCPプロセス）
     * @param {string} sessionId - セッションID
     */
    async cleanupSessionResources(sessionId) {
        console.log(`Cleaning up resources for session ${sessionId}...`);

        // 1. TMUXセッション削除
        try {
            await this.execPromise(`tmux kill-session -t "${sessionId}" 2>/dev/null`);
            console.log(`Deleted TMUX session: ${sessionId}`);
        } catch (err) {
            // エラーは無視（既に削除されている可能性がある）
        }

        // 2. TMUXペインのプロセスID取得 → 子プロセス（MCP含む）を強制終了
        try {
            const { stdout } = await this.execPromise(
                `tmux list-panes -s -t "${sessionId}" -F "#{pane_pid}" 2>/dev/null || echo ""`
            );

            if (stdout.trim()) {
                const panePids = stdout.trim().split('\n');
                for (const pid of panePids) {
                    // 子プロセス（MCP等）を終了
                    await this.execPromise(`pkill -TERM -P ${pid} 2>/dev/null`).catch(() => {});
                    // 親プロセスを終了
                    await this.execPromise(`kill -TERM ${pid} 2>/dev/null`).catch(() => {});
                }
                console.log(`Cleaned up ${panePids.length} pane processes for session ${sessionId}`);
            }
        } catch (err) {
            // エラーは無視（TMUXセッションが既に削除されている可能性がある）
        }
    }

    /**
     * Phase 2: Paused状態のセッションの24時間TTLクリーンアップ
     * 24時間以上経過したPausedセッションのTMUXを削除
     */
    async cleanupStalePausedSessions() {
        const state = this.stateStore.get();
        const now = Date.now();
        const PAUSED_TTL = 24 * 60 * 60 * 1000; // 24時間

        for (const session of state.sessions) {
            if (session.intendedState === 'paused' && session.pausedAt) {
                const pausedTime = new Date(session.pausedAt).getTime();

                if (now - pausedTime > PAUSED_TTL && !session.tmuxCleanedAt) {
                    // TMUX削除
                    try {
                        await this.execPromise(`tmux kill-session -t "${session.id}" 2>/dev/null`);
                        console.log(`[Cleanup] Deleted TMUX for paused session ${session.id} (24h TTL)`);
                    } catch (err) {
                        // エラーは無視（TMUXが既に削除されている可能性がある）
                    }

                    // state.json更新
                    const updatedSessions = state.sessions.map(s =>
                        s.id === session.id
                            ? { ...s, tmuxCleanedAt: new Date().toISOString() }
                            : s
                    );

                    await this.stateStore.update({ ...state, sessions: updatedSessions });
                    console.log(`[Cleanup] Marked TMUX cleaned for paused session ${session.id}`);
                }
            }
        }
    }

    /**
     * Phase 2: Archived状態のセッションの30日TTL自動削除
     * 30日以上経過したArchivedセッションを完全削除
     */
    async cleanupArchivedSessions() {
        const state = this.stateStore.get();
        const now = Date.now();
        const ARCHIVED_TTL = 30 * 24 * 60 * 60 * 1000; // 30日

        const sessionsToKeep = state.sessions.filter(session => {
            if (session.intendedState === 'archived' && session.archivedAt) {
                const archivedTime = new Date(session.archivedAt).getTime();

                if (now - archivedTime > ARCHIVED_TTL) {
                    console.log(`[Cleanup] Deleting archived session ${session.id} (30d TTL)`);

                    // Worktreeがあれば削除（非同期、エラー無視）
                    if (session.worktree && this.worktreeService) {
                        this.worktreeService.remove(session.id, session.worktree.repo).catch(() => {});
                    }

                    return false; // 削除対象
                }
            }
            return true; // 保持
        });

        if (sessionsToKeep.length < state.sessions.length) {
            await this.stateStore.update({ ...state, sessions: sessionsToKeep });
            const deletedCount = state.sessions.length - sessionsToKeep.length;
            console.log(`[Cleanup] Removed ${deletedCount} archived session(s) (30d TTL)`);
        }
    }

    /**
     * ターミナルに入力を送信
     * @param {string} sessionId - セッションID
     * @param {string} input - 入力内容
     * @param {string} type - 'key' | 'text'
     */
    async sendInput(sessionId, input, type) {
        if (!input) {
            throw new Error('Input required');
        }

        if (type === 'key') {
            if (!this.ALLOWED_KEYS.includes(input)) {
                throw new Error('Key not allowed');
            }
            await this.execPromise(`tmux send-keys -t "${sessionId}" ${input}`);
        } else if (type === 'text') {
            // Use -l for literal text (don't interpret special keys)
            // Escape double quotes in input
            const escaped = input.replace(/"/g, '\\"');
            await this.execPromise(`tmux send-keys -t "${sessionId}" -l "${escaped}"`);
        } else {
            throw new Error('Type must be key or text');
        }
    }

    /**
     * ターミナルコンテンツを取得（履歴）
     * @param {string} sessionId - セッションID
     * @param {number} lines - 取得行数（デフォルト: 500）
     * @returns {Promise<string>} ターミナルコンテンツ
     */
    async getContent(sessionId, lines = 500) {
        const { stdout } = await this.execPromise(`tmux capture-pane -t "${sessionId}" -p -S -${lines}`);
        return stdout;
    }

    /**
     * ターミナル出力と選択肢を取得
     * @param {string} sessionId - セッションID
     * @returns {Promise<{output: string, choices: Array, hasChoices: boolean}>}
     */
    async getOutput(sessionId) {
        // -S -100: 最後100行の履歴を取得（選択肢がスクロールで上に行っても検出可能）
        // -J: 行の継続を結合
        const { stdout } = await this.execPromise(`tmux capture-pane -t "${sessionId}" -p -J -S -100`);
        const choices = this.outputParser.detectChoices(stdout);

        return {
            output: stdout,
            choices: choices,
            hasChoices: choices.length > 0
        };
    }
}
