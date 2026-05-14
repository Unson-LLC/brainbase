// @ts-check
/**
 * MiscController
 * その他のHTTPリクエスト処理（version, restart, upload, open-file）
 */
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';

/** @typedef {any} Request */
/** @typedef {any} Response */
/** @typedef {{ brainbaseRoot?: string | null, projectsRoot?: string | null, sessionQuery?: any, workspace?: any } | null | undefined} MiscControllerPaths */

export class MiscController {
    /**
     * @param {string} appVersion
     * @param {any} uploadMiddleware
     * @param {string} workspaceRoot
     * @param {string} uploadsDir
     * @param {any} [runtimeInfo]
     * @param {MiscControllerPaths} [paths]
     */
    constructor(appVersion, uploadMiddleware, workspaceRoot, uploadsDir, runtimeInfo = null, paths = {}) {
        this.appVersion = appVersion;
        this.uploadMiddleware = uploadMiddleware;
        this.workspaceRoot = workspaceRoot;
        this.uploadsDir = uploadsDir;
        this.runtimeInfo = runtimeInfo;
        this.brainbaseRoot = paths?.brainbaseRoot || null;
        this.projectsRoot = paths?.projectsRoot || null;
        this.sessionQuery = paths?.sessionQuery || null;
        this.workspace = paths?.workspace || null;
    }

    /**
     * GET /api/version
     * アプリケーションバージョンを取得
     */
    /** @param {Request} req @param {Response} res */
    getVersion = (req, res) => {
        res.json({ version: this.appVersion, runtime: this.runtimeInfo });
    };

    /**
     * POST /api/restart
     * サーバーを再起動
     */
    /** @param {Request} req @param {Response} res */
    restart = (req, res) => {
        res.json({ message: 'Server restarting...' });
        setTimeout(() => {
            process.exit(0); // Exit process, assuming it's managed by a process manager
        }, 100);
    };

    /**
     * POST /api/upload
     * ファイルをアップロード
     * Note: uploadMiddleware は multer の single('file') ミドルウェア
     */
    /** @param {Request & { file?: { filename?: string } }} req @param {Response} res */
    upload = async (req, res) => {
        logger.info(`[upload] POST /api/upload received filename=${req.file?.filename || 'MISSING'} size=${req.file?.size || 0} ua="${req.headers['user-agent']?.slice(0, 80) || ''}"`);
        if (!req.file?.filename) {
            logger.warn('[upload] 400: No file in request');
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const absolutePath = path.resolve(this.uploadsDir, req.file.filename);
        logger.info(`[upload] 200: saved ${absolutePath}`);
        res.json({ path: absolutePath, filename: req.file.filename });
    };

    /**
     * worktreeパスからプロジェクトリポジトリのパスを解決
     * worktreeパターン: .worktrees/session-{id}-{project-id}/
     * config.ymlのprojects[].local.pathを参照
     */
    /** @param {string | null | undefined} cwdPath @returns {string | null} */
    _resolveProjectPath(cwdPath) {
        if (!cwdPath || !this.brainbaseRoot) return null;

        // worktreeパスからproject IDを抽出
        const worktreeMatch = cwdPath.match(/\.worktrees\/session-\d+-(.+?)(?:\/|$)/);
        if (!worktreeMatch) return null;

        const projectId = worktreeMatch[1];
        logger.debug('Extracted project ID from worktree', { projectId });

        // projectsRootから直接パスを構築（最速パス）
        if (this.projectsRoot) {
            const directPath = path.join(this.projectsRoot, projectId);
            if (fs.existsSync(directPath)) {
                return directPath;
            }
        }

        // config.ymlからプロジェクトのlocal.pathを取得（フォールバック）
        try {
            const configPath = path.join(this.brainbaseRoot, 'config.yml');
            if (!fs.existsSync(configPath)) return null;

            const configContent = fs.readFileSync(configPath, 'utf-8');
            const projectRegex = new RegExp(
                `- id: ${projectId}[\\s\\S]*?path:\\s*(.+?)\\n`,
                'm'
            );
            const match = configContent.match(projectRegex);
            if (!match) return null;

            let projectPath = match[1].trim();
            // 環境変数展開
            projectPath = projectPath.replace(
                /\$\{(\w+):-([^}]+)\}/g,
                (_, envVar, fallback) => process.env[envVar] || fallback
            );

            if (fs.existsSync(projectPath)) {
                return projectPath;
            }
        } catch (error) {
            logger.error('Error resolving project path', { error });
        }

        return null;
    }

    /** @param {string | null | undefined} candidate */
    _normalizePath(candidate) {
        if (!candidate || typeof candidate !== 'string') return null;

        const resolved = path.resolve(candidate);
        try {
            return fs.realpathSync.native(resolved);
        } catch {
            return resolved;
        }
    }

