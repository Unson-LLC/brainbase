import { logger } from '../../utils/logger.js';
import { SessionHealthMonitor } from '../session-health-monitor.js';

export const runtimeMaintenanceMethods = {
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
            const restoreLimit = Math.max(0, parseInt(process.env.BRAINBASE_RESTORE_ACTIVE_LIMIT || '0', 10) || 0);
            const sessionsToRestore = restoreLimit > 0 ? activeSessions.slice(0, restoreLimit) : [];
            if (sessionsToRestore.length < activeSessions.length) {
                logger.info(`[restoreActiveSessions] Restoring ${sessionsToRestore.length}/${activeSessions.length} active session(s); remaining sessions stay lazy until opened`);
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

            for (const session of sessionsToRestore) {
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
                // 2026-05-21: consolidated path. Single source of truth for
                // tmux_missing → paused transition lives in _pauseSessionsForMissingTmux.
                await this._pauseSessionsForMissingTmux(pauseSessionIds, {
                    reason: 'tmux_missing_on_restore',
                });
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

    /**
     * tmux runtime が missing な active session を paused に flip する単一の
     * state transition point。 boot-time restore と periodic ensure ループの
     * 双方から呼ばれる。
     *
     * 2026-05-21: 17 sessions が tmux_missing で degraded のまま滞留した
     * incident への対応で抽出。以前は restoreActiveSessions が inline で同様
     * の更新を行い、ensureTtydForActiveSession は warn だけして state 更新を
     * 行っていなかった。 単一経路に集約して再発を防ぐ。
     *
     * @param {Iterable<string>} sessionIds
     * @param {{ reason: 'tmux_missing_on_restore'|'tmux_missing_runtime' }} options
     * @returns {Promise<{ paused: string[] }>}
     */
    async _pauseSessionsForMissingTmux(sessionIds, { reason } = {}) {
        const ids = new Set();
        for (const id of sessionIds || []) {
            if (typeof id === 'string' && id.length > 0) ids.add(id);
        }
        if (ids.size === 0) return { paused: [] };
        if (typeof reason !== 'string' || reason.length === 0) {
            throw new Error('[_pauseSessionsForMissingTmux] reason is required');
        }

        const now = new Date().toISOString();
        const currentState = this.stateStore.get();
        const updatedSessions = (currentState.sessions || []).map(session => {
            if (!ids.has(session.id)) return session;
            return {
                ...session,
                intendedState: 'paused',
                pausedReason: reason,
                pausedAt: now,
                tmuxMissingAt: now,
                ttydProcess: null,
                updatedAt: now,
            };
        });
        await this.stateStore.update({ ...currentState, sessions: updatedSessions });

        // Drop from active registry so future ensure ticks skip them.
        for (const id of ids) {
            this.activeSessions.delete(id);
        }

        logger.warn(
            `[_pauseSessionsForMissingTmux] Paused ${ids.size} session(s) with reason=${reason}: ${[...ids].join(', ')}`
        );
        return { paused: [...ids] };
    },

    /**
     * tmux pane が指定 threshold 以上稼働している active session を検知して
     * recycle する。 tmux を kill して codex/claude プロセスを破棄し、 state を
     * paused にする。 次回 user が start すると fresh tmux + agent が立ち上がる。
     *
     * 2026-05-22 incident: 「手紙改善」「運用報告書」 session が 10 日稼働で
     * codex プロセスの env スナップショットが凍結 (CLAUDE_CODE_OAUTH_TOKEN 等)
     * → token rotation 後に「壊れた」と codex が誤判定する事故。 上限 threshold
     * を設けて長期稼働 session を能動的に recycle する。
     *
     * @param {{ thresholdHours: number, reason?: string }} options
     * @returns {Promise<{ recycled: Array<{ id: string, uptimeHours: number }> }>}
     */
    async _pauseStaleSessionsByUptime({ thresholdHours, reason = 'stale_uptime_recycle' } = {}) {
        if (typeof thresholdHours !== 'number' || !(thresholdHours > 0)) {
            throw new Error('[_pauseStaleSessionsByUptime] thresholdHours must be a positive number');
        }

        const state = this.stateStore.get();
        const activeSessions = (state.sessions || []).filter((s) => s?.intendedState === 'active');
        if (activeSessions.length === 0) return { recycled: [] };

        const thresholdSec = thresholdHours * 3600;
        const nowSec = Math.floor(Date.now() / 1000);
        const stale = [];

        for (const s of activeSessions) {
            try {
                const { stdout } = await this.execPromise(
                    `tmux display -t '${s.id}' -p '#{session_created}' 2>/dev/null`
                );
                const created = parseInt(String(stdout).trim(), 10);
                if (!Number.isFinite(created)) continue;
                const uptimeSec = nowSec - created;
                if (uptimeSec >= thresholdSec) {
                    stale.push({ id: s.id, uptimeHours: Math.floor(uptimeSec / 3600) });
                }
            } catch (_) {
                // tmux not running for this session — handled by
                // ensureTtydForActiveSession via _pauseSessionsForMissingTmux.
            }
        }

        if (stale.length === 0) return { recycled: [] };

        // Kill tmux first so the env-frozen codex/claude process tree dies.
        // ttyd will exit on its own when tmux disappears.
        for (const { id, uptimeHours } of stale) {
            logger.warn(
                `[_pauseStaleSessionsByUptime] Recycling stale session ${id} (uptime=${uptimeHours}h >= threshold=${thresholdHours}h)`
            );
            await this.execPromise(`tmux kill-session -t '${id}' 2>/dev/null`).catch(() => {});
        }

        // Mark state via existing helper (single source of truth for paused
        // transition, PR #802).
        await this._pauseSessionsForMissingTmux(stale.map((x) => x.id), { reason });

        return { recycled: stale };
    },

    /**
     * Periodic recycler. Calls _pauseStaleSessionsByUptime on an interval.
     * Default: check every 1h with threshold 168h (7 days).
     * Env overrides:
     *   BRAINBASE_STALE_UPTIME_THRESHOLD_HOURS (default 168)
     *   BRAINBASE_STALE_UPTIME_CHECK_INTERVAL_MS (default 3600000)
     */
    startStaleSessionRecycler() {
        if (this._staleRecyclerTimer) return;
        const thresholdHours = Number(process.env.BRAINBASE_STALE_UPTIME_THRESHOLD_HOURS) || 168;
        const intervalMs = Number(process.env.BRAINBASE_STALE_UPTIME_CHECK_INTERVAL_MS) || 3600000;
        if (!(thresholdHours > 0) || !(intervalMs > 0)) {
            logger.warn(`[StaleSessionRecycler] disabled (threshold=${thresholdHours}h interval=${intervalMs}ms)`);
            return;
        }
        logger.info(`[StaleSessionRecycler] Starting (threshold=${thresholdHours}h, interval=${intervalMs / 1000}s)`);
        const tick = async () => {
            try {
                const { recycled } = await this._pauseStaleSessionsByUptime({ thresholdHours });
                if (recycled.length > 0) {
                    logger.warn(`[StaleSessionRecycler] Recycled ${recycled.length} session(s): ${recycled.map((x) => x.id).join(', ')}`);
                }
            } catch (err) {
                logger.error('[StaleSessionRecycler] Error:', err instanceof Error ? err.message : String(err));
            }
        };
        // Don't await — run async on interval
        this._staleRecyclerTimer = setInterval(tick, intervalMs);
        // Fire once immediately so boot-time long-running sessions get recycled.
        tick().catch(() => {});
    },

    stopStaleSessionRecycler() {
        if (this._staleRecyclerTimer) {
            clearInterval(this._staleRecyclerTimer);
            this._staleRecyclerTimer = null;
            logger.info('[StaleSessionRecycler] Stopped');
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
                if (session.archive?.status && session.archive.status !== 'cleaned') {
                    return true;
                }
                if (!session.archive?.status && session.worktree) {
                    return true;
                }

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

    async repairActiveTtydSessions({ sessionId = null } = {}) {
        if (this._isXtermOnlyMode()) {
            return { checked: 0, restarted: 0, failed: 0, skipped: 0 };
        }

        const state = this.stateStore.get();
        const activeSessions = (state.sessions || []).filter((session) =>
            session?.intendedState === 'active'
            && (!sessionId || session.id === sessionId)
        );
        const result = { checked: 0, restarted: 0, failed: 0, skipped: 0 };

        for (const session of activeSessions) {
            result.checked += 1;
            const runtimeStatus = this.getRuntimeStatus(session);
            if (runtimeStatus.ttydRunning) {
                result.skipped += 1;
                continue;
            }

            try {
                const repair = await this.ensureTtydForActiveSession(session);
                if (repair.restarted) {
                    result.restarted += 1;
                } else {
                    result.skipped += 1;
                }
            } catch (err) {
                result.failed += 1;
                logger.error(`[repairActiveTtydSessions] Failed to repair ${session.id}:`, err);
            }
        }

        if (result.restarted > 0 || result.failed > 0) {
            logger.warn(`[repairActiveTtydSessions] checked=${result.checked} restarted=${result.restarted} failed=${result.failed} skipped=${result.skipped}`);
        }

        return result;
    },

    startPtyWatchdog(intervalMs = 600000) {
        if (this._ptyWatchdogTimer) return;
        logger.info(`[PTY Watchdog] Starting (interval: ${intervalMs / 1000}s)`);

        this._healthMonitor = new SessionHealthMonitor({
            runtimeRegistry: this.runtimeRegistry,
            runtimeQuery: this.runtimeQuery
        }, {
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

                if (typeof this.runtimeReconciler?.reconcile === 'function') {
                    const reconcileResult = await this.runtimeReconciler.reconcile({ dryRun: false, recover: true });
                    const recoveryActions = (reconcileResult.actions || []).filter((action) =>
                        action.type === 'restart_terminal_runtime' || action.success === true
                    );
                    if (recoveryActions.length > 0) {
                        logger.warn(`[PTY Watchdog] Runtime reconciliation recovered ${recoveryActions.length} issue(s)`);
                    }
                }

                await this.repairActiveTtydSessions();
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
    }
};
