/**
 * Schedule Routes
 * スケジュール関連のルーティング定義
 */
import express from 'express';
import { ScheduleController } from '../controllers/schedule-controller.js';

export function createScheduleRouter(scheduleParser, googleCalendarService = null) {
    const router = express.Router();
    const controller = new ScheduleController(scheduleParser, googleCalendarService);

    router.get('/google/auth-status', controller.getGoogleCalendarAuthStatus);
    router.get('/google/start', controller.googleCalendarOAuthDeprecated);
    router.get('/google/callback', controller.googleCalendarOAuthDeprecated);
    router.delete('/google/auth', controller.googleCalendarOAuthDeprecated);

    // GET /api/schedule/today - 今日のスケジュールを取得
    router.get('/today', controller.getToday);

    // GET /api/schedule/:date - 指定日のスケジュールを取得
    router.get('/:date', controller.getByDate);

    return router;
}
