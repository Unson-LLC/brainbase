import { execSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { logger } from '../../utils/logger.js';
import {
    buildCodexAppServerRestoreMetadata,
    getCodexAppServerThreadId
} from '../codex-app-server-session-state.js';
import { PS_INVENTORY_MAX_BUFFER } from './ps-inventory-config.js';

const PROCESS_CATEGORIES = [
    'codex',
    'codex_app_server',
    'pty_shim',
    'tmux',
    'ttyd',
    'mcp',
    'unknown_child'
];

function parsePsOutput(psOutput) {
    if (typeof psOutput !== 'string') return [];
    return psOutput
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map((line) => {
            const match = line.match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
            if (!match) return null;
            return {
                pid: Number(match[1]),
                ppid: Number(match[2]),
                rssKb: Number(match[3]),
                command: match[4]
            };
        })
        .filter(Boolean);
}

function classifyRuntimeProcess(command) {
    if (typeof command !== 'string') return 'unknown_child';
    if (command.includes('codex-pty-shim.py')) return 'pty_shim';
    if (/\bcodex\s+app-server\b/.test(command)) return 'codex_app_server';
    if (/\bttyd\b/.test(command)) return 'ttyd';
    if (/\btmux\b/.test(command)) return 'tmux';
    if (command.includes('/mcp/') || command.includes('.claude/mcp') || /\bmcp\//.test(command)) return 'mcp';
    if (/\bcodex\b/.test(command)) return 'codex';
    return 'unknown_child';
}

function buildSessionRuntimeIdentifiers(session) {
    const identifiers = [];
    const add = (value, strength) => {
        if (typeof value === 'string' && value.trim()) {
            identifiers.push({ value: value.trim(), strength });
        }
    };
    const addWeakSessionId = (value) => {
        if (isSpecificSessionIdentifier(value)) {
            add(value, 'weak');
        }
    };
    const addRuntimePath = (value) => {
        if (isSpecificRuntimePath(value, session)) {
            add(path.resolve(value.trim()), 'strong');
        }
    };

    addWeakSessionId(session?.id);
    if (session?.id) add(`/console/${session.id}`, 'strong');
    addRuntimePath(session?.path);
    addRuntimePath(session?.worktree?.path);
    add(getCodexAppServerThreadId(session), 'strong');
    add(session?.codexThreadId, 'strong');
    add(session?.conversationSummary?.codexThreadId, 'strong');
    add(session?.conversationSummary?.lastConversation?.resumeId, 'strong');
    add(session?.conversationSummary?.lastConversation?.conversationId, 'strong');

    return identifiers;
}

function isSpecificSessionIdentifier(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    const text = value.trim();
    return /^session[-_]/i.test(text)
        || /(^|[-_])session[-_]/i.test(text)
        || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
        || /^sess[-_]/i.test(text)
        || /^codex[-_]/i.test(text);
}

function isSpecificRuntimePath(value, session = {}) {
    if (typeof value !== 'string' || !value.trim()) return false;
    const resolved = path.resolve(value.trim());
    const normalized = resolved.replace(/\\/g, '/');
    const broadWorkspaceRoots = new Set([
        '/Users/ksato',
        '/Users/ksato/workspace',
        '/Users/ksato/workspace/code',
        '/Volumes/UNSON-DRIVE',
        '/Volumes/UNSON-DRIVE/brainbase'
    ]);
    if (broadWorkspaceRoots.has(normalized)) return false;

    return /\/brainbase-worktrees-session[-_/][^/]+/i.test(normalized)
        || /\/worktrees-session[-_/][^/]+/i.test(normalized)
        || /\/brainbase-worktrees\/session[-_][^/]+/i.test(normalized);
}

function getActiveSessionPidMap(activeSessions = new Map()) {
    const pidMap = new Map();
    if (!activeSessions || typeof activeSessions.forEach !== 'function') return pidMap;

    activeSessions.forEach((entry, sessionId) => {
        const pid = Number(entry?.process?.pid || entry?.pid);
        if (sessionId && Number.isFinite(pid) && pid > 0) {
            pidMap.set(pid, sessionId);
        }
    });

    return pidMap;
}

function findMatchingSessions(processInfo, sessions, activePidMap = new Map()) {
    const activeSessionId = activePidMap.get(Number(processInfo?.pid));
    const command = processInfo?.command || '';
    if (activeSessionId) {
        const activeSession = sessions.find(session => session?.id === activeSessionId);
        const hasStrongCommandEvidence = buildSessionRuntimeIdentifiers(activeSession)
            .some(identifier => identifier.strength === 'strong' && command.includes(identifier.value));
        if (hasStrongCommandEvidence) {
            return [{ sessionId: activeSessionId, strength: 'strong' }];
        }
    }

    return sessions.flatMap((session) => {
        const matches = buildSessionRuntimeIdentifiers(session).filter(identifier => command.includes(identifier.value));
        if (matches.length === 0 || !session.id) return [];
        const strength = matches.some(match => match.strength === 'strong') ? 'strong' : 'weak';
        return [{ sessionId: session.id, strength }];
    });
}

function buildProcessMatchMap(processRows, sessions, activeSessions = new Map()) {
    const rowsByPid = new Map(processRows.map(processInfo => [processInfo.pid, processInfo]));
    const activePidMap = getActiveSessionPidMap(activeSessions);
    const matchMap = new Map();

    for (const processInfo of processRows) {
        matchMap.set(processInfo.pid, {
            matches: findMatchingSessions(processInfo, sessions, activePidMap),
            source: 'command'
        });
    }

    let changed = true;
    while (changed) {
        changed = false;
        for (const processInfo of processRows) {
            const current = matchMap.get(processInfo.pid);
            if (current?.matches?.length) continue;

            const parent = rowsByPid.get(processInfo.ppid);
            const parentMatch = parent ? matchMap.get(parent.pid) : null;
            if (parentMatch?.matches?.length === 1) {
                matchMap.set(processInfo.pid, {
                    matches: parentMatch.matches,
                    source: 'parent'
                });
                changed = true;
            }
        }
    }

    return matchMap;
}

function isStartupPending(session) {
    return session?.startupStatus === 'pending' || session?.startupStatus === 'failed';
}

export function buildHibernationEligibility({
    session,
    inventorySession = null,
    ambiguousProcesses = [],
    activityStatus = null,
    owner = null,
    pendingInput = ''
} = {}) {
    const blockers = [];
    const reasons = [];

    if (!session) {
        return {
            eligible: false,
            reasons: ['session_not_found'],
            blockers: ['session_not_found']
        };
    }

    const runtimePresence = inventorySession?.runtimePresence || 'cold';
    const processCount = Number(inventorySession?.processCount || 0);
    const rssKb = Number(inventorySession?.rssKb || 0);
    const processesByCategory = inventorySession?.processesByCategory || {};
    const processes = Array.isArray(inventorySession?.processes) ? inventorySession.processes : [];
    const ownedProcesses = processes.filter(processInfo => (
        processInfo?.ownershipStrength === 'strong'
        && processInfo?.category !== 'tmux'
    ));
    const weakStoppableProcesses = processes.filter(processInfo => (
        processInfo?.category !== 'tmux'
        && processInfo?.ownershipStrength !== 'strong'
    ));
    const weakUnknownProcesses = processes.filter(processInfo => (
        processInfo?.category === 'unknown_child'
        && processInfo?.ownershipStrength !== 'strong'
    ));
    const restoreMetadata = buildCodexAppServerRestoreMetadata(session);
    const codexResumeId = restoreMetadata.codexResumeId;

    if (session.intendedState && session.intendedState !== 'active') {
        blockers.push('inactive_session_state');
    }
    if (activityStatus?.isWorking || Number(activityStatus?.activeTurnCount || 0) > 0) {
        blockers.push('active_turn');
    }
    if (isStartupPending(session)) {
        blockers.push('pending_startup');
    }
    if (typeof pendingInput === 'string' && pendingInput.trim()) {
        blockers.push('pending_input');
    }
    if (owner) {
        blockers.push('active_owner');
    }
    if (session.runtimePinned === true) {
        blockers.push('pinned');
    }
    if (session.engine !== 'codex') {
        blockers.push('unsupported_engine');
    }
    if (session.engine === 'codex' && !codexResumeId) {
        blockers.push('missing_restore_metadata');
    }
    if (weakUnknownProcesses.length > 0 || ambiguousProcesses.length > 0) {
        blockers.push('unknown_process_ownership');
    }
    if (weakStoppableProcesses.length > 0) {
        blockers.push('weak_process_ownership');
    }

    if (runtimePresence !== 'hot' || processCount === 0) {
        reasons.push('already_cold');
    }
    if (blockers.length === 0 && reasons.length === 0) {
        reasons.push('idle_runtime_can_hibernate');
    }

    return {
        sessionId: session.id,
        eligible: blockers.length === 0 && runtimePresence === 'hot' && processCount > 0,
        reasons,
        blockers: Array.from(new Set(blockers)),
        runtimePresence,
        rssKb,
        processCount,
        processesByCategory,
        ownedProcesses,
        ambiguousProcessCount: ambiguousProcesses.length,
        restoreMetadata: {
            restoreStrategy: restoreMetadata.restoreStrategy,
            codexResumeId,
            codexThreadId: session.codexThreadId || session.conversationSummary?.codexThreadId || null,
            codexAppServerThreadId: restoreMetadata.codexAppServerThreadId,
            source: restoreMetadata.source,
            blocker: restoreMetadata.blocker
        }
    };
}

export function buildRuntimeInventory({ sessions = [], activeSessions = new Map(), psOutput = '' } = {}) {
    const sessionSummaries = new Map();
    const processRows = parsePsOutput(psOutput);
    const processMatchMap = buildProcessMatchMap(processRows, sessions, activeSessions);
    const unattributed = [];

    for (const session of sessions || []) {
        const activeEntry = activeSessions?.get?.(session.id) || null;
        sessionSummaries.set(session.id, {
            sessionId: session.id,
            name: session.name || null,
            intendedState: session.intendedState || null,
            runtimePresence: activeEntry ? 'hot' : 'cold',
            rssKb: 0,
            processCount: 0,
            processesByCategory: Object.fromEntries(PROCESS_CATEGORIES.map(category => [category, 0])),
            processes: []
        });
    }

    for (const processInfo of processRows) {
        const category = classifyRuntimeProcess(processInfo.command);
        const match = processMatchMap.get(processInfo.pid) || { matches: [] };
        const matches = match.matches || [];
        const matchingSessionIds = matches.map(candidate => candidate.sessionId).filter(Boolean);

        if (matchingSessionIds.length === 1 && sessionSummaries.has(matchingSessionIds[0])) {
            const summary = sessionSummaries.get(matchingSessionIds[0]);
            const ownershipStrength = matches[0]?.strength || 'weak';
            summary.runtimePresence = 'hot';
            summary.rssKb += processInfo.rssKb;
            summary.processCount += 1;
            summary.processesByCategory[category] = (summary.processesByCategory[category] || 0) + 1;
            summary.processes.push({ ...processInfo, category, attribution: match.source || 'command', ownershipStrength });
            continue;
        }

        if (matchingSessionIds.length > 1 || matchingSessionIds.length === 0) {
            unattributed.push({
                ...processInfo,
                category,
                matchedSessionIds: matchingSessionIds,
                attribution: match.source || null,
                reason: matchingSessionIds.length > 1 ? 'matched_multiple_sessions' : 'no_session_match'
            });
        }
    }

    const sessionList = [...sessionSummaries.values()];
    const totals = sessionList.reduce((acc, session) => {
        acc.rssKb += session.rssKb;
        acc.processCount += session.processCount;
        if (session.runtimePresence === 'hot') acc.hotSessions += 1;
        if (session.runtimePresence === 'cold') acc.coldSessions += 1;
        return acc;
    }, {
        sessionCount: sessionList.length,
        hotSessions: 0,
        coldSessions: 0,
        rssKb: 0,
        processCount: 0,
        unattributedProcessCount: unattributed.length
    });

    return {
        generatedAt: new Date().toISOString(),
        sessions: sessionList,
        totals,
        unattributed
    };
}

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
        // Xterm-only mode is determined solely by the configured terminal transport.
        // Production runs BRAINBASE_TERMINAL_TRANSPORT=xterm (tmux + WebSocket) with
        // zero ttyd processes; the previous `&& BRAINBASE_TEST_MODE !== 'false'` clause
        // was a rollout artifact that left ttyd-vestigial code (scan/restore/repair/
        // spawn) active in production, where repairActiveTtydSessions then spawned ttyd
        // that timed out every watchdog cycle. When the transport is xterm, ttyd is not
        // the serving mechanism regardless of test mode.
        return process.env.BRAINBASE_TERMINAL_TRANSPORT === 'xterm';
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
        const ttydRunning = activePid ? this._isProcessRunning(activePid) : false;
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

    async getRuntimeInventory() {
        const state = this.stateStore.get();
        let psOutput = '';

        try {
            if (typeof this.execPromise === 'function') {
                const result = await this.execPromise('ps -axo pid=,ppid=,rss=,command=', { maxBuffer: PS_INVENTORY_MAX_BUFFER });
                psOutput = typeof result === 'string' ? result : result?.stdout || '';
            } else {
                psOutput = execSync('ps -axo pid=,ppid=,rss=,command=', { encoding: 'utf-8', maxBuffer: PS_INVENTORY_MAX_BUFFER });
            }
        } catch (error) {
            logger.warn('[runtime-inventory] ps command failed', {
                error: error instanceof Error ? error.message : String(error)
            });
        }

        return buildRuntimeInventory({
            sessions: state.sessions || [],
            activeSessions: this.activeSessions,
            psOutput
        });
    },

    async getHibernationEligibility(sessionId, {
        activityStatus = null,
        owner = null,
        pendingInput = '',
        sessionOverride = null
    } = {}) {
        const state = this.stateStore.get();
        const session = sessionOverride || (state.sessions || []).find(candidate => candidate.id === sessionId) || null;
        if (!session) return null;

        const inventory = await this.getRuntimeInventory();
        const inventorySession = (inventory.sessions || []).find(candidate => candidate.sessionId === sessionId) || null;
        const ambiguousProcesses = (inventory.unattributed || []).filter((processInfo) => (
            Array.isArray(processInfo.matchedSessionIds)
            && processInfo.matchedSessionIds.includes(sessionId)
        ));

        return buildHibernationEligibility({
            session,
            inventorySession,
            ambiguousProcesses,
            activityStatus,
            owner,
            pendingInput
        });
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
