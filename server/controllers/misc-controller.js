/**
 * MiscController
 * その他のHTTPリクエスト処理（version, restart, upload, open-file）
 */
import { exec, execFile } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { logger } from '../utils/logger.js';

export class MiscController {
    constructor(appVersion, uploadMiddleware, workspaceRoot, uploadsDir) {
        this.appVersion = appVersion;
        this.uploadMiddleware = uploadMiddleware;
        this.workspaceRoot = workspaceRoot;
        this.uploadsDir = uploadsDir;
    }

    /**
     * GET /api/version
     * アプリケーションバージョンを取得
     */
    getVersion = (req, res) => {
        res.json({ version: this.appVersion });
    };

    /**
     * POST /api/restart
     * サーバーを再起動
     */
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
    upload = async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const absolutePath = path.resolve(this.uploadsDir, req.file.filename);
        res.json({ path: absolutePath, filename: req.file.filename });
    };

    /**
     * POST /api/open-file
     * ファイルを開く/表示する
     *
     * パラメータ:
     * - filePath or path: ファイルパス（相対パスまたは絶対パス）
     * - line: 行番号（cursorモード時のみ）
     * - mode: 開き方 ('cursor' | 'file' | 'reveal')
     *   - 'cursor': Cursorエディタで開く（既存の動作、デフォルト）
     *   - 'file': デフォルトアプリで開く
     *   - 'reveal': Finderで表示
     */
    openFile = async (req, res) => {
        try {
            const { filePath, path: pathParam, line, mode = 'cursor' } = req.body;
            const targetPath = pathParam || filePath;

            logger.debug('openFile request', { mode, line, hasPath: !!targetPath });

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

            // チルダ（~）で始まるパスはホームディレクトリ相対パスとして扱う
            const isHomeDirPath = targetPath.startsWith('~/');
            let expandedPath = targetPath;
            if (isHomeDirPath) {
                expandedPath = path.join(os.homedir(), targetPath.slice(2));
            }

            // Resolve relative paths from workspace root
            let absolutePath = path.isAbsolute(expandedPath)
                ? expandedPath
                : path.join(this.workspaceRoot, expandedPath);

            // パスを正規化
            let normalizedPath = path.resolve(absolutePath);

            // パストラバーサル対策: ホームディレクトリからの相対パスは許可
            // /workspace/ を含むパスであれば、workspace全体を許可範囲とする
            // これにより、worktree環境でも通常環境でも、同じworkspace内のファイルにアクセス可能
            let allowedRoot = this.workspaceRoot;
            const workspaceIndex = this.workspaceRoot.indexOf('/workspace/');
            if (workspaceIndex !== -1) {
                // 例: /home/user/workspace/projects/app → /home/user/workspace/
                allowedRoot = this.workspaceRoot.substring(0, workspaceIndex + '/workspace/'.length);
            }

            logger.debug('Path validation', {
                workspaceRoot: this.workspaceRoot,
                normalizedPath,
                allowedRoot,
                isHomeDirPath,
                startsWithAllowed: normalizedPath.startsWith(allowedRoot)
            });

            if (!isHomeDirPath && !normalizedPath.startsWith(allowedRoot)) {
                logger.warn('Path traversal attempt detected', { allowedRoot, normalizedPath });
                return res.status(400).json({
                    success: false,
                    error: 'Invalid path: outside workspace'
                });
            }

            // ファイルが存在しない場合、プロジェクトディレクトリ内を検索
            if (!fs.existsSync(normalizedPath) && !path.isAbsolute(targetPath) && !isHomeDirPath) {
                logger.debug('File not found, searching in project directories');

                try {
                    const subdirs = fs.readdirSync(this.workspaceRoot, { withFileTypes: true })
                        .filter(dirent => dirent.isDirectory())
                        .map(dirent => dirent.name);

                    for (const subdir of subdirs) {
                        const candidatePath = path.join(this.workspaceRoot, subdir, expandedPath);
                        if (fs.existsSync(candidatePath)) {
                            logger.debug('Found file in project directory');
                            normalizedPath = path.resolve(candidatePath);
                            break;
                        }
                    }
                } catch (searchError) {
                    logger.error('Error searching project directories', { error: searchError });
                }
            }

            let execProgram;
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
                    logger.error('Error opening file', { error, mode });
                    return res.status(500).json({
                        success: false,
                        error: 'Failed to open file'
                    });
                }
                res.json({ success: true, path: normalizedPath });
            });
        } catch (error) {
            logger.error('Error in openFile handler', { error });
            res.status(500).json({ error: 'Failed to open file' });
        }
    };
}
