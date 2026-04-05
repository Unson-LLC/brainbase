import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { gracefulCleanup } from '../../lib/graceful-cleanup.js';

export const runtimeLifecycleMethods = {
    async ensureSessionRuntime({ sessionId, cwd, initialCommand, engine = 'claude' }) {
        if (!sessionId || typeof sessionId !== 'string') {
            throw new Error('sessionId is required');
        }
        if (!['claude', 'codex'].includes(engine)) {
            throw new Error('engine must be "claude" or "codex"');
        }

        if (await this._isTmuxSessionRunning(sessionId)) {
            return { startedExisting: true };
        }

        if (cwd && (cwd === '/tmp' || cwd.startsWith('/tmp/') || cwd === '/private/tmp' || cwd.startsWith('/private/tmp/'))) {
            logger.warn(`[runtime] Rejecting ephemeral cwd: ${cwd}`);
            cwd = null;
        }
        if (cwd && !fs.existsSync(cwd)) {
            throw new Error(`Working directory does not exist: ${cwd}`);
        }

        const scriptPath = this._resolveScriptPath('ensure_session_runtime.sh');
        const spawnOptions = {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                LANG: 'en_US.UTF-8',
                LC_ALL: 'en_US.UTF-8'
            }
        };
        const resolvedUiPort = this.uiPort ?? process.env.BRAINBASE_PORT;
        if (resolvedUiPort) {
            spawnOptions.env.BRAINBASE_PORT = String(resolvedUiPort);
        }
        if (cwd) {
            spawnOptions.cwd = cwd;
        }

        await new Promise((resolve, reject) => {
            const child = spawn('bash', [scriptPath, sessionId, initialCommand || '', engine], spawnOptions);
            let stderr = '';

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('error', reject);
            child.on('exit', (code) => {
                if (code === 0) {
                    resolve();
                    return;
                }
                reject(new Error(stderr.trim() || `ensure_session_runtime exited with code ${code}`));
            });
        });

        for (let attempt = 0; attempt < 20; attempt += 1) {
            if (await this._isTmuxSessionRunning(sessionId)) {
                return { startedExisting: false };
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        throw new Error(`tmux session did not become ready: ${sessionId}`);
    },

    async startTtyd({ sessionId, cwd, initialCommand, engine = 'claude', preferredPort, forceTtyd = false }) {
        await this.ensureSessionRuntime({ sessionId, cwd, initialCommand, engine });

        if (this._isXtermOnlyMode() && !forceTtyd) {
            logger.info(`[startTtyd] xterm-only mode: skipping ttyd for ${sessionId}`);
            return { port: null, proxyPath: null, startedExisting: false, xtermOnly: true };
        }

        if (this.startLocks.has(sessionId)) {
            logger.info(`[startTtyd] Lock active for ${sessionId}, waiting for existing start to complete`);
            return await this.startLocks.get(sessionId);
        }

        const promise = this._doStartTtyd({ sessionId, cwd, initialCommand, engine, preferredPort });
        this.startLocks.set(sessionId, promise);
        try {
            return await promise;
        } finally {
            this.startLocks.delete(sessionId);
        }
    },

    async _doStartTtyd({ sessionId, cwd, initialCommand, engine = 'claude', preferredPort }) {
        if (!['claude', 'codex'].includes(engine)) {
            throw new Error('engine must be "claude" or "codex"');
        }

        if (this.activeSessions.has(sessionId)) {
            const existing = this.activeSessions.get(sessionId);
            const pid = existing.process?.pid || existing.pid;
            if (pid && this._isProcessRunning(pid)) {
                return {
                    port: existing.port,
                    proxyPath: `/console/${sessionId}`
                };
            }
            logger.warn(`[startTtyd] Stale entry for ${sessionId}: pid ${pid} is dead. Cleaning up and relaunching.`);
            this.activeSessions.delete(sessionId);
        }

        let port;
        if (Number.isFinite(preferredPort) && preferredPort >= 40000) {
            port = await this.findFreePort(preferredPort);
            if (port !== preferredPort) {
                logger.info(`[startTtyd] Preferred port ${preferredPort} in use, allocated ${port} instead`);
            }
        } else {
            port = await this.findFreePort(this.nextPort);
            this.nextPort = port + 1;
        }

        logger.info(`Starting ttyd for session '${sessionId}' on port ${port} with engine '${engine}'...`);
        if (cwd) logger.info(`Working directory: ${cwd}`);

        if (cwd && !fs.existsSync(cwd)) {
            throw new Error(`Working directory does not exist: ${cwd}`);
        }

        const scriptPath = this._resolveScriptPath('login_script.sh');
        const customIndexPath = fs.existsSync(path.join(this.serverDir, 'public', 'ttyd', 'custom_ttyd_index.html'))
            ? path.join(this.serverDir, 'public', 'ttyd', 'custom_ttyd_index.html')
            : path.join(this.serverDir, 'custom_ttyd_index.html');
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

        const args = [
            '-p', port.toString(),
            '-W',
            '-P', '3',
        ];

        if (process.platform !== 'win32') {
            args.push('-b', basePath);
        }

        if (process.platform === 'win32') {
            const workingDir = cwd || 'C:/';
            args.push('-w', workingDir);
        }

        const fontFamily = process.platform === 'win32'
            ? 'Cascadia Code, Consolas, monospace'
            : (engine === 'codex' ? 'Menlo, Monaco, monospace' : 'Menlo');

        args.push(
            '-I', customIndexPath,
            '-m', '1',
            '-t', 'disableReconnect=true',
            '-t', 'disableLeaveAlert=true',
            '-t', 'enableClipboard=true',
            '-t', 'fontSize=14',
            '-t', `fontFamily=${fontFamily}`,
            '-t', 'scrollback=5000',
            '-t', 'scrollSensitivity=3',
            bashPath,
            bashScriptPath,
            sessionId,
            initialCommand || '',
            engine
        );

        const spawnOptions = {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
                LANG: 'en_US.UTF-8',
                LC_ALL: 'en_US.UTF-8',
                TERM: 'tmux-256color'
            }
        };

        const resolvedUiPort = this.uiPort ?? process.env.BRAINBASE_PORT;
        if (resolvedUiPort) {
            spawnOptions.env.BRAINBASE_PORT = String(resolvedUiPort);
        }

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
        logger.info(`[ttyd:${sessionId}] Command: ${ttydPath}`);
        logger.info(`[ttyd:${sessionId}] Args: ${JSON.stringify(args)}`);
        logger.info(`[ttyd:${sessionId}] CWD: ${spawnOptions.cwd || 'default'}`);
        const ttyd = spawn(ttydPath, args, spawnOptions);

        ttyd.stdout.on('data', (data) => {
            logger.info(`[ttyd:${sessionId}] ${data}`);
        });

        ttyd.stderr.on('data', (data) => {
            logger.error(`[ttyd:${sessionId}] ${data}`);
        });

        ttyd.on('error', (err) => {
            logger.error(`Failed to start ttyd for ${sessionId}:`, err);
        });

        ttyd.on('exit', async (code, signal) => {
            logger.info(`ttyd for ${sessionId} exited with code ${code}${signal ? ` signal ${signal}` : ''}`);

            const activeEntry = this.activeSessions.get(sessionId);
            const activePid = activeEntry?.process?.pid || activeEntry?.pid;
            if (activePid && ttyd.pid && activePid !== ttyd.pid) {
                logger.info(`[ttyd:${sessionId}] Ignoring exit for stale pid ${ttyd.pid} (active pid ${activePid})`);
                return;
            }

            await this._clearTtydProcessInfoIfMatches(sessionId, ttyd.pid);
            this.activeSessions.delete(sessionId);
            this.releaseTerminalOwnership(sessionId, null, { force: true });
        });

        this.activeSessions.set(sessionId, { port, pid: ttyd.pid, process: ttyd });

        await this._saveTtydProcessInfo(sessionId, { port, pid: ttyd.pid, engine });

        await new Promise((resolve, reject) => {
            const minStableMs = 50;
            const timeoutMs = 200;
            const stableAt = Date.now() + minStableMs;
            const deadline = Date.now() + timeoutMs;

            const check = () => {
                if (!this.activeSessions.has(sessionId)) {
                    reject(new Error('Session failed to start (process exited)'));
                    return;
                }
                if (Date.now() >= stableAt) {
                    resolve();
                    return;
                }
                if (Date.now() >= deadline) {
                    reject(new Error('Session start verification timeout'));
                    return;
                }
                setTimeout(check, 25);
            };

            check();
        });

        try {
            await this.waitForTtydReady(port, 3000, 50);
            logger.info(`[ttyd:${sessionId}] Port ${port} is ready for WebSocket connections`);
        } catch (error) {
            logger.error(`[ttyd:${sessionId}] Failed to wait for port ready:`, error);
            await this.stopTtyd(sessionId);
            throw new Error(`ttyd startup timeout: ${error instanceof Error ? error.message : String(error)}`);
        }

        return { port, proxyPath: basePath, startedExisting: false };
    },

    async _restartTtydForExistingTmux(sessionId, preferredPort, engine = 'claude') {
        const tmuxRunning = await this._isTmuxSessionRunning(sessionId);
        if (!tmuxRunning) {
            throw new Error(`TMUX session ${sessionId} not found. Cannot reconnect ttyd.`);
        }

        logger.info(`[_restartTtydForExistingTmux] Reconnecting ttyd to existing tmux: ${sessionId}`);

        return await this.startTtyd({
            sessionId,
            cwd: null,
            initialCommand: '',
            engine,
            preferredPort
        });
    },

    async stopTtyd(sessionId, { preserveTmux = false } = {}) {
        if (!this.activeSessions.has(sessionId)) {
            return false;
        }

        this._clearPromptBuffer(sessionId);

        const sessionData = this.activeSessions.get(sessionId);
        const pid = sessionData.process?.pid || sessionData.pid;
        logger.info(`Stopping ttyd process for session ${sessionId} (port ${sessionData.port}, pid ${pid}, preserveTmux=${preserveTmux})`);

        const steps = [];

        if (pid) {
            steps.push({
                name: 'kill-ttyd-process',
                fn: async () => {
                    try {
                        process.kill(pid, 'SIGTERM');
                        await new Promise(resolve => setTimeout(resolve, 500));
                        if (this._isProcessRunning(pid)) {
                            process.kill(pid, 'SIGKILL');
                        }
                    } catch (err) {
                        if (err.code !== 'ESRCH') throw err;
                    }
                }
            });
        }

        if (!preserveTmux) {
            steps.push({
                name: 'cleanup-session-resources',
                fn: () => this.cleanupSessionResources(sessionId)
            });
        }

        steps.push({
            name: 'clear-ttyd-process-info',
            fn: async () => {
                if (pid) {
                    await this._clearTtydProcessInfoIfMatches(sessionId, pid);
                } else {
                    await this._clearTtydProcessInfo(sessionId);
                }
            }
        });

        steps.push({
            name: 'delete-active-session',
            fn: () => { this.activeSessions.delete(sessionId); }
        });

        steps.push({
            name: 'release-terminal-ownership',
            fn: () => { this.releaseTerminalOwnership(sessionId, null, { force: true }); }
        });

        const result = await gracefulCleanup(sessionId, steps);
        if (result.warnings.length > 0) {
            logger.warn(`[stopTtyd] Partial cleanup for ${sessionId}:`, result.warnings);
        }

        return true;
    },

    async cleanupSessionResources(sessionId) {
        this._clearPromptBuffer(sessionId);
        let processesKilled = 0;
        let panePids = [];

        try {
            const { stdout } = await this.execPromise(
                `tmux list-panes -s -t "${sessionId}" -F "#{pane_pid}" 2>/dev/null || echo ""`
            );
            panePids = stdout
                .split('\n')
                .map(line => parseInt(line.trim(), 10))
                .filter(pid => Number.isFinite(pid) && pid > 1);
        } catch {
            panePids = [];
        }

        for (const pid of panePids) {
            await this.execPromise(`kill -TERM ${pid} 2>/dev/null || true`).catch(() => {});
            processesKilled += 1;
            try {
                const { stdout } = await this.execPromise(`pgrep -P ${pid} 2>/dev/null || true`);
                const childPids = stdout.split('\n').map(line => parseInt(line.trim(), 10)).filter(Number.isFinite);
                for (const childPid of childPids) {
                    await this.execPromise(`kill -TERM ${childPid} 2>/dev/null || true`).catch(() => {});
                    processesKilled += 1;
                }
            } catch {
                // ignore
            }
        }

        try {
            await this.execPromise(`tmux kill-session -t "${sessionId}" 2>/dev/null`);
        } catch {
            // ignore
        }

        logger.info(`[Cleanup] Completed for ${sessionId} (Processes killed: ${processesKilled})`);
    },

    async cleanup() {
        this.stopPtyWatchdog();
        logger.info('[SessionManager] Starting graceful cleanup (preserve tmux)...');
        const sessionIds = [...this.activeSessions.keys()];
        for (const sessionId of sessionIds) {
            logger.info(`[SessionManager] Stopping ttyd for session: ${sessionId}`);
            await this.stopTtyd(sessionId, { preserveTmux: true });
        }
        logger.info(`[SessionManager] Graceful cleanup complete (${sessionIds.length} session(s))`);
    }
};
