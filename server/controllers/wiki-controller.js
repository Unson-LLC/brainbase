import { logger } from '../utils/logger.js';

/**
 * WikiController
 * Wiki関連のHTTPリクエスト処理
 */
export class WikiController {
    constructor(wikiService) {
        this.wikiService = wikiService;
    }

    /**
     * リクエストからアクセス情報を抽出
     * 認証情報がない場合はデフォルト（member, internal）
     */
    _extractAccess(req) {
        // requireAuth guarantees req.access exists
        if (req.access) {
            return {
                role: req.access.role || 'member',
                clearance: req.access.clearance || [],
                projectCodes: req.access.projectCodes || []
            };
        }
        // フォールバック（通常はrequireAuthで保証されるため到達しない）
        if (req.auth) {
            return {
                role: req.auth.role || 'member',
                clearance: req.auth.clearance || [],
                projectCodes: req.auth.projectCodes || []
            };
        }
        return { role: 'ceo', clearance: ['internal', 'restricted', 'finance', 'hr', 'contract'], projectCodes: [] };
    }

    /**
     * GET /api/wiki/pages
     * ページ一覧を取得（権限フィルタ済み）
     */
    listPages = async (req, res) => {
        try {
            const access = this._extractAccess(req);
            const pages = await this.wikiService.listPages(access);
            res.json(pages);
        } catch (error) {
            logger.error('Failed to list wiki pages', { error });
            res.status(500).json({ error: 'Failed to list wiki pages' });
        }
    };

    /**
     * GET /api/wiki/page?path=xxx
     * ページ取得
     */
    getPage = async (req, res) => {
        try {
            const pagePath = req.query.path;
            if (!pagePath || typeof pagePath !== 'string') {
                return res.status(400).json({ error: 'path query parameter is required' });
            }

            const access = this._extractAccess(req);
            const result = await this.wikiService.getPage(access, pagePath);

            if (result.error === 'forbidden') return res.status(403).json({ error: 'Forbidden' });
            if (result.error === 'not_found') return res.status(404).json({ error: 'Page not found' });

            res.json(result);
        } catch (error) {
            logger.error('Failed to get wiki page', { error, path: req.query.path });
            res.status(500).json({ error: 'Failed to get wiki page' });
        }
    };

    /**
     * POST /api/wiki/page
     * ページ作成/更新 { path, content }
     */
    savePage = async (req, res) => {
        try {
            const { path: pagePath, content } = req.body;
            if (!pagePath || typeof pagePath !== 'string') {
                return res.status(400).json({ error: 'path is required' });
            }
            if (typeof content !== 'string') {
                return res.status(400).json({ error: 'content must be a string' });
            }

            const access = this._extractAccess(req);
            const result = await this.wikiService.savePage(access, pagePath, content);

            if (result.error === 'forbidden') return res.status(403).json({ error: 'Forbidden' });

            res.json(result);
        } catch (error) {
            logger.error('Failed to save wiki page', { error });
            res.status(500).json({ error: 'Failed to save wiki page' });
        }
    };

    /**
     * DELETE /api/wiki/page?path=xxx
     * ページ削除
     */
    deletePage = async (req, res) => {
        try {
            const pagePath = req.query.path;
            if (!pagePath || typeof pagePath !== 'string') {
                return res.status(400).json({ error: 'path query parameter is required' });
            }

            const access = this._extractAccess(req);
            const result = await this.wikiService.deletePage(access, pagePath);

            if (result.error === 'forbidden') return res.status(403).json({ error: 'Forbidden' });
            if (result.error === 'not_found') return res.status(404).json({ error: 'Page not found' });

            res.json(result);
        } catch (error) {
            logger.error('Failed to delete wiki page', { error, path: req.query.path });
            res.status(500).json({ error: 'Failed to delete wiki page' });
        }
    };

    /**
     * PUT /api/wiki/page/access
     * ページ権限設定 { path, role_min, sensitivity }
     */
    setAccess = async (req, res) => {
        try {
            const { path: pagePath, role_min, sensitivity, project_id } = req.body;
            if (!pagePath || typeof pagePath !== 'string') {
                return res.status(400).json({ error: 'path is required' });
            }

            const result = await this.wikiService.setPageAccess(pagePath, {
                roleMin: role_min,
                sensitivity,
                projectId: project_id
            });

            res.json(result);
        } catch (error) {
            logger.error('Failed to set wiki page access', { error });
            res.status(500).json({ error: 'Failed to set page access' });
        }
    };

    /**
     * GET /api/wiki/sync/manifest
     * 権限済みページ一覧（content_hash付き）
     */
    getManifest = async (req, res) => {
        try {
            const access = this._extractAccess(req);
            const manifest = await this.wikiService.getManifest(access);
            res.json(manifest);
        } catch (error) {
            logger.error('Failed to get wiki manifest', { error });
            res.status(500).json({ error: 'Failed to get wiki manifest' });
        }
    };

    /**
     * POST /api/wiki/sync/pull
     * バルクダウンロード { paths: [...] }
     */
    bulkPull = async (req, res) => {
        try {
            const { paths } = req.body;
            if (!Array.isArray(paths)) {
                return res.status(400).json({ error: 'paths must be an array' });
            }

            const access = this._extractAccess(req);
            const pages = await this.wikiService.bulkGetPages(access, paths);
            res.json(pages);
        } catch (error) {
            logger.error('Failed to bulk pull wiki pages', { error });
            res.status(500).json({ error: 'Failed to bulk pull wiki pages' });
        }
    };

    /**
     * POST /api/wiki/sync/push
     * バルクアップロード { pages: [{ path, content, if_unmodified_since }] }
     */
    bulkPush = async (req, res) => {
        try {
            const { pages } = req.body;
            if (!Array.isArray(pages)) {
                return res.status(400).json({ error: 'pages must be an array' });
            }

            const access = this._extractAccess(req);
            const results = await this.wikiService.bulkSavePages(access, pages);

            // 409 if any conflicts
            const hasConflict = results.some(r => r.error === 'conflict');
            res.status(hasConflict ? 409 : 200).json(results);
        } catch (error) {
            logger.error('Failed to bulk push wiki pages', { error });
            res.status(500).json({ error: 'Failed to bulk push wiki pages' });
        }
    };
}
