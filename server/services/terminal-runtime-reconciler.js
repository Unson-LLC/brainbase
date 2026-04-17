import { execSync } from 'child_process';
import { TERMINAL_RUNTIME_STATE } from './terminal-runtime-registry.js';

const INPUT_PROBE_FRESH_MS = 60_000;
const OWNERSHIP_STALE_MS = 90_000;
const GATEWAY_STALE_MS = 45_000;

function parsePsLine(line) {
    const match = String(line || '').match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) return null;
    return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        pgid: Number(match[3]),
        command: match[4]
    };
}

function extractSessionId(command) {
    if (!command) return null;
    const consoleMatch = command.match(/\/console\/([^/\s?]+)/);
    if (consoleMatch) return decodeURIComponent(consoleMatch[1]);
    const tmuxMatch = command.match(/tmux\s+new-session\s+.*?-s\s+["']?([^"'\s]+)/);
    if (tmuxMatch) return tmuxMatch[1];
    return null;
}

export class TerminalRuntimeReconciler {
    constructor({
        stateStore,
        runtimeQuery,
        runtimeLifecycle,
        ownershipService = null,
        runtimeRegistry,
        serverGeneration = null,
        execSyncFn = execSync,
        killFn = process.kill,
        logger = console
    } = {}) {
        this.stateStore = stateStore;
        this.runtimeQuery = runtimeQuery;
        this.runtimeLifecycle = runtimeLifecycle;
        this.ownershipService = ownershipService;
        this.runtimeRegistry = runtimeRegistry;
        this.serverGeneration = serverGeneration;
        this.execSync = execSyncFn;
        this.kill = killFn;
        this.logger = logger;
    }

    observe() {
        const state = this.stateStore?.get?.() || { sessions: [] };
        const sessions = state.sessions || [];
        const processes = this._listProcesses();
        const ttydProcesses = processes
            .filter((proc) => /\bttyd\b/.test(proc.command))
            .map((proc) => ({
                ...proc,
                sessionId: extractSessionId(proc.command)
            }));

        const observedSessions = {};
        for (const session of sessions) {
            const sessionId = session.id;
            const tmux = this._observeTmux(sessionId, session?.intendedState);
            const ownership = this._observeOwnership(sessionId);
            observedSessions[sessionId] = {
                sessionId,
                name: session.name || sessionId,
                engine: session.engine || null,
                intendedState: session.intendedState || 'active',
                ttyd: ttydProcesses.filter((proc) => proc.sessionId === sessionId),
                tmux,
                ownership
            };
        }

        for (const ttyd of ttydProcesses) {
            if (!ttyd.sessionId || observedSessions[ttyd.sessionId]) continue;
            observedSessions[ttyd.sessionId] = {
                sessionId: ttyd.sessionId,
                intendedState: 'unknown',
                name: ttyd.sessionId,
                engine: null,
                ttyd: [ttyd],
                tmux: { exists: false },
                ownership: this._observeOwnership(ttyd.sessionId)
            };
        }

        return {
            serverGeneration: this.serverGeneration,
            processes,
            ttydProcesses,
            sessions: observedSessions
        };
    }

    async reconcile({ sessionId = null, dryRun = true, recover = false } = {}) {
        const observation = this.observe();
        const actions = [];
        const targetEntries = Object.values(observation.sessions)
            .filter((entry) => !sessionId || entry.sessionId === sessionId);

        for (const entry of targetEntries) {
            const ttyds = entry.ttyd || [];
            const registryEntry = this.runtimeRegistry?.getSession?.(entry.sessionId);
            if (ttyds.length > 1) {
                const keeper = this._chooseTtydKeeper(ttyds);
                for (const ttyd of ttyds) {
                    if (ttyd.pid === keeper.pid) continue;
                    actions.push(await this._killProcessAction({
                        sessionId: entry.sessionId,
                        pid: ttyd.pid,
                        type: 'kill_stale_ttyd',
                        reason: 'duplicate_ttyd',
                        dryRun
                    }));
                }
            }

            if (entry.ownership?.stale) {
                actions.push(await this._clearStaleOwnershipAction({
                    sessionId: entry.sessionId,
                    ownerViewerId: entry.ownership.ownerViewerId,
                    dryRun
                }));
            }

            const classification = this._classifyRuntimeState(entry, registryEntry);
            this.runtimeRegistry?.updateSession?.(entry.sessionId, {
                intendedState: entry.intendedState,
                runtimeState: classification.runtimeState,
                serverGeneration: this.serverGeneration || null,
                observedAt: new Date().toISOString(),
                issues: classification.issues,
                observed: {
                    tmux: entry.tmux,
                    ttyd: {
                        running: ttyds.length > 0,
                        duplicates: Math.max(0, ttyds.length - 1),
                        processes: ttyds.map(({ pid, ppid, pgid, command }) => ({ pid, ppid, pgid, command }))
                    },
                    ownership: entry.ownership
                }
            });

            if (recover && entry.intendedState === 'active' && classification.runtimeState === TERMINAL_RUNTIME_STATE.DEGRADED) {
                actions.push({
                    sessionId: entry.sessionId,
                    type: 'ensure_runtime',
                    reason: 'explicit_recover',
                    dryRun
                });
                if (!dryRun && typeof this.runtimeLifecycle?.ensureSessionRuntime === 'function') {
                    await this.runtimeLifecycle.ensureSessionRuntime({ sessionId: entry.sessionId });
                }
            }
        }

        const health = await this.getHealth();
        return {
            success: true,
            dryRun,
            recover,
            actions,
            observedAt: new Date().toISOString(),
            health
        };
    }

    async getHealth() {
        const observation = this.observe();
        const issues = [];
        let active = 0;
        let interactiveReady = 0;
        let degraded = 0;
        let duplicateTtyd = 0;
        let snapshotOnly = 0;
        let blocked = 0;
        let transportConnected = 0;
        const sessionHealth = [];

        for (const entry of Object.values(observation.sessions)) {
            if (entry.intendedState === 'active') active += 1;
            if ((entry.ttyd || []).length > 1) {
                duplicateTtyd += 1;
            }
            const registryEntry = this.runtimeRegistry?.getSession?.(entry.sessionId);
            const classification = this._classifyRuntimeState(entry, registryEntry);
            const runtimeState = classification.runtimeState;
            if (runtimeState === TERMINAL_RUNTIME_STATE.INTERACTIVE_READY) interactiveReady += 1;
            if (runtimeState === TERMINAL_RUNTIME_STATE.DEGRADED) degraded += 1;
            if (runtimeState === TERMINAL_RUNTIME_STATE.SNAPSHOT_ONLY) snapshotOnly += 1;
            if (runtimeState === TERMINAL_RUNTIME_STATE.BLOCKED_BY_OWNER) blocked += 1;
            if (runtimeState === TERMINAL_RUNTIME_STATE.TRANSPORT_CONNECTED) transportConnected += 1;

            for (const issue of classification.issues) {
                issues.push(issue);
            }

            sessionHealth.push({
                sessionId: entry.sessionId,
                name: entry.name || entry.sessionId,
                engine: entry.engine || null,
                intendedState: entry.intendedState,
                runtimeState,
                terminalAccess: {
                    state: entry.ownership?.state || 'available',
                    ownerViewerLabel: entry.ownership?.ownerViewerLabel || null,
                    ownerLastSeenAt: entry.ownership?.ownerLastSeenAt || null,
                    stale: Boolean(entry.ownership?.stale)
                },
                observed: {
                    tmux: entry.tmux,
                    ttyd: {
                        running: (entry.ttyd || []).length > 0,
                        duplicates: Math.max(0, (entry.ttyd || []).length - 1),
                        processes: (entry.ttyd || []).map(({ pid, ppid, pgid, command }) => ({ pid, ppid, pgid, command }))
                    },
                    gateway: this._withAge(registryEntry?.observed?.gateway),
                    inputProbe: this._withAge(registryEntry?.observed?.inputProbe),
                    cli: registryEntry?.observed?.cli || null
                },
                issues: classification.issues
            });
        }

        return {
            status: issues.length > 0 || degraded > 0 ? 'degraded' : 'healthy',
            serverGeneration: this.serverGeneration || null,
            canonicalServerPid: process.pid,
            sessions: {
                active,
                interactiveReady,
                degraded,
                duplicateTtyd,
                snapshotOnly,
                blocked,
                transportConnected
            },
            issues,
            sessionHealth
        };
    }

    _observeTmux(sessionId, intendedState) {
        if (intendedState !== 'active') {
            return { exists: false };
        }
        if (!sessionId) {
            return { exists: false, observationError: 'session_id_missing' };
        }
        try {
            if (typeof this.runtimeQuery?.isTmuxSessionRunningSync === 'function') {
                return { exists: Boolean(this.runtimeQuery.isTmuxSessionRunningSync(sessionId)) };
            }
            if (typeof this.runtimeQuery?._isTmuxSessionRunningSync === 'function') {
                return { exists: Boolean(this.runtimeQuery._isTmuxSessionRunningSync(sessionId)) };
            }
            return { exists: null, observationError: 'tmux_sync_observer_unavailable' };
        } catch (error) {
            return { exists: null, observationError: error instanceof Error ? error.message : 'tmux_observation_failed' };
        }
    }

    _observeOwnership(sessionId) {
        const snapshot = this.ownershipService?.getTerminalOwnerSnapshot?.(sessionId);
        if (!snapshot?.ownerViewerId) {
            return {
                state: 'available',
                ownerViewerId: null,
                ownerViewerLabel: null,
                ownerLastSeenAt: null,
                stale: false
            };
        }
        const ageMs = this._ageMs(snapshot.lastSeenAt);
        return {
            state: 'owned',
            ownerViewerId: snapshot.ownerViewerId,
            ownerViewerLabel: snapshot.ownerViewerLabel || null,
            ownerLastSeenAt: snapshot.ownerLastSeenAt || null,
            ageMs,
            stale: ageMs !== null && ageMs > OWNERSHIP_STALE_MS
        };
    }

    _listProcesses() {
        try {
            const stdout = this.execSync('ps -axo pid=,ppid=,pgid=,command=', { encoding: 'utf8' });
            return stdout.split('\n').map(parsePsLine).filter(Boolean);
        } catch (error) {
            this.logger.warn?.(`[TerminalRuntimeReconciler] process observation failed: ${error.message}`);
            return [];
        }
    }

    _chooseTtydKeeper(ttyds) {
        const registry = this.runtimeRegistry?.getAll?.();
        const registeredPids = new Set();
        for (const entry of Object.values(registry?.sessions || {})) {
            const directPid = entry?.observed?.ttyd?.pid;
            if (directPid) registeredPids.add(directPid);
            for (const proc of entry?.observed?.ttyd?.processes || []) {
                if (proc?.pid) registeredPids.add(proc.pid);
            }
        }
        return ttyds.find((ttyd) => registeredPids.has(ttyd.pid)) || ttyds[ttyds.length - 1];
    }

    _classifyRuntimeState(entry, registryEntry = null) {
        const issues = [];
        if (entry.intendedState && entry.intendedState !== 'active') {
            return { runtimeState: TERMINAL_RUNTIME_STATE.STOPPED, issues };
        }
        if ((entry.ttyd || []).length > 1) {
            issues.push(this._issue('duplicate_ttyd', entry.sessionId, 'critical', 'Multiple ttyd fallback processes are attached to this session.'));
            return { runtimeState: TERMINAL_RUNTIME_STATE.DEGRADED, issues };
        }
        if (entry.tmux?.exists === null) {
            issues.push(this._issue('tmux_observation_unavailable', entry.sessionId, 'warning', entry.tmux?.observationError || 'tmux observer is unavailable.'));
            return { runtimeState: TERMINAL_RUNTIME_STATE.SNAPSHOT_ONLY, issues };
        }
        if (!entry.tmux?.exists) {
            issues.push(this._issue('tmux_missing', entry.sessionId, 'critical', 'Active session has no tmux runtime.'));
            return { runtimeState: TERMINAL_RUNTIME_STATE.DEGRADED, issues };
        }
        if (entry.ownership?.stale) {
            issues.push(this._issue('stale_ownership', entry.sessionId, 'warning', 'Terminal owner heartbeat is stale.'));
            return { runtimeState: TERMINAL_RUNTIME_STATE.DEGRADED, issues };
        }
        if (entry.ownership?.state === 'owned') {
            return { runtimeState: TERMINAL_RUNTIME_STATE.BLOCKED_BY_OWNER, issues };
        }

        const inputProbe = registryEntry?.observed?.inputProbe;
        if (inputProbe?.status === 'passed') {
            const ageMs = this._probeAgeMs(inputProbe);
            if (ageMs === null || ageMs <= INPUT_PROBE_FRESH_MS) {
                return { runtimeState: TERMINAL_RUNTIME_STATE.INTERACTIVE_READY, issues };
            }
            return { runtimeState: TERMINAL_RUNTIME_STATE.SNAPSHOT_ONLY, issues };
        }

        const gateway = registryEntry?.observed?.gateway;
        if (gateway?.connected) {
            const ageMs = this._ageMs(gateway.lastSeenAt || gateway.connectedAt);
            if (ageMs === null || ageMs <= GATEWAY_STALE_MS) {
                return { runtimeState: TERMINAL_RUNTIME_STATE.TRANSPORT_CONNECTED, issues };
            }
        }
        return { runtimeState: TERMINAL_RUNTIME_STATE.SNAPSHOT_ONLY, issues };
    }

    async _killProcessAction({ sessionId, pid, type, reason, dryRun }) {
        const action = { sessionId, type, pid, reason, dryRun };
        if (!dryRun) {
            try {
                this.kill(pid, 'SIGTERM');
                action.success = true;
            } catch (error) {
                action.success = false;
                action.error = error.message;
            }
        }
        return action;
    }

    async _clearStaleOwnershipAction({ sessionId, ownerViewerId, dryRun }) {
        const action = {
            sessionId,
            type: 'clear_stale_ownership',
            ownerViewerId,
            reason: 'owner heartbeat expired',
            dryRun
        };
        if (!dryRun) {
            action.success = Boolean(this.ownershipService?.releaseTerminalOwnership?.(sessionId, ownerViewerId, { force: true }));
        }
        return action;
    }

    _issue(type, sessionId, severity, message) {
        return { type, sessionId, severity, message };
    }

    _probeAgeMs(inputProbe) {
        return this._ageMs(inputProbe?.lastPassedAt || inputProbe?.lastFailedAt);
    }

    _ageMs(isoOrMs) {
        if (!isoOrMs) return null;
        const time = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
        if (!Number.isFinite(time)) return null;
        return Math.max(0, Date.now() - time);
    }

    _withAge(value) {
        if (!value || typeof value !== 'object') return value || null;
        const ageMs = this._ageMs(value.lastSeenAt || value.lastPassedAt || value.lastFailedAt || value.connectedAt);
        return { ...value, ageMs };
    }
}

export { INPUT_PROBE_FRESH_MS, OWNERSHIP_STALE_MS, GATEWAY_STALE_MS };
