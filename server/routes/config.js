/**
 * Config Routes
 * 設定管理のルーティング定義
 */
import express from 'express';
import { ConfigController } from '../controllers/config-controller.js';

export function createConfigRouter(configParser, configService) {
    const router = express.Router();
    const controller = new ConfigController(configParser, configService);

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
    router.post('/projects', controller.upsertProject);
    router.put('/projects/:projectId', controller.upsertProject);
    router.delete('/projects/:projectId', controller.deleteProject);

    // GET /api/config/github - GitHub設定を取得
    router.get('/github', controller.getGitHub);

    // GET /api/config/integrity - 整合性チェック
    router.get('/integrity', controller.checkIntegrity);

    // GET /api/config/unified - 統合ビューを取得
    router.get('/unified', controller.getUnified);

    // GET /api/config/root - BRAINBASE_ROOTを取得
    router.get('/root', controller.getRoot);

    // GET /api/config/plugins - UI Plugin設定を取得
    router.get('/plugins', controller.getPlugins);

    // GET /api/config/organizations - Organizations設定を取得
    router.get('/organizations', controller.getOrganizations);

    // GET /api/config/dependencies - Dependencies設定を取得
    router.get('/dependencies', controller.getDependencies);

    // GET /api/config/notifications - Notifications設定を取得
    router.get('/notifications', controller.getNotifications);

    // Organizations CRUD
    router.post('/organizations', controller.upsertOrganization);
    router.put('/organizations/:orgId', controller.upsertOrganization);
    router.delete('/organizations/:orgId', controller.deleteOrganization);

    // Notifications update
    router.put('/notifications', controller.updateNotifications);

    // GitHub mappings CRUD
    router.post('/github', controller.upsertGitHub);
    router.put('/github/:projectId', controller.upsertGitHub);
    router.delete('/github/:projectId', controller.deleteGitHub);

    // NocoDB mappings CRUD
    router.post('/nocodb', controller.upsertNocoDB);
    router.put('/nocodb/:projectId', controller.upsertNocoDB);
    router.delete('/nocodb/:projectId', controller.deleteNocoDB);

    return router;
}
