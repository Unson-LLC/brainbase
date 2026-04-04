// @ts-check
import fs from 'fs/promises';
import path from 'path';

import { logger } from '../../utils/logger.js';
import { MARKDOWN_EXTENSIONS, MAX_FILE_READ_SIZE } from './shared-methods.js';

function isEphemeralCwd(candidate) {
    return typeof candidate === 'string'
        && (candidate === '/tmp'
            || candidate === '/tmp/'
            || candidate === '/private/tmp'
            || candidate === '/private/tmp/');
}

export function installContextHandlers(controller) {
    controller.getContext = async (req, res) => {
        const { id } = req.params;
        const session = controller._findSessionOrFail(id, res);
        if (!session) return;

        const repoPath = session.worktree?.repo || null;
        const workspacePath = await controller._resolveSessionWorkspacePath(session, { persist: true, preferTmux: true })
            || session.worktree?.path
            || session.path
            || null;
        const fallbackRepoName = repoPath ? path.basename(repoPath) : null;
        const currentDirectory = isEphemeralCwd(session.cwd)
            ? (workspacePath || null)
            : (session.cwd || workspacePath || null);
        const context = {
            sessionId: session.id,
            sessionName: session.name || null,
            engine: session.engine || null,
            repo: fallbackRepoName,
            repoPath,
            workspacePath,
            currentDirectory,
            bookmark: session.id,
            dirty: false,
            changesNotPushed: 0,
            hasWorkingCopyChanges: false,
            bookmarkPushed: false,
            prStatus: session.merged ? 'merged' : 'none',
            prUrl: session.mergedPrUrl || null,
            merged: Boolean(session.merged),
            mergedAt: session.mergedAt || null,
            baseBranch: null
        };

        if (!repoPath) {
            return res.json(context);
        }

        try {
            const status = await controller.worktreeService.getStatus(
                id,
                repoPath,
                session.worktree?.startCommit || null,
                { fetchRemote: false }
            );

            const changesNotPushed = status.changesNotPushed || 0;
            const hasWorkingCopyChanges = Boolean(status.hasWorkingCopyChanges);
            const dirty = hasWorkingCopyChanges || changesNotPushed > 0;
            const prStatus = session.merged
                ? 'merged'
                : (changesNotPushed > 0 || status.bookmarkPushed ? 'open_or_pending' : 'none');

            res.json({
                ...context,
                repo: status.repoName || context.repo,
                bookmark: status.bookmarkName || context.bookmark,
                dirty,
                changesNotPushed,
                hasWorkingCopyChanges,
                bookmarkPushed: Boolean(status.bookmarkPushed),
                prStatus,
                baseBranch: status.mainBranch || null,
                currentDirectory: context.currentDirectory || status.worktreePath || null
            });
        } catch (error) {
            logger.error('Failed to get session context:', error);
            res.json(context);
        }
    };

    controller.getFolderTree = async (req, res) => {
        const { id } = req.params;
        const rawPath = req.query.path || '';
        const depth = controller._parseTreeDepth(req.query.depth);
        const session = controller._findSessionOrFail(id, res);
        if (!session) return;

        const sessionRootPath = await controller._resolveSessionWorkspacePath(session, { persist: true, preferTmux: true })
            || session.worktree?.path
            || session.path;
        const requestedRootPath = typeof req.query.root === 'string' && req.query.root.trim()
            ? path.normalize(req.query.root.trim())
            : null;
        let rootPath = sessionRootPath;
        if (!rootPath) {
            return res.status(400).json({ error: 'Session does not have workspace path' });
        }

        if (requestedRootPath) {
            const repoHint = session?.worktree?.repo || null;
            const projectHint = repoHint ? path.basename(repoHint) : null;
            const allowedRoots = [
                sessionRootPath,
                ...controller._buildRepoPathCandidates(repoHint, projectHint),
                ...controller._buildWorkspaceRootCandidates(session)
            ].filter(Boolean).map((candidate) => path.normalize(candidate));
            if (!allowedRoots.includes(requestedRootPath)) {
                return res.status(400).json({ error: 'Invalid root override' });
            }
            rootPath = requestedRootPath;
        }

        try {
            const relativePath = controller._normalizeRelativePath(rawPath);
            const targetPath = path.resolve(rootPath, relativePath);

            if (!controller._isWithinRoot(rootPath, targetPath)) {
                return res.status(400).json({ error: 'Invalid path: outside session workspace' });
            }

            const stat = await fs.stat(targetPath);
            if (!stat.isDirectory()) {
                return res.status(400).json({ error: 'Target path is not a directory' });
            }

            const { nodes, truncated } = await controller._readTree(targetPath, relativePath, depth);
            res.json({
                sessionId: id,
                rootPath,
                baseRelativePath: relativePath,
                nodes,
                truncated,
                truncatedPath: truncated ? relativePath : null
            });
        } catch (error) {
            if (error.code === 'ENOENT') {
                return res.status(404).json({ error: 'Directory not found' });
            }
            if (error.message === 'Invalid path') {
                return res.status(400).json({ error: 'Invalid path' });
            }
            logger.error('Failed to get folder tree:', error);
            res.status(500).json({ error: error.message || 'Failed to get folder tree' });
        }
    };

    controller.getFileContent = async (req, res) => {
        const { id } = req.params;
        const rawPath = req.query.path || '';

        if (!rawPath) {
            return res.status(400).json({ error: 'path query parameter is required' });
        }

        const session = controller._findSessionOrFail(id, res);
        if (!session) return;

        try {
            const { relativePath, targetPath } = await controller._resolveFilePreviewTarget(session, rawPath);
            const { treeNavigable, treeRootPath, treeRelativePath } = await controller._resolveTreeNavigationTarget(session, targetPath);

            const stat = await fs.stat(targetPath);
            if (stat.size > MAX_FILE_READ_SIZE) {
                return res.status(413).json({ error: 'File too large to preview' });
            }

            const fd = await fs.open(targetPath, 'r');
            try {
                const probeSize = Math.min(8192, stat.size);
                const probeBuf = Buffer.alloc(probeSize);
                const { bytesRead } = await fd.read(probeBuf, 0, probeSize, 0);
                const probe = probeBuf.subarray(0, bytesRead);
                if (probe.includes(0)) {
                    return res.status(415).json({ error: 'Binary files cannot be previewed' });
                }
            } finally {
                await fd.close();
            }

            const content = await fs.readFile(targetPath, 'utf-8');
            const fileName = path.basename(targetPath);
            const ext = path.extname(fileName).toLowerCase();
            const isMarkdown = MARKDOWN_EXTENSIONS.has(ext);

            res.json({
                sessionId: id,
                relativePath,
                treeNavigable,
                treeRootPath,
                treeRelativePath,
                fileName,
                content,
                size: stat.size,
                isMarkdown
            });
        } catch (error) {
            if (error.code === 'ENOENT') {
                return res.status(404).json({ error: 'File not found' });
            }
            if (error.message === 'Invalid path') {
                return res.status(400).json({ error: 'Invalid path' });
            }
            logger.error('Failed to get file content:', error);
            res.status(500).json({ error: error.message || 'Failed to read file' });
        }
    };

    controller.getCommitLog = async (req, res) => {
        const { id } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        const session = controller._findSessionOrFail(id, res);
        if (!session) return;

        try {
            let result;
            if (session.worktree?.repo) {
                result = await controller.worktreeService.getCommitLog(
                    id,
                    session.worktree.repo,
                    limit
                );
            } else if (session.path) {
                result = await controller.worktreeService.getCommitLogByPath(
                    session.path,
                    limit
                );
            } else {
                return res.status(400).json({ error: 'Session does not have a repository path' });
            }
            res.json(result);
        } catch (error) {
            controller._respondError(res, 'Failed to get commit log:', error);
        }
    };

    controller.commitNotify = async (req, res) => {
        controller._commitNotifyMap.set(req.params.id, Date.now());
        res.json({ ok: true });
    };

    controller.getCommitNotify = async (req, res) => {
        const ts = controller._commitNotifyMap.get(req.params.id) || 0;
        res.json({ lastNotify: ts });
    };
}
