/**
 * MiscController
 * その他のHTTPリクエスト処理（version, restart, upload, open-file）
 */
import { exec } from 'child_process';
import path from 'path';

export class MiscController {
    constructor(appVersion, uploadMiddleware, workspaceRoot) {
        this.appVersion = appVersion;
        this.uploadMiddleware = uploadMiddleware;
        this.workspaceRoot = workspaceRoot;
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

        const path = await import('path');
        const __dirname = path.dirname(new URL(import.meta.url).pathname);
        const absolutePath = path.resolve(__dirname, '../../uploads', req.file.filename);
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

            // Resolve relative paths from workspace root
            const absolutePath = path.isAbsolute(targetPath)
                ? targetPath
                : path.join(this.workspaceRoot, targetPath);

            // パスを正規化
            const normalizedPath = path.resolve(absolutePath);

            // セキュリティチェック: ワークスペース内かどうか
            if (mode !== 'cursor') {
                const relativePath = path.relative(this.workspaceRoot, normalizedPath);
                const isInsideWorkspace = relativePath &&
                    !relativePath.startsWith('..') &&
                    !path.isAbsolute(relativePath);

                if (!isInsideWorkspace) {
                    return res.status(403).json({
                        success: false,
                        error: 'Access denied: path is outside workspace'
                    });
                }
            }

            let command;

            // modeに応じてコマンドを構築
            switch (mode) {
                case 'reveal':
                    // Finderで表示
                    command = `open -R "${normalizedPath}"`;
                    break;
                case 'file':
                    // デフォルトアプリで開く
                    command = `open "${normalizedPath}"`;
                    break;
                case 'cursor':
                default:
                    // Cursorエディタで開く（既存の動作）
                    const lineArg = line ? `:${line}` : '';
                    command = `cursor "${normalizedPath}${lineArg}"`;
                    break;
            }

            console.log(`Opening file: ${command}`);

            exec(command, (error) => {
                if (error) {
                    console.error('Error opening file:', error);
                    return res.status(500).json({
                        success: false,
                        error: error.message
                    });
                }
                res.json({ success: true, path: normalizedPath });
            });
        } catch (error) {
            console.error('Error in /api/open-file:', error);
            res.status(500).json({ error: error.message });
        }
    };
}
