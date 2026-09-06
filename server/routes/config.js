/**
 * Config Routes
 * 設定管理のルーティング定義
 */
import express from 'express';
import { ConfigController } from '../controllers/config-controller.js';

/**
 * SPEC-settings-phase0-guards INV-2: server-side auth + role guard
 * write op の前に actor / role を検証する middleware
 */
export function requireConfigAuth(req, res, next) {
    const actor = req.actor || req.user || req.auth;
    const access = req.access;
    if (!actor?.sub && !access?.personId && !access?.role) {
        return res.status(401).json({ error: 'authentication required' });
    }
    return next();
}

export function requireConfigWriteRole(req, res, next) {
    const actor = req.actor || req.user || req.auth || {};
    const access = req.access || {};
    const role = actor.role || access.role || 'member';
    if (!['gm', 'ceo'].includes(role)) {
        return res.status(403).json({ error: 'role required: gm or ceo', actual: role });
    }
    return next();
}

export function createConfigRouter(configParser, configService, runtimePaths = null, options = {}) {
    const router = express.Router();
    const controller = new ConfigController(
        configParser,
        configService,
        runtimePaths,
        options.projectCatalogParser || configParser
    );
    const authGuard = options.authGuard || requireConfigAuth;
    const writeGuard = options.writeGuard || requireConfigWriteRole;

    // GET /api/config - すべての設定を取得
    router.get('/', controller.getAll);

    // GET /api/config/slack/workspaces - Slackワークスペースを取得
    router.get('/slack/workspaces', controller.getWorkspaces);

    // GET /api/config/slack/channels - Slackチャンネルを取得
    router.get('/slack/channels', controller.getChannels);

    // GET /api/config/slack/members - Slackメンバーを取得
    router.get('/slack/members', controller.getMembers);

    // GET /api/config/projects - プロジェクトを取得
    router.get('/projects', authGuard, controller.getProjects);
    router.post('/projects', authGuard, writeGuard, controller.upsertProject);
    router.put('/projects/:projectId', authGuard, writeGuard, controller.upsertProject);
    router.delete('/projects/:projectId', authGuard, writeGuard, controller.deleteProject);

    // GET /api/config/github - GitHub設定を取得
    router.get('/github', controller.getGitHub);

    // GET /api/config/integrity - 整合性チェック
    router.get('/integrity', controller.checkIntegrity);

    // GET /api/config/unified - 統合ビューを取得
    router.get('/unified', controller.getUnified);

    // GET /api/config/env - 環境変数の存在チェック
    router.get('/env', (req, res) => {
        const keysParam = req.query.keys || '';
        const keys = keysParam.split(',').filter(Boolean);
        const result = {};
        for (const key of keys) {
            result[key] = !!process.env[key];
        }
        res.json({ keys: result });
    });

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
    router.post('/organizations', authGuard, writeGuard, controller.upsertOrganization);
    router.put('/organizations/:orgId', authGuard, writeGuard, controller.upsertOrganization);
    router.delete('/organizations/:orgId', authGuard, writeGuard, controller.deleteOrganization);

    // Notifications update
    router.put('/notifications', authGuard, writeGuard, controller.updateNotifications);

    // GitHub mappings CRUD
    router.post('/github', authGuard, writeGuard, controller.upsertGitHub);
    router.put('/github/:projectId', authGuard, writeGuard, controller.upsertGitHub);
    router.delete('/github/:projectId', authGuard, writeGuard, controller.deleteGitHub);

    // NocoDB mappings CRUD
    router.post('/nocodb', authGuard, writeGuard, controller.upsertNocoDB);
    router.put('/nocodb/:projectId', authGuard, writeGuard, controller.upsertNocoDB);
    router.delete('/nocodb/:projectId', authGuard, writeGuard, controller.deleteNocoDB);

    return router;
}
