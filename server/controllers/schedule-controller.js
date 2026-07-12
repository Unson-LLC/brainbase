// @ts-check
/**
 * ScheduleController
 * スケジュール関連のHTTPリクエスト処理
 */
import { AppError, ErrorCodes } from '../lib/errors.js';

/** @typedef {any} Request */
/** @typedef {any} Response */
/** @typedef {any} NextFunction */

export class ScheduleController {
    /**
     * @param {any} scheduleParser
     * @param {any} [googleCalendarService]
     */
    constructor(scheduleParser, googleCalendarService = null) {
        this.scheduleParser = scheduleParser;
        this.googleCalendarService = googleCalendarService;
    }

    /**
     * GET /api/schedule/today
     * 今日のスケジュールを取得
     */
    /** @param {Request} req @param {Response} res @param {NextFunction} next */
    getToday = async (req, res, next) => {
        try {
            const schedule = await this.scheduleParser.getTodaySchedule();
            res.json(schedule);
        } catch (error) {
            next(AppError.internal('Failed to get schedule', error));
        }
    };

    /**
     * GET /api/schedule/:date
     * 指定日のスケジュールを取得
     */
    /** @param {Request} req @param {Response} res @param {NextFunction} next */
    getByDate = async (req, res, next) => {
        try {
            const { date } = req.params;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                throw new AppError('Invalid date format. Use YYYY-MM-DD', ErrorCodes.INVALID_DATE_FORMAT);
            }
            const schedule = await this.scheduleParser.getSchedule(date);
            res.json(schedule);
        } catch (error) {
            next(AppError.isAppError(error) ? error : AppError.internal('Failed to get schedule', /** @type {any} */ (error)));
        }
    };

    /** @param {Request} req @param {Response} res @param {NextFunction} next */
    getGoogleCalendarAuthStatus = async (req, res, next) => {
        try {
            if (!this.googleCalendarService) {
                return res.json({
                    provider: 'gog',
                    configured: false,
                    installed: false,
                    connected: false,
                    defaultAccount: null,
                    calendarIds: [],
                    reason: 'missing_service',
                    setupCommands: []
                });
            }
            const status = await this.googleCalendarService.getAuthStatus();
            return res.json(status);
        } catch (error) {
            next(AppError.internal('Failed to get Google Calendar auth status', /** @type {any} */ (error)));
        }
    };

    /** @param {Request} _req @param {Response} res */
    googleCalendarOAuthDeprecated = async (_req, res) => {
        return res.status(410).json({
            error: 'Google Calendar OAuth flow has been removed. Configure gog locally instead.',
            provider: 'gog'
        });
    };
}
