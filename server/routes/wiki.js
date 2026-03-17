/**
 * Wiki Routes
 * Wiki関連のルーティング定義
 */
import express from 'express';
import { WikiController } from '../controllers/wiki-controller.js';

export function createWikiRouter(wikiService) {
    const router = express.Router();
    const controller = new WikiController(wikiService);

    // GET /api/wiki/pages - ページ一覧（権限フィルタ済み）
    router.get('/pages', controller.listPages);

    // GET /api/wiki/page?path=xxx - ページ取得
    router.get('/page', controller.getPage);

    // POST /api/wiki/page - ページ作成/更新
    router.post('/page', controller.savePage);

    // DELETE /api/wiki/page?path=xxx - ページ削除
    router.delete('/page', controller.deletePage);

    // PUT /api/wiki/page/access - ページ権限設定
    router.put('/page/access', controller.setAccess);

    // ── Sync endpoints ──
    // GET /api/wiki/sync/manifest - 権限済みページ一覧 + hash
    router.get('/sync/manifest', controller.getManifest);

    // POST /api/wiki/sync/pull - バルクダウンロード
    router.post('/sync/pull', controller.bulkPull);

    // POST /api/wiki/sync/push - バルクアップロード（conflict検出）
    router.post('/sync/push', controller.bulkPush);

    return router;
}
