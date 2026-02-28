/**
 * Timeline Routes
 * タイムライン関連のルーティング定義
 */
import express from 'express';
import { TimelineController } from '../controllers/timeline-controller.js';

export function createTimelineRouter(timelineStorage) {
    const router = express.Router();
    const controller = new TimelineController(timelineStorage);

    // GET /api/timeline/today - 今日のタイムラインを取得
    router.get('/today', controller.getToday);

    // GET /api/timeline?date=YYYY-MM-DD - 指定日のタイムラインを取得
    router.get('/', controller.getByDate);

    // GET /api/timeline/:id - 指定IDの項目を取得
    router.get('/:id', controller.getItem);

    // POST /api/timeline - タイムライン項目を作成
    router.post('/', controller.create);

    // PUT /api/timeline/:id - タイムライン項目を更新
    router.put('/:id', controller.update);

    // DELETE /api/timeline/:id - タイムライン項目を削除
    router.delete('/:id', controller.delete);

    return router;
}
