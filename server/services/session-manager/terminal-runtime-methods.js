import { spawn, execSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { gracefulCleanup } from '../../lib/graceful-cleanup.js';
import { SessionHealthMonitor } from '../session-health-monitor.js';

const INPUT_TEMPFILE_THRESHOLD_BYTES = 16 * 1024;

export const terminalRuntimeMethods = {
    findFreePort(startPort = this.nextPort) {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.listen(startPort, '0.0.0.0', () => {
                const { port } = server.address();
                server.close(() => resolve(port));
            });
            server.on('error', () => {
                resolve(this.findFreePort(startPort + 1));
            });
        });
    },

    async waitForTtydReady(port, timeoutMs = 10000, retryIntervalMs = 100) {
        const startTime = Date.now();
        const deadline = startTime + timeoutMs;
        let lastError = null;
        while (Date.now() < deadline) {
            try {
                await this._checkPortListening(port);
                const elapsedMs = Date.now() - startTime;
                logger.info(`[ttyd] Port ${port} ready after ${elapsedMs}ms`);
                return;
            } catch (error) {
                lastError = error;
                await new Promise(resolve => setTimeout(resolve, retryIntervalMs));
            }
        }
        const elapsedMs = Date.now() - startTime;
        throw new Error(`ttyd port ${port} did not become ready within ${timeoutMs}ms (elapsed: ${elapsedMs}ms)`);
    },

    _checkPortListening(port, connectionTimeout = 100) {
        return new Promise((resolve, reject) => {
            const socket = net.createConnection({ port, host: 'localhost', timeout: connectionTimeout });

            socket.on('connect', () => {
                socket.end();
                resolve();
            });

            socket.on('timeout', () => {
                socket.destroy();
                reject(new Error('Connection timeout'));
            });

            socket.on('error', (err) => {
                socket.destroy();
                reject(err);
            });
        });
    },

    isActive(sessionId) {
        return this.activeSessions.has(sessionId);
    },

    getActiveSessions() {
        return this.activeSessions;
    },

    getSession(sessionId) {
        const state = this.stateStore.get();
        return (state.sessions || []).find(session => session.id === sessionId) || null;
    },

    _resolveScriptPath(scriptName) {
        const candidates = [
            path.join(this.serverDir, 'scripts', scriptName),
            path.join(this.serverDir, scriptName),
            path.join(this.serverDir, '..', 'scripts', scriptName),
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        return candidates[0];
    },

    markReady() {
        if (this._isReady) {
            return;
        }
        this._isReady = true;
        if (this._readyResolver) {
            this._readyResolver(true);
        }
    },

    isReady() {
        return this._isReady;
    },

    async waitUntilReady(timeoutMs = 10000) {
        if (this._isReady) {
            return true;
        }

        return await Promise.race([
            this._readyPromise.then(() => true),
            new Promise(resolve => setTimeout(() => resolve(false), timeoutMs))
        ]);
    },

    _isTmuxSessionRunningSync(sessionId) {
        if (!sessionId) return false;
        try {
            execSync(`tmux has-session -t "${sessionId}" 2>/dev/null`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    },

    _isXtermOnlyMode() {
        return process.env.BRAINBASE_TERMINAL_TRANSPORT === 'xterm'
            && process.env.BRAINBASE_TEST_MODE !== 'false';
    },

    getRuntimeStatus(session) {
        if (this._isXtermOnlyMode()) {
            const sessionId = session?.id;
            const intendedState = session?.intendedState;
            const tmuxRunning = intendedState === 'active'
                ? this._isTmuxSessionRunningSync(sessionId)
                : false;
            return {
                interactiveTransport: tmuxRunning ? 'xterm' : 'none',
                interactiveReady: tmuxRunning,
                interactiveUrl: null,
                ttydRunning: false,
                needsRestart: intendedState === 'active' && !tmuxRunning,
                proxyPath: null,
                port: null
            };
        }
        const sessionId = session?.id;
        const intendedState = session?.intendedState;
        const activeEntry = this.activeSessions.get(session?.id);
        const activePid = activeEntry?.process?.pid || activeEntry?.pid;
        const persistedPid = session?.ttydProcess?.pid;
        const pidToCheck = activePid || persistedPid;
        const ttydRunning = pidToCheck ? this._isProcessRunning(pidToCheck) : false;
        const shouldCheckTmux = intendedState === 'active' && !ttydRunning;
        const tmuxRunning = shouldCheckTmux ? this._isTmuxSessionRunningSync(sessionId) : false;
        const needsRestart = intendedState === 'active' && !ttydRunning && !tmuxRunning;
        const port = activeEntry?.port || session?.ttydProcess?.port || null;
        const interactiveTransport = ttydRunning ? 'ttyd' : (tmuxRunning ? 'xterm' : 'none');
        const interactiveReady = ttydRunning || tmuxRunning;
        const interactiveUrl = ttydRunning && sessionId ? `/console/${sessionId}` : null;

        return {
            interactiveTransport,
            interactiveReady,
            interactiveUrl,
            ttydRunning,
            needsRestart,
            proxyPath: interactiveUrl,
            port
        };
    },

    getSessionById(sessionId) {
        const state = this.stateStore.get();
        const session = (state.sessions || []).find(s => s.id === sessionId);
        if (!session) return null;
        const runtimeStatus = this.getRuntimeStatus(session);

        return {
            ...session,
            ttydRunning: runtimeStatus.ttydRunning,
            runtimeStatus
        };
    },

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

    async restoreActiveSessions() {
        try {
            logger.info('[restoreActiveSessions] Restoring active sessions from state.json...');

            const state = this.stateStore.get();
            const sessions = state.sessions || [];
            if (sessions.length === 0) {
                logger.info('[restoreActiveSessions] No sessions in state.json');
                return;
            }

            const activeSessions = sessions.filter(s => s.intendedState === 'active');
            logger.info(`[restoreActiveSessions] Found ${activeSessions.length} active session(s) in state.json`);

            if (activeSessions.length === 0) {
                return;
            }

            const { stdout: tmuxOut } = await this.execPromise(
                'tmux list-sessions -F "#{session_name}" 2>/dev/null || echo ""'
            ).catch(() => ({ stdout: '' }));
            const tmuxSessions = new Set(tmuxOut.trim().split('\n').filter(Boolean));

            const ttydProcsBySessionId = new Map();
            if (!this._isXtermOnlyMode()) {
                const { stdout: psOut } = await this.execPromise('ps aux | grep ttyd | grep -v grep').catch(() => ({ stdout: '' }));
                const ttydLines = psOut.trim() ? psOut.trim().split('\n') : [];

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
            }

            const pauseSessionIds = new Set();

            for (const session of activeSessions) {
                const sessionId = session.id;
                const engine = session.engine || 'claude';
                const initialCommand = session.initialCommand || '';
                const cwd = await this.resolveSessionWorkspacePath(session, { persist: true, preferTmux: true })
                    || this._getStoredWorkspacePath(session);

                const hasTmux = tmuxSessions.has(sessionId);
                const candidates = ttydProcsBySessionId.get(sessionId) || [];

                if (!hasTmux) {
                    if (candidates.length > 0) {
                        logger.warn(`[restoreActiveSessions] TMUX missing for ${sessionId}. Killing ${candidates.length} ttyd process(es) and pausing session.`);
                        for (const proc of candidates) {
                            await this.execPromise(`kill ${proc.pid}`).catch(() => {});
                        }
                    } else {
                        logger.warn(`[restoreActiveSessions] TMUX missing for ${sessionId}. Pausing session.`);
                    }
                    pauseSessionIds.add(sessionId);
                    this.activeSessions.delete(sessionId);
                    continue;
                }

                if (this._isXtermOnlyMode()) {
                    logger.info(`[restoreActiveSessions] xterm-only: tmux alive for ${sessionId}`);
                    continue;
                }

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

                    for (const proc of candidates) {
                        if (proc.pid === keep.pid) continue;
                        logger.warn(`[restoreActiveSessions] Duplicate ttyd for ${sessionId}: killing pid ${proc.pid} (keeping ${keep.pid})`);
                        await this.execPromise(`kill ${proc.pid}`).catch(() => {});
                    }

                    if (session?.ttydProcess?.pid !== keep.pid || session?.ttydProcess?.port !== keep.port) {
                        await this._saveTtydProcessInfo(sessionId, { port: keep.port, pid: keep.pid, engine });
                    }

                    logger.info(`[restoreActiveSessions] Restored session ${sessionId}: PID ${keep.pid}, Port ${keep.port}`);
                    continue;
                }

                if (session.ttydProcess) {
                    await this._clearTtydProcessInfo(sessionId);
                }

                try {
                    const preferredPort = session?.ttydProcess?.port;
                    logger.info(`[restoreActiveSessions] Reconnecting ttyd for ${sessionId} (preferredPort: ${preferredPort}, engine: ${engine})`);

                    await this._restartTtydForExistingTmux(sessionId, preferredPort, engine);
                    logger.info(`[restoreActiveSessions] Successfully reconnected ttyd for ${sessionId}`);
                } catch (err) {
                    logger.error(`[restoreActiveSessions] Failed to reconnect ttyd for ${sessionId}:`, err);
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
                        pausedReason: 'tmux_missing_on_restore',
                        pausedAt: now,
                        tmuxMissingAt: now,
                        ttydProcess: null,
                        updatedAt: now
                    };
                });
                await this.stateStore.update({ ...currentState, sessions: updatedSessions });
                logger.warn(`[restoreActiveSessions] Paused ${pauseSessionIds.size} session(s) with missing TMUX`);
            }

            logger.info(`[restoreActiveSessions] Total restored/started: ${this.activeSessions.size} session(s)`);

            const ports = Array.from(this.activeSessions.values())
                .map(s => s.port)
                .filter(p => Number.isFinite(p));

            if (ports.length > 0) {
                const maxPort = Math.max(40000, ...ports);
                this.nextPort = maxPort + 1;
                logger.info(`[restoreActiveSessions] Updated nextPort to ${this.nextPort} (max existing port: ${maxPort})`);
            }

            await this.cleanupOrphans();
        } catch (err) {
            logger.error('[restoreActiveSessions] Error:', err);
        }
    },

    async cleanupOrphans() {
        try {
            logger.info('[cleanupOrphans] Checking for orphaned/duplicate ttyd processes...');
            const { stdout } = await this.execPromise('ps aux | grep ttyd | grep -v grep').catch(() => ({ stdout: '' }));
            if (!stdout.trim()) {
                logger.info('[cleanupOrphans] No ttyd processes found');
                return;
            }

            const lines = stdout.trim().split('\n');
            logger.info(`[cleanupOrphans] Found ${lines.length} ttyd process(es)`);

            const state = this.stateStore.get();
            const persistedProtected = new Set();
            const stateEngineBySessionId = new Map();
            for (const session of state.sessions || []) {
                const intendedState = session?.intendedState;
                const shouldProtect = intendedState === 'active' || intendedState === 'paused';
                if (!shouldProtect) continue;
                persistedProtected.add(session.id);
                const pid = session?.ttydProcess?.pid;
                if (Number.isFinite(pid)) {
                    persistedProtected.add(`pid:${pid}`);
                    stateEngineBySessionId.set(session.id, session.engine || session?.ttydProcess?.engine || 'claude');
                }
            }

            const runtimeProtected = new Set();
            for (const [sessionId, sessionData] of this.activeSessions) {
                runtimeProtected.add(sessionId);
                const pid = sessionData?.process?.pid || sessionData?.pid;
                if (Number.isFinite(pid)) {
                    runtimeProtected.add(`pid:${pid}`);
                }
            }

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
            for (const [sessionId, procs] of procsBySessionId) {
                const shouldProtectSession = persistedProtected.has(sessionId) || runtimeProtected.has(sessionId);
                if (!shouldProtectSession) {
                    for (const proc of procs) {
                        logger.info(`[cleanupOrphans] Killing orphaned ttyd process: PID ${proc.pid} (sessionId: ${sessionId})`);
                        await this.execPromise(`kill ${proc.pid}`).catch(() => {});
                        killed += 1;
                    }
                    continue;
                }

                const protectedPid = Array.from(runtimeProtected)
                    .filter((value) => typeof value === 'string' && value.startsWith('pid:'))
                    .map(value => Number(value.slice(4)))
                    .find(pid => procs.some(proc => proc.pid === pid))
                    ?? Array.from(persistedProtected)
                        .filter((value) => typeof value === 'string' && value.startsWith('pid:'))
                        .map(value => Number(value.slice(4)))
                        .find(pid => procs.some(proc => proc.pid === pid));

                if (procs.length <= 1) continue;

                const keepPid = protectedPid || procs.sort((a, b) => b.pid - a.pid)[0].pid;
                logger.warn(`[cleanupOrphans] Duplicate ttyd detected for ${sessionId}. Keeping pid=${keepPid}, killing ${procs.length - 1} process(es).`);
                for (const proc of procs) {
                    if (proc.pid === keepPid) continue;
                    logger.info(`[cleanupOrphans] Killing duplicate ttyd process: PID ${proc.pid} (sessionId: ${sessionId})`);
                    await this.execPromise(`kill ${proc.pid}`).catch(() => {});
                    killed += 1;
                }

                const keepProc = procs.find(proc => proc.pid === keepPid);
                const keepEngine = stateEngineBySessionId.get(sessionId) || 'claude';
                if (keepProc && (!this.activeSessions.has(sessionId) || this.activeSessions.get(sessionId)?.pid !== keepPid)) {
                    this.activeSessions.set(sessionId, { port: keepProc.port, pid: keepPid, process: null });
                    if (Number.isFinite(keepProc.port)) {
                        await this._saveTtydProcessInfo(sessionId, {
                            port: keepProc.port,
                            pid: keepPid,
                            engine: keepEngine
                        });
                    }
                }
            }

            logger.info(`[cleanupOrphans] Cleaned up ${killed} orphaned/duplicate ttyd process(es)`);
        } catch (err) {
            logger.error('[cleanupOrphans] Error:', err);
        }
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
            const minStableMs = 120;
            const timeoutMs = 500;
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
            await this.waitForTtydReady(port, 10000, 100);
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

    async cleanupStalePausedSessions() {
        const state = this.stateStore.get();
        const now = Date.now();
        const PAUSED_TTL = 24 * 60 * 60 * 1000;

        for (const session of state.sessions) {
            if (session.intendedState === 'paused' && session.pausedAt) {
                const pausedTime = new Date(session.pausedAt).getTime();

                if (now - pausedTime > PAUSED_TTL && !session.tmuxCleanedAt) {
                    try {
                        await this.execPromise(`tmux kill-session -t "${session.id}" 2>/dev/null`);
                        logger.info(`[Cleanup] Deleted TMUX for paused session ${session.id} (24h TTL)`);
                    } catch {
                        // ignore
                    }

                    const updatedSessions = state.sessions.map(s =>
                        s.id === session.id
                            ? { ...s, tmuxCleanedAt: new Date().toISOString() }
                            : s
                    );

                    await this.stateStore.update({ ...state, sessions: updatedSessions });
                    logger.info(`[Cleanup] Marked TMUX cleaned for paused session ${session.id}`);
                }
            }
        }
    },

    async cleanupArchivedSessions() {
        const state = this.stateStore.get();
        const now = Date.now();
        const ARCHIVED_TTL = 30 * 24 * 60 * 60 * 1000;

        const sessionsToKeep = state.sessions.filter(session => {
            if (session.intendedState === 'archived' && session.archivedAt) {
                const archivedTime = new Date(session.archivedAt).getTime();

                if (now - archivedTime > ARCHIVED_TTL) {
                    logger.info(`[Cleanup] Deleting archived session ${session.id} (30d TTL)`);

                    if (session.worktree && this.worktreeService) {
                        this.worktreeService.remove(session.id, session.worktree.repo).catch(() => {});
                    }

                    return false;
                }
            }
            return true;
        });

        if (sessionsToKeep.length < state.sessions.length) {
            await this.stateStore.update({ ...state, sessions: sessionsToKeep });
            const deletedCount = state.sessions.length - sessionsToKeep.length;
            logger.info(`[Cleanup] Removed ${deletedCount} archived session(s) (30d TTL)`);
        }
    },

    _isProcessRunning(pid) {
        try {
            process.kill(pid, 0);
            const status = execSync(`ps -o state= -p ${pid} 2>/dev/null`, { encoding: 'utf-8' }).trim();
            return !status.startsWith('Z');
        } catch {
            return false;
        }
    },

    async _isTmuxSessionRunning(sessionId) {
        try {
            await this.execPromise(`tmux has-session -t "${sessionId}" 2>/dev/null`);
            return true;
        } catch {
            return false;
        }
    },

    async isTmuxSessionRunning(sessionId) {
        return await this._isTmuxSessionRunning(sessionId);
    },

    async getPaneMode(sessionId) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const { stdout } = await this.execPromise(`tmux display-message -p -t "${sessionId}" "#{pane_in_mode}" 2>/dev/null || echo "0"`);
        return stdout.trim() === '1';
    },

    async resizeSessionWindow(sessionId, cols, rows) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const safeCols = Math.max(40, Math.min(300, Number(cols) || 0));
        const safeRows = Math.max(12, Math.min(120, Number(rows) || 0));
        if (!Number.isFinite(safeCols) || !Number.isFinite(safeRows)) {
            throw new Error('Invalid terminal size');
        }

        await this.execPromise(`tmux resize-window -t "${sessionId}" -x ${safeCols} -y ${safeRows}`);
    },

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
    },

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
    },

    async exitCopyMode(sessionId) {
        if (!sessionId) {
            throw new Error('Session ID required');
        }

        const target = sessionId.replace(/"/g, '\\"');
        const cmd = `tmux if-shell -F '#{pane_in_mode}' "send-keys -t \\\"${target}\\\" -X cancel" ""`;

        await this.execPromise(cmd);
    },

    async sendInput(sessionId, input, type) {
        if (!input) {
            throw new Error('Input required');
        }

        await this._capturePromptInput(sessionId, input, type);

        if (type === 'key') {
            if (this.ALLOWED_KEYS.includes(input)) {
                await this._sendNamedKey(sessionId, input);
                return;
            }
        } else if (type !== 'text') {
            throw new Error('Type must be key or text');
        }

        await this._pasteInputFromTempFile(sessionId, input);
    },

    async _runTmux(args) {
        return await new Promise((resolve, reject) => {
            const child = spawn('tmux', args, {
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let stdout = '';
            let stderr = '';

            child.stdout?.on('data', (chunk) => {
                stdout += chunk.toString();
            });
            child.stderr?.on('data', (chunk) => {
                stderr += chunk.toString();
            });
            child.on('error', reject);
            child.on('close', (code) => {
                if (code === 0) {
                    resolve({ stdout, stderr });
                    return;
                }

                const detail = stderr.trim() || stdout.trim() || `tmux exited with code ${code}`;
                const error = new Error(detail);
                error.code = code;
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
            });
        });
    },

    async _sendNamedKey(sessionId, key) {
        await this._runTmux(['send-keys', '-t', sessionId, key]);
    },

    async _pasteInputFromTempFile(sessionId, input) {
        const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'brainbase-input-'));
        const tempFile = path.join(tempDir, 'paste.txt');
        const bufferName = `brainbase-${sessionId}-${Date.now()}`;

        try {
            await fs.promises.writeFile(tempFile, input, 'utf8');
            await this._runTmux(['load-buffer', '-b', bufferName, tempFile]);
            await this._runTmux(['paste-buffer', '-d', '-b', bufferName, '-t', sessionId]);
        } finally {
            await this._runTmux(['delete-buffer', '-b', bufferName]).catch(() => {});
            await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
    },

    async getContent(sessionId, lines = 500) {
        const { stdout } = await this.execPromise(`tmux capture-pane -t "${sessionId}" -p -S -${lines}`);
        return stdout;
    },

    async getContentWithColors(sessionId, lines = 10) {
        const { stdout } = await this.execPromise(
            `tmux capture-pane -e -t "${sessionId}" -p -S -${lines}`
        );
        return stdout;
    },

    async getOutput(sessionId) {
        const { stdout } = await this.execPromise(`tmux capture-pane -t "${sessionId}" -p -J -S -100`);
        const choices = this.outputParser.detectChoices(stdout);

        return {
            output: stdout,
            choices: choices,
            hasChoices: choices.length > 0
        };
    },

    startPtyWatchdog(intervalMs = 600000) {
        if (this._ptyWatchdogTimer) return;
        logger.info(`[PTY Watchdog] Starting (interval: ${intervalMs / 1000}s)`);

        this._healthMonitor = new SessionHealthMonitor(this, {
            onDeadSession: (sessionId) => {
                logger.warn(`[PTY Watchdog] Dead session detected: ${sessionId}, cleaning up...`);
                this.stopTtyd(sessionId).catch(err => {
                    logger.error(`[PTY Watchdog] Cleanup failed for ${sessionId}:`, err.message);
                });
            }
        });
        this._healthMonitor.start(intervalMs);

        this._ptyWatchdogTimer = setInterval(async () => {
            try {
                const { stdout: maxOut } = await this.execPromise('sysctl -n kern.tty.ptmx_max 2>/dev/null || echo 512');
                const maxPty = parseInt(maxOut.trim()) || 512;

                const { stdout: countOut } = await this.execPromise('ls /dev/pty* 2>/dev/null | wc -l');
                const usedPty = parseInt(countOut.trim()) || 0;

                const usage = (usedPty / maxPty * 100).toFixed(1);
                const level = usedPty > maxPty * 0.8 ? 'CRITICAL' : usedPty > maxPty * 0.6 ? 'WARNING' : 'OK';

                logger.info(`[PTY Watchdog] ${level}: ${usedPty}/${maxPty} PTYs used (${usage}%)`);

                if (level === 'CRITICAL') {
                    logger.error(`[PTY Watchdog] CRITICAL: PTY usage at ${usage}%! Running orphan cleanup...`);
                    await this.cleanupOrphans();
                }
            } catch (err) {
                logger.error('[PTY Watchdog] Error:', err.message);
            }
        }, intervalMs);
    },

    stopPtyWatchdog() {
        if (this._healthMonitor) {
            this._healthMonitor.stop();
            this._healthMonitor = null;
        }
        if (this._ptyWatchdogTimer) {
            clearInterval(this._ptyWatchdogTimer);
            this._ptyWatchdogTimer = null;
            logger.info('[PTY Watchdog] Stopped');
        }
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
