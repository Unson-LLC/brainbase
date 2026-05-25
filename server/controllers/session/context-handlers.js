// @ts-check
import fs from 'fs/promises';
import path from 'path';

import { logger } from '../../utils/logger.js';
import {
    HTML_EXTENSIONS,
    MARKDOWN_EXTENSIONS,
    MAX_FILE_READ_SIZE,
    MAX_PREVIEW_ASSET_SIZE,
    buildSessionWorktreeStatusSummary
} from './shared-methods.js';

function isEphemeralCwd(candidate) {
    return typeof candidate === 'string'
        && (candidate === '/tmp'
            || candidate === '/tmp/'
            || candidate === '/private/tmp'
            || candidate === '/private/tmp/');
}

const HTML_PREVIEW_ASSET_TYPES = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.htm', 'text/html; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.mjs', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.svg', 'image/svg+xml; charset=utf-8'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp'],
    ['.ico', 'image/x-icon'],
    ['.avif', 'image/avif'],
    ['.bmp', 'image/bmp'],
    ['.woff', 'font/woff'],
    ['.woff2', 'font/woff2'],
    ['.ttf', 'font/ttf']
]);

function encodePreviewPath(relativePath) {
    return String(relativePath || '')
        .split('/')
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join('/');
}

function parseCsv(value) {
    if (typeof value !== 'string') return [];
    return value.split(',').map(item => item.trim()).filter(Boolean);
}

function buildSessionMemoryPolicy(req, session) {
    const query = req.query || {};
    const includeMemory = String(query.includeMemory || query.include_memory || '').toLowerCase() === 'true';
    const roles = parseCsv(query.roles || req.get?.('x-brainbase-role') || req.get?.('x-role') || '');
    const projectCodes = parseCsv(query.projectCodes || query.project_codes || req.get?.('x-brainbase-projects') || req.get?.('x-projects') || '');
    const clearance = parseCsv(query.clearance || req.get?.('x-brainbase-clearance') || req.get?.('x-clearance') || '');

    return {
        mode: 'deny_by_default',
        includeMemory,
        injectedMemoryCount: 0,
        personId: query.personId || query.person_id || req.get?.('x-brainbase-person-id') || req.get?.('x-person-id') || null,
        workspace: query.workspace || req.get?.('x-brainbase-workspace') || req.get?.('x-workspace') || null,
        channelId: query.channelId || query.channel_id || req.get?.('x-brainbase-channel-id') || req.get?.('x-channel-id') || null,
        sessionId: session?.id || null,
        roles,
        projectCodes,
        clearance,
        status: includeMemory && roles.length && projectCodes.length && clearance.length
            ? 'scoped'
            : 'gated'
    };
}

// Short TTL cache for getContext output.
//
// VibePro story-session-switch-performance evidence:
// /api/sessions/:id/context p95 was 5179ms (cold switch). The hot work is
// worktreeService.getStatus(), which shells out to git/jj per call. The
// payload only changes when commits/merges happen, which doesn't need to be
// reflected within the same second the user clicks a session row.
//
// 5s TTL gives a near-instant hit for the burst of /context calls a single
// switch fires, while keeping the staleness bounded.
const CONTEXT_CACHE_TTL_MS = 5000;
const contextResponseCache = new Map(); // sessionId -> { expiresAt, payload }

function getCachedContext(sessionId) {
    const entry = contextResponseCache.get(sessionId);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
        contextResponseCache.delete(sessionId);
        return null;
    }
    return entry.payload;
}

function setCachedContext(sessionId, payload) {
    contextResponseCache.set(sessionId, {
        expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS,
        payload
    });
}

export function invalidateContextCache(sessionId) {
    if (sessionId) {
        contextResponseCache.delete(sessionId);
    } else {
        contextResponseCache.clear();
    }
}

