// @ts-check
import { asyncHandler } from '../lib/async-handler.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

/** @typedef {any} Request */
/** @typedef {any} Response */
/** @typedef {{ role?: string, clearance?: string[], projectCodes?: string[] }} WikiAccess */

/**
 * WikiController
 * Wiki関連のHTTPリクエスト処理
 */
export class WikiController {
    /** @param {any} wikiService */
    constructor(wikiService) {
        this.wikiService = wikiService;
    }

    /**
     * リクエストからアクセス情報を抽出
     */
    /**
     * @param {Request & { access?: WikiAccess, auth?: WikiAccess }} req
     * @returns {{ role: string, clearance: string[], projectCodes: string[] }}
     */
    _extractAccess(req) {
        if (req.access) {
            return {
                role: req.access.role || 'member',
                clearance: req.access.clearance || [],
                projectCodes: req.access.projectCodes || []
            };
        }
        if (req.auth) {
            return {
                role: req.auth.role || 'member',
                clearance: req.auth.clearance || [],
                projectCodes: req.auth.projectCodes || []
            };
        }
        return { role: 'ceo', clearance: ['internal', 'restricted', 'finance', 'hr', 'contract'], projectCodes: [] };
    }

    /** @param {{ error?: string }} result */
    _handleResultErrors(result) {
        if (result.error === 'forbidden') throw new AppError('Forbidden', ErrorCodes.FORBIDDEN);
        if (result.error === 'not_found') throw new AppError('Page not found', ErrorCodes.TASK_NOT_FOUND);
    }

    /** GET /api/wiki/pages */
    /** @param {Request} req @param {Response} res */
    listPages = asyncHandler(async (req, res) => {
        const access = this._extractAccess(req);
        const pages = await this.wikiService.listPages(access);
        res.json(pages);
    });

    /** GET /api/wiki/page?path=xxx */
    /** @param {Request} req @param {Response} res */
    getPage = asyncHandler(async (req, res) => {
        const pagePath = req.query.path;
        if (!pagePath || typeof pagePath !== 'string') {
            throw AppError.validation('path query parameter is required');
        }

        const access = this._extractAccess(req);
        const result = await this.wikiService.getPage(access, pagePath);
        this._handleResultErrors(result);
        res.json(result);
    });

    /** POST /api/wiki/page */
    /** @param {Request} req @param {Response} res */
    savePage = asyncHandler(async (req, res) => {
        const { path: pagePath, content } = req.body;
        if (!pagePath || typeof pagePath !== 'string') {
            throw AppError.validation('path is required');
        }
        if (typeof content !== 'string') {
            throw AppError.validation('content must be a string');
        }

        const access = this._extractAccess(req);
        const result = await this.wikiService.savePage(access, pagePath, content);
        this._handleResultErrors(result);
        res.json(result);
    });

    /** DELETE /api/wiki/page?path=xxx */
    /** @param {Request} req @param {Response} res */
    deletePage = asyncHandler(async (req, res) => {
        const pagePath = req.query.path;
        if (!pagePath || typeof pagePath !== 'string') {
            throw AppError.validation('path query parameter is required');
        }

        const access = this._extractAccess(req);
        const result = await this.wikiService.deletePage(access, pagePath);
        this._handleResultErrors(result);
        res.json(result);
    });

    /** PUT /api/wiki/page/access */
    /** @param {Request} req @param {Response} res */
    setAccess = asyncHandler(async (req, res) => {
        const { path: pagePath, role_min, sensitivity, project_id } = req.body;
        if (!pagePath || typeof pagePath !== 'string') {
            throw AppError.validation('path is required');
        }

        const result = await this.wikiService.setPageAccess(pagePath, {
            roleMin: role_min,
            sensitivity,
            projectId: project_id
        });
        res.json(result);
    });

    /** GET /api/wiki/sync/manifest */
    /** @param {Request} req @param {Response} res */
    getManifest = asyncHandler(async (req, res) => {
        const access = this._extractAccess(req);
        const manifest = await this.wikiService.getManifest(access);
        res.json(manifest);
    });

    /** POST /api/wiki/sync/pull */
    /** @param {Request} req @param {Response} res */
    bulkPull = asyncHandler(async (req, res) => {
        const { paths } = req.body;
        if (!Array.isArray(paths)) {
            throw AppError.validation('paths must be an array');
        }

        const access = this._extractAccess(req);
        const pages = await this.wikiService.bulkGetPages(access, paths);
        res.json(pages);
    });

    /** POST /api/wiki/sync/push */
    /** @param {Request} req @param {Response} res */
    bulkPush = asyncHandler(async (req, res) => {
        const { pages } = req.body;
        if (!Array.isArray(pages)) {
            throw AppError.validation('pages must be an array');
        }

        const access = this._extractAccess(req);
        const results = await this.wikiService.bulkSavePages(access, pages);

        const hasConflict = results.some((r) => r.error === 'conflict');
        res.status(hasConflict ? 409 : 200).json(results);
    });
}
