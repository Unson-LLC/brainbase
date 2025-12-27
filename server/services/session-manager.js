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
     */
    constructor({ serverDir, execPromise, stateStore }) {
        this.serverDir = serverDir;
        this.execPromise = execPromise;
        this.stateStore = stateStore;

        // セッション状態
        this.activeSessions = new Map(); // sessionId -> { port, process }
        this.hookStatus = new Map(); // sessionId -> { status: 'working'|'done', timestamp }
        this.nextPort = 3001;

        // ターミナル出力パーサー
        this.outputParser = new TerminalOutputParser();

        // 許可されたキー
        this.ALLOWED_KEYS = ['M-Enter', 'C-c', 'C-d', 'C-l', 'Enter', 'Escape', 'Up', 'Down', 'Tab'];
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
     */
    async cleanupOrphans() {
        try {
            console.log('Cleaning up orphaned ttyd processes...');
            await this.execPromise('pkill ttyd').catch(() => { }); // Ignore error if no processes found
        } catch (err) {
            console.error('Error cleaning up orphans:', err);
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

        ttyd.on('exit', (code) => {
            console.log(`ttyd for ${sessionId} exited with code ${code}`);
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
