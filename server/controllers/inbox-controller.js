// @ts-check
/**
 * InboxController
 * インボックス管理のHTTPリクエスト処理
 */
import { asyncHandler } from '../lib/async-handler.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

/** @typedef {any} Request */
/** @typedef {any} Response */

export class InboxController {
    /** @param {any} inboxParser */
    constructor(inboxParser) {
        this.inboxParser = inboxParser;
    }

    /** @param {Request} req @param {Response} res */
    getPending = asyncHandler(async (req, res) => {
        const items = await this.inboxParser.getPendingItems();
        res.json(items);
    });

    /** @param {Request} req @param {Response} res */
    getCount = asyncHandler(async (req, res) => {
        const count = await this.inboxParser.getPendingCount();
        res.json({ count });
    });

    /** @param {Request} req @param {Response} res */
    markAsDone = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const success = await this.inboxParser.markAsDone(id);
        if (!success) {
            throw new AppError('Item not found or mark failed', ErrorCodes.TASK_NOT_FOUND);
        }
        res.json({ success: true });
    });

    /** @param {Request} req @param {Response} res */
    markAllAsDone = asyncHandler(async (req, res) => {
        const success = await this.inboxParser.markAllAsDone();
        res.json({ success });
    });
}
