/**
 * SessionManager
 * セッション管理とttyd/tmuxプロセス管理を担当
 */
import { spawn, execSync } from 'child_process';
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
            const sessions = state.sessions || [];
            if (sessions.length === 0) {
                console.log('[restoreActiveSessions] No sessions in state.json');
                return;
            }

            // intendedState === 'active' のセッションを抽出
            const activeSessions = sessions.filter(s => s.intendedState === 'active');
            console.log(`[restoreActiveSessions] Found ${activeSessions.length} active session(s) in state.json`);

            if (activeSessions.length === 0) {
                return;
            }

            // Collect tmux sessions once
            const { stdout: tmuxOut } = await this.execPromise(
                'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""'
            ).catch(() => ({ stdout: '' }));
            const tmuxSessions = new Set(tmuxOut.trim().split('\n').filter(Boolean));

            // Collect ttyd processes once
            const { stdout: psOut } = await this.execPromise('ps aux | grep ttyd | grep -v grep').catch(() => ({ stdout: '' }));
            const ttydLines = psOut.trim() ? psOut.trim().split('\n') : [];

            const ttydProcsBySessionId = new Map();
            for (const line of ttydLines) {
                const parts = line.trim().split(/\s+/);
                const pid = parseInt(parts[1], 10);
                if (!Number.isFinite(pid)) continue;

                const sessionMatch = line.match(/-b\s+\/console\/(session-\d+)/);
                const sessionId = sessionMatch ? sessionMatch[1] : null;
                if (!sessionId) continue;

                const portMatch = line.match(/-p\s+(\d+)/);
                const port = portMatch ? parseInt(portMatch[1], 10) : null;
                if (!Number.isFinite(port)) continue;

                const list = ttydProcsBySessionId.get(sessionId) || [];
                list.push({ pid, port, line });
                ttydProcsBySessionId.set(sessionId, list);
            }

            const pauseSessionIds = new Set();

            for (const session of activeSessions) {
                const sessionId = session.id;
                const engine = session.engine || 'claude';
                const initialCommand = session.initialCommand || '';
                const cwd = session.path || (session.worktree && session.worktree.path);

                const hasTmux = tmuxSessions.has(sessionId);
                const candidates = ttydProcsBySessionId.get(sessionId) || [];

                // If tmux is missing, don't auto-recreate. Pause + kill stray ttyd (prevents wrong log linkage).
                if (!hasTmux) {
                    if (candidates.length > 0) {
                        console.warn(`[restoreActiveSessions] TMUX missing for ${sessionId}. Killing ${candidates.length} ttyd process(es) and pausing session.`);
                        for (const proc of candidates) {
                            await this.execPromise(`kill ${proc.pid}`).catch(() => {});
                        }
                    } else {
                        console.warn(`[restoreActiveSessions] TMUX missing for ${sessionId}. Pausing session.`);
                    }
                    pauseSessionIds.add(sessionId);
                    this.activeSessions.delete(sessionId);
                    continue;
                }

                // Prefer persisted pid if it's still running.
                const persistedPid = session?.ttydProcess?.pid;
                const persistedPort = session?.ttydProcess?.port;

                let keep = null;
                if (Number.isFinite(persistedPid) && this._isProcessRunning(persistedPid)) {
                    const port = Number.isFinite(persistedPort)
                        ? persistedPort
                        : candidates.find(p => p.pid === persistedPid)?.port;
                    if (Number.isFinite(port)) {
                        keep = { pid: persistedPid, port };
                    }
                }

                // Otherwise, adopt from ps aux.
                if (!keep && candidates.length > 0) {
                    const running = candidates.filter(p => this._isProcessRunning(p.pid));
                    const pool = running.length > 0 ? running : candidates;
                    const chosen = pool.sort((a, b) => b.pid - a.pid)[0];
                    keep = { pid: chosen.pid, port: chosen.port };
                }

                if (keep && Number.isFinite(keep.pid) && Number.isFinite(keep.port)) {
                    this.activeSessions.set(sessionId, {
                        port: keep.port,
                        pid: keep.pid,
                        process: null
                    });

                    // Kill duplicates (best-effort)
                    for (const proc of candidates) {
                        if (proc.pid === keep.pid) continue;
                        console.warn(`[restoreActiveSessions] Duplicate ttyd for ${sessionId}: killing pid ${proc.pid} (keeping ${keep.pid})`);
                        await this.execPromise(`kill ${proc.pid}`).catch(() => {});
                    }

                    // Sync persisted ttydProcess when needed
                    if (session?.ttydProcess?.pid !== keep.pid || session?.ttydProcess?.port !== keep.port) {
                        await this._saveTtydProcessInfo(sessionId, { port: keep.port, pid: keep.pid, engine });
                    }

                    console.log(`[restoreActiveSessions] Restored session ${sessionId}: PID ${keep.pid}, Port ${keep.port}`);
                    continue;
                }

                // No running ttyd found: clear stale info then start a new ttyd attached to existing tmux.
                if (session.ttydProcess) {
                    await this._clearTtydProcessInfo(sessionId);
                }

                try {
                    // Use persisted port for reconnection stability (UI URLs stay valid)
                    const preferredPort = session?.ttydProcess?.port;
                    console.log(`[restoreActiveSessions] Reconnecting ttyd for ${sessionId} (preferredPort: ${preferredPort}, engine: ${engine})`);

                    await this._restartTtydForExistingTmux(sessionId, preferredPort, engine);
                    console.log(`[restoreActiveSessions] Successfully reconnected ttyd for ${sessionId}`);
                } catch (err) {
                    console.error(`[restoreActiveSessions] Failed to reconnect ttyd for ${sessionId}:`, err);
                }
            }

            if (pauseSessionIds.size > 0) {
                const now = new Date().toISOString();
                const currentState = this.stateStore.get();
                const updatedSessions = (currentState.sessions || []).map(session => {
                    if (!pauseSessionIds.has(session.id)) return session;
                    return {
                        ...session,
                        intendedState: 'paused',
                        pausedAt: now,
                        tmuxMissingAt: now,
                        ttydProcess: null,
                        updatedAt: now
                    };
                });
                await this.stateStore.update({ ...currentState, sessions: updatedSessions });
                console.warn(`[restoreActiveSessions] Paused ${pauseSessionIds.size} session(s) with missing TMUX`);
            }

            console.log(`[restoreActiveSessions] Total restored/started: ${this.activeSessions.size} session(s)`);

            // Update nextPort to avoid port conflicts with restored sessions
            // 既存セッションがUIポート帯でも、新規セッションは40000番台から開始
            const ports = Array.from(this.activeSessions.values())
                .map(s => s.port)
                .filter(p => Number.isFinite(p));

            if (ports.length > 0) {
                const maxPort = Math.max(40000, ...ports);
                this.nextPort = maxPort + 1;
                console.log(`[restoreActiveSessions] Updated nextPort to ${this.nextPort} (max existing port: ${maxPort})`);
            }

            // Best-effort: orphan/duplicate cleanup
            await this.cleanupOrphans();
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
            console.log('[cleanupOrphans] Checking for orphaned/duplicate ttyd processes...');

            // 1. 全てのttydプロセスを取得
            const { stdout } = await this.execPromise('ps aux | grep ttyd | grep -v grep').catch(() => ({ stdout: '' }));
            if (!stdout.trim()) {
                console.log('[cleanupOrphans] No ttyd processes found');
                return;
            }

            const lines = stdout.trim().split('\n');
            console.log(`[cleanupOrphans] Found ${lines.length} ttyd process(es)`);

            // 2. 保護対象: state.json の intendedState === 'active' または 'paused'
            const state = this.stateStore.get();
            const protectedSessionIds = new Set(
                (state.sessions || [])
                    .filter(s => s.intendedState === 'active' || s.intendedState === 'paused')
                    .map(s => s.id)
            );
            console.log(`[cleanupOrphans] Found ${protectedSessionIds.size} active/paused session(s) in state.json`);

            // 3. state.json / in-memory の正PIDマップ
            const statePidBySessionId = new Map();
            const stateEngineBySessionId = new Map();
            for (const session of state.sessions || []) {
                const pid = session?.ttydProcess?.pid;
                if (Number.isFinite(pid)) {
                    statePidBySessionId.set(session.id, pid);
                    stateEngineBySessionId.set(session.id, session.engine || session?.ttydProcess?.engine || 'claude');
                }
            }

            const activePidBySessionId = new Map();
            for (const [sessionId, sessionData] of this.activeSessions) {
                const pid = sessionData.process?.pid || sessionData.pid;
                if (Number.isFinite(pid)) {
                    activePidBySessionId.set(sessionId, pid);
                }
            }

            // 4. ttydプロセスを sessionId ごとにグループ化
            const procsBySessionId = new Map();
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parseInt(parts[1], 10);
                if (!Number.isFinite(pid)) continue;

                const sessionMatch = line.match(/-b\s+\/console\/(session-\d+)/);
                const sessionId = sessionMatch ? sessionMatch[1] : null;
                if (!sessionId) continue;

                const portMatch = line.match(/-p\s+(\d+)/);
                const port = portMatch ? parseInt(portMatch[1], 10) : null;

                const list = procsBySessionId.get(sessionId) || [];
                list.push({ pid, port, line });
                procsBySessionId.set(sessionId, list);
            }

            let killed = 0;

            // 5. 保護対象外は全kill
            for (const [sessionId, procs] of procsBySessionId.entries()) {
                if (protectedSessionIds.has(sessionId)) continue;

                for (const proc of procs) {
                    console.log(`[cleanupOrphans] Killing orphaned ttyd process: PID ${proc.pid} (sessionId: ${sessionId})`);
                    await this.execPromise(`kill ${proc.pid}`).catch(() => {});
                    killed++;
                }
                procsBySessionId.delete(sessionId);
            }

            // 6. 保護対象内の重複だけkill（正PIDは保持）
            for (const [sessionId, procs] of procsBySessionId.entries()) {
                if (procs.length <= 1) continue;

                const activePid = activePidBySessionId.get(sessionId);
                const statePid = statePidBySessionId.get(sessionId);

                const candidatePids = new Set(procs.map(p => p.pid));

                let keepPid = null;
                if (Number.isFinite(activePid) && candidatePids.has(activePid) && this._isProcessRunning(activePid)) {
                    keepPid = activePid;
                } else if (Number.isFinite(statePid) && candidatePids.has(statePid) && this._isProcessRunning(statePid)) {
                    keepPid = statePid;
                } else {
                    // Prefer the newest PID as a fallback.
                    keepPid = Math.max(...procs.map(p => p.pid));
                }

                console.warn(`[cleanupOrphans] Duplicate ttyd detected for ${sessionId}. Keeping pid=${keepPid}, killing ${procs.length - 1} process(es).`);

                for (const proc of procs) {
                    if (proc.pid === keepPid) continue;
                    console.log(`[cleanupOrphans] Killing duplicate ttyd process: PID ${proc.pid} (sessionId: ${sessionId})`);
                    await this.execPromise(`kill ${proc.pid}`).catch(() => {});
                    killed++;
                }

                // Best-effort: persist keepPid when state pid doesn't match.
                if (Number.isFinite(keepPid) && keepPid != statePid) {
                    const keepPort = procs.find(p => p.pid == keepPid)?.port;
                    if (Number.isFinite(keepPort)) {
                        const engine = stateEngineBySessionId.get(sessionId) || 'claude';
                        await this._saveTtydProcessInfo(sessionId, { port: keepPort, pid: keepPid, engine });
                    }
                }
            }

            console.log(`[cleanupOrphans] Cleaned up ${killed} orphaned/duplicate ttyd process(es)`);
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
     * @param {number} [options.preferredPort] - 優先ポート番号（再利用用）
     * @returns {Promise<{port: number, proxyPath: string}>}
     */
    async startTtyd({ sessionId, cwd, initialCommand, engine = 'claude', preferredPort }) {
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

        // Allocate port: prefer persisted port for reconnection stability
        let port;
        if (Number.isFinite(preferredPort) && preferredPort >= 40000) {
            // Try preferred port first (from state.json)
            port = await this.findFreePort(preferredPort);
            if (port !== preferredPort) {
                console.log(`[startTtyd] Preferred port ${preferredPort} in use, allocated ${port} instead`);
            }
        } else {
            port = await this.findFreePort(this.nextPort);
            this.nextPort = port + 1;
        }

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
            // Exit on disconnect to avoid PTY FD leaks accumulating inside long-lived ttyd processes.
            '-o',
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

        const fontFamily = process.platform === 'win32'
            ? 'Cascadia Code, Consolas, monospace'
            : (engine === 'codex' ? 'Menlo, Monaco, monospace' : 'Menlo');

        args.push(
            '-I', customIndexPath, // Custom HTML with keyboard shortcuts and mobile scroll support
            '-m', '1',                         // Max 1 client: prevent concurrent PTY allocation per session
            '-t', 'disableReconnect=true',   // Prevent PTY leak: disable ttyd built-in reconnect (brainbase TerminalReconnectManager handles it)
            '-t', 'disableLeaveAlert=true', // Disable "Leave site?" alert
            '-t', 'enableClipboard=true',   // Enable clipboard access for copy/paste
            '-t', 'fontSize=14',            // Readable font size for mobile
            '-t', `fontFamily=${fontFamily}`, // Engine/platform-specific monospace font
            '-t', 'scrollback=5000',        // Larger scrollback buffer
            '-t', 'scrollSensitivity=3',    // Touch scroll sensitivity for mobile
            bashPath,
            bashScriptPath,
            sessionId,
            initialCommand || '',
            engine
        );

        // Options for spawn (server-managed)
        const spawnOptions = {
            stdio: ['ignore', 'pipe', 'pipe'],  // stdin無視、stdout/stderrはpipe
            env: {
                ...process.env,  // Inherit parent process environment
                LANG: 'en_US.UTF-8',
                LC_ALL: 'en_US.UTF-8'
            }
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


        ttyd.stdout.on('data', (data) => {
            console.log(`[ttyd:${sessionId}] ${data}`);
        });

        ttyd.stderr.on('data', (data) => {
            console.error(`[ttyd:${sessionId}] ${data}`);
        });

        ttyd.on('error', (err) => {
            console.error(`Failed to start ttyd for ${sessionId}:`, err);
        });

        ttyd.on('exit', async (code, signal) => {
            console.log(`ttyd for ${sessionId} exited with code ${code}${signal ? ` signal ${signal}` : ''}`);

            // If a newer ttyd has been started for this session, ignore stale exits.
            const activeEntry = this.activeSessions.get(sessionId);
            const activePid = activeEntry?.process?.pid || activeEntry?.pid;
            if (activePid && ttyd.pid && activePid !== ttyd.pid) {
                console.log(`[ttyd:${sessionId}] Ignoring exit for stale pid ${ttyd.pid} (active pid ${activePid})`);
                return;
            }

            // Preserve tmux on ttyd exit. tmux lifecycle is managed explicitly (archive/delete/TTL).
            await this._clearTtydProcessInfoIfMatches(sessionId, ttyd.pid);
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
     * 既存のtmuxセッションにttydを再接続（サーバー再起動後の復旧用）
     * tmuxセッションは生きてるけどttydが落ちた場合に使用
     *
     * @param {string} sessionId - セッションID
     * @param {number} preferredPort - 優先ポート番号（state.jsonから）
     * @param {string} engine - エンジン（'claude' | 'codex'）
     * @returns {Promise<{port: number, proxyPath: string}>}
     */
    async _restartTtydForExistingTmux(sessionId, preferredPort, engine = 'claude') {
        // tmuxセッションの存在確認
        const tmuxRunning = await this._isTmuxSessionRunning(sessionId);
        if (!tmuxRunning) {
            throw new Error(`TMUX session ${sessionId} not found. Cannot reconnect ttyd.`);
        }

        console.log(`[_restartTtydForExistingTmux] Reconnecting ttyd to existing tmux: ${sessionId}`);

        // login_script.shは既存tmuxセッションを検出してattachする
        // initialCommandは空文字（既存セッションだから）
        return await this.startTtyd({
            sessionId,
            cwd: null,  // 既存セッションなのでCWD不要
            initialCommand: '',  // 初期コマンドなし
            engine,
            preferredPort
        });
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

            // ttydProcess情報をクリア (only if it still points to this pid)
            if (pid) {
                await this._clearTtydProcessInfoIfMatches(sessionId, pid);
            } else {
                await this._clearTtydProcessInfo(sessionId);
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
        // Input validation
        if (!sessionId || typeof sessionId !== 'string') {
            console.error('[Cleanup] Invalid sessionId:', sessionId);
            return;
        }

        console.log(`[Cleanup] Starting cleanup for session ${sessionId}...`);

        let processesKilled = 0;

        // 1. 先にPID取得（tmuxが生きているうちに）
        let panePids = [];
        try {
            const { stdout } = await this.execPromise(
                `tmux list-panes -s -t "${sessionId}" -F "#{pane_pid}" 2>/dev/null || echo ""`
            );
            if (stdout.trim()) {
                panePids = stdout.trim().split('\n').filter(p => p.trim());
                console.log(`[Cleanup] Collected ${panePids.length} pane PID(s) for ${sessionId}: ${panePids.join(', ')}`);
            }
        } catch (err) {
            console.log(`[Cleanup] Could not collect pane PIDs for ${sessionId}:`, err.message);
        }

        // 2. 子プロセスツリーを全て取得（pgrep -P で再帰的に）
        const allPids = new Set();
        for (const pid of panePids) {
            allPids.add(pid);
            try {
                const { stdout } = await this.execPromise(`pgrep -P ${pid} 2>/dev/null`);
                if (stdout.trim()) {
                    stdout.trim().split('\n').forEach(p => allPids.add(p.trim()));
                }
            } catch (_) {}
        }

        // 3. TMUXセッション削除
        try {
            await this.execPromise(`tmux kill-session -t "${sessionId}" 2>/dev/null`);
            console.log(`[Cleanup] TMUX session deleted: ${sessionId}`);
        } catch (err) {
            console.log(`[Cleanup] TMUX session ${sessionId} already deleted or not found`);
        }

        // 4. 収集したプロセスを全てkill（SIGTERM → 待機 → SIGKILL）
        if (allPids.size > 0) {
            console.log(`[Cleanup] Killing ${allPids.size} process(es) for ${sessionId}: ${[...allPids].join(', ')}`);
            for (const pid of allPids) {
                try {
                    await this.execPromise(`kill -TERM ${pid} 2>/dev/null`);
                } catch (_) {}
            }
            // SIGTERM後500ms待機
            await new Promise(resolve => setTimeout(resolve, 500));
            // まだ生きてるやつはSIGKILL
            for (const pid of allPids) {
                if (this._isProcessRunning(parseInt(pid))) {
                    try {
                        await this.execPromise(`kill -9 ${pid} 2>/dev/null`);
                        console.log(`[Cleanup] Force killed PID ${pid}`);
                    } catch (_) {}
                }
            }
            processesKilled = allPids.size;
        }

        console.log(`[Cleanup] Completed for ${sessionId} (Processes killed: ${processesKilled})`);
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
            const sessions = state.sessions || [];
            const hasSession = sessions.some(session => session.id === sessionId);
            if (!hasSession) {
                console.warn(`[ttydProcess] Skip save: session ${sessionId} not found in state`);
                return;
            }

            const updatedSessions = sessions.map(session =>
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
            const sessions = state.sessions || [];
            const updatedSessions = sessions.map(session =>
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
     * Phase 3: ttydProcess情報をstate.jsonからクリア（PID一致時のみ）
     * 重複ttydがいる状態でstaleプロセスがexitしても、正しいPIDを消さないためのガード。
     * @param {string} sessionId - セッションID
     * @param {number|undefined|null} pid - ttyd PID
     * @returns {Promise<boolean>} クリアしたらtrue
     */
    async _clearTtydProcessInfoIfMatches(sessionId, pid) {
        try {
            const state = this.stateStore.get();
            const sessions = state.sessions || [];

            let changed = false;
            const updatedSessions = sessions.map(session => {
                if (session.id !== sessionId) return session;
                if (!session.ttydProcess) return session;

                const currentPid = session.ttydProcess?.pid;
                // If both are valid pids and don't match, don't clear.
                if (Number.isFinite(currentPid) && Number.isFinite(pid) && currentPid !== pid) {
                    return session;
                }

                changed = true;
                return { ...session, ttydProcess: null };
            });

            if (!changed) return false;

            await this.stateStore.update({ ...state, sessions: updatedSessions });
            console.log(`[ttydProcess] Cleared for ${sessionId}${Number.isFinite(pid) ? ` (pid=${pid})` : ''}`);
            return true;
        } catch (err) {
            console.error(`[ttydProcess] Failed to clear for ${sessionId}:`, err.message);
            return false;
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
            // ゾンビ検出: psコマンドでプロセス状態を確認
            const status = execSync(`ps -o state= -p ${pid} 2>/dev/null`, { encoding: 'utf-8' }).trim();
            // 'Z' = zombie, 'Z+' = zombie (foreground)
            return !status.startsWith('Z');
        } catch (e) {
            return false;
        }
    }

    /**
     * tmuxセッションが存在するか確認
     * @param {string} sessionId - セッションID
     * @returns {Promise<boolean>} 存在すればtrue
     */
    async _isTmuxSessionRunning(sessionId) {
        try {
            await this.execPromise(`tmux has-session -t "${sessionId}" 2>/dev/null`);
            return true;
        } catch {
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

    /**
     * PTY Watchdog: 定期的にPTY使用状況を監視し、閾値超過時に警告
     * @param {number} intervalMs - 監視間隔（デフォルト: 600000ms = 10分）
     */
    startPtyWatchdog(intervalMs = 600000) {
        if (this._ptyWatchdogTimer) return;
        console.log(`[PTY Watchdog] Starting (interval: ${intervalMs / 1000}s)`);

        this._ptyWatchdogTimer = setInterval(async () => {
            try {
                // macOS: sysctl kern.tty.ptmx_max でPTY上限取得
                const { stdout: maxOut } = await this.execPromise('sysctl -n kern.tty.ptmx_max 2>/dev/null || echo 512');
                const maxPty = parseInt(maxOut.trim()) || 512;

                // 現在のPTY使用数
                const { stdout: countOut } = await this.execPromise('ls /dev/pty* 2>/dev/null | wc -l');
                const usedPty = parseInt(countOut.trim()) || 0;

                const usage = (usedPty / maxPty * 100).toFixed(1);
                const level = usedPty > maxPty * 0.8 ? 'CRITICAL' : usedPty > maxPty * 0.6 ? 'WARNING' : 'OK';

                console.log(`[PTY Watchdog] ${level}: ${usedPty}/${maxPty} PTYs used (${usage}%)`);

                if (level === 'CRITICAL') {
                    console.error(`[PTY Watchdog] CRITICAL: PTY usage at ${usage}%! Running orphan cleanup...`);
                    await this.cleanupOrphans();
                }
            } catch (err) {
                console.error('[PTY Watchdog] Error:', err.message);
            }
        }, intervalMs);
    }

    /**
     * PTY Watchdogを停止
     */
    stopPtyWatchdog() {
        if (this._ptyWatchdogTimer) {
            clearInterval(this._ptyWatchdogTimer);
            this._ptyWatchdogTimer = null;
            console.log('[PTY Watchdog] Stopped');
        }
    }

    /**
     * Graceful shutdown: 全セッションのリソースをクリーンアップ
     * server.jsのSIGTERM/SIGINTハンドラから呼ばれる
     */
    async cleanup() {
        this.stopPtyWatchdog();
        console.log('[SessionManager] Starting graceful cleanup (preserve tmux)...');
        const sessionIds = [...this.activeSessions.keys()];
        for (const sessionId of sessionIds) {
            console.log(`[SessionManager] Stopping ttyd for session: ${sessionId}`);
            await this.stopTtyd(sessionId, { preserveTmux: true });
        }
        console.log(`[SessionManager] Graceful cleanup complete (${sessionIds.length} session(s))`);
    }
}