    /** @param {string | null | undefined} candidatePath @param {string | null | undefined} rootPath */
    _isWithinRoot(candidatePath, rootPath) {
        if (!candidatePath || !rootPath) return false;
        return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
    }

    /** @param {Array<string | null | undefined>} candidates */
    _dedupePaths(candidates) {
        /** @type {string[]} */
        const results = [];
        const seen = new Set();

        for (const candidate of candidates) {
            const normalized = this._normalizePath(candidate);
            if (!normalized || seen.has(normalized)) continue;
            seen.add(normalized);
            results.push(normalized);
        }

        return results;
    }

    /** @param {string | null | undefined} sessionId */
    async _getSessionContext(sessionId) {
        if (!sessionId) {
            return { session: null, resolvedWorkspacePath: null };
        }

        const session = typeof this.sessionQuery?.getSession === 'function'
            ? this.sessionQuery.getSession(sessionId)
            : null;
        const resolvedWorkspacePath = typeof this.workspace?.resolveSessionWorkspacePath === 'function'
            ? await this.workspace.resolveSessionWorkspacePath(sessionId, { persist: false, preferTmux: true })
            : null;

        return { session, resolvedWorkspacePath };
    }

    /** @param {{ sessionId: string | null | undefined }} options */
    async _getManagedRoots({ sessionId }) {
        const { session, resolvedWorkspacePath } = await this._getSessionContext(sessionId);
        return this._dedupePaths([
            this.workspaceRoot,
            this.brainbaseRoot,
            this.projectsRoot,
            resolvedWorkspacePath,
            session?.path,
            session?.worktree?.path
        ]);
    }

    /**
     * @param {{ managedRoots: string[], sessionContext: { session: any, resolvedWorkspacePath: string | null }, cwd: string | null | undefined }} options
     */
    _buildResolutionBases({ managedRoots, sessionContext, cwd }) {
        /** @type {string[]} */
        const bases = [];
        const pushIfAllowed = (candidate) => {
            const normalized = this._normalizePath(candidate);
            if (!normalized) return;
            if (!managedRoots.some(root => this._isWithinRoot(normalized, root))) return;
            if (!bases.includes(normalized)) bases.push(normalized);
        };

        pushIfAllowed(sessionContext.resolvedWorkspacePath);
        pushIfAllowed(sessionContext.session?.worktree?.path);
        pushIfAllowed(sessionContext.session?.path);
        pushIfAllowed(cwd);

        const projectPath = this._resolveProjectPath(
            sessionContext.resolvedWorkspacePath
            || sessionContext.session?.worktree?.path
            || sessionContext.session?.path
            || cwd
        );
        pushIfAllowed(projectPath);

        for (const root of managedRoots) {
            pushIfAllowed(root);
        }

        return bases;
    }

    /**
     * @param {{ targetPath: string, managedRoots: string[], resolutionBases: string[] }} options
     */
    _resolveTargetPath({ targetPath, managedRoots, resolutionBases }) {
        if (path.isAbsolute(targetPath)) {
            const normalized = this._normalizePath(targetPath);
            const matchedRoot = managedRoots.find(root => this._isWithinRoot(normalized, root)) || null;
            if (!matchedRoot) {
                return {
                    error: 'Invalid path: outside managed roots',
                    debug: { normalizedTarget: normalized, matchedRoot: null }
                };
            }

            return { normalizedPath: normalized, matchedRoot };
        }

        let firstAllowed = null;
        for (const base of resolutionBases) {
            const candidate = this._normalizePath(path.join(base, targetPath));
            const matchedRoot = managedRoots.find(root => this._isWithinRoot(candidate, root)) || null;
            if (!matchedRoot) continue;

            if (!firstAllowed) {
                firstAllowed = { normalizedPath: candidate, matchedRoot };
            }

            if (candidate && fs.existsSync(candidate)) {
                return { normalizedPath: candidate, matchedRoot };
            }
        }

        if (firstAllowed) {
            return firstAllowed;
        }

        return {
            error: 'Invalid path: outside managed roots',
            debug: { normalizedTarget: this._normalizePath(targetPath), matchedRoot: null }
        };
    }

