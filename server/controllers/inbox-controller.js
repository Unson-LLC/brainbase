/**
 * InboxController
 * インボックス管理のHTTPリクエスト処理
 */
import { asyncHandler } from '../lib/async-handler.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

export class InboxController {
    constructor(inboxParser) {
        this.inboxParser = inboxParser;
    }

    /** GET /api/inbox/pending */
    getPending = asyncHandler(async (req, res) => {
        const items = await this.inboxParser.getPendingItems();
        res.json(items);
    });

    /** GET /api/inbox/count */
    getCount = asyncHandler(async (req, res) => {
        const count = await this.inboxParser.getPendingCount();
        res.json({ count });
    });

    /** POST /api/inbox/:id/done */
    markAsDone = asyncHandler(async (req, res) => {
        const { id } = req.params;
        const success = await this.inboxParser.markAsDone(id);
        if (!success) {
            throw new AppError('Item not found or mark failed', ErrorCodes.TASK_NOT_FOUND);
        }
        res.json({ success: true });
    });

    /** POST /api/inbox/mark-all-done */
    markAllAsDone = asyncHandler(async (req, res) => {
        const success = await this.inboxParser.markAllAsDone();
        res.json({ success });
    });
}
