import express from 'express';
import path from 'path';
import { GitHubService } from '../services/github-service.js';
import { SystemService } from '../services/system-service.js';
import { StorageService } from '../services/storage-service.js';
import { ACTION_TYPES, ACTION_STATUS } from '../controllers/brainbase-action-controller.js';
import { createBrainbaseManaRouter } from './brainbase/mana-routes.js';
import { createBrainbaseOverviewRouter } from './brainbase/overview-routes.js';
import { createBrainbaseTrendsRouter } from './brainbase/trends-routes.js';
import { createManaCaptureRouter } from './brainbase/mana-capture-routes.js';
import { createBrainbasePortalRouter } from './brainbase/portal-routes.js';
import { createRetiredCapabilityRouter } from './retired-capability.js';
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
        configParser,
        projectCatalogParser = configParser,
        projectsRoot,
        infoSSOTService,
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
        configParser,
        projectCatalogParser,
        projectCatalogAuthGuard
    }));

    router.use(createBrainbaseTrendsRouter({
        configParser,
        projectCatalogParser,
        projectCatalogAuthGuard
    }));

    // ==================== Portal API ====================
    router.use(createBrainbasePortalRouter({
        configParser,
        projectCatalogParser,
        projectCatalogAuthGuard,
        infoSSOTService
    }));

    // ==================== mana Capture + Chat API (P0) ====================
    const honchoService = createHonchoService();
    router.use('/mana', createManaCaptureRouter({
        honchoService,
        canonicalTaskService,
        sessionGuard: authGuard
    }));

    // ==================== Legacy NocoDB Actions API ====================
    // Action records were stored in NocoDB and this alias could still perform
    // writes after the canonical task cutover. Retire the whole boundary so
    // every method and sub-path is side-effect free.
    const retiredNocoActions = createRetiredCapabilityRouter({
        capability: 'brainbase.nocodb-actions',
        owner: 'Brainbase canonical APIs',
        replacement: 'Use Graph/Canonical Task workflows; legacy action records are migration-only'
    });
    router.use('/actions', retiredNocoActions);
    router.use('/action-types', retiredNocoActions);

    return router;
}