export function installContextHandlers(controller) {
    controller.getContext = async (req, res) => {
        const { id } = req.params;
        const session = controller._findSessionOrFail(id, res);
        if (!session) return;

        const cached = getCachedContext(id);
        if (cached) {
            return res.json(cached);
        }

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
            unpushed: false,
            unmerged: false,
            conflict: false,
            changesNotPushed: 0,
            hasWorkingCopyChanges: false,
            needsMerge: false,
            hasConflicts: false,
            bookmarkPushed: false,
            prStatus: session.merged ? 'merged' : 'none',
            prUrl: session.mergedPrUrl || null,
            merged: Boolean(session.merged),
            mergedAt: session.mergedAt || null,
            baseBranch: null,
            memoryPolicy: buildSessionMemoryPolicy(req, session)
        };

        if (!repoPath) {
            setCachedContext(id, context);
            return res.json(context);
        }

        try {
            const status = await controller.worktreeService.getStatus(
                id,
                repoPath,
                session.worktree?.startCommit || null,
                {
                    fetchRemote: false,
                    workspaceId: session.activeWorkspaceId || session.worktree?.workspaceId || id,
                    generation: session.worktree?.generation
                }
            );

            const statusSummary = buildSessionWorktreeStatusSummary(status);
            const { changesNotPushed } = statusSummary;
            const prStatus = session.merged
                ? 'merged'
                : (changesNotPushed > 0 || status.bookmarkPushed ? 'open_or_pending' : 'none');

            const responsePayload = {
                ...context,
                repo: status.repoName || context.repo,
                bookmark: status.bookmarkName || context.bookmark,
                dirty: statusSummary.dirty,
                unpushed: statusSummary.unpushed,
                unmerged: statusSummary.unmerged,
                conflict: statusSummary.conflict,
                changesNotPushed,
                hasWorkingCopyChanges: statusSummary.hasWorkingCopyChanges,
                needsMerge: statusSummary.needsMerge,
                hasConflicts: statusSummary.hasConflicts,
                bookmarkPushed: Boolean(status.bookmarkPushed),
                prStatus,
                baseBranch: status.mainBranch || null,
                currentDirectory: context.currentDirectory || status.worktreePath || null
            };
            setCachedContext(id, responsePayload);
            res.json(responsePayload);
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
            const { relativePath, targetPath, external } = await controller._resolveFilePreviewTarget(session, rawPath);
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
            const isHtml = HTML_EXTENSIONS.has(ext);

            res.json({
                sessionId: id,
                relativePath,
                treeNavigable,
                treeRootPath,
                treeRelativePath,
                fileName,
                content,
                size: stat.size,
                isMarkdown,
                isHtml,
                htmlPreviewUrl: isHtml
                    ? (
                        external
                            ? `/api/sessions/${encodeURIComponent(id)}/html-preview/__external__/${encodeURIComponent(fileName)}?path=${encodeURIComponent(targetPath)}`
                            : `/api/sessions/${encodeURIComponent(id)}/html-preview/${encodePreviewPath(relativePath)}`
                    )
                    : null
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

    async function sendHtmlPreviewFile(req, res, { requireHtml }) {
        const { id } = req.params;
        const pathParam = req.params.previewPath;
        const queryPath = typeof req.query.path === 'string' && req.query.path ? req.query.path : '';
        const rawPath = queryPath || (Array.isArray(pathParam)
            ? pathParam.join('/')
            : (typeof pathParam === 'string' && pathParam ? pathParam : ''));

        if (!rawPath) {
            return res.status(400).json({ error: 'path query parameter is required' });
        }

        const session = controller._findSessionOrFail(id, res);
        if (!session) return;

        try {
            const { targetPath } = await controller._resolveFilePreviewTarget(session, rawPath);
            const fileName = path.basename(targetPath);
            const ext = path.extname(fileName).toLowerCase();
            if (requireHtml && !HTML_EXTENSIONS.has(ext)) {
                return res.status(415).json({ error: 'Only HTML files can be opened as pages' });
            }
            const contentType = HTML_PREVIEW_ASSET_TYPES.get(ext);
            if (!contentType) {
                return res.status(415).json({ error: 'Unsupported HTML preview asset type' });
            }

            const stat = await fs.stat(targetPath);
            if (!stat.isFile()) {
                return res.status(400).json({ error: 'Target path is not a file' });
            }
            const maxPreviewSize = HTML_EXTENSIONS.has(ext) ? MAX_FILE_READ_SIZE : MAX_PREVIEW_ASSET_SIZE;
            if (stat.size > maxPreviewSize) {
                return res.status(413).json({ error: 'File too large to preview' });
            }

            if (HTML_EXTENSIONS.has(ext)) {
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
            }

            const content = await fs.readFile(targetPath);
            res.setHeader('Content-Type', contentType);
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader(
                'Content-Security-Policy',
                [
                    "default-src 'self' data: blob:",
                    "img-src 'self' data: blob:",
                    "style-src 'self' 'unsafe-inline'",
                    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
                    "connect-src 'self' data: blob:",
                    "frame-ancestors 'self'",
                    "base-uri 'none'",
                    "form-action 'none'"
                ].join('; ')
            );
            return res.send(content);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return res.status(404).json({ error: 'File not found' });
            }
            if (error.message === 'Invalid path') {
                return res.status(400).json({ error: 'Invalid path' });
            }
            logger.error('Failed to get HTML preview:', error);
            return res.status(500).json({ error: error.message || 'Failed to preview HTML file' });
        }
    }

    controller.getHtmlPreview = async (req, res) => sendHtmlPreviewFile(req, res, { requireHtml: true });
    controller.getHtmlPreviewAsset = async (req, res) => sendHtmlPreviewFile(req, res, { requireHtml: false });

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
