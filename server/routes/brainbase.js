import express from 'express';
import path from 'path';
import { GitHubService } from '../services/github-service.js';
import { SystemService } from '../services/system-service.js';
import { StorageService } from '../services/storage-service.js';
import { NocoDBService } from '../services/nocodb-service.js';
import { BrainbaseActionController, ACTION_TYPES, ACTION_STATUS } from '../controllers/brainbase-action-controller.js';
import { createBrainbaseManaRouter } from './brainbase/mana-routes.js';
import { createBrainbaseOverviewRouter } from './brainbase/overview-routes.js';
import { createBrainbaseTrendsRouter } from './brainbase/trends-routes.js';
import { createManaCaptureRouter } from './brainbase/mana-capture-routes.js';
import { createBrainbasePortalRouter } from './brainbase/portal-routes.js';
import { createHonchoService } from '../services/honcho-service.js';

// Re-export for backward compatibility
export { ACTION_TYPES, ACTION_STATUS };

/**
 * brainbaseダッシュボードAPIルーター
 * システム全体の監視情報を提供
 */
export function createBrainbaseRouter(options = {}) {
    const router = express.Router();
    const {
        githubService = new GitHubService(),
        systemService = new SystemService(),
        storageService = new StorageService(),
        nocodbService = new NocoDBService(),
        configParser,
        projectCatalogParser = configParser,
        projectsRoot,
        infoSSOTService,
        wikiService,
        canonicalTaskService,
        authGuard,
        projectCatalogAuthGuard
    } = options;
    const resolvedProjectsRoot = projectsRoot || process.env.PROJECTS_ROOT || null;
    const manaRepoPath = process.env.MANA_REPO_PATH
        || (resolvedProjectsRoot ? path.join(resolvedProjectsRoot, 'mana') : null);

    router.use(createBrainbaseManaRouter({
        manaRepoPath
    }));

    router.use(createBrainbaseOverviewRouter({
        githubService,
        systemService,
        storageService,
        nocodbService,
        configParser,
        projectCatalogParser,
        projectCatalogAuthGuard
    }));

    router.use(createBrainbaseTrendsRouter({
        nocodbService,
        configParser
    }));

    // ==================== Portal API ====================
    router.use(createBrainbasePortalRouter({
        nocodbService,
        configParser,
        infoSSOTService,
        wikiService
    }));

    // ==================== mana Capture + Chat API (P0) ====================
    const honchoService = createHonchoService();
    router.use('/mana', createManaCaptureRouter({
        honchoService,
        canonicalTaskService,
        sessionGuard: authGuard
    }));

    // ==================== Actions API (Story 3) ====================
    const actionController = new BrainbaseActionController(nocodbService);
    router.post('/actions', actionController.create);
    router.get('/actions', actionController.list);
    router.patch('/actions/:actionId/status', actionController.updateStatus);
    router.get('/action-types', actionController.getTypes);

    return router;
}
