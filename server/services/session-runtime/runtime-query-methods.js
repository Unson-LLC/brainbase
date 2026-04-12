import { execSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { logger } from '../../utils/logger.js';

export const runtimeQueryMethods = {
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
        const needsRestart = intendedState === 'active' && !ttydRunning;
        const port = activeEntry?.port || session?.ttydProcess?.port || null;
        const interactiveTransport = ttydRunning ? 'ttyd' : 'none';
        const interactiveReady = ttydRunning;
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
    }
};
