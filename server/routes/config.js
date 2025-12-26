/**
 * Config Routes
 * 設定管理のルーティング定義
 */
import express from 'express';
import { ConfigController } from '../controllers/config-controller.js';

export function createConfigRouter(configParser) {
    const router = express.Router();
    const controller = new ConfigController(configParser);

    // GET /api/config - すべての設定を取得
    router.get('/', controller.getAll);

    // GET /api/config/slack/workspaces - Slackワークスペースを取得
    router.get('/slack/workspaces', controller.getWorkspaces);

    // GET /api/config/slack/channels - Slackチャンネルを取得
    router.get('/slack/channels', controller.getChannels);

    // GET /api/config/slack/members - Slackメンバーを取得
    router.get('/slack/members', controller.getMembers);

    // GET /api/config/projects - プロジェクトを取得
    router.get('/projects', controller.getProjects);

    // GET /api/config/github - GitHub設定を取得
    router.get('/github', controller.getGitHub);

    // GET /api/config/integrity - 整合性チェック
    router.get('/integrity', controller.checkIntegrity);

    // GET /api/config/unified - 統合ビューを取得
    router.get('/unified', controller.getUnified);

    return router;
}
