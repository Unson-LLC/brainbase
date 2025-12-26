/**
 * Schedule Routes
 * スケジュール関連のルーティング定義
 */
import express from 'express';
import { ScheduleController } from '../controllers/schedule-controller.js';

export function createScheduleRouter(scheduleParser) {
    const router = express.Router();
    const controller = new ScheduleController(scheduleParser);

    // GET /api/schedule/today - 今日のスケジュールを取得
    router.get('/today', controller.getToday);

    return router;
}
