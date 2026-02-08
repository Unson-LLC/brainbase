/**
 * SessionManager
 * セッション管理とttyd/tmuxプロセス管理を担当
 */
import { spawn } from 'child_process';
import fs from 'fs';
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
     * @param {number|string} [options.uiPort] - UIサーバーのポート
     */
    constructor({ serverDir, execPromise, stateStore, worktreeService, uiPort }) {
        this.serverDir = serverDir;
        this.execPromise = execPromise;
        this.stateStore = stateStore;
        this.worktreeService = worktreeService;  // Phase 2: Worktree削除用
        this.uiPort = uiPort;

        // セッション状態
        this.activeSessions = new Map(); // sessionId -> { port, process }
        this.hookStatus = new Map(); // sessionId -> { status: 'working'|'done', timestamp }
        // ポート範囲を40000番台に設定（UIの31013/31014帯との競合回避）
        this.nextPort = 40000;

        // 起動準備完了フラグ
        this._isReady = false;
        this._readyResolver = null;
        this._readyPromise = new Promise((resolve) => {
            this._readyResolver = resolve;
        });

        // ターミナル出力パーサー
        this.outputParser = new TerminalOutputParser();

        // 許可されたキー
        this.ALLOWED_KEYS = ['M-Enter', 'C-c', 'C-d', 'C-l', 'C-u', 'Enter', 'Escape', 'Up', 'Down', 'Tab', 'S-Tab', 'BTab'];
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
     * Phase 3: activeセッションを復元
     * サーバー起動時にstate.jsonからintendedState === 'active'のセッションを復元し、
     * 既存のttydプロセスと紐付ける。
     *
     * 改善: state.jsonのttydProcess情報を優先使用
     * 1. ttydProcess情報がある場合 → プロセス存在確認 → activeSessionsに登録
     * 2. ttydProcess情報がない場合 → ps auxで検索（後方互換性）
     * 3. どちらでも見つからない場合 → 新規起動
     */
    async restoreActiveSessions() {
        try {
            console.log('[restoreActiveSessions] Restoring active sessions from state.json...');

            const state = this.stateStore.get();
            if (!state.sessions) {
                console.log('[restoreActiveSessions] No sessions in state.json');
                return;
            }

            // intendedState === 'active' のセッションを抽出
            const activeSessions = state.sessions.filter(s => s.intendedState === 'active');
            console.log(`[restoreActiveSessions] Found ${activeSessions.length} active session(s) in state.json`);

            if (activeSessions.length === 0) {
                return;
            }

            const restoredSessionIds = new Set();

            // Phase 3: state.jsonのttydProcess情報を使用して復旧
            const sessionsWithTtydProcess = activeSessions.filter(s => s.ttydProcess);
            console.log(`[restoreActiveSessions] Found ${sessionsWithTtydProcess.length} session(s) with ttydProcess info`);

            for (const session of sessionsWithTtydProcess) {
                const { port, pid } = session.ttydProcess;

                // プロセスが実際に存在するか確認
                if (this._isProcessRunning(pid)) {
                    // activeSessionsに登録（復旧時はprocessはnull）
                    this.activeSessions.set(session.id, {
                        port,
                        pid,
                        process: null  // 復旧時はChildProcessオブジェクトなし
                    });
                    restoredSessionIds.add(session.id);
                    console.log(`[restoreActiveSessions] Restored session ${session.id} from ttydProcess: PID ${pid}, Port ${port}`);
                } else {
                    console.log(`[restoreActiveSessions] Process ${pid} not running for ${session.id}, will restart`);
                    // ttydProcess情報をクリア
                    await this._clearTtydProcessInfo(session.id);
                }
            }

            // ttydProcess情報がないセッションに対して、従来のps aux検索（後方互換性）
            const sessionsWithoutTtydProcess = activeSessions.filter(s => !s.ttydProcess && !restoredSessionIds.has(s.id));
            if (sessionsWithoutTtydProcess.length > 0) {
                console.log(`[restoreActiveSessions] Checking ps aux for ${sessionsWithoutTtydProcess.length} session(s) without ttydProcess info...`);

                // 全ttydプロセスを取得
                const { stdout } = await this.execPromise('ps aux | grep ttyd | grep -v grep').catch(() => ({ stdout: '' }));

                if (stdout.trim()) {
                    const lines = stdout.trim().split('\n');
                    console.log(`[restoreActiveSessions] Found ${lines.length} ttyd process(es)`);

                    // 各ttydプロセスから sessionId と port を抽出
                    for (const line of lines) {
                        const parts = line.trim().split(/\s+/);
                        const pid = parseInt(parts[1], 10);

                        // コマンドライン全体を取得
                        const cmdLine = parts.slice(10).join(' ');

                        // -p PORT を抽出
                        const portMatch = cmdLine.match(/-p\s+(\d+)/);
                        const port = portMatch ? parseInt(portMatch[1], 10) : null;

                        // -b /console/SESSION_ID を抽出
                        const sessionMatch = cmdLine.match(/-b\s+\/console\/(session-\d+)/);
                        const sessionId = sessionMatch ? sessionMatch[1] : null;

                        if (!sessionId || !port) {
                            continue;
                        }

                        // state.jsonのactiveセッションに一致するか確認
                        const matchingSession = sessionsWithoutTtydProcess.find(s => s.id === sessionId);
                        if (matchingSession && !restoredSessionIds.has(sessionId)) {
                            this.activeSessions.set(sessionId, {
                                port,
                                pid,
                                process: null
                            });
                            restoredSessionIds.add(sessionId);
                            console.log(`[restoreActiveSessions] Restored session ${sessionId} from ps aux: PID ${pid}, Port ${port}`);

                            // 見つかったプロセス情報をstate.jsonに永続化
                            await this._saveTtydProcessInfo(sessionId, { port, pid, engine: matchingSession.engine || 'claude' });
                        }
                    }
                }
            }

            // ttydプロセスが見つからなかったactiveセッションに対してttydを起動
            const missingSessions = activeSessions.filter(s => !restoredSessionIds.has(s.id));
            if (missingSessions.length > 0) {
                console.log(`[restoreActiveSessions] Starting ttyd for ${missingSessions.length} session(s) without running process...`);

                for (const session of missingSessions) {
                    try {
                        const cwd = session.path || (session.worktree && session.worktree.path);
                        const engine = session.engine || 'claude';
                        const initialCommand = session.initialCommand || '';

                        console.log(`[restoreActiveSessions] Starting ttyd for ${session.id} (cwd: ${cwd}, engine: ${engine})`);

                        await this.startTtyd({
                            sessionId: session.id,
                            cwd,
                            initialCommand,
                            engine
                        });

                        console.log(`[restoreActiveSessions] Successfully started ttyd for ${session.id}`);
                    } catch (err) {
                        console.error(`[restoreActiveSessions] Failed to start ttyd for ${session.id}:`, err);
                    }
                }
            }

            console.log(`[restoreActiveSessions] Total restored/started: ${this.activeSessions.size} session(s)`);

            // Update nextPort to avoid port conflicts with restored sessions
            // 既存セッションがUIポート帯でも、新規セッションは40000番台から開始
            if (this.activeSessions.size > 0) {
                const maxPort = Math.max(
                    40000,
                    ...Array.from(this.activeSessions.values()).map(s => s.port)
                );
                this.nextPort = maxPort + 1;
                console.log(`[restoreActiveSessions] Updated nextPort to ${this.nextPort} (max existing port: ${maxPort})`);
            }
        } catch (err) {
            console.error('[restoreActiveSessions] Error:', err);
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

            // 3. state.json の intendedState === 'active' または 'paused' のセッションIDを取得
            // active: 通常のアクティブセッション
            // paused: 一時停止中だがttyd/tmux/Claudeプロセスが動いている可能性があるセッション
            // BUG FIX: 'paused'セッションのttydを孤立プロセスとして殺すと、
            // tmux/Claudeセッションが巻き添えで死ぬ。pausedも保護対象に含める。
            const state = this.stateStore.get();
            const activeSessionIds = new Set(
                state.sessions
                    .filter(s => s.intendedState === 'active' || s.intendedState === 'paused')
                    .map(s => s.id)
            );
            console.log(`[cleanupOrphans] Found ${activeSessionIds.size} active/paused session(s) in state.json`);

            // 4. 孤立したttydプロセスのみ殺す
            let orphansKilled = 0;
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parseInt(parts[1], 10);

                // 行全体からセッションIDを抽出
                const sessionMatch = line.match(/-b\s+\/console\/(session-\d+)/);
                const sessionId = sessionMatch ? sessionMatch[1] : null;

                // activePids にあるか、または activeSessionIds にあれば保護
                const isActive = activePids.has(pid) || (sessionId && activeSessionIds.has(sessionId));

                if (!isActive) {
                    console.log(`[cleanupOrphans] Killing orphaned ttyd process: PID ${pid} (sessionId: ${sessionId || 'unknown'})`);
                    await this.execPromise(`kill ${pid}`).catch(() => {});
                    orphansKilled++;
                } else {
                    console.log(`[cleanupOrphans] Keeping active ttyd process: PID ${pid} (sessionId: ${sessionId || 'unknown'})`);
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
            // ttydはIPv4で待ち受けるため、同じ条件で空きポート判定する
            server.listen({ port: startPort, host: '0.0.0.0' }, () => {
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
     * ハートビートタイムアウト: 10分以上working報告がなければisWorking=falseとする
     * @returns {Object} sessionId -> {isWorking, isDone}
     */
    getSessionStatus() {
        const status = {};
        const HEARTBEAT_TIMEOUT = 60 * 60 * 1000; // 60分
        const now = Date.now();

        // hookStatusでループ（ttyd停止後も'done'を保持するため）
        for (const [sessionId, hookData] of this.hookStatus) {
            const normalized = this._normalizeHookData(hookData);
            if (!normalized) continue;

            const hasWorking = normalized.lastWorkingAt > 0;
            const hasDone = normalized.lastDoneAt > 0;
            if (!hasWorking && !hasDone) continue;

            // タイムアウト判定: 最後のworking報告から10分経過したらisWorking: false
            const isStale = now - normalized.lastWorkingAt > HEARTBEAT_TIMEOUT;
            const isWorking = !isStale && normalized.lastWorkingAt > normalized.lastDoneAt;
            const isDone = !isWorking && (normalized.lastDoneAt > 0 || isStale);

            status[sessionId] = {
                isWorking,
                isDone,
                lastWorkingAt: normalized.lastWorkingAt,
                lastDoneAt: normalized.lastDoneAt,
                timestamp: normalized.timestamp
            };
        }

        return status;
    }

    /**
     * Activity報告を記録
     * @param {string} sessionId - セッションID
     * @param {string} status - ステータス（'working' | 'done'）
     * @param {number} reportedAt - 報告時刻（ms）
     */
    reportActivity(sessionId, status, reportedAt) {
        if (status !== 'working' && status !== 'done') {
            console.warn(`[Hook] Ignoring invalid status for ${sessionId}: ${status}`);
            return;
        }

        const timestamp = this._coerceTimestamp(reportedAt);
        console.log(`[Hook] Received status update from ${sessionId}: ${status} @ ${timestamp}`);

        const currentHookData = this._normalizeHookData(this.hookStatus.get(sessionId)) || {
            lastWorkingAt: 0,
            lastDoneAt: 0
        };

        let lastWorkingAt = currentHookData.lastWorkingAt;
        let lastDoneAt = currentHookData.lastDoneAt;

        if (status === 'working') {
            lastWorkingAt = Math.max(lastWorkingAt, timestamp);
        } else {
            lastDoneAt = Math.max(lastDoneAt, timestamp);
        }

        const effectiveStatus = lastWorkingAt > lastDoneAt ? 'working' : 'done';

        const hookStatusData = {
            status: effectiveStatus,
            timestamp,
            lastWorkingAt,
            lastDoneAt
        };

        this.hookStatus.set(sessionId, hookStatusData);

        // Update persisted state
        const currentState = this.stateStore.get();
        const updatedAt = new Date(timestamp).toISOString();
        const updatedSessions = currentState.sessions.map(session =>
            session.id === sessionId
                ? {
                    ...session,
                    hookStatus: hookStatusData,
                    updatedAt
                }
                : session
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
        const normalized = this._normalizeHookData(this.hookStatus.get(sessionId));
        if (normalized && normalized.lastDoneAt >= normalized.lastWorkingAt && normalized.lastDoneAt > 0) {
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

    _normalizeHookData(hookData) {
        if (!hookData) return null;

        const timestamp = Number.isFinite(hookData.timestamp) ? hookData.timestamp : 0;
        const status = hookData.status;
        const lastWorkingAt = Number.isFinite(hookData.lastWorkingAt)
            ? hookData.lastWorkingAt
            : status === 'working'
                ? timestamp
                : 0;
        const lastDoneAt = Number.isFinite(hookData.lastDoneAt)
            ? hookData.lastDoneAt
            : status === 'done'
                ? timestamp
                : 0;

        return {
            ...hookData,
            status,
            timestamp,
            lastWorkingAt,
            lastDoneAt
        };
    }

    _coerceTimestamp(value) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric > 0) {
            return numeric;
        }
        return Date.now();
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
     * 起動準備完了フラグを設定
     */
    markReady() {
        if (this._isReady) {
            return;
        }
        this._isReady = true;
        if (this._readyResolver) {
            this._readyResolver(true);
        }
    }

    /**
     * 起動準備完了かどうか
     * @returns {boolean}
     */
    isReady() {
        return this._isReady;
    }

    /**
     * 起動準備完了を待機
     * @param {number} timeoutMs - タイムアウト（ms）
     * @returns {Promise<boolean>} 準備完了ならtrue
     */
    async waitUntilReady(timeoutMs = 10000) {
        if (this._isReady) {
            return true;
        }

        return await Promise.race([
            this._readyPromise.then(() => true),
            new Promise(resolve => setTimeout(() => resolve(false), timeoutMs))
        ]);
    }

    /**
     * セッションのランタイム状態を取得
     * @param {Object} session - セッション情報
     * @returns {{ttydRunning: boolean, needsRestart: boolean}}
     */
    getRuntimeStatus(session) {
        const activeEntry = this.activeSessions.get(session.id);
        const activePid = activeEntry?.process?.pid || activeEntry?.pid;
        const persistedPid = session?.ttydProcess?.pid;
        const pidToCheck = activePid || persistedPid;
        const ttydRunning = pidToCheck ? this._isProcessRunning(pidToCheck) : false;
        const needsRestart = session.intendedState === 'active' && !ttydRunning;

        return {
            ttydRunning,
            needsRestart
        };
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
            const existing = this.activeSessions.get(sessionId);
            const pid = existing.process?.pid || existing.pid;
            if (pid && this._isProcessRunning(pid)) {
                return {
                    port: existing.port,
                    proxyPath: `/console/${sessionId}`
                };
            }
            // Process is dead but entry remains in map — clean up and proceed to new launch
            console.warn(`[startTtyd] Stale entry for ${sessionId}: pid ${pid} is dead. Cleaning up and relaunching.`);
            this.activeSessions.delete(sessionId);
        }

        // Allocate new port
        const port = await this.findFreePort(this.nextPort);
        this.nextPort = port + 1;

        console.log(`Starting ttyd for session '${sessionId}' on port ${port} with engine '${engine}'...`);
        if (cwd) console.log(`Working directory: ${cwd}`);

        // Spawn ttyd with Base Path
        const scriptPath = fs.existsSync(path.join(this.serverDir, 'scripts', 'login_script.sh'))
            ? path.join(this.serverDir, 'scripts', 'login_script.sh')
            : path.join(this.serverDir, 'login_script.sh');
        const customIndexPath = fs.existsSync(path.join(this.serverDir, 'public', 'ttyd', 'custom_ttyd_index.html'))
            ? path.join(this.serverDir, 'public', 'ttyd', 'custom_ttyd_index.html')
            : path.join(this.serverDir, 'custom_ttyd_index.html');
        // IMPORTANT: ttyd base path must match the proxy route
        const basePath = `/console/${sessionId}`;

        const resolveBashPath = () => {
            const envPath = process.env.BASH_PATH;
            if (envPath && fs.existsSync(envPath)) return envPath;

            if (process.platform === 'win32') {
                const candidates = [
                    'C:\\msys64\\usr\\bin\\bash.exe',
                    'C:\\Program Files\\Git\\bin\\bash.exe',
                    'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
                ];
                for (const candidate of candidates) {
                    if (fs.existsSync(candidate)) return candidate;
                }

                const userProfile = process.env.USERPROFILE;
                if (userProfile) {
                    const userGit = path.join(userProfile, 'AppData', 'Local', 'Programs', 'Git', 'bin', 'bash.exe');
                    if (fs.existsSync(userGit)) return userGit;
                }
            }

            return 'bash';
        };

        const bashPath = resolveBashPath();
        const toBashPath = (value) =>
            value
                .replace(/\\/g, '/')
                .replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`);
        const bashScriptPath = toBashPath(scriptPath);

        // Build ttyd arguments
        // Note: On Windows, -b (base-path) option doesn't work correctly, so we skip it
        // and handle path rewriting in the proxy instead
        const args = [
            '-p', port.toString(),
            '-W',
        ];

        // Only use base path on non-Windows platforms
        if (process.platform !== 'win32') {
            args.push('-b', basePath);
        }

        // On Windows, -w (working directory) is required to prevent crash
        // See: https://github.com/tsl0922/ttyd/issues/1292
        if (process.platform === 'win32') {
            const workingDir = cwd || 'C:/';
            args.push('-w', workingDir);
        }

        args.push(
            '-I', customIndexPath, // Custom HTML with keyboard shortcuts and mobile scroll support
            '-m', '1',                         // Max 1 client: prevent concurrent PTY allocation per session
            '-t', 'disableReconnect=true',   // Prevent PTY leak: disable ttyd built-in reconnect (brainbase TerminalReconnectManager handles it)
            '-t', 'disableLeaveAlert=true', // Disable "Leave site?" alert
            '-t', 'enableClipboard=true',   // Enable clipboard access for copy/paste
            '-t', 'fontSize=14',            // Readable font size for mobile
            '-t', `fontFamily=${process.platform === 'win32' ? 'Cascadia Code, Consolas, monospace' : 'Menlo'}`, // Platform-specific monospace font
            '-t', 'scrollback=5000',        // Larger scrollback buffer
            '-t', 'scrollSensitivity=3',    // Touch scroll sensitivity for mobile
            bashPath,
            bashScriptPath,
            sessionId,
            initialCommand || '',
            engine
        );

        // Options for spawn (detached: サーバー再起動後もttydが継続)
        const spawnOptions = {
            stdio: ['ignore', 'pipe', 'pipe'],  // stdin無視、stdout/stderrはpipe
            env: {
                ...process.env,  // Inherit parent process environment
                LANG: 'en_US.UTF-8',
                LC_ALL: 'en_US.UTF-8'
            },
            detached: true  // 親プロセスから切り離し
        };

        const resolvedUiPort = this.uiPort ?? process.env.BRAINBASE_PORT;
        if (resolvedUiPort) {
            spawnOptions.env.BRAINBASE_PORT = String(resolvedUiPort);
        }

        // Set CWD if provided
        if (cwd) {
            spawnOptions.cwd = cwd;
        }

        const resolveTtydPath = () => {
            const envPath = process.env.TTYD_PATH;
            if (envPath && fs.existsSync(envPath)) return envPath;

            if (process.platform === 'win32') {
                const userProfile = process.env.USERPROFILE;
                if (userProfile) {
                    const userTtyd = path.join(userProfile, 'bin', 'ttyd.exe');
                    if (fs.existsSync(userTtyd)) return userTtyd;
                }
            }

            return 'ttyd';
        };

        const ttydPath = resolveTtydPath();
        console.log(`[ttyd:${sessionId}] Command: ${ttydPath}`);
        console.log(`[ttyd:${sessionId}] Args: ${JSON.stringify(args)}`);
        console.log(`[ttyd:${sessionId}] CWD: ${spawnOptions.cwd || 'default'}`);
        const ttyd = spawn(ttydPath, args, spawnOptions);

        // 親プロセス終了時に子プロセスを待機しない
        ttyd.unref();

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

            // ttydProcess情報をクリア
            await this._clearTtydProcessInfo(sessionId);

            this.activeSessions.delete(sessionId);
        });

        // activeSessionsにpidも保存（復旧時の型統一のため）
        this.activeSessions.set(sessionId, { port, pid: ttyd.pid, process: ttyd });

        // state.jsonにttydProcess情報を永続化
        await this._saveTtydProcessInfo(sessionId, { port, pid: ttyd.pid, engine });

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
     * @param {Object} [options] - オプション
     * @param {boolean} [options.preserveTmux=false] - trueの場合、tmuxセッションを残してttydのみ再起動（PTYリーク修復用）
     * @returns {Promise<boolean>} 停止成功時true
     */
    async stopTtyd(sessionId, { preserveTmux = false } = {}) {
        if (this.activeSessions.has(sessionId)) {
            const sessionData = this.activeSessions.get(sessionId);
            // PIDを取得（新規起動時はprocess.pid、復旧時はpid直接）
            const pid = sessionData.process?.pid || sessionData.pid;
            console.log(`Stopping ttyd process for session ${sessionId} (port ${sessionData.port}, pid ${pid}, preserveTmux=${preserveTmux})`);

            if (pid) {
                try {
                    // PIDベースでkill（ChildProcessオブジェクトがなくても動作）
                    process.kill(pid, 'SIGTERM');
                    // Give it a moment to terminate gracefully
                    await new Promise(resolve => setTimeout(resolve, 500));

                    // プロセスがまだ存在するか確認
                    if (this._isProcessRunning(pid)) {
                        // Force kill if still running
                        process.kill(pid, 'SIGKILL');
                    }
                } catch (err) {
                    // ESRCH: プロセスが既に存在しない場合は正常
                    if (err.code !== 'ESRCH') {
                        console.error(`Error killing ttyd process for ${sessionId}:`, err.message);
                    }
                }
            }

            // Cleanup TMUX session and MCP processes (skip if preserveTmux)
            if (!preserveTmux) {
                await this.cleanupSessionResources(sessionId);
            } else {
                console.log(`[stopTtyd] Preserving TMUX session for ${sessionId} (ttyd-only restart)`);
            }

            // ttydProcess情報をクリア
            await this._clearTtydProcessInfo(sessionId);

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
        // Input validation
        if (!sessionId || typeof sessionId !== 'string') {
            console.error('[Cleanup] Invalid sessionId:', sessionId);
            return;
        }

        console.log(`[Cleanup] Starting cleanup for session ${sessionId}...`);

        let tmuxDeleted = false;
        let processesKilled = 0;

        // 1. TMUXセッション削除
        try {
            await this.execPromise(`tmux kill-session -t "${sessionId}" 2>/dev/null`);
            tmuxDeleted = true;
            console.log(`[Cleanup] ✅ TMUX session deleted: ${sessionId}`);
        } catch (err) {
            console.log(`[Cleanup] ⚠️ TMUX session ${sessionId} already deleted or not found`);
        }

        // 2. TMUXペインのプロセスID取得 → 子プロセス（MCP含む）を強制終了
        try {
            const { stdout } = await this.execPromise(
                `tmux list-panes -s -t "${sessionId}" -F "#{pane_pid}" 2>/dev/null || echo ""`
            );

            if (stdout.trim()) {
                const panePids = stdout.trim().split('\n');
                console.log(`[Cleanup] Found ${panePids.length} pane process(es) for ${sessionId}`);

                for (const pid of panePids) {
                    // 子プロセス（MCP等）を終了
                    await this.execPromise(`pkill -TERM -P ${pid} 2>/dev/null`).catch(() => {});
                    // 親プロセスを終了
                    await this.execPromise(`kill -TERM ${pid} 2>/dev/null`).catch(() => {});
                    processesKilled++;
                }
                console.log(`[Cleanup] ✅ Killed ${processesKilled} pane processes for ${sessionId}`);
            } else {
                console.log(`[Cleanup] ⚠️ No pane processes found for ${sessionId}`);
            }
        } catch (err) {
            console.log(`[Cleanup] ⚠️ Error cleaning up pane processes for ${sessionId}:`, err.message);
        }

        console.log(`[Cleanup] Completed for ${sessionId} (TMUX: ${tmuxDeleted ? '✅' : '⚠️'}, Processes: ${processesKilled})`);
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
     * Phase 3: ttydProcess情報をstate.jsonに永続化
     * @param {string} sessionId - セッションID
     * @param {Object} processInfo - { port, pid, engine }
     */
    async _saveTtydProcessInfo(sessionId, { port, pid, engine }) {
        try {
            const state = this.stateStore.get();
            const updatedSessions = state.sessions.map(session =>
                session.id === sessionId
                    ? {
                        ...session,
                        ttydProcess: {
                            port,
                            pid,
                            startedAt: new Date().toISOString(),
                            engine: engine || 'claude'
                        }
                    }
                    : session
            );
            await this.stateStore.update({ ...state, sessions: updatedSessions });
            console.log(`[ttydProcess] Saved for ${sessionId}: port=${port}, pid=${pid}`);
        } catch (err) {
            console.error(`[ttydProcess] Failed to save for ${sessionId}:`, err.message);
        }
    }

    /**
     * Phase 3: ttydProcess情報をstate.jsonからクリア
     * @param {string} sessionId - セッションID
     */
    async _clearTtydProcessInfo(sessionId) {
        try {
            const state = this.stateStore.get();
            const updatedSessions = state.sessions.map(session =>
                session.id === sessionId
                    ? { ...session, ttydProcess: null }
                    : session
            );
            await this.stateStore.update({ ...state, sessions: updatedSessions });
            console.log(`[ttydProcess] Cleared for ${sessionId}`);
        } catch (err) {
            console.error(`[ttydProcess] Failed to clear for ${sessionId}:`, err.message);
        }
    }

    /**
     * Phase 3: プロセスが実行中かどうかを確認
     * @param {number} pid - プロセスID
     * @returns {boolean} 実行中ならtrue
     */
    _isProcessRunning(pid) {
        try {
            process.kill(pid, 0);  // シグナル0 = 存在確認のみ
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * tmux copy-mode scroll
     * @param {string} sessionId - セッションID
     * @param {string} direction - 'up' | 'down'
     * @param {number} steps - スクロール量
     */
    async scrollSession(sessionId, direction, steps = 1) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const dir = direction === 'down' ? 'scroll-down' : direction === 'up' ? 'scroll-up' : null;
        if (!dir) {
            throw new Error('Invalid scroll direction');
        }

        const count = Math.min(10, Math.max(1, Number(steps) || 1));
        const target = sessionId.replace(/"/g, '\\"');
        const cmd = `tmux if-shell -F '#{pane_in_mode}' "send-keys -t \\"${target}\\" -X -N ${count} ${dir}" "copy-mode -t \\"${target}\\"; send-keys -t \\"${target}\\" -X -N ${count} ${dir}"`;

        await this.execPromise(cmd);
    }

    /**
     * tmux select-pane
     * @param {string} sessionId - セッションID
     * @param {string} direction - U/D/L/R
     */
    async selectPane(sessionId, direction) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const validDirections = ['U', 'D', 'L', 'R'];
        if (!validDirections.includes(direction)) {
            throw new Error('Invalid direction. Must be U, D, L, or R');
        }

        const target = sessionId.replace(/"/g, '\\"');
        await this.execPromise(`tmux select-pane -t "${target}" -${direction}`);
    }

    /**
     * tmux copy-mode exit
     * @param {string} sessionId - セッションID
     */
    async exitCopyMode(sessionId) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const target = sessionId.replace(/"/g, '\\"');
        const cmd = `tmux if-shell -F '#{pane_in_mode}' "send-keys -t \\\"${target}\\\" -X cancel" ""`;

        await this.execPromise(cmd);
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

        // DEBUG: ログ出力
        console.log(`[session-manager] sendInput: sessionId="${sessionId}", type="${type}", input="${input}"`);

        if (type === 'key') {
            if (!this.ALLOWED_KEYS.includes(input)) {
                throw new Error('Key not allowed');
            }
            const cmd = `tmux send-keys -t "${sessionId}" ${input}`;
            console.log(`[session-manager] Executing: ${cmd}`);
            await this.execPromise(cmd);
        } else if (type === 'text') {
            // Use -l for literal text (don't interpret special keys)
            // Escape double quotes in input
            const escaped = input.replace(/"/g, '\\"');
            const cmd = `tmux send-keys -t "${sessionId}" -l "${escaped}"`;
            console.log(`[session-manager] Executing: ${cmd}`);
            await this.execPromise(cmd);
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
