/**
 * MiscController
 * その他のHTTPリクエスト処理（version, restart, upload）
 */
export class MiscController {
    constructor(appVersion, uploadMiddleware) {
        this.appVersion = appVersion;
        this.uploadMiddleware = uploadMiddleware;
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
}
