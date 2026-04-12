// @ts-check
import { exec } from 'child_process';
import { promisify } from 'util';

import { logger } from '../../utils/logger.js';
import { TAKEOVER_COOLDOWN_MS } from './constants.js';

const execAsync = promisify(exec);

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

        const ownership = controller.ownership.ensureTerminalOwnership(id, viewerId, viewerLabel);
        let effectiveSession = session;
        let baseRuntimeStatus = session.runtimeStatus || {};

        if (
            ownership.allowed
            && baseRuntimeStatus.needsRestart
            && !baseRuntimeStatus.ttydRunning
            && typeof controller.runtimeLifecycle?.ensureTtydForActiveSession === 'function'
        ) {
            try {
                const repair = await controller.runtimeLifecycle.ensureTtydForActiveSession(session);
                if (repair?.runtimeStatus) {
                    effectiveSession = controller._getSessionById(id) || session;
                    baseRuntimeStatus = repair.runtimeStatus;
                }
            } catch (error) {
                logger.error(`[getRuntime] Failed to repair ttyd for ${id}:`, error);
            }
        }

        const runtimeStatus = ownership.allowed
            ? controller._withViewerRuntimeStatus(baseRuntimeStatus, viewerId)
            : controller._withViewerRuntimeStatus({
                ...(effectiveSession.runtimeStatus || baseRuntimeStatus || {}),
                interactiveUrl: null,
                proxyPath: null
            }, viewerId);

        res.json({
            sessionId: id,
            runtimeStatus,
            terminalAccess: ownership.terminalAccess
        });
    };

    controller.ensureTerminalRuntime = async (req, res) => {
        const { id } = req.params;
        const { initialCommand, cwd, engine, viewerId, forceTtyd } = req.body || {};
        const session = controller._findSessionOrFail(id, res);
        if (!session) return;
        if (session.intendedState === 'archived') {
            return res.status(409).json({ error: 'Session is archived. Use restore to reactivate.' });
        }

        try {
            const resolvedCwd = await controller._resolveSessionWorkspacePath(session, { persist: true, preferTmux: true });
            const runtimeOptions = {
                sessionId: id,
                cwd: typeof resolvedCwd === 'string' && resolvedCwd.trim()
                    ? resolvedCwd
                    : (typeof cwd === 'string' && cwd.trim() ? cwd : undefined),
                initialCommand: typeof initialCommand === 'string' ? initialCommand : (session.initialCommand || ''),
                engine: typeof engine === 'string' && engine.trim() ? engine : (session.engine || 'claude')
            };
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

            const updatedSession = controller._getSessionById(id);
            const terminalAccess = typeof viewerId === 'string' && viewerId.trim()
                ? controller.ownership.getTerminalAccessState(id, viewerId.trim())
                : null;
            const response = {
                sessionId: id,
                runtimeStatus: controller._withViewerRuntimeStatus(updatedSession?.runtimeStatus || null, viewerId),
                terminalAccess
            };
            if (ttydResult) {
                response.port = ttydResult.port;
                response.proxyPath = controller._appendViewerIdToProxyPath(ttydResult.proxyPath, viewerId);
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

    controller.getTerminalSnapshot = async (req, res) => {
        const { id } = req.params;
        const viewerId = typeof req.query?.viewerId === 'string' ? req.query.viewerId.trim() : '';
        const viewerLabel = controller._resolveViewerLabel(req, req.query?.viewerLabel);
        const lines = Math.max(50, Math.min(400, Number.parseInt(req.query?.lines, 10) || 200));

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

        const ownership = controller.ownership.ensureTerminalOwnership(id, viewerId, viewerLabel);
        if (!ownership.allowed) {
            return res.status(409).json({
                error: 'Session is already open in another viewer',
                code: 'SESSION_OWNED_BY_OTHER_VIEWER',
                terminalAccess: ownership.terminalAccess
            });
        }

        try {
            const payload = controller.captureCache
                ? await controller.captureCache.getSnapshot(id, {
                    lines,
                    includeColors: true,
                    includeCopyMode: true
                })
                : await (async () => {
                    const [text, colorText, copyMode] = await Promise.all([
                        controller.snapshot.getContent(id, lines),
                        controller.snapshot.getContentWithColors(id, lines).catch(() => null),
                        controller.snapshot.getPaneMode(id).catch(() => false),
                    ]);
                    return {
                        text,
                        colorText,
                        copyMode,
                        capturedAt: new Date().toISOString()
                    };
                })();
            const response = {
                sessionId: id,
                text: payload.text,
                copyMode: payload.copyMode,
                capturedAt: payload.capturedAt,
                terminalAccess: ownership.terminalAccess
            };
            if (payload.colorText) response.colorText = payload.colorText;
            res.json(response);
        } catch (error) {
            controller._respondError(res, `Failed to get terminal snapshot for ${id}:`, error);
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
        const { skipMergeCheck } = req.body;

        try {
            const session = controller._findSessionOrFail(id, res);
            if (!session) return;

            if (session.worktree?.repo && !skipMergeCheck) {
                let status = await controller.worktreeService.getStatus(
                    id,
                    session.worktree.repo,
                    session.worktree.startCommit || null
                );
                let autoHealResult = null;

                if (status.needsIntegration || status.needsMerge) {
                    autoHealResult = await controller.worktreeService.autoHealArchiveState(
                        id,
                        session.worktree.repo,
                        session.worktree.path,
                        session.worktree.startCommit || null
                    );

                    status = autoHealResult.statusAfter || status;
                    status.autoHealAttempted = Boolean(autoHealResult.attempted);
                    status.autoHealApplied = Boolean(autoHealResult.healed && autoHealResult.actions?.length);
                    status.autoHealReason = autoHealResult.reason || null;
                    status.autoHealActions = autoHealResult.actions || [];
                }

                if (status.needsIntegration || status.needsMerge) {
                    return res.json({
                        needsConfirmation: true,
                        status,
                        message: 'Workspace has changes not pushed to remote'
                    });
                }
            }

            try {
                await controller.runtimeLifecycle.stopTtyd(id);
            } catch (ttydError) {
                logger.error(`[archive] Failed to stop ttyd for ${id}:`, ttydError.message);
            }

            await controller._updateStateWithRetry((state) => {
                const updatedSessions = state.sessions.map((session) =>
                    session.id === id ? { ...session, intendedState: 'archived', archivedAt: new Date().toISOString() } : session
                );
                return { ...state, sessions: updatedSessions };
            });

            res.json({ success: true });
        } catch (error) {
            logger.error(`[archive] Error archiving session ${id}:`, error);
            res.status(500).json({ error: 'Failed to archive session', detail: error.message });
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

            const result = await controller.runtimeLifecycle.startTtyd({
                sessionId: id,
                cwd: restoredWorkspacePath,
                initialCommand: session.initialCommand,
                engine
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

この状況を分析して、必要な対処（マージ、push、統合など）を実行してください。`;

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
