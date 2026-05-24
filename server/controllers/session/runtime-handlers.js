// @ts-check
import { exec } from 'child_process';
import { promisify } from 'util';

import { logger } from '../../utils/logger.js';
import { TAKEOVER_COOLDOWN_MS } from './constants.js';

const execAsync = promisify(exec);

function isMissingTmuxPaneError(error) {
    const message = error instanceof Error ? error.message : String(error || '');
    return message.includes("can't find pane") || message.includes('no server running on');
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

async function repairCollapsedTerminalGeometry(controller, sessionId, reason) {
    if (typeof controller.terminalIo?.repairCollapsedSessionWindow !== 'function') {
        return null;
    }
    const result = await controller.terminalIo.repairCollapsedSessionWindow(sessionId, { reason });
    if (result?.repaired) {
        controller.captureCache?.invalidate?.(sessionId);
        logger.warn('[MOBILE_TERMINAL_GEOMETRY] repaired collapsed pane before terminal response', {
            sessionId,
            reason,
            paneSize: result.paneSize,
            repairedPaneSize: result.repairedPaneSize
        });
        return result;
    }
    return null;
}

function isInteractiveRuntimeReady(runtimeStatus = {}, observedRuntime = null) {
    const runtimeState = observedRuntime?.runtimeState || runtimeStatus?.runtimeState;
    const inputProbe = observedRuntime?.observed?.inputProbe || runtimeStatus?.inputProbe || null;
    const inputReady = inputProbe?.status === 'passed' || runtimeStatus?.inputReady === true;
    return runtimeState === 'interactive_ready' && inputReady;
}

function buildObservedRuntimeStatus(baseRuntimeStatus = {}, observedRuntime = null) {
    return {
        ...(baseRuntimeStatus || {}),
        ...(observedRuntime?.runtimeState ? { runtimeState: observedRuntime.runtimeState } : {}),
        ...(Array.isArray(observedRuntime?.issues) ? { issues: observedRuntime.issues } : {}),
        ...(observedRuntime?.observed?.ttyd ? { observedTtyd: observedRuntime.observed.ttyd } : {}),
        ...(observedRuntime?.observed?.inputProbe ? {
            inputProbe: observedRuntime.observed.inputProbe,
            inputReady: observedRuntime.observed.inputProbe.status === 'passed'
        } : {})
    };
}

function isStartupShell(session) {
    return session?.startupStatus === 'pending' || session?.startupStatus === 'failed';
}

function hasRuntimeIssue(runtimeStatus, issueType) {
    return Array.isArray(runtimeStatus?.issues)
        && runtimeStatus.issues.some((issue) => issue?.type === issueType);
}

function hasUnsafeTtydIssue(runtimeStatus) {
    return hasRuntimeIssue(runtimeStatus, 'stale_ttyd_process')
        || hasRuntimeIssue(runtimeStatus, 'ttyd_port_conflict');
}

function stripUnsafeTtydRuntime(runtimeStatus = {}) {
    if (!hasUnsafeTtydIssue(runtimeStatus)) return runtimeStatus;
    return {
        ...runtimeStatus,
        ttydRunning: false,
        proxyPath: null,
        interactiveUrl: null,
        inputReady: false
    };
}

function runtimeHealthEntryToObservedRuntime(healthEntry) {
    if (!healthEntry) return null;
    return {
        runtimeState: healthEntry.runtimeState,
        issues: healthEntry.issues || [],
        observed: healthEntry.observed || null
    };
}

export function installRuntimeHandlers(controller) {
    controller.get = async (req, res) => {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        const session = controller._findSessionOrFail(id, res);
        if (!session) return;

        const resolvedPath = await controller._resolveSessionWorkspacePath(session, { persist: true, preferTmux: true });
        const runtimeStatus = controller._getSessionRuntimeStatus(session);

        res.json({
            ...session,
            path: resolvedPath || session.path,
            worktree: session.worktree
                ? { ...session.worktree, path: resolvedPath || session.worktree.path }
                : session.worktree,
            runtimeStatus
        });
    };

    controller.getRuntime = async (req, res) => {
        const { id } = req.params;
        const viewerId = typeof req.query?.viewerId === 'string' ? req.query.viewerId.trim() : '';
        const viewerLabel = controller._resolveViewerLabel(req, req.query?.viewerLabel);
        if (!id) {
            return res.status(400).json({ error: 'Session ID is required' });
        }
        if (!viewerId) {
            return res.status(400).json({ error: 'viewerId is required' });
        }

        const session = controller._getSessionById(id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        if (isStartupShell(session)) {
            return res.status(409).json({
                error: 'Session startup is not ready for terminal snapshot.',
                startupStatus: session.startupStatus,
                startupPhase: session.startupPhase || null,
                startupMessage: session.startupMessage || null
            });
        }

        const terminalAccess = controller.ownership.getTerminalAccessState(id, viewerId);
        let effectiveSession = session;
        let baseRuntimeStatus = session.runtimeStatus || {};
        let observedRuntime = controller.runtimeRegistry?.getSession?.(id) || null;
        if (
            session?.intendedState === 'active'
            && session?.ttydProcess
            && !hasUnsafeTtydIssue(observedRuntime)
            && typeof controller.runtimeReconciler?.reconcile === 'function'
        ) {
            try {
                const reconcileResult = await controller.runtimeReconciler.reconcile({
                    sessionId: id,
                    dryRun: true,
                    recover: false
                });
                observedRuntime = runtimeHealthEntryToObservedRuntime(
                    (reconcileResult?.health?.sessionHealth || []).find((entry) => entry.sessionId === id)
                ) || controller.runtimeRegistry?.getSession?.(id) || observedRuntime;
            } catch (error) {
                logger.warn(`[runtime] Failed to refresh observed runtime for ${id}:`, error);
            }
        }
        const blocked = terminalAccess?.state === 'blocked';
        const runtimeStatus = controller._withViewerRuntimeStatus({
            ...stripUnsafeTtydRuntime(buildObservedRuntimeStatus(effectiveSession.runtimeStatus || baseRuntimeStatus || {}, observedRuntime)),
            ...(blocked ? {
                inputReady: false,
                interactiveUrl: null,
                proxyPath: null
            } : {})
        }, viewerId);

        res.json({
            sessionId: id,
            runtimeStatus,
            terminalAccess
        });
    };

    controller.getRuntimeInventory = async (_req, res) => {
        if (typeof controller.runtimeQuery?.getRuntimeInventory !== 'function') {
            return res.status(501).json({ error: 'Runtime inventory is not available' });
        }

        try {
            const inventory = await controller.runtimeQuery.getRuntimeInventory();
            return res.json(inventory);
        } catch (error) {
            logger.error('[runtime-inventory] Failed to collect runtime inventory:', error);
            return res.status(500).json({ error: 'Failed to collect runtime inventory' });
        }
    };

    controller.getHibernateEligibility = async (req, res) => {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Session ID is required' });
        }
        if (typeof controller.runtimeQuery?.getHibernationEligibility !== 'function') {
            return res.status(501).json({ error: 'Hibernation eligibility is not available' });
        }

        const session = controller._getSessionById(id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        try {
            const activityStatus = controller.activity?.getSessionStatus?.()?.[id] || null;
            const owner = controller.ownership?.getTerminalOwnerSnapshot?.(id) || null;
            const pendingInput = controller.activity?.promptBuffers?.get?.(id) || '';
            const eligibility = await controller.runtimeQuery.getHibernationEligibility(id, {
                activityStatus,
                owner,
                pendingInput
            });

            if (!eligibility) {
                return res.status(404).json({ error: 'Session not found' });
            }

            return res.json(eligibility);
        } catch (error) {
            logger.error('[hibernation] Failed to evaluate eligibility:', error);
            return res.status(500).json({ error: 'Failed to evaluate hibernation eligibility' });
        }
    };

    controller.ensureTerminalRuntime = async (req, res) => {
        const { id } = req.params;
        const { initialCommand, cwd, engine, viewerId, forceTtyd } = req.body || {};
        const session = controller._findSessionOrFail(id, res);
        if (!session) return;
        if (session.intendedState === 'archived') {
            return res.status(409).json({ error: 'Session is archived. Use restore to reactivate.' });
        }
        if (isStartupShell(session)) {
            return res.status(409).json({
                error: 'Session startup is not ready for terminal runtime.',
                startupStatus: session.startupStatus,
                startupPhase: session.startupPhase || null,
                startupMessage: session.startupMessage || null
            });
        }

        try {
            const trimmedViewerId = typeof viewerId === 'string' ? viewerId.trim() : '';
            const terminalAccess = trimmedViewerId
                ? controller.ownership.getTerminalAccessState(id, trimmedViewerId)
                : null;
            const observedRuntime = controller.runtimeRegistry?.getSession?.(id) || null;
            const baseRuntimeStatus = session.runtimeStatus || {};
            const runtimeStatus = buildObservedRuntimeStatus(baseRuntimeStatus, observedRuntime);
            if (
                !forceTtyd
                && session.intendedState === 'active'
                && terminalAccess?.state !== 'blocked'
                && isInteractiveRuntimeReady(runtimeStatus, observedRuntime)
            ) {
                return res.json({
                    sessionId: id,
                    runtimeStatus: controller._withViewerRuntimeStatus(runtimeStatus, trimmedViewerId),
                    terminalAccess,
                    fastPath: true
                });
            }

            const resolvedCwd = await controller._resolveSessionWorkspacePath(session, { persist: true, preferTmux: true });
            const runtimeOptions = {
                sessionId: id,
                cwd: typeof resolvedCwd === 'string' && resolvedCwd.trim()
                    ? resolvedCwd
                    : (typeof cwd === 'string' && cwd.trim() ? cwd : undefined),
                initialCommand: typeof initialCommand === 'string' ? initialCommand : (session.initialCommand || ''),
                engine: typeof engine === 'string' && engine.trim() ? engine : (session.engine || 'claude')
            };
            const codexResumeId = getCodexResumeId(session, runtimeOptions.engine);
            if (codexResumeId) {
                runtimeOptions.codexResumeId = codexResumeId;
            }
            let ttydResult = null;

            if (forceTtyd) {
                ttydResult = await controller.runtimeLifecycle.startTtyd({
                    ...runtimeOptions,
                    forceTtyd: true
                });
            } else {
                await controller.runtimeLifecycle.ensureSessionRuntime(runtimeOptions);
            }

            if (session.intendedState !== 'active') {
                await controller._updateStateWithRetry((currentState) => {
                    const updatedSessions = (currentState.sessions || []).map((currentSession) =>
                        currentSession.id === id
                            ? {
                                ...currentSession,
                                intendedState: 'active',
                                pausedAt: null,
                                pausedReason: null,
                                updatedAt: new Date().toISOString()
                            }
                            : currentSession
                    );
                    return { ...currentState, sessions: updatedSessions };
                });
            }

            const geometryRepair = await repairCollapsedTerminalGeometry(controller, id, 'terminal-ensure');
            const updatedSession = controller._getSessionById(id);
            const updatedTerminalAccess = trimmedViewerId
                ? controller.ownership.getTerminalAccessState(id, trimmedViewerId)
                : null;
            const response = {
                sessionId: id,
                runtimeStatus: controller._withViewerRuntimeStatus(updatedSession?.runtimeStatus || null, trimmedViewerId),
                terminalAccess: updatedTerminalAccess
            };
            if (geometryRepair) {
                response.geometryRepair = geometryRepair;
            }
            if (ttydResult) {
                response.port = ttydResult.port;
                response.proxyPath = controller._appendViewerIdToProxyPath(ttydResult.proxyPath, trimmedViewerId);
            }
            res.json(response);
        } catch (error) {
            console.error('Failed to ensure terminal runtime:', error);
            res.status(500).json({ error: error.message || 'Failed to ensure terminal runtime' });
        }
    };

    controller.releaseTerminal = (req, res) => {
        const { id } = req.params;
        const viewerId = typeof req.body?.viewerId === 'string' ? req.body.viewerId.trim() : '';
        if (!id) {
            return res.status(400).json({ error: 'Session ID is required' });
        }
        if (!viewerId) {
            return res.status(400).json({ error: 'viewerId is required' });
        }

        const released = controller.ownership.releaseTerminalOwnership(id, viewerId);
        const terminalAccess = controller.ownership.getTerminalAccessState(id, viewerId);
        res.json({ success: released, terminalAccess });
    };

    controller.takeoverTerminal = (req, res) => {
        const { id } = req.params;
        const viewerId = typeof req.body?.viewerId === 'string' ? req.body.viewerId.trim() : '';
        const viewerLabel = controller._resolveViewerLabel(req, req.body?.viewerLabel);
        if (!id) {
            return res.status(400).json({ error: 'Session ID is required' });
        }
        if (!viewerId) {
            return res.status(400).json({ error: 'viewerId is required' });
        }
        const ownership = controller.ownership.forceTerminalOwnership(id, viewerId, viewerLabel);
        res.json({ success: ownership.allowed, terminalAccess: ownership.terminalAccess });
    };

    controller.getTerminalSnapshot = async (req, res) => {
        const { id } = req.params;
        const viewerId = typeof req.query?.viewerId === 'string' ? req.query.viewerId.trim() : '';
        const viewerLabel = controller._resolveViewerLabel(req, req.query?.viewerLabel);
        const lines = Math.max(50, Math.min(5000, Number.parseInt(req.query?.lines, 10) || 200));
        const requestedVisibleOnly = req.query?.visibleOnly === '1' || req.query?.visibleOnly === 'true';

        if (!id) {
            return res.status(400).json({ error: 'Session ID is required' });
        }
        if (!viewerId) {
            return res.status(400).json({ error: 'viewerId is required' });
        }

        const session = controller._getSessionById(id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        if (isStartupShell(session)) {
            return res.status(409).json({
                error: 'Session startup is not ready for terminal snapshot.',
                startupStatus: session.startupStatus,
                startupPhase: session.startupPhase || null,
                startupMessage: session.startupMessage || null
            });
        }

        const terminalAccess = controller.ownership.getTerminalAccessState(id, viewerId);
        const visibleOnly = terminalAccess?.state === 'blocked' ? false : requestedVisibleOnly;

        try {
            const geometryRepair = await repairCollapsedTerminalGeometry(controller, id, 'terminal-snapshot');
            const payload = controller.captureCache
                ? await controller.captureCache.getSnapshot(id, {
                    lines,
                    includeColors: true,
                    includeCopyMode: true,
                    visibleOnly
                })
                : await (async () => {
                    const [text, colorText, copyMode, cursor] = await Promise.all([
                        visibleOnly && typeof controller.snapshot.getVisibleContent === 'function'
                            ? controller.snapshot.getVisibleContent(id)
                            : controller.snapshot.getContent(id, lines),
                        visibleOnly && typeof controller.snapshot.getVisibleContentWithColors === 'function'
                            ? controller.snapshot.getVisibleContentWithColors(id).catch(() => null)
                            : controller.snapshot.getContentWithColors(id, lines).catch(() => null),
                        controller.snapshot.getPaneMode(id).catch(() => false),
                        typeof controller.snapshot.getCursorPosition === 'function'
                            ? controller.snapshot.getCursorPosition(id).catch(() => null)
                            : Promise.resolve(null),
                    ]);
                    return {
                        text,
                        colorText,
                        copyMode,
                        cursor,
                        capturedAt: new Date().toISOString()
                    };
                })();
            const response = {
                sessionId: id,
                text: payload.text,
                copyMode: payload.copyMode,
                cursor: payload.cursor || null,
                capturedAt: payload.capturedAt,
                terminalAccess
            };
            if (geometryRepair) response.geometryRepair = geometryRepair;
            if (payload.colorText) response.colorText = payload.colorText;
            res.json(response);
        } catch (error) {
            if (isMissingTmuxPaneError(error)) {
                logger.debug?.('[terminal snapshot] stale tmux pane', { sessionId: id });
                return res.json({
                    sessionId: id,
                    text: '',
                    colorText: null,
                    copyMode: false,
                    cursor: null,
                    capturedAt: new Date().toISOString(),
                    terminalAccess: terminalAccess || null,
                    source: 'stale_tmux_pane',
                    stale: true
                });
            }
            controller._respondError(res, `Failed to get terminal snapshot for ${id}:`, error);
        }
    };

    controller.probeTerminalInput = async (req, res) => {
        const { id } = req.params;
        const viewerId = typeof req.body?.viewerId === 'string' ? req.body.viewerId.trim() : '';
        const viewerLabel = controller._resolveViewerLabel(req, req.body?.viewerLabel);
        if (!id) return res.status(400).json({ error: 'Session ID is required' });
        if (!viewerId) return res.status(400).json({ error: 'viewerId is required' });
        if (!controller.terminalInputProbe?.probe) {
            return res.status(503).json({ error: 'Terminal input probe is not available' });
        }
        const session = controller._findSessionOrFail(id, res);
        if (!session) return;
        if (isStartupShell(session)) {
            return res.status(409).json({
                error: 'Session startup is not ready for terminal input probe.',
                startupStatus: session.startupStatus,
                startupPhase: session.startupPhase || null,
                startupMessage: session.startupMessage || null
            });
        }

        const result = await controller.terminalInputProbe.probe({ sessionId: id, viewerId, viewerLabel });
        if (!result.success) {
            const status = result.code === 'SESSION_OWNED_BY_OTHER_VIEWER' ? 409 : 409;
            return res.status(status).json(result);
        }
        res.json(result);
    };

    controller.recoverTerminal = async (req, res) => {
        const { id } = req.params;
        const dryRun = req.body?.dryRun === true;
        if (!id) return res.status(400).json({ error: 'Session ID is required' });
        const session = controller._getSessionById?.(id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        if (isStartupShell(session)) {
            return res.status(409).json({
                error: 'Session startup is not ready for terminal recovery.',
                startupStatus: session.startupStatus,
                startupPhase: session.startupPhase || null,
                startupMessage: session.startupMessage || null
            });
        }
        if (!controller.runtimeReconciler?.reconcile) {
            return res.status(503).json({ error: 'Terminal runtime reconciler is not available' });
        }
        try {
            const result = await controller.runtimeReconciler.reconcile({ sessionId: id, dryRun, recover: true });
            res.json(result);
        } catch (error) {
            controller._respondError(res, `Failed to recover terminal runtime for ${id}:`, error);
        }
    };

    controller.start = async (req, res) => {
        const { sessionId, initialCommand, cwd, engine, viewerId, forceTakeover = false, forceTtyd = false } = req.body;
        const viewerLabel = controller._resolveViewerLabel(req, req.body?.viewerLabel);
        logger.debug(`[DEBUG] /api/sessions/start called: sessionId=${sessionId}, referer=${req.headers.referer}, userAgent=${req.headers['user-agent']?.substring(0, 50)}`);
        logger.debug('[DEBUG] Request stack:', new Error().stack?.split('\n').slice(1, 4).join(' <- '));

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }
        if (!viewerId || typeof viewerId !== 'string' || !viewerId.trim()) {
            return res.status(400).json({ error: 'viewerId is required' });
        }

        const currentState = controller.stateStore.get();
        const targetSession = (currentState.sessions || []).find((session) => session.id === sessionId);
        if (targetSession?.intendedState === 'archived') {
            logger.info(`[start] Rejected: session ${sessionId} is archived`);
            return res.status(409).json({ error: 'Session is archived. Use restore to reactivate.' });
        }
        if (isStartupShell(targetSession)) {
            logger.info(`[start] Rejected: session ${sessionId} startup is not ready`);
            return res.status(409).json({
                error: 'Session startup is not ready for terminal runtime.',
                startupStatus: targetSession.startupStatus,
                startupPhase: targetSession.startupPhase || null,
                startupMessage: targetSession.startupMessage || null
            });
        }
        if (targetSession?.workspaceRotationStatus === 'rotating') {
            logger.info(`[start] Rejected: session ${sessionId} is rotating workspace generation`);
            return res.status(409).json({ error: 'Session workspace generation is rotating', rotating: true });
        }
        if (targetSession?.workspaceRotationStatus === 'blocked') {
            logger.info(`[start] Rejected: session ${sessionId} workspace rotation is blocked`);
            return res.status(409).json({
                error: targetSession.workspaceRotationError || 'Session workspace generation rotation is blocked',
                rotationBlocked: true
            });
        }

        try {
            controller.activity.clearDoneStatus(sessionId);

            const ownership = forceTakeover
                ? controller.ownership.forceTerminalOwnership(sessionId, viewerId, viewerLabel)
                : controller.ownership.ensureTerminalOwnership(sessionId, viewerId, viewerLabel);

            if (!ownership.allowed) {
                return res.status(409).json({
                    error: 'Session is already open in another viewer',
                    code: 'SESSION_OWNED_BY_OTHER_VIEWER',
                    terminalAccess: ownership.terminalAccess
                });
            }

            const existingSession = controller._getActiveSessionEntry(sessionId);
            if (!controller._isXtermOnlyMode() && existingSession) {
                const pid = existingSession.process?.pid || existingSession.pid;
                if (pid && controller._isProcessRunning(pid)) {
                    if (!forceTakeover) {
                        return res.json({
                            port: existingSession.port,
                            proxyPath: controller._appendViewerIdToProxyPath(`/console/${sessionId}`, viewerId),
                            startedExisting: true,
                            takeoverSkipped: true,
                            terminalAccess: ownership.terminalAccess
                        });
                    }

                    const lastStartedAt = controller._recentSessionStarts.get(sessionId) || 0;
                    const startedAgoMs = Date.now() - lastStartedAt;
                    if (startedAgoMs >= 0 && startedAgoMs < TAKEOVER_COOLDOWN_MS) {
                        logger.info(`[takeover] Session ${sessionId}: skipped restart during cooldown (${startedAgoMs}ms since last start)`);
                        return res.json({
                            port: existingSession.port,
                            proxyPath: controller._appendViewerIdToProxyPath(`/console/${sessionId}`, viewerId),
                            startedExisting: true,
                            takeoverSkipped: true,
                            terminalAccess: ownership.terminalAccess
                        });
                    }

                    logger.info(`[takeover] Session ${sessionId}: restarting ttyd for new client (killing pid ${pid})`);
                    await controller.runtimeLifecycle.stopTtyd(sessionId, { preserveTmux: true });
                    await new Promise((resolve) => setTimeout(resolve, 300));
                }
            }

            const startOptions = { sessionId };
            const resolvedCwd = targetSession
                ? await controller._resolveSessionWorkspacePath(targetSession, { persist: true, preferTmux: true })
                : null;

            const isEphemeral = (value) => typeof value === 'string'
                && (value === '/tmp' || value.startsWith('/tmp/') || value === '/private/tmp' || value.startsWith('/private/tmp/'));
            if (typeof resolvedCwd === 'string' && resolvedCwd.trim() && !isEphemeral(resolvedCwd)) {
                startOptions.cwd = resolvedCwd;
            } else if (typeof cwd === 'string' && cwd.trim() && !isEphemeral(cwd)) {
                startOptions.cwd = cwd;
            }
            if (typeof initialCommand === 'string') {
                startOptions.initialCommand = initialCommand;
            }
            if (typeof engine === 'string' && engine.trim()) {
                startOptions.engine = engine;
            }
            const codexResumeId = getCodexResumeId(targetSession, startOptions.engine);
            if (codexResumeId) {
                startOptions.codexResumeId = codexResumeId;
            }
            if (forceTtyd) startOptions.forceTtyd = true;

            const result = await controller.runtimeLifecycle.startTtyd(startOptions);
            controller._recentSessionStarts.set(sessionId, Date.now());

            await controller._updateStateWithRetry((state) => {
                const updatedSessions = (state.sessions || []).map((session) => {
                    if (session.id !== sessionId) return session;
                    const updates = { ...session, intendedState: 'active', updatedAt: new Date().toISOString() };
                    if (startOptions.engine) {
                        updates.engine = startOptions.engine;
                    }
                    return updates;
                });
                return { ...state, sessions: updatedSessions };
            });

            res.json({
                ...result,
                proxyPath: controller._appendViewerIdToProxyPath(result.proxyPath, viewerId),
                runtimeStatus: controller._withViewerRuntimeStatus(
                    controller._getSessionRuntimeStatus(
                        controller.stateStore.get().sessions?.find((session) => session.id === sessionId)
                        || targetSession
                        || { id: sessionId, intendedState: 'active' }
                    ),
                    viewerId
                ),
                terminalAccess: ownership.terminalAccess
            });
        } catch (error) {
            controller._respondError(res, 'Failed to start session:', error);
        }
    };

    controller.stop = async (req, res) => {
        const { id } = req.params;
        const { preserveTmux = false } = req.body || {};

        try {
            const stopped = await controller.runtimeLifecycle.stopTtyd(id, { preserveTmux });

            if (!stopped) {
                return res.status(404).json({ error: 'Session not found or already stopped' });
            }

            if (!preserveTmux) {
                const now = new Date().toISOString();
                await controller._updateStateWithRetry((state) => {
                    const updatedSessions = (state.sessions || []).map((session) =>
                        session.id === id
                            ? {
                                ...session,
                                intendedState: 'paused',
                                pausedReason: 'manual',
                                pausedAt: now,
                                updatedAt: now
                            }
                            : session
                    );
                    return { ...state, sessions: updatedSessions };
                });
            }

            res.json({ success: true });
        } catch (error) {
            logger.error(`[stop] Error stopping session ${id}:`, error);
            res.status(500).json({ error: 'Failed to stop session', detail: error.message });
        }
    };

    controller.archive = async (req, res) => {
        const { id } = req.params;

        try {
            const session = controller._findSessionOrFail(id, res);
            if (!session) return;

            try {
                await controller.runtimeLifecycle.stopTtyd(id);
            } catch (ttydError) {
                logger.error(`[archive] Failed to stop ttyd for ${id}:`, ttydError.message);
            }

            await controller._updateStateWithRetry((state) => {
                const updatedSessions = state.sessions.map((session) =>
                    session.id === id
                        ? {
                            ...session,
                            intendedState: 'archived',
                            archivedAt: new Date().toISOString(),
                            archive: {
                                ...(session.archive || {}),
                                status: 'queued',
                                blockerReason: null,
                                updatedAt: new Date().toISOString()
                            }
                        }
                        : session
                );
                return { ...state, sessions: updatedSessions };
            });

            await controller.archiveFinalizer?.enqueue?.(id);

            res.json({ success: true, archive: { status: 'queued' } });
        } catch (error) {
            logger.error(`[archive] Error archiving session ${id}:`, error);
            res.status(500).json({ error: 'Failed to archive session', detail: error.message });
        }
    };

    controller.getArchiveStatus = async (req, res) => {
        const { id } = req.params;
        try {
            const session = controller._findSessionOrFail(id, res);
            if (!session) return;
            res.json({ success: true, archive: session.archive || null });
        } catch (error) {
            controller._respondError(res, 'Failed to get archive status', error);
        }
    };

    controller.finalizeArchive = async (req, res) => {
        const { id } = req.params;
        try {
            if (!controller.archiveFinalizer?.finalize) {
                return res.status(503).json({ error: 'Archive finalizer is not available' });
            }
            const result = await controller.archiveFinalizer.finalize(id);
            res.json(result);
        } catch (error) {
            controller._respondError(res, 'Failed to finalize archive', error);
        }
    };

    controller.restore = async (req, res) => {
        const { id } = req.params;
        const { engine: requestEngine } = req.body;
        const session = controller._findSessionOrFail(id, res);
        if (!session) return;

        if (session.intendedState !== 'archived') {
            return res.status(400).json({ error: 'Session is not archived' });
        }

        const engine = requestEngine || session.engine || 'claude';

        try {
            let restoredWorkspacePath = session.worktree?.path || session.path || session.cwd;
            const resolvedRepoPath = await controller._resolveRepoPath(session.worktree?.repo || null, session.project);

            if (resolvedRepoPath) {
                try {
                    const worktreeResult = await controller.worktreeService.create(id, resolvedRepoPath);
                    if (worktreeResult?.worktreePath) {
                        restoredWorkspacePath = worktreeResult.worktreePath;
                    } else {
                        throw new Error('worktreeService.create returned null');
                    }
                } catch (worktreeError) {
                    const fallbackPath = session.worktree?.path || session.path || session.cwd;
                    if (await controller._pathExists(fallbackPath)) {
                        restoredWorkspacePath = fallbackPath;
                        logger.warn(
                            `[restore] Failed to recreate worktree for ${id}, reusing existing workspace: ${fallbackPath}. ${worktreeError.message}`
                        );
                    } else {
                        return res.status(500).json({
                            error: 'Failed to restore worktree',
                            detail: worktreeError.message
                        });
                    }
                }
            }

            controller.activity.clearDoneStatus(id);

            const codexResumeId = getCodexResumeId(session, engine);
            const result = await controller.runtimeLifecycle.startTtyd({
                sessionId: id,
                cwd: restoredWorkspacePath,
                initialCommand: session.initialCommand,
                engine,
                ...(codexResumeId ? { codexResumeId } : {})
            });

            await controller._updateStateWithRetry((state) => {
                const updatedSessions = state.sessions.map((entry) => {
                    if (entry.id !== id) return entry;
                    const { archivedAt, ...rest } = entry;
                    return {
                        ...rest,
                        path: restoredWorkspacePath,
                        worktree: rest.worktree
                            ? { ...rest.worktree, repo: resolvedRepoPath, path: restoredWorkspacePath }
                            : rest.worktree,
                        intendedState: 'active',
                        engine
                    };
                });
                return { ...state, sessions: updatedSessions };
            });

            res.json({
                success: true,
                port: result.port,
                proxyPath: result.proxyPath
            });
        } catch (error) {
            controller._respondError(res, 'Failed to restore session:', error);
        }
    };

    controller.askAiIntegration = async (req, res) => {
        const { id } = req.params;
        const status = req.body?.status || {};

        const session = controller._findSessionOrFail(id, res);
        if (!session) return;

        try {
            const workspacePath = session.worktree?.path || session.path || session.cwd || process.cwd();
            const runCommand = async (command) => {
                try {
                    const { stdout, stderr } = await execAsync(command, { cwd: workspacePath, maxBuffer: 1024 * 1024 });
                    return [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)';
                } catch (cmdError) {
                    const stdout = typeof cmdError?.stdout === 'string' ? cmdError.stdout : '';
                    const stderr = typeof cmdError?.stderr === 'string' ? cmdError.stderr : '';
                    const output = [stdout, stderr].filter(Boolean).join('\n').trim();
                    if (output) {
                        return `${output}\n(command failed: ${cmdError.message})`;
                    }
                    return `(command failed: ${cmdError.message})`;
                }
            };

            const jjStatus = await runCommand('jj status');
            const jjLog = await runCommand('jj log -r @ -r @- -r @-- --limit 5');
            const jjBookmarks = await runCommand('jj bookmark list');

            const message = `[システム自動送信]

ユーザーがアーカイブしようとしたが、以下の警告が出ました：

${status.changesNotPushed > 0 ? `- ${status.changesNotPushed}件のchangeがremoteにpushされてません` : ''}
${status.hasWorkingCopyChanges ? '- working copyに未完了のchangeがあります' : ''}
${status.needsMerge ? `- ${status.mainBranch || 'base branch'} に未マージのcommitが${status.commitsAheadOfBase || 0}件あります` : ''}
${!status.bookmarkPushed && status.bookmarkName ? `- bookmark '${status.bookmarkName}' はローカルのみに存在します` : ''}
${status.autoHealReason && status.autoHealReason !== 'healed' ? `- 自動修復スキップ理由: ${status.autoHealReason}` : ''}

現在の状態：
=== jj status ===
${jjStatus}

=== jj log ===
${jjLog}

=== jj bookmark list ===
${jjBookmarks}

セッション情報：
- session-id: ${id}
- プロジェクト: ${session.name || 'unson'}
- パス: ${workspacePath}

この状況を分析して、必要な対処（マージ、push、統合など）を実行してください。
Brainbaseセッションのマージが必要な場合は、raw gh/jj を組み合わせず、まず次のAPIを使ってください：
POST http://localhost:31013/api/sessions/${id}/merge`;

            const clipboardResult = await controller._copyToSystemClipboard(message);
            const copiedByServer = clipboardResult.success;

            res.json({
                success: true,
                message: copiedByServer
                    ? 'AIへの依頼内容をコピーしました。チャットでペーストして送信してください。'
                    : 'AIへの依頼内容を生成しました。ブラウザ側でコピーして送信してください。',
                copiedByServer,
                clipboardMethod: clipboardResult.method,
                clipboardContent: message
            });
        } catch (error) {
            controller._respondError(res, 'Failed to ask AI for integration:', error);
        }
    };
}
