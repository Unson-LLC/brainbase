/**
 * ScheduleController
 * スケジュール関連のHTTPリクエスト処理
 */
import { AppError, ErrorCodes } from '../lib/errors.js';

export class ScheduleController {
    constructor(scheduleParser, googleCalendarService = null) {
        this.scheduleParser = scheduleParser;
        this.googleCalendarService = googleCalendarService;
    }

    /**
     * GET /api/schedule/today
     * 今日のスケジュールを取得
     */
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
    getByDate = async (req, res, next) => {
        try {
            const { date } = req.params;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                throw new AppError('Invalid date format. Use YYYY-MM-DD', ErrorCodes.INVALID_DATE_FORMAT);
            }
            const schedule = await this.scheduleParser.getSchedule(date);
            res.json(schedule);
        } catch (error) {
            next(AppError.isAppError(error) ? error : AppError.internal('Failed to get schedule', error));
        }
    };

    /**
     * POST /api/schedule/:date/events
     * イベントを追加（Kiro形式のみ）
     */
    addEvent = async (req, res, next) => {
        try {
            const { date } = req.params;
            const eventData = req.body;

            if (!eventData.title || !eventData.start) {
                throw new AppError('title and start are required', ErrorCodes.MISSING_REQUIRED_FIELD);
            }

            const result = await this.scheduleParser.addEvent(date, eventData);

            if (result.duplicate) {
                throw AppError.conflict('Event already exists');
            }

            res.status(201).json(result.event);
        } catch (error) {
            if (!AppError.isAppError(error) && error.message?.includes('only supported in Kiro format')) {
                return next(new AppError('This operation requires Kiro schedule format', ErrorCodes.UNSUPPORTED_FORMAT));
            }
            next(AppError.isAppError(error) ? error : AppError.internal('Failed to add event', error));
        }
    };

    /**
     * PUT /api/schedule/:date/events/:id
     * イベントを更新（Kiro形式のみ）
     */
    updateEvent = async (req, res, next) => {
        try {
            const { date, id } = req.params;
            const updates = req.body;

            const result = await this.scheduleParser.updateEvent(date, id, updates);

            if (!result.success) {
                throw new AppError(result.error, ErrorCodes.EVENT_NOT_FOUND);
            }

            res.json(result.event);
        } catch (error) {
            if (!AppError.isAppError(error) && error.message?.includes('only supported in Kiro format')) {
                return next(new AppError('This operation requires Kiro schedule format', ErrorCodes.UNSUPPORTED_FORMAT));
            }
            next(AppError.isAppError(error) ? error : AppError.internal('Failed to update event', error));
        }
    };

    /**
     * DELETE /api/schedule/:date/events/:id
     * イベントを削除（Kiro形式のみ）
     */
    deleteEvent = async (req, res, next) => {
        try {
            const { date, id } = req.params;

            const result = await this.scheduleParser.deleteEvent(date, id);

            if (!result.success) {
                throw new AppError(result.error, ErrorCodes.EVENT_NOT_FOUND);
            }

            res.json({ success: true, event: result.event });
        } catch (error) {
            if (!AppError.isAppError(error) && error.message?.includes('only supported in Kiro format')) {
                return next(new AppError('This operation requires Kiro schedule format', ErrorCodes.UNSUPPORTED_FORMAT));
            }
            next(AppError.isAppError(error) ? error : AppError.internal('Failed to delete event', error));
        }
    };

    getGoogleCalendarAuthStatus = async (req, res, next) => {
        try {
            if (!this.googleCalendarService) {
                return res.json({ configured: false, connected: false, calendarIds: [] });
            }
            const status = await this.googleCalendarService.getAuthStatus();
            return res.json(status);
        } catch (error) {
            next(AppError.internal('Failed to get Google Calendar auth status', error));
        }
    };

    startGoogleCalendarAuth = async (req, res, next) => {
        try {
            if (!this.googleCalendarService?.isConfigured()) {
                throw AppError.internal('Google Calendar OAuth is not configured');
            }
            const origin = typeof req.query.origin === 'string' ? req.query.origin : '';
            return res.redirect(this.googleCalendarService.buildAuthorizeUrl(origin));
        } catch (error) {
            next(AppError.isAppError(error) ? error : AppError.internal('Failed to start Google Calendar auth', error));
        }
    };

    googleCalendarCallback = async (req, res) => {
        const code = typeof req.query.code === 'string' ? req.query.code : '';
        const state = typeof req.query.state === 'string' ? req.query.state : '';

        if (!code || !state || !this.googleCalendarService) {
            return res.status(400).type('html').send(this.googleCalendarService?.renderCallbackError('Missing code or state') || 'Invalid callback');
        }

        try {
            const result = await this.googleCalendarService.handleOAuthCallback(code, state);
            return res.status(200).type('html').send(this.googleCalendarService.renderCallbackSuccess(result.origin));
        } catch (error) {
            return res.status(400).type('html').send(this.googleCalendarService.renderCallbackError(error));
        }
    };

    disconnectGoogleCalendar = async (req, res, next) => {
        try {
            if (!this.googleCalendarService) {
                return res.json({ success: true });
            }
            await this.googleCalendarService.disconnect();
            return res.json({ success: true });
        } catch (error) {
            next(AppError.internal('Failed to disconnect Google Calendar', error));
        }
    };
}
