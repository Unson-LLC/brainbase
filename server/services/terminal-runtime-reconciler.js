import { execSync } from 'child_process';
import { TERMINAL_RUNTIME_STATE } from './terminal-runtime-registry.js';

const INPUT_PROBE_FRESH_MS = 60_000;
const OWNERSHIP_STALE_MS = 90_000;
const GATEWAY_STALE_MS = 45_000;
const PANE_CAPTURE_LINES = 80;
const PANE_ERROR_FLOOD_MIN_LINES = 12;
const PANE_ERROR_FLOOD_MIN_RATIO = 0.55;
const CODEX_PANE_ERROR_PATTERNS = [
    /MallocStackLogging: can't turn off malloc stack logging because it was not enabled\./
];

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

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function detectPaneErrorFlood(text) {
    const lines = String(text || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(-PANE_CAPTURE_LINES);
    if (lines.length === 0) {
        return { stuck: false, matchedLines: 0, totalLines: 0, ratio: 0 };
    }
    const matchedLines = lines.filter((line) =>
        CODEX_PANE_ERROR_PATTERNS.some((pattern) => pattern.test(line))
    ).length;
    const ratio = matchedLines / lines.length;
    return {
        stuck: matchedLines >= PANE_ERROR_FLOOD_MIN_LINES && ratio >= PANE_ERROR_FLOOD_MIN_RATIO,
        matchedLines,
        totalLines: lines.length,
        ratio
    };
}

function extractCodexResumeId(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    return match ? match[1] : null;
}

function getCodexResumeId(session, engine) {
    const selectedEngine = typeof engine === 'string' && engine.trim()
        ? engine
        : session?.engine;
    if (!session || selectedEngine !== 'codex') return null;
    return session.codexThreadId
        || session.conversationSummary?.codexThreadId
        || session.conversationSummary?.lastConversation?.resumeId
        || extractCodexResumeId(session.conversationSummary?.lastConversation?.conversationId)
        || null;
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
                session,
                name: session.name || sessionId,
                engine: session.engine || null,
                intendedState: session.intendedState || 'active',
                ttyd: ttydProcesses.filter((proc) => proc.sessionId === sessionId),
                tmux,
                pane: this._observePane(sessionId, session?.intendedState, tmux),
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
                pane: null,
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
                    pane: entry.pane,
                    ttyd: {
                        running: ttyds.length > 0,
                        duplicates: Math.max(0, ttyds.length - 1),
                        processes: ttyds.map(({ pid, ppid, pgid, command }) => ({ pid, ppid, pgid, command }))
                    },
                    ownership: entry.ownership
                }
            });

            if (recover && entry.intendedState === 'active' && classification.runtimeState === TERMINAL_RUNTIME_STATE.DEGRADED) {
                const hasPaneErrorFlood = classification.issues.some((issue) => issue.type === 'codex_pane_error_flood');
                if (hasPaneErrorFlood) {
                    actions.push(await this._restartRuntimeAction({
                        entry,
                        reason: 'codex_pane_error_flood',
                        dryRun
                    }));
                } else {
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
                    pane: entry.pane,
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

    _observePane(sessionId, intendedState, tmux = null) {
        if (intendedState !== 'active' || !sessionId || tmux?.exists === false) {
            return null;
        }
        try {
            const stdout = this.execSync(`tmux capture-pane -t ${shellQuote(sessionId)} -p -S -${PANE_CAPTURE_LINES}`, { encoding: 'utf8' });
            const diagnostic = detectPaneErrorFlood(stdout);
            return {
                checked: true,
                stuck: diagnostic.stuck,
                matchedLines: diagnostic.matchedLines,
                totalLines: diagnostic.totalLines,
                ratio: diagnostic.ratio
            };
        } catch (error) {
            return {
                checked: false,
                stuck: false,
                observationError: error instanceof Error ? error.message : 'pane_observation_failed'
            };
        }
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
        if (entry.pane?.stuck) {
            issues.push(this._issue(
                'codex_pane_error_flood',
                entry.sessionId,
                'critical',
                `Terminal pane is dominated by Codex error output (${entry.pane.matchedLines}/${entry.pane.totalLines} recent lines).`
            ));
            return { runtimeState: TERMINAL_RUNTIME_STATE.DEGRADED, issues };
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

    async _restartRuntimeAction({ entry, reason, dryRun }) {
        const session = entry.session || {};
        const engine = session.engine || entry.engine || 'claude';
        const cwd = session.worktree?.path || session.path || session.cwd || undefined;
        const action = {
            sessionId: entry.sessionId,
            type: 'restart_terminal_runtime',
            reason,
            dryRun
        };
        if (!dryRun) {
            try {
                await this.runtimeLifecycle?.stopTtyd?.(entry.sessionId, { preserveTmux: false });
                const startOptions = {
                    sessionId: entry.sessionId,
                    cwd,
                    initialCommand: session.initialCommand || '',
                    engine,
                    forceTtyd: true
                };
                const codexResumeId = getCodexResumeId(session, engine);
                if (codexResumeId) {
                    startOptions.codexResumeId = codexResumeId;
                }
                action.result = await this.runtimeLifecycle?.startTtyd?.(startOptions);
                action.success = true;
            } catch (error) {
                action.success = false;
                action.error = error instanceof Error ? error.message : String(error);
            }
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

export { INPUT_PROBE_FRESH_MS, OWNERSHIP_STALE_MS, GATEWAY_STALE_MS, detectPaneErrorFlood };
