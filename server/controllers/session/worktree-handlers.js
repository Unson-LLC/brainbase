// @ts-check
import { logger } from '../../utils/logger.js';
import { deriveTaskBriefFromPrompt } from '../../utils/task-brief.js';
import { getCodexResumeId } from '../../services/codex-app-server-session-state.js';

const MAX_SESSION_ACTIVITY_HISTORY = 40;

function stableHash(value) {
    const text = String(value || '');
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return Math.abs(hash).toString(36);
}

function normalizePromptExcerpt(prompt) {
    if (typeof prompt !== 'string') return '';
    const normalized = prompt
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n');
    if (!normalized) return '';
    return normalized.length > 240 ? `${normalized.slice(0, 239)}…` : normalized;
}

function buildStartupPromptHistory(initialCommand, occurredAt) {
    const text = normalizePromptExcerpt(initialCommand);
    if (!text) return [];
    const dedupeKey = `startup_prompt:${stableHash(text)}:${occurredAt}`;
    return [{
        id: `startup_prompt-${stableHash(dedupeKey)}`,
        actor: 'user',
        kind: 'startup_prompt',
        text,
        textSource: 'raw_prompt',
        evidenceSource: 'session_initial_command',
        occurredAt,
        dedupeKey
    }].slice(-MAX_SESSION_ACTIVITY_HISTORY);
}

