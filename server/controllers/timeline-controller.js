import { asyncHandler } from '../lib/async-handler.js';
import { AppError, ErrorCodes } from '../lib/errors.js';

/**
 * TimelineController
 * タイムライン関連のHTTPリクエスト処理
 */
export class TimelineController {
    constructor(timelineStorage) {
        this.storage = timelineStorage;
    }

    /** GET /api/timeline/today */
    getToday = asyncHandler(async (req, res) => {
        const timeline = await this.storage.getTodayTimeline();
        res.json(timeline);
    });

    /** GET /api/timeline */
    getByDate = asyncHandler(async (req, res) => {
        const { date } = req.query;
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            throw new AppError('Invalid date format. Use YYYY-MM-DD', ErrorCodes.INVALID_DATE_FORMAT);
        }
        const timeline = await this.storage.loadTimeline(date);
        res.json(timeline);
    });

    /** GET /api/timeline/:id */
    getItem = asyncHandler(async (req, res) => {
        const item = await this.storage.getItem(req.params.id);
        if (!item) {
            throw new AppError('Timeline item not found', ErrorCodes.TASK_NOT_FOUND);
        }
        res.json(item);
    });

    /** POST /api/timeline */
    create = asyncHandler(async (req, res) => {
        const item = req.body;

        if (!item.type || !item.title) {
            throw AppError.validation('type and title are required');
        }

        const result = await this.storage.addItem(item);
        if (!result.success) {
            if (result.reason === 'duplicate') {
                throw AppError.conflict('Duplicate item');
            }
            throw AppError.validation(`Failed to create item: ${result.reason}`);
        }

        res.status(201).json(result.item);
    });

    /** PUT /api/timeline/:id */
    update = asyncHandler(async (req, res) => {
        const result = await this.storage.updateItem(req.params.id, req.body);
        if (!result.success) {
            if (result.reason === 'not_found') {
                throw new AppError('Timeline item not found', ErrorCodes.TASK_NOT_FOUND);
            }
            throw AppError.validation(`Failed to update item: ${result.reason}`);
        }

        res.json(result.item);
    });

    /** DELETE /api/timeline/:id */
    delete = asyncHandler(async (req, res) => {
        const result = await this.storage.deleteItem(req.params.id);
        if (!result.success) {
            if (result.reason === 'not_found') {
                throw new AppError('Timeline item not found', ErrorCodes.TASK_NOT_FOUND);
            }
            throw AppError.validation(`Failed to delete item: ${result.reason}`);
        }

        res.status(204).send();
    });
}
