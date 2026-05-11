// @ts-check
import { logger } from '../../utils/logger.js';
import { deriveTaskBriefFromPrompt } from '../../utils/task-brief.js';

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

            const worktreeResult = await controller.worktreeService.create(sessionId, resolvedRepoPath, { skipFetch });
            if (!worktreeResult) {
                controller._updateProgress(sessionId, 'error', 0, 'ワークスペース作成に失敗');
                return res.status(500).json({ error: 'Failed to create worktree' });
            }

            controller._updateProgress(sessionId, 'worktree', 40, 'ワークスペース作成完了');

            const { worktreePath, branchName } = worktreeResult;
            controller.activity.clearDoneStatus(sessionId);

            const now = new Date().toISOString();
            const taskBrief = deriveTaskBriefFromPrompt(initialCommand);
            const newSession = {
                id: sessionId,
                name: name || sessionId,
                path: worktreePath,
                project,
                worktree: {
                    repo: resolvedRepoPath,
                    path: worktreePath,
                    branch: branchName,
                    startCommit: worktreeResult.startCommit
                },
                initialCommand,
                engine,
                intendedState: 'active',
                ...(taskBrief ? { taskBrief, taskBriefUpdatedAt: now } : {}),
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
                        sessions: (state.sessions || []).filter((session) => session.id !== sessionId)
                    }));
                } catch (rollbackError) {
                    logger.error('[createWithWorktree] Rollback failed:', rollbackError);
                }
                controller.worktreeService.remove(sessionId, resolvedRepoPath).catch(() => {});
                throw ttydError;
            }

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
                session.worktree.startCommit || null
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
            const result = await controller.worktreeService.merge(id, session.worktree.repo, session.name);

            if (result.success) {
                const mergedAt = result.mergedAt || new Date().toISOString();
                await controller._updateStateWithRetry((state) => {
                    const updatedSessions = (state.sessions || []).map((entry) =>
                        entry.id === id
                            ? {
                                ...entry,
                                merged: true,
                                mergedAt,
                                mergedPrUrl: result.prUrl || null
                            }
                            : entry
                    );
                    return { ...state, sessions: updatedSessions };
                });
            }

            res.json(result);
        } catch (error) {
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