export function installWorktreeHandlers(controller) {
    controller.getProgress = async (req, res) => {
        const { id } = req.params;
        const currentPercent = parseInt(req.query.current) || 0;

        const startTime = Date.now();
        const timeout = 30000;
        const interval = 100;

        const checkProgress = () => {
            const progress = controller.progressMap.get(id);

            if (progress && progress.percent > currentPercent) {
                return res.json(progress);
            }

            if (progress && progress.percent >= 100) {
                controller.progressMap.delete(id);
                return res.json(progress);
            }

            if (Date.now() - startTime > timeout) {
                return res.json({ phase: 'timeout', percent: currentPercent, message: 'Timeout' });
            }

            setTimeout(checkProgress, interval);
        };

        checkProgress();
    };

    controller.createWithWorktree = async (req, res) => {
        const { sessionId, repoPath, name, initialCommand, engine = 'claude', project, viewerId } = req.body;
        const viewerLabel = controller._resolveViewerLabel(req, req.body?.viewerLabel);
        const skipFetch = req.body.skipFetch !== undefined ? req.body.skipFetch : true;

        if (!sessionId || !repoPath) {
            return res.status(400).json({ error: 'sessionId and repoPath are required' });
        }
        if (!viewerId || typeof viewerId !== 'string' || !viewerId.trim()) {
            return res.status(400).json({ error: 'viewerId is required' });
        }

        if (!['claude', 'codex'].includes(engine)) {
            return res.status(400).json({ error: 'engine must be "claude" or "codex"' });
        }

        try {
            controller._updateProgress(sessionId, 'worktree', 10, 'ワークスペースを作成中...');
            const resolvedRepoPath = await controller._resolveRepoPath(repoPath, project);

            if (resolvedRepoPath !== repoPath) {
                logger.warn(`[createWithWorktree] Repo path fallback for ${sessionId}: ${repoPath} -> ${resolvedRepoPath}`);
            }

            const deployGuard = await controller.worktreeService.getMergeDeploymentGuardStatus(resolvedRepoPath, { fetchRemote: true });
            if (!deployGuard.ready) {
                controller._updateProgress(sessionId, 'error', 0, '正本ワークスペースが未反映です');
                return res.status(409).json({
                    error: 'Canonical Brainbase workspace is not deployed to the latest merged base. Deploy merged changes before starting another Brainbase worktree.',
                    guard: deployGuard
                });
            }

            const initialWorkspace = {
                workspaceId: `${sessionId}-g1`,
                generation: 1
            };
            const worktreeResult = await controller.worktreeService.create(sessionId, resolvedRepoPath, {
                ...initialWorkspace,
                skipFetch
            });
            if (!worktreeResult) {
                controller._updateProgress(sessionId, 'error', 0, 'ワークスペース作成に失敗');
                return res.status(500).json({ error: 'Failed to create worktree' });
            }

            controller._updateProgress(sessionId, 'worktree', 40, 'ワークスペース作成完了');

            const { worktreePath, branchName } = worktreeResult;
            controller.activity.clearDoneStatus(sessionId);

            const now = new Date().toISOString();
            const taskBrief = deriveTaskBriefFromPrompt(initialCommand);
            const activityHistory = buildStartupPromptHistory(initialCommand, now);
            const newSession = {
                id: sessionId,
                name: name || sessionId,
                path: worktreePath,
                project,
                activeWorkspaceId: worktreeResult.workspaceId || initialWorkspace.workspaceId,
                worktree: {
                    workspaceId: worktreeResult.workspaceId || initialWorkspace.workspaceId,
                    generation: worktreeResult.generation || initialWorkspace.generation,
                    repo: resolvedRepoPath,
                    path: worktreePath,
                    branch: branchName,
                    startCommit: worktreeResult.startCommit
                },
                workspaceHistory: [],
                workspaceRotationStatus: 'ready',
                initialCommand,
                engine,
                intendedState: 'active',
                startupStatus: 'pending',
                startupPhase: 'ttyd',
                startupMessage: 'ターミナルを起動中...',
                ...(taskBrief ? { taskBrief, taskBriefUpdatedAt: now } : {}),
                ...(activityHistory.length > 0 ? { activityHistory } : {}),
                createdAt: now,
                updatedAt: now
            };

            controller._updateProgress(sessionId, 'state', 60, 'セッション状態を更新中...');

            try {
                const persistedState = await controller._updateStateWithRetry((state) => ({
                    ...state,
                    sessions: [...(state.sessions || []).filter((session) => session.id !== sessionId), newSession]
                }));
                const persistedSessions = persistedState?.sessions || [];
                const persistedSession = persistedSessions.find((session) => session.id === sessionId);
                if (!persistedSession) {
                    throw new Error('Session state was not persisted');
                }
                if (persistedSession.path !== worktreePath || persistedSession.worktree?.path !== worktreePath) {
                    throw new Error('Session state missing persisted worktree.path');
                }
                if (!await controller._pathExists(worktreePath)) {
                    throw new Error(`Persisted worktree path does not exist: ${worktreePath}`);
                }
            } catch (stateError) {
                controller._updateProgress(sessionId, 'error', 0, 'セッション状態の更新に失敗');
                try {
                    await controller.worktreeService.remove(sessionId, resolvedRepoPath);
                } catch (cleanupError) {
                    logger.error('[createWithWorktree] Worktree cleanup after state failure failed:', cleanupError);
                }
                throw stateError;
            }

            let result;
            try {
                controller._updateProgress(sessionId, 'ttyd', 80, 'ターミナルを起動中...');
                result = await controller.runtimeLifecycle.startTtyd({
                    sessionId,
                    cwd: worktreePath,
                    initialCommand,
                    engine
                });
            } catch (ttydError) {
                controller._updateProgress(sessionId, 'error', 0, 'ターミナル起動に失敗');
                try {
                    await controller._updateStateWithRetry((state) => ({
                        ...state,
                        sessions: (state.sessions || []).map((session) => {
                            if (session.id !== sessionId) return session;
                            return {
                                ...session,
                                startupStatus: 'failed',
                                startupPhase: 'error',
                                startupMessage: ttydError?.message || 'ターミナル起動に失敗',
                                updatedAt: new Date().toISOString()
                            };
                        })
                    }));
                } catch (rollbackError) {
                    logger.error('[createWithWorktree] Failed to persist startup failure:', rollbackError);
                }
                try {
                    await Promise.resolve(controller.worktreeService.remove(sessionId, resolvedRepoPath));
                } catch (cleanupError) {
                    logger.error('[createWithWorktree] Worktree cleanup after ttyd failure failed:', cleanupError);
                }
                throw ttydError;
            }

            await controller._updateStateWithRetry((state) => ({
                ...state,
                sessions: (state.sessions || []).map((session) => {
                    if (session.id !== sessionId) return session;
                    return {
                        ...session,
                        startupStatus: 'ready',
                        startupPhase: 'done',
                        startupMessage: '',
                        updatedAt: new Date().toISOString()
                    };
                })
            }));

            const ownership = controller.ownership.forceTerminalOwnership(sessionId, viewerId, viewerLabel);
            controller._updateProgress(sessionId, 'done', 100, 'セッション作成完了！');

            res.json({
                success: true,
                port: result.port,
                proxyPath: controller._appendViewerIdToProxyPath(result.proxyPath, viewerId),
                terminalAccess: ownership.terminalAccess,
                worktreePath,
                branchName
            });
        } catch (error) {
            logger.error('Failed to create session with worktree:', error);
            controller._updateProgress(sessionId, 'error', 0, 'セッション作成に失敗');
            res.status(500).json({ error: error.message || 'Failed to create worktree' });
        }
    };

    controller.getWorktreeStatus = async (req, res) => {
        const { id } = req.params;
        const session = controller._findSessionOrFail(id, res);
        if (!session) return;

        if (!session.worktree?.repo) {
            return res.status(400).json({ error: 'Session does not have a worktree' });
        }

        try {
            const status = await controller.worktreeService.getStatus(
                id,
                session.worktree.repo,
                session.worktree.startCommit || null,
                {
                    workspaceId: session.activeWorkspaceId || session.worktree?.workspaceId || id,
                    generation: session.worktree?.generation
                }
            );
            res.json(status);
        } catch (error) {
            controller._respondError(res, 'Failed to get worktree status:', error);
        }
    };

    controller.updateLocalMain = async (req, res) => {
        const { id } = req.params;
        const { autoStash = false } = req.body || {};

        const session = controller._findSessionOrFail(id, res);
        if (!session) return;

        if (!session.worktree?.repo) {
            return res.status(400).json({ error: 'Session does not have a worktree' });
        }

        try {
            const result = await controller.worktreeService.updateLocalMain(session.worktree.repo, { autoStash });
            res.json(result);
        } catch (error) {
            controller._respondError(res, 'Failed to update local main:', error);
        }
    };

    controller.merge = async (req, res) => {
        const { id } = req.params;
        const session = controller._findSessionOrFail(id, res);
        if (!session) return;

        if (!session.worktree?.repo) {
            return res.status(400).json({ error: 'Session does not have a worktree' });
        }

        try {
            await controller._updateStateWithRetry((state) => ({
                ...state,
                sessions: (state.sessions || []).map((entry) =>
                    entry.id === id
                        ? { ...entry, workspaceRotationStatus: 'rotating', workspaceRotationError: null }
                        : entry
                )
            }));

            const activeWorkspaceId = session.activeWorkspaceId || session.worktree?.workspaceId || id;
            const activeGeneration = Number.isFinite(session.worktree?.generation) ? session.worktree.generation : undefined;
            const codexResumeId = getCodexResumeId(session);
            const result = await controller.worktreeService.merge(id, session.worktree.repo, session.name, {
                workspaceId: activeWorkspaceId,
                generation: activeGeneration,
                workspacePath: session.worktree?.path || session.path || null,
                rotateAfterMerge: true
            });

            if (result.success) {
                const mergedAt = result.mergedAt || new Date().toISOString();
                const active = result.rotation?.active || null;
                const retired = result.rotation?.retired || null;
                await controller._updateStateWithRetry((state) => {
                    const updatedSessions = (state.sessions || []).map((entry) =>
                        entry.id === id
                            ? {
                                ...entry,
                                merged: true,
                                mergedAt,
                                mergedPrUrl: result.prUrl || null,
                                activeWorkspaceId: active?.workspaceId || entry.activeWorkspaceId || null,
                                path: active?.path || entry.path,
                                worktree: active
                                    ? {
                                        ...(entry.worktree || {}),
                                        repo: active.repo || entry.worktree?.repo || session.worktree.repo,
                                        path: active.path,
                                        branch: active.branch,
                                        startCommit: active.startCommit || null,
                                        workspaceId: active.workspaceId,
                                        generation: active.generation
                                    }
                                    : entry.worktree,
                                ...(codexResumeId ? {
                                    codexThreadId: codexResumeId,
                                    bindingSource: 'workspace-rotation',
                                    bindingUpdatedAt: new Date().toISOString()
                                } : {}),
                                workspaceHistory: retired
                                    ? [...(entry.workspaceHistory || []), retired]
                                    : (entry.workspaceHistory || []),
                                workspaceRotationStatus: 'ready',
                                workspaceRotationError: null,
                                intendedState: entry.intendedState === 'archived' ? 'archived' : 'active'
                            }
                            : entry
                    );
                    return { ...state, sessions: updatedSessions };
                });

                if (active?.path && typeof controller.runtimeLifecycle?.startTtyd === 'function') {
                    try {
                        await controller.runtimeLifecycle.stopTtyd?.(id, { preserveTmux: false });
                    } catch (stopError) {
                        logger.info(`[merge] Runtime stop before workspace rotation restart skipped: ${stopError instanceof Error ? stopError.message : String(stopError)}`);
                    }
                    const runtime = await controller.runtimeLifecycle.startTtyd({
                        sessionId: id,
                        cwd: active.path,
                        initialCommand: session.initialCommand,
                        engine: session.engine || 'claude',
                        ...(codexResumeId ? { codexResumeId } : {})
                    });
                    result.port = runtime?.port;
                    result.proxyPath = runtime?.proxyPath;
                }
            } else {
                const rotationStatus = result.merged || result.rotationBlocked ? 'blocked' : 'ready';
                await controller._updateStateWithRetry((state) => ({
                    ...state,
                    sessions: (state.sessions || []).map((entry) =>
                        entry.id === id
                            ? {
                                ...entry,
                                workspaceRotationStatus: rotationStatus,
                                workspaceRotationError: rotationStatus === 'blocked' ? (result.error || 'Workspace rotation failed') : null,
                                merged: result.merged ? true : entry.merged,
                                mergedAt: result.mergedAt || entry.mergedAt,
                                mergedPrUrl: result.prUrl || entry.mergedPrUrl,
                                workspaceHistory: result.rotation?.retired
                                    ? [...(entry.workspaceHistory || []), result.rotation.retired]
                                    : (entry.workspaceHistory || [])
                            }
                            : entry
                    )
                }));
            }

            res.json(result);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            try {
                await controller._updateStateWithRetry((state) => ({
                    ...state,
                    sessions: (state.sessions || []).map((entry) =>
                        entry.id === id && entry.workspaceRotationStatus === 'rotating'
                            ? { ...entry, workspaceRotationStatus: 'ready', workspaceRotationError: message }
                            : entry
                    )
                }));
            } catch (stateError) {
                logger.info(`[merge] Failed to clear rotating state after controller error: ${stateError instanceof Error ? stateError.message : String(stateError)}`);
            }
            controller._respondError(res, 'Failed to merge worktree:', error);
        }
    };

    controller.deleteWorktree = async (req, res) => {
        const { id } = req.params;
        const session = controller._findSessionOrFail(id, res);
        if (!session) return;

        if (!session.worktree?.repo) {
            return res.status(400).json({ error: 'Session does not have a worktree' });
        }

        try {
            const success = await controller.worktreeService.remove(id, session.worktree.repo);
            if (!success) {
                return res.status(500).json({ error: 'Failed to delete worktree' });
            }

            await controller._updateStateWithRetry((state) => {
                const updatedSessions = state.sessions.map((entry) => {
                    if (entry.id === id) {
                        const { worktree, ...rest } = entry;
                        return rest;
                    }
                    return entry;
                });
                return { ...state, sessions: updatedSessions };
            });

            res.json({ success: true });
        } catch (error) {
            controller._respondError(res, 'Failed to delete worktree:', error);
        }
    };
}
