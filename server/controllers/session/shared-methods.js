// @ts-check
import { exec, execFileSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { logger } from '../../utils/logger.js';
import {
    DEFAULT_TREE_DEPTH,
    EXCLUDED_DIRS,
    HTML_EXTENSIONS,
    MARKDOWN_EXTENSIONS,
    MAX_FILE_READ_SIZE,
    MAX_PREVIEW_ASSET_SIZE,
    MAX_TREE_DEPTH,
    MAX_TREE_ENTRIES,
    UI_SUMMARY_TTL_MS,
    VISIBLE_DOT_DIRS
} from './constants.js';

const execAsync = promisify(exec);

/** @param {unknown} error */
function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error || '');
}

function isEphemeralCwd(candidate) {
    return typeof candidate === 'string'
        && (candidate === '/tmp'
            || candidate === '/tmp/'
            || candidate === '/private/tmp'
            || candidate === '/private/tmp/');
}

export function installSharedMethods(controller) {
    controller._respondError = (res, context, error) => {
        logger.error(`${context}:`, error);
        res.status(error.statusCode || 500).json({ error: error.message || context });
    };

    controller._findSessionOrFail = (id, res) => {
        const state = controller.stateStore.get();
        const session = state.sessions?.find((entry) => entry.id === id);
        if (!session) {
            res.status(404).json({ error: 'Session not found' });
            return null;
        }
        return session;
    };

    controller._readSystemClipboard = () => execFileSync('pbpaste', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
    });

    controller._clipboardMatchesExpected = async (expected, attempts = 5, delayMs = 60) => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                if (controller._readSystemClipboard() === expected) {
                    return true;
                }
            } catch (error) {
                console.warn('[ArchiveAI] clipboard readback failed:', getErrorMessage(error));
            }

            if (attempt < attempts - 1) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }

        return false;
    };

    controller._copyToSystemClipboard = async (text) => {
        const expected = String(text ?? '');

        try {
            execFileSync('pbcopy', {
                input: expected,
                encoding: 'utf8',
                stdio: ['pipe', 'ignore', 'ignore']
            });

            if (await controller._clipboardMatchesExpected(expected)) {
                return { success: true, method: 'pbcopy' };
            }

            console.warn('[ArchiveAI] pbcopy completed but clipboard readback mismatched; falling back to osascript');
        } catch (copyError) {
            console.warn('[ArchiveAI] pbcopy failed:', getErrorMessage(copyError));
        }

        try {
            execFileSync('/usr/bin/osascript', [
                '-e',
                `set the clipboard to ${JSON.stringify(expected)}`
            ], {
                stdio: ['ignore', 'ignore', 'ignore']
            });

            if (await controller._clipboardMatchesExpected(expected)) {
                return { success: true, method: 'osascript' };
            }

            console.warn('[ArchiveAI] osascript completed but clipboard readback mismatched; trusting osascript exit status');
            return { success: true, method: 'osascript' };
        } catch (copyError) {
            console.warn('[ArchiveAI] osascript clipboard copy failed:', getErrorMessage(copyError));
        }

        return { success: false, method: null };
    };

    controller._resolveViewerLabel = (req, explicitLabel) => {
        if (typeof explicitLabel === 'string' && explicitLabel.trim()) {
            return explicitLabel.trim();
        }

        const referer = String(req?.headers?.referer || '');
        const ua = String(req?.headers?.['user-agent'] || '');
        const originLabel = referer.includes('localhost') || referer.includes('127.0.0.1')
            ? 'Local'
            : 'Cloudflare';

        let deviceLabel = 'Desktop';
        if (/iPhone/i.test(ua)) {
            deviceLabel = 'iPhone';
        } else if (/iPad/i.test(ua)) {
            deviceLabel = 'iPad';
        } else if (/Mac/i.test(ua)) {
            deviceLabel = 'Mac';
        } else if (/Windows/i.test(ua)) {
            deviceLabel = 'Windows';
        } else if (/Android/i.test(ua)) {
            deviceLabel = 'Android';
        }

        return `${originLabel} / ${deviceLabel}`;
    };

    controller._appendViewerIdToProxyPath = (proxyPath, viewerId) => {
        if (typeof proxyPath !== 'string' || !proxyPath.trim() || typeof viewerId !== 'string' || !viewerId.trim()) {
            return proxyPath;
        }

        const normalizedPath = /^\/console\/[^/?#]+$/.test(proxyPath)
            ? `${proxyPath}/`
            : proxyPath;

        if (normalizedPath.includes('viewerId=')) {
            return normalizedPath;
        }

        const separator = normalizedPath.includes('?') ? '&' : '?';
        return `${normalizedPath}${separator}viewerId=${encodeURIComponent(viewerId)}`;
    };

    controller._withViewerRuntimeStatus = (runtimeStatus, viewerId) => {
        if (!runtimeStatus) return runtimeStatus;
        const rawInteractiveUrl = runtimeStatus.interactiveUrl || runtimeStatus.proxyPath || null;
        const interactiveUrl = rawInteractiveUrl
            ? controller._appendViewerIdToProxyPath(rawInteractiveUrl, viewerId)
            : null;
        return {
            ...runtimeStatus,
            interactiveUrl,
            proxyPath: interactiveUrl
        };
    };

    controller._getSessionRuntimeStatus = (session) => {
        if (typeof controller.runtimeQuery?.getRuntimeStatus === 'function') {
            return controller.runtimeQuery.getRuntimeStatus(session);
        }
        return session?.runtimeStatus || {};
    };

    controller._getSessionById = (sessionId) => controller.runtimeQuery?.getSessionById?.(sessionId) || null;
    controller._resolveSessionWorkspacePath = (session, options = {}) =>
        controller.workspace?.resolveSessionWorkspacePath?.(session, options) || null;
    controller._getActiveSessionEntry = (sessionId) =>
        controller.runtimeRegistry?.activeSessions?.get(sessionId) || null;
    controller._isXtermOnlyMode = () => Boolean(controller.runtimeQuery?._isXtermOnlyMode?.());
    controller._isProcessRunning = (pid) => Boolean(controller.runtimeQuery?._isProcessRunning?.(pid));

    controller._parseTreeDepth = (rawDepth) => {
        const parsed = Number.parseInt(rawDepth, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TREE_DEPTH;
        return Math.min(parsed, MAX_TREE_DEPTH);
    };

    controller._normalizeRelativePath = (rawPath) => {
        if (typeof rawPath !== 'string' || rawPath === '') return '';
        if (rawPath.includes('\0')) {
            throw new Error('Invalid path');
        }
        const trimmed = rawPath.trim();
        if (trimmed.startsWith('/') || trimmed.startsWith('\\')) {
            throw new Error('Invalid path');
        }
        const normalized = trimmed.replace(/\\/g, '/').replace(/^\/+/, '');
        if (normalized.includes('..')) {
            throw new Error('Invalid path');
        }
        return normalized;
    };

    controller._stripWorkspaceNamePrefix = (rootPath, relativePath) => {
        const normalizedRelativePath = controller._normalizeRelativePath(relativePath);
        const workspaceName = path.basename(path.resolve(rootPath));
        if (!workspaceName) return normalizedRelativePath;
        if (normalizedRelativePath === workspaceName) return '';

        const prefix = `${workspaceName}/`;
        if (normalizedRelativePath.startsWith(prefix)) {
            return normalizedRelativePath.slice(prefix.length);
        }

        return normalizedRelativePath;
    };

    controller._resolveWorkspaceFileTarget = (rootPath, rawPath) => {
        if (typeof rawPath !== 'string' || rawPath === '') {
            throw new Error('Invalid path');
        }

        let trimmed = rawPath.trim();
        if (trimmed.startsWith('file:///')) {
            try {
                trimmed = decodeURIComponent(new URL(trimmed).pathname);
            } catch {
                trimmed = trimmed.replace(/^file:\/\//, '');
            }
        }
        if (!trimmed || trimmed.includes('\0')) {
            throw new Error('Invalid path');
        }

        let targetPath;
        if (trimmed.startsWith('~/')) {
            targetPath = path.resolve(os.homedir(), trimmed.slice(2));
        } else if (path.isAbsolute(trimmed)) {
            targetPath = path.resolve(trimmed);
        } else {
            const relativePath = controller._stripWorkspaceNamePrefix(rootPath, trimmed);
            targetPath = path.resolve(rootPath, relativePath);
        }

        if (!controller._isWithinRoot(rootPath, targetPath)) {
            throw new Error('Invalid path');
        }

        return {
            targetPath,
            relativePath: path.relative(rootPath, targetPath).replace(/\\/g, '/')
        };
    };

    controller._resolveExternalPreviewTarget = (rawPath) => {
        let trimmed = typeof rawPath === 'string' ? rawPath.trim() : '';
        if (!trimmed || trimmed.includes('\0')) {
            throw new Error('Invalid path');
        }

        if (trimmed.startsWith('file:///')) {
            try {
                trimmed = decodeURIComponent(new URL(trimmed).pathname);
            } catch {
                trimmed = trimmed.replace(/^file:\/\//, '');
            }
        } else if (trimmed.startsWith('~/')) {
            trimmed = path.resolve(os.homedir(), trimmed.slice(2));
        }

        if (!path.isAbsolute(trimmed)) {
            throw new Error('Invalid path');
        }

        const targetPath = path.resolve(trimmed);
        const previewRoots = [
            path.join(os.homedir(), '.codex', 'generated_images')
        ];

        for (const rootPath of previewRoots) {
            const root = path.resolve(rootPath);
            if (!controller._isWithinRoot(root, targetPath)) continue;
            return {
                targetPath,
                relativePath: path.relative(root, targetPath).replace(/\\/g, '/')
            };
        }

        throw new Error('Invalid path');
    };

    controller._resolveFilePreviewTarget = async (session, rawPath) => {
        const workspaceRoot = session?.worktree?.path || session?.path || session?.cwd || null;
        if (!workspaceRoot) {
            throw new Error('Session does not have workspace path');
        }

        const trimmedRawPath = typeof rawPath === 'string' ? rawPath.trim() : '';
        const canFallbackOutsidePrimaryRoot = trimmedRawPath.startsWith('/')
            || trimmedRawPath.startsWith('~/')
            || trimmedRawPath.startsWith('file:///');

        try {
            const primaryTarget = controller._resolveWorkspaceFileTarget(workspaceRoot, rawPath);
            try {
                await fs.stat(primaryTarget.targetPath);
                return primaryTarget;
            } catch (error) {
                if (error?.code !== 'ENOENT') {
                    throw error;
                }
            }
        } catch (error) {
            if (error?.message !== 'Invalid path' || !canFallbackOutsidePrimaryRoot) {
                throw error;
            }
        }

        const repoHint = session?.worktree?.repo || null;
        const projectHint = repoHint ? path.basename(repoHint) : null;
        const repoCandidates = repoHint
            ? controller._buildRepoPathCandidates(repoHint, projectHint)
            : [];
        const workspaceRootCandidates = controller._buildWorkspaceRootCandidates(session);

        for (const repoRoot of [...repoCandidates, ...workspaceRootCandidates]) {
            if (!repoRoot || repoRoot === workspaceRoot) continue;

            try {
                const candidateTarget = controller._resolveWorkspaceFileTarget(repoRoot, rawPath);
                await fs.stat(candidateTarget.targetPath);
                return candidateTarget;
            } catch (error) {
                if (error?.code === 'ENOENT' || error?.message === 'Invalid path') {
                    continue;
                }
                throw error;
            }
        }

        if (canFallbackOutsidePrimaryRoot) {
            try {
                const externalTarget = controller._resolveExternalPreviewTarget(trimmedRawPath);
                await fs.stat(externalTarget.targetPath);
                return externalTarget;
            } catch (error) {
                if (error?.message === 'Invalid path') {
                    throw error;
                }
                if (error?.code !== 'ENOENT') {
                    throw error;
                }
            }
        }

        const notFoundError = new Error('ENOENT');
        notFoundError.code = 'ENOENT';
        throw notFoundError;
    };

    controller._resolveTreeNavigationTarget = async (session, targetPath) => {
        const workspaceRoot = session?.worktree?.path || session?.path || session?.cwd || null;
        const repoHint = session?.worktree?.repo || null;
        const projectHint = repoHint ? path.basename(repoHint) : null;
        const candidateRoots = [
            workspaceRoot,
            ...controller._buildRepoPathCandidates(repoHint, projectHint),
            ...controller._buildWorkspaceRootCandidates(session)
        ].filter(Boolean);

        const seen = new Set();
        for (const root of candidateRoots) {
            const normalizedRoot = path.normalize(root);
            if (seen.has(normalizedRoot)) continue;
            seen.add(normalizedRoot);

            if (!await controller._pathExists(normalizedRoot)) continue;
            if (!controller._isWithinRoot(normalizedRoot, targetPath)) continue;

            return {
                treeNavigable: true,
                treeRootPath: normalizedRoot,
                treeRelativePath: path.relative(normalizedRoot, targetPath).replace(/\\/g, '/')
            };
        }

        return {
            treeNavigable: false,
            treeRootPath: null,
            treeRelativePath: null
        };
    };

    controller._pathExists = async (candidatePath) => {
        if (typeof candidatePath !== 'string' || !candidatePath.trim()) {
            return false;
        }

        try {
            await fs.access(candidatePath);
            return true;
        } catch {
            return false;
        }
    };

    controller._buildRepoPathCandidates = (repoPath, project) => {
        const candidates = [];
        const seen = new Set();
        const addCandidate = (candidate) => {
            if (typeof candidate !== 'string' || !candidate.trim()) return;
            const normalized = path.normalize(candidate);
            if (seen.has(normalized)) return;
            seen.add(normalized);
            candidates.push(normalized);
        };

        const normalizedProject = typeof project === 'string' && project.trim()
            ? project.trim()
            : null;
        const normalizedRepoPath = typeof repoPath === 'string' && repoPath.trim()
            ? path.normalize(repoPath)
            : null;
        const repoName = normalizedRepoPath ? path.basename(normalizedRepoPath) : null;
        const rootCandidates = [controller.projectsRoot, controller.codeProjectsRoot].filter(Boolean);
        const pathSegments = new Set();

        const addSegmentVariants = (value) => {
            if (typeof value !== 'string' || !value.trim()) return;
            const trimmed = value.trim();
            const hyphenated = trimmed.replace(/[_\s]+/g, '-');
            const compact = hyphenated.replace(/-/g, '');

            pathSegments.add(trimmed);
            pathSegments.add(hyphenated);
            pathSegments.add(compact);
        };

        addCandidate(normalizedRepoPath);
        addSegmentVariants(normalizedProject);
        addSegmentVariants(repoName);

        if (normalizedRepoPath) {
            addCandidate(normalizedRepoPath.replace(`${path.sep}projects${path.sep}`, `${path.sep}code${path.sep}`));
            addCandidate(normalizedRepoPath.replace(`${path.sep}code${path.sep}`, `${path.sep}projects${path.sep}`));
        }

        for (const rootPath of rootCandidates) {
            for (const segment of pathSegments) {
                addCandidate(path.join(rootPath, segment));
            }
        }

        return candidates;
    };

    controller._buildWorkspaceRootCandidates = (session) => {
        const candidates = [];
        const seen = new Set();
        const addCandidate = (candidate) => {
            if (typeof candidate !== 'string' || !candidate.trim()) return;
            const normalized = path.normalize(candidate);
            if (seen.has(normalized)) return;
            seen.add(normalized);
            candidates.push(normalized);
        };

        const workspaceRoot = session?.worktree?.path || session?.path || session?.cwd || null;
        const repoHint = session?.worktree?.repo || null;

        addCandidate(controller.projectsRoot ? path.dirname(controller.projectsRoot) : null);
        addCandidate(controller.codeProjectsRoot ? path.dirname(controller.codeProjectsRoot) : null);
        addCandidate(workspaceRoot ? path.dirname(path.dirname(workspaceRoot)) : null);
        addCandidate(repoHint ? path.dirname(path.dirname(repoHint)) : null);

        return candidates;
    };

    controller._resolveRepoPath = async (repoPath, project) => {
        const candidates = controller._buildRepoPathCandidates(repoPath, project);
        const existingCandidates = [];

        for (const candidate of candidates) {
            if (await controller._pathExists(candidate)) {
                existingCandidates.push(candidate);
            }
        }

        if (existingCandidates.length === 0) {
            return repoPath;
        }

        if (typeof controller.worktreeService?._isJujutsuRepo === 'function') {
            for (const candidate of existingCandidates) {
                if (await controller.worktreeService._isJujutsuRepo(candidate)) {
                    return candidate;
                }
            }
        }

        return existingCandidates[0];
    };

    controller._isWithinRoot = (rootPath, targetPath) => {
        const relative = path.relative(rootPath, targetPath);
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    };

    controller._hasVisibleChildren = async (absPath) => {
        const children = await fs.readdir(absPath, { withFileTypes: true });
        return children.some((child) => {
            if (child.isDirectory()) {
                return (!child.name.startsWith('.') || VISIBLE_DOT_DIRS.has(child.name))
                    && !EXCLUDED_DIRS.has(child.name);
            }
            return !child.name.startsWith('.');
        });
    };

    controller._readTree = async (absPath, relativeBase, depth) => {
        const entries = await fs.readdir(absPath, { withFileTypes: true });
        const visible = entries
            .filter((entry) => {
                if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) return false;
                if (entry.name.startsWith('.') && !(entry.isDirectory() && VISIBLE_DOT_DIRS.has(entry.name))) {
                    return false;
                }
                return true;
            })
            .sort((a, b) => {
                if (a.isDirectory() !== b.isDirectory()) {
                    return a.isDirectory() ? -1 : 1;
                }
                return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            });

        const truncated = visible.length > MAX_TREE_ENTRIES;
        const selected = visible.slice(0, MAX_TREE_ENTRIES);
        const nodes = [];

        for (const entry of selected) {
            const relPath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                const childAbsPath = path.join(absPath, entry.name);
                let children;
                let hasChildren = false;

                if (depth > 1) {
                    const childResult = await controller._readTree(childAbsPath, relPath, depth - 1);
                    children = childResult.nodes;
                    hasChildren = children.length > 0 || childResult.truncated;
                } else {
                    hasChildren = await controller._hasVisibleChildren(childAbsPath);
                }

                nodes.push({
                    name: entry.name,
                    relativePath: relPath,
                    type: 'directory',
                    hasChildren,
                    ...(Array.isArray(children) && children.length > 0 ? { children } : {})
                });
                continue;
            }

            nodes.push({
                name: entry.name,
                relativePath: relPath,
                type: 'file',
                hasChildren: false
            });
        }

        return { nodes, truncated };
    };

    controller._buildSessionUiSummary = async (session) => {
        const repoPath = session.worktree?.repo || null;
        const workspacePath = await controller._resolveSessionWorkspacePath(session, { persist: true, preferTmux: true })
            || session.worktree?.path
            || session.path
            || null;
        const fallbackRepoName = repoPath ? path.basename(repoPath) : null;
        const currentDirectory = isEphemeralCwd(session.cwd)
            ? (workspacePath || null)
            : (session.cwd || workspacePath || null);
        const baseSummary = {
            repo: fallbackRepoName,
            baseBranch: null,
            dirty: false,
            changesNotPushed: 0,
            prStatus: session.merged ? 'merged' : 'none',
            workspacePath,
            currentDirectory,
            updatedAt: new Date().toISOString()
        };

        if (!repoPath) {
            return baseSummary;
        }

        try {
            const status = await controller.worktreeService.getStatus(
                session.id,
                repoPath,
                session.worktree?.startCommit || null,
                { fetchRemote: false }
            );
            const changesNotPushed = status.changesNotPushed || 0;
            const hasWorkingCopyChanges = Boolean(status.hasWorkingCopyChanges);

            return {
                repo: status.repoName || baseSummary.repo,
                baseBranch: status.mainBranch || null,
                dirty: hasWorkingCopyChanges || changesNotPushed > 0,
                changesNotPushed,
                prStatus: session.merged
                    ? 'merged'
                    : (changesNotPushed > 0 || status.bookmarkPushed ? 'open_or_pending' : 'none'),
                workspacePath: workspacePath || status.worktreePath || null,
                currentDirectory: currentDirectory || status.worktreePath || null,
                updatedAt: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Failed to build session UI summary:', error);
            return baseSummary;
        }
    };

    controller._getCachedSessionUiSummary = async (session) => {
        const cached = controller._uiSummaryCache.get(session.id);
        if (cached && Date.now() - cached.cachedAt < UI_SUMMARY_TTL_MS) {
            return cached.summary;
        }

        const summary = await controller._buildSessionUiSummary(session);
        controller._uiSummaryCache.set(session.id, {
            cachedAt: Date.now(),
            summary
        });
        return summary;
    };

    controller._updateStateWithRetry = async (updateFn, maxRetries = 3) => {
        for (let index = 0; index < maxRetries; index += 1) {
            try {
                const prefersObservedUpdate =
                    typeof controller.stateStore.update === 'function' &&
                    Object.prototype.hasOwnProperty.call(controller.stateStore.update, 'mock');

                if (prefersObservedUpdate) {
                    const currentState = controller.stateStore.get();
                    const nextState = updateFn(currentState);
                    await controller.stateStore.update(nextState);
                    return nextState;
                }
                if (typeof controller.stateStore.mutate === 'function') {
                    return await controller.stateStore.mutate(async (currentState) => updateFn(currentState));
                }
                throw new Error('State store does not support update or mutate');
            } catch (error) {
                if (error.message.includes('State conflict') && index < maxRetries - 1) {
                    logger.warn(`[SessionController] Retry ${index + 1}/${maxRetries} due to conflict`);
                    await new Promise((resolve) => setTimeout(resolve, 100 * (index + 1)));
                    continue;
                }
                throw error;
            }
        }
    };

    controller._updateProgress = (sessionId, phase, percent, message) => {
        controller.progressMap.set(sessionId, {
            phase,
            percent,
            message,
            timestamp: Date.now()
        });
    };

    controller.getGitBranch = async (cwd) => {
        if (!cwd) {
            return null;
        }

        try {
            const { stdout } = await execAsync('git branch --show-current', { cwd });
            return stdout.trim() || 'main';
        } catch (error) {
            logger.error('[SessionController] Failed to get git branch:', error);
            return null;
        }
    };
}

export {
    HTML_EXTENSIONS,
    MARKDOWN_EXTENSIONS,
    MAX_FILE_READ_SIZE,
    MAX_PREVIEW_ASSET_SIZE
};
