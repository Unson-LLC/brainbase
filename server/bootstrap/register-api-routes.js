import path from 'path';
import { Pool } from 'pg';
import { createTaskRouter } from '../routes/tasks.js';
import { createStateRouter } from '../routes/state.js';
import { createConfigRouter } from '../routes/config.js';
import { createScheduleRouter } from '../routes/schedule.js';
import { createSessionRouter } from '../routes/sessions.js';
import { createBrainbaseRouter } from '../routes/brainbase.js';
import { createNocoDBRouter } from '../routes/nocodb.js';
import { createHealthRouter } from '../routes/health.js';
import { createTerminalRouter } from '../routes/terminal.js';
import { createAuthRouter } from '../routes/auth.js';
import { createInfoSSOTRouter } from '../routes/info-ssot.js';
import { createLearningRouter } from '../routes/learning.js';
import { createCandidateStoreRouter } from '../routes/candidate-store.js';
import { createCompanionRouter } from '../routes/companion.js';
import { createExternalRunnerRouter } from '../routes/external-runner.js';
import { adminNoCacheMiddleware, createAdminVisualizationRouter } from '../routes/admin-visualization.js';
import { createSetupRouter } from '../routes/setup.js';
import { createWikiRouter } from '../routes/wiki.js';
import { createMiscRouter } from '../routes/misc.js';
import { createUsageRouter } from '../routes/usage.js';
import { createSnsGrowthRouter } from '../routes/sns-growth.js';
import {
    createWorkflowHumanStepRouter,
    createWorkflowRouter,
    createWorkflowRunRouter
} from '../routes/workflows.js';
import { requireAuth } from '../middleware/auth.js';
import { AdminVisualizationService } from '../services/admin-visualization-service.js';
import { AccountService } from '../services/account/account-service.js';
import { PgAccountRepository } from '../services/account/account-repository.js';
import {
    JsonFileSnsPostingLedgerRepository,
    PgSnsPostingLedgerRepository
} from '../services/sns/posting-ledger-repository.js';
import {
    createSnsPostScriptExecutor,
    SnsLedgerPublishService
} from '../services/sns/sns-ledger-publish-service.js';
import {
    createPostingBridgeHealthCheck,
    createSnsAccountHealthProvider
} from '../services/sns/sns-posting-auth-health.js';
import { XApiClient } from '../services/sns/providers/x-client.js';
import { buildXProvider } from '../services/sns/providers/x-provider.js';
import { ReplyDraftService } from '../services/companion/reply-draft-service.js';

export function resolveSnsPostingLedgerDatabaseUrl(env = process.env) {
    if (env.SNS_POSTING_LEDGER_DATABASE_URL) return env.SNS_POSTING_LEDGER_DATABASE_URL;
    if (env.BRAINBASE_TEST_MODE === 'true') return '';
    return env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL || '';
}

function createSnsPostingLedgerRepository(runtimePaths) {
    const databaseUrl = resolveSnsPostingLedgerDatabaseUrl();
    if (databaseUrl) {
        return new PgSnsPostingLedgerRepository({
            pool: new Pool({ connectionString: databaseUrl })
        });
    }
    return new JsonFileSnsPostingLedgerRepository({
        filePath: path.join(runtimePaths.varDir, 'sns-posting-ledger.json')
    });
}

function createSnsAccountService() {
    const databaseUrl = resolveSnsPostingLedgerDatabaseUrl();
    if (databaseUrl) {
        return new AccountService({
            repository: new PgAccountRepository({
                pool: new Pool({ connectionString: databaseUrl })
            })
        });
    }
    return new AccountService();
}

function createSnsAccountProvider() {
    const xProvider = buildXProvider({
        xClient: new XApiClient(),
        oauthSecret: process.env.INTEGRATION_OAUTH_STATE_SECRET
            || process.env.AUTH_SESSION_SECRET
            || 'local-dev-oauth-state-secret'
    });
    return createSnsAccountHealthProvider({
        xProvider,
        postingBridgeHealthCheck: createPostingBridgeHealthCheck()
    });
}

