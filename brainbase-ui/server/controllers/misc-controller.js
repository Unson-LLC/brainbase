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
     * エディタ（Cursor）でファイルを開く
     */
    openFile = async (req, res) => {
        try {
            const { filePath, line } = req.body;

            if (!filePath) {
                return res.status(400).json({ error: 'filePath is required' });
            }

            // Resolve relative paths from workspace root
            const absolutePath = path.isAbsolute(filePath)
                ? filePath
                : path.join(this.workspaceRoot, filePath);

            // Build cursor command
            const lineArg = line ? `:${line}` : '';
            const command = `cursor "${absolutePath}${lineArg}"`;

            console.log(`Opening file: ${command}`);

            exec(command, (error) => {
                if (error) {
                    console.error('Error opening file:', error);
                }
            });

            res.json({ success: true, path: absolutePath });
        } catch (error) {
            console.error('Error in /api/open-file:', error);
            res.status(500).json({ error: error.message });
        }
    };
}