    /**
     * POST /api/open-file
     * ファイルを開く/表示する
     *
     * パラメータ:
     * - filePath or path: ファイルパス（相対パスまたは絶対パス）
     * - line: 行番号（cursorモード時のみ）
     * - mode: 開き方 ('cursor' | 'file' | 'reveal')
     *   - 'cursor': Cursorエディタで開く
     *   - 'file': デフォルトアプリで開く
     *   - 'reveal': Finderで表示
     */
    /** @param {Request} req @param {Response} res */
    openFile = async (req, res) => {
        try {
            const { filePath, path: pathParam, line, mode = 'file', cwd, sessionId } = req.body;
            const targetPath = pathParam || filePath;

            logger.debug('openFile request', { mode, line, hasPath: !!targetPath, sessionId: sessionId || null });

            if (!targetPath) {
                return res.status(400).json({ error: 'filePath or path is required' });
            }

            // セキュリティチェック: ヌルバイト
            if (targetPath.includes('\0')) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid path: contains null byte'
                });
            }

            const managedRoots = await this._getManagedRoots({ sessionId });
            const sessionContext = await this._getSessionContext(sessionId);
            const resolutionBases = this._buildResolutionBases({ managedRoots, sessionContext, cwd });
            const resolvedTarget = this._resolveTargetPath({ targetPath, managedRoots, resolutionBases });

            if (resolvedTarget.error) {
                logger.warn('Path validation failed', {
                    targetPath,
                    cwd: cwd || null,
                    sessionId: sessionId || null,
                    managedRoots,
                    resolutionBases,
                    ...resolvedTarget.debug
                });
                return res.status(400).json({
                    success: false,
                    error: resolvedTarget.error
                });
            }

            const normalizedPath = resolvedTarget.normalizedPath;
            if (!normalizedPath) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid path'
                });
            }

            /** @type {string} */
            let execProgram;
            /** @type {string[]} */
            let execArgs;

            // modeに応じてコマンドを構築（execFileでシェルインジェクションを防止）
            switch (mode) {
                case 'reveal':
                    // Finderで表示
                    execProgram = 'open';
                    execArgs = ['-R', normalizedPath];
                    break;
                case 'file':
                    // デフォルトアプリで開く
                    execProgram = 'open';
                    execArgs = [normalizedPath];
                    break;
                case 'cursor':
                default:
                    // Cursorエディタで開く（既存の動作）
                    execProgram = 'cursor';
                    execArgs = line ? [`${normalizedPath}:${line}`] : [normalizedPath];
                    break;
            }

            logger.debug('Opening file', { mode });

            execFile(execProgram, execArgs, (error) => {
                if (error) {
                    logger.error('Error opening file', { error, mode, path: normalizedPath });
                    return res.status(500).json({
                        success: false,
                        error: `Failed to open file: ${error.message}`
                    });
                }
                res.json({ success: true, path: normalizedPath });
            });
        } catch (error) {
            logger.error('Error in openFile handler', { error });
            res.status(500).json({ error: 'Failed to open file' });
        }
    };

    /**
     * POST /api/client-diagnostics/session-menu
     * セッションリストの3点メニュー操作をサーバーログへ残す。
     */
    /** @param {Request} req @param {Response} res */
    recordSessionMenuDiagnostic = (req, res) => {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const safeBody = {
            seq: body.seq || null,
            phase: typeof body.phase === 'string' ? body.phase : null,
            reason: typeof body.reason === 'string' ? body.reason : null,
            timestamp: typeof body.timestamp === 'string' ? body.timestamp : null,
            sid: typeof body.sessionId === 'string' ? body.sessionId : null,
            currentSid: typeof body.currentSessionId === 'string' ? body.currentSessionId : null,
            viewMode: typeof body.sessionListView === 'string' ? body.sessionListView : null,
            sideView: typeof body.sidebarPrimaryView === 'string' ? body.sidebarPrimaryView : null,
            hitRow: typeof body.hitClosestRow === 'string' ? body.hitClosestRow : null,
            sessionId: typeof body.sessionId === 'string' ? body.sessionId : null,
            currentSessionId: typeof body.currentSessionId === 'string' ? body.currentSessionId : null,
            sessionListView: typeof body.sessionListView === 'string' ? body.sessionListView : null,
            sidebarPrimaryView: typeof body.sidebarPrimaryView === 'string' ? body.sidebarPrimaryView : null,
            fileViewerActive: body.fileViewerActive === true,
            renderScheduled: body.renderScheduled === true,
            event: body.event || null,
            target: body.target || null,
            hitElement: body.hitElement || null,
            hitClosestMenuToggle: body.hitClosestMenuToggle === true,
            hitClosestRow: body.hitClosestRow || null,
            row: body.row || null,
            menuToggle: body.menuToggle || null,
            dropdownMenu: body.dropdownMenu || null,
            overlay: body.overlay || null,
            fileViewerPanel: body.fileViewerPanel || null,
            activeElement: body.activeElement || null,
            openMenus: Array.isArray(body.openMenus) ? body.openMenus.slice(0, 5) : []
        };

        logger.info('[client-diagnostics][session-menu]', safeBody);
        res.json({ ok: true });
    };
}