export function registerApiRoutes(app, {
    taskParser,
    stateStore,
    sessionServices,
    testMode,
    configParser,
    configService,
    runtimePaths,
    scheduleParser,
    googleCalendarService,
    worktreeService,
    conversationLinker,
    projectsRoot,
    tmuxCaptureCache,
    authService,
    infoSSOTService,
    learningService,
    learningHealthService,
    candidateRepository,
    wikiService,
    tokenUsageService,
    workflowService,
    externalRunnerIngestService,
    uploadMiddleware,
    appVersion,
    workspaceRoot,
    uploadsDir,
    runtimeInfo,
    brainbaseRoot
}) {
    app.use('/api/tasks', createTaskRouter(taskParser));
    app.use('/api/state', createStateRouter(
        stateStore,
        sessionServices.runtime.registry,
        sessionServices.runtime.query,
        testMode
    ));
    app.use('/api/config', createConfigRouter(configParser, configService, runtimePaths, {
        authGuard: requireAuth(authService)
    }));
    app.use('/api/schedule', createScheduleRouter(scheduleParser, googleCalendarService));
    app.use('/api/sessions', createSessionRouter(
        sessionServices,
        worktreeService,
        stateStore,
        testMode,
        conversationLinker,
        {
            projectsRoot,
            codeProjectsRoot: path.join(path.dirname(projectsRoot), 'code'),
            captureCache: tmuxCaptureCache
        }
    ));
    app.use('/api/brainbase', createBrainbaseRouter({
        taskParser,
        worktreeService,
        configParser,
        projectsRoot,
        infoSSOTService,
        wikiService
    }));
    app.use('/api/nocodb', createNocoDBRouter(configParser));
    app.use('/api/health', createHealthRouter({
        readiness: sessionServices.runtime.registry,
        configParser,
        terminalRuntimeReconciler: sessionServices.runtime.reconciler
    }));
    app.use('/api/terminal', createTerminalRouter({
        terminalRuntimeReconciler: sessionServices.runtime.reconciler
    }));
    app.use('/api/auth', createAuthRouter(authService));
    app.use('/api/info', createInfoSSOTRouter(infoSSOTService));
    app.use('/api/learning', createLearningRouter(learningService, learningHealthService));
    app.use('/api/companion', createCompanionRouter({
        replyDraftService: new ReplyDraftService({
            infoSSOTService,
            learningService
        }),
        authGuard: requireAuth(authService)
    }));
    app.use('/api/admin', adminNoCacheMiddleware, requireAuth(authService), createAdminVisualizationRouter(new AdminVisualizationService({
        infoSSOTService,
        candidateRepository
    })));
    if (candidateRepository) {
        // cross-repo source (mana / salestailor / zeims / SNS) からの
        // Raw Ledger envelope 受信。 STR-006 / ADR-010 で確定した
        // canonical Memory Promotion Kernel の外部受け口。
        app.use('/api/candidate-store', createCandidateStoreRouter({
            candidateRepository,
            allowedSources: process.env.CANDIDATE_STORE_ALLOWED_SOURCES
                ? process.env.CANDIDATE_STORE_ALLOWED_SOURCES.split(',').map((s) => s.trim()).filter(Boolean)
                : null
        }));
    }
    const snsPostingLedgerRepository = createSnsPostingLedgerRepository(runtimePaths);
    app.use('/api/sns-growth', createSnsGrowthRouter({
        repository: snsPostingLedgerRepository,
        publishService: new SnsLedgerPublishService({
            ledgerRepository: snsPostingLedgerRepository,
            postExecutor: createSnsPostScriptExecutor()
        }),
        accountService: createSnsAccountService(),
        accountProvider: createSnsAccountProvider()
    }));
    app.use('/api/wiki', createWikiRouter(wikiService));
    app.use('/api/usage', createUsageRouter(tokenUsageService));
    const workflowAuthGuard = requireAuth(authService);
    app.use('/api/workflows', workflowAuthGuard, createWorkflowRouter(workflowService));
    app.use('/api/workflow-runs', workflowAuthGuard, createWorkflowRunRouter(workflowService));
    app.use('/api/workflow-human-steps', workflowAuthGuard, createWorkflowHumanStepRouter(workflowService));
    app.use('/api/external-runner', workflowAuthGuard, createExternalRunnerRouter(externalRunnerIngestService));
    app.use('/api/setup', createSetupRouter(authService, infoSSOTService, configParser));
    app.use('/api', createMiscRouter(appVersion, uploadMiddleware, workspaceRoot, uploadsDir, runtimeInfo, {
        brainbaseRoot,
        projectsRoot,
        sessionQuery: sessionServices.runtime.query,
        workspace: sessionServices.workspace
    }));
}
