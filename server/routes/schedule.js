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

    // GET /api/schedule/:date - 指定日のスケジュールを取得
    router.get('/:date', controller.getByDate);

    // POST /api/schedule/:date/events - イベントを追加（Kiro形式のみ）
    router.post('/:date/events', controller.addEvent);

    // PUT /api/schedule/:date/events/:id - イベントを更新（Kiro形式のみ）
    router.put('/:date/events/:id', controller.updateEvent);

    // DELETE /api/schedule/:date/events/:id - イベントを削除（Kiro形式のみ）
    router.delete('/:date/events/:id', controller.deleteEvent);

    return router;
}
