/**
 * Wiki Routes
 * Wiki関連のルーティング定義
 */
import express from 'express';

export const WIKI_RETIREMENT = Object.freeze({
    code: 'WIKI_RETIRED_READ_ONLY',
    message: 'Brainbase Wiki is retired. Use Graph, the owning Git repository, or Drive as the SSOT.',
    readOnly: true,
    migration: 'docs/architecture/ADR-018-retire-wiki-storage.md'
});

export function rejectRetiredWiki(_req, res) {
    return res.status(410).json(WIKI_RETIREMENT);
}

export function createWikiRouter() {
    const router = express.Router();

    // All Wiki endpoints are retained only as an explicit retirement boundary.
    // Do not instantiate a service or touch auth/database state on this path.
    router.get('/pages', rejectRetiredWiki);

    // GET /api/wiki/page?path=xxx - 退役済みページ取得境界
    router.get('/page', rejectRetiredWiki);

    // POST /api/wiki/page - 退役済みページ作成/更新境界
    router.post('/page', rejectRetiredWiki);

    // DELETE /api/wiki/page?path=xxx - 退役済みページ削除境界
    router.delete('/page', rejectRetiredWiki);

    // PUT /api/wiki/page/access - 退役済みページ権限設定境界
    router.put('/page/access', rejectRetiredWiki);

    // ── Sync endpoints ──
    // GET /api/wiki/sync/manifest - 退役済み同期manifest境界
    router.get('/sync/manifest', rejectRetiredWiki);

    // POST /api/wiki/sync/pull - 退役済み同期pull境界
    router.post('/sync/pull', rejectRetiredWiki);

    // POST /api/wiki/sync/push - 退役済み同期push境界
    router.post('/sync/push', rejectRetiredWiki);

    return router;
}
