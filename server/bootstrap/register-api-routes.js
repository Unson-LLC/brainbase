import path from 'path';
import { Pool } from 'pg';
import { createConfigRouter } from '../routes/config.js';
import { createScheduleRouter } from '../routes/schedule.js';
import { createBrainbaseRouter } from '../routes/brainbase.js';
import { createNocoDBRouter } from '../routes/nocodb.js';
import { createHealthRouter } from '../routes/health.js';
import { createRetiredCapabilityRouter } from '../routes/retired-capability.js';
import { createAuthRouter } from '../routes/auth.js';
import { createInfoSSOTRouter } from '../routes/info-ssot.js';
import { createLearningRouter } from '../routes/learning.js';
import { createPersonalKnowledgeRouter } from '../routes/personal-knowledge.js';
import { createCandidateStoreRouter } from '../routes/candidate-store.js';
import { createOnboardingRouter } from '../routes/onboarding.js';
import { createKnowledgeResolutionRouter } from '../routes/knowledge-resolution.js';
import { createKnowledgeEventRouter } from '../routes/knowledge-events.js';
import { createJudgmentResolutionRouter } from '../routes/judgment-resolution.js';
import { createCompanionRouter } from '../routes/companion.js';
import { createExternalRunnerRouter } from '../routes/external-runner.js';
import { createRunReceiptRouter } from '../routes/run-receipts.js';
import { createMeetingMinutesContextReceiptRouter } from '../routes/meeting-minutes-context-receipts.js';
import { createRoutineRouter } from '../routes/routines.js';
import { createMeetingSourceSettingsRouter } from '../routes/meeting-source-settings.js';
import { adminNoCacheMiddleware, createAdminVisualizationRouter } from '../routes/admin-visualization.js';
import { createSetupRouter } from '../routes/setup.js';
import { createWikiRouter } from '../routes/wiki.js';
import { createMiscRouter } from '../routes/misc.js';
import { createUsageRouter } from '../routes/usage.js';
import { createSnsGrowthRouter } from '../routes/sns-growth.js';
import { createTenantRuntimeRouter } from '../routes/tenant-runtime.js';
import { createSlackInstallationControlPlaneRouter } from '../routes/slack-installation-control-plane.js';
import { createSlackInstallationControlPlaneAuthMiddleware } from '../services/multitenant/slack-installation-auth.js';
import {
    createTenantEntrypointGuard,
    createUnavailableTenantEntrypointGuard
} from '../middleware/tenant-entrypoint.js';
import {
    createWorkflowHumanStepRouter,
    createWorkflowRouter,
    createWorkflowRunRouter
} from '../routes/workflows.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePersonalKnowledgeAccess } from '../middleware/personal-knowledge-access.js';
import {
    createPersonalKnowledgePromotionAuthorityGuard,
    createUnavailablePersonalKnowledgePromotionAuthorityGuard
} from '../middleware/personal-knowledge-promotion-authority.js';
import { AdminVisualizationService } from '../services/admin-visualization-service.js';
import { AccountService } from '../services/account/account-service.js';
import { PgAccountRepository } from '../services/account/account-repository.js';
import {
    JsonFileSnsPostingLedgerRepository,
    PgSnsPostingLedgerRepository,
    SnsPostingLedgerUnavailableRepository,
    isSnsPostingLedgerJsonTestMode
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
import { DecisionEventService } from '../services/companion/decision-event-service.js';
import { KnowledgeResolutionService } from '../services/knowledge-resolution-service.js';
import { JudgmentResolutionService } from '../services/judgment-resolution-service.js';
import {
    JsonFileMeetingMinutesContextReceiptRepository,
    MeetingMinutesContextReceiptService
} from '../services/meeting-minutes/context-receipt-service.js';

export function resolveSnsPostingLedgerDatabaseUrl(env = process.env) {
    if (env.SNS_POSTING_LEDGER_DATABASE_URL) return env.SNS_POSTING_LEDGER_DATABASE_URL;
    if (env.BRAINBASE_TEST_MODE === 'true') return '';
    return env.INFO_SSOT_DATABASE_URL || env.INFO_SSOT_DB_URL || '';
}

export function createSnsPostingLedgerRepository(runtimePaths, { env = process.env } = {}) {
    const databaseUrl = resolveSnsPostingLedgerDatabaseUrl(env);
    if (databaseUrl) {
        return new PgSnsPostingLedgerRepository({
            pool: new Pool({ connectionString: databaseUrl })
        });
    }
    if (isSnsPostingLedgerJsonTestMode(env)) {
        return new JsonFileSnsPostingLedgerRepository({
            filePath: path.join(runtimePaths.varDir, 'sns-posting-ledger.json')
        });
    }
    return new SnsPostingLedgerUnavailableRepository();
}

function createDecisionEventService(runtimePaths) {
    return new DecisionEventService({
        dataDir: path.join(runtimePaths.varDir, 'companion-decision-events')
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

export function registerOnboardingApiRoute(app, { authService, onboardingRuntimeService }) {
    app.use(
        '/api/onboarding',
        requireAuth(authService, { allowInsecureHeaders: false }),
        createOnboardingRouter({ service: onboardingRuntimeService })
    );
}

export function registerPersonalKnowledgePreAuth(app, { authService }) {
    const authGuard = requireAuth(authService, { allowInsecureHeaders: false });
    app.use('/api/learning', authGuard);
    app.use('/api/personal-knowledge', authGuard);
}

export function registerKnowledgeResolutionApiRoute(app, { authService, service = new KnowledgeResolutionService() }) {
    app.use(
        '/api/knowledge',
        requireAuth(authService, { allowInsecureHeaders: false }),
        createKnowledgeResolutionRouter({ service })
    );
}

export function registerKnowledgeEventApiRoutes(app, {
    authService,
    eventService,
    feedbackService,
    cycleQueryService
}) {
    app.use(
        '/api/knowledge',
        requireAuth(authService, { allowInsecureHeaders: false }),
        createKnowledgeEventRouter({ eventService, feedbackService, cycleQueryService })
    );
}

export function registerJudgmentResolutionApiRoute(app, {
    authService,
    service = new JudgmentResolutionService(),
    bindingSecret = process.env.BRAINBASE_JUDGMENT_BINDING_SECRET,
    now,
    maxAgeMs,
    maxFutureSkewMs
}) {
    app.use(
        '/api/judgment',
        requireAuth(authService, { allowInsecureHeaders: false }),
        createJudgmentResolutionRouter({ service, bindingSecret, now, maxAgeMs, maxFutureSkewMs })
    );
}

export function registerTenantRuntimeApiRoute(app, services) {
    if (!services?.serviceAuth) {
        throw new Error('Tenant runtime service authentication middleware is required');
    }
    if (!services?.tenantContextVerifier) {
        throw new Error('Tenant runtime context verifier is required');
    }
    app.use('/api/v1/runtime', createTenantRuntimeRouter(services));
}

export function registerSlackInstallationControlPlaneApiRoute(app, {
    controlPlane,
    authService,
    authMiddleware,
    appId,
    resolvePreProvisionedConnection,
    authEnv = process.env,
    authNow
}) {
    if (!controlPlane) throw new Error('Slack installation control-plane is required');
    const guard = authMiddleware ?? createSlackInstallationControlPlaneAuthMiddleware({
        authService,
        env: authEnv,
        now: authNow
    });
    app.use(
        '/api/v1',
        guard,
        createSlackInstallationControlPlaneRouter({ controlPlane, appId, resolvePreProvisionedConnection })
    );
}

export function registerApiRoutes(app, {
    configParser,
    configService,
    runtimePaths,
    scheduleParser,
    googleCalendarService,
    projectsRoot,
    authService,
    infoSSOTService,
    canonicalTaskStoreConfig,
    canonicalTaskService,
    learningService,
    learningHealthService,
    candidateRepository,
    knowledgeEventService,
    knowledgeFeedbackService,
    knowledgeCycleQueryService,
    personalKnowledgeService,
    personalKnowledgePromotionService,
    onboardingRuntimeService,
    wikiService,
    tokenUsageService,
    agentControlCatalogService,
    loopIntentService,
    meetingAutomationService,
    automationRunService,
    runReceiptQueryService,
    companionApprovalInboxService,
    meetingSourceMcpSyncService,
    externalRunnerIngestService,
    runReceiptIngestService,
    routineLivenessService,
    routineCycleExecutor,
    uploadMiddleware,
    appVersion,
    workspaceRoot,
    uploadsDir,
    runtimeInfo,
    brainbaseRoot,
    tenantRuntimeServices,
    slackInstallationControlPlane,
    slackInstallationControlPlaneAuthMiddleware,
    slackInstallationControlPlaneAppId,
    resolvePreProvisionedSlackConnection,
    snsPostExecutor = null
}) {
    const adminTenantGuard = tenantRuntimeServices
        ? createTenantEntrypointGuard(tenantRuntimeServices, 'admin_api')
        : createUnavailableTenantEntrypointGuard();
    const auditTenantGuard = tenantRuntimeServices
        ? createTenantEntrypointGuard(tenantRuntimeServices, 'audit_log')
        : createUnavailableTenantEntrypointGuard();
    if (slackInstallationControlPlane) {
        registerSlackInstallationControlPlaneApiRoute(app, {
            controlPlane: slackInstallationControlPlane,
            authService,
            authMiddleware: slackInstallationControlPlaneAuthMiddleware,
            appId: slackInstallationControlPlaneAppId,
            resolvePreProvisionedConnection: resolvePreProvisionedSlackConnection
        });
    }
    app.use('/api/state', createRetiredCapabilityRouter({
        capability: 'brainbase.session-state',
        owner: 'Codex app and CLI',
        replacement: 'Use Codex task state directly; historical Brainbase records are frozen'
    }));
    app.use('/api/config', createConfigRouter(configParser, configService, runtimePaths, {
        authGuard: requireAuth(authService)
    }));
    app.use('/api/schedule', createScheduleRouter(scheduleParser, googleCalendarService));
    app.use('/api/sessions', createRetiredCapabilityRouter({
        capability: 'brainbase.session-runtime',
        owner: 'Codex app and CLI',
        replacement: 'Use Codex tasks, worktrees, and terminals directly'
    }));
    app.use('/api/brainbase', createBrainbaseRouter({
        configParser,
        projectsRoot,
        infoSSOTService,
        wikiService,
        canonicalTaskService,
        authGuard: requireAuth(authService),
        projectCatalogAuthGuard: requireAuth(authService)
    }));
    app.use('/api/nocodb', createNocoDBRouter(configParser, { canonicalTaskStoreConfig }));
    app.use('/api/health', createHealthRouter({ configParser }));
    app.use('/api/terminal', createRetiredCapabilityRouter({
        capability: 'brainbase.terminal-runtime',
        owner: 'Codex app and CLI',
        replacement: 'Use the terminal attached to the Codex task'
    }));
    app.use('/api/auth', createAuthRouter(authService));
    app.use(
        '/api/info',
        requireAuth(authService, { allowInsecureHeaders: false }),
        createInfoSSOTRouter(infoSSOTService, { auditTenantGuard, configParser })
    );
    const personalKnowledgeAuthGuard = requireAuth(authService, { allowInsecureHeaders: false });
    const auditPersonalAccess = personalKnowledgeService
        ? (entry) => personalKnowledgeService.auditAccess(entry)
        : null;
    const personalKnowledgeAccessGuard = requirePersonalKnowledgeAccess({ audit: auditPersonalAccess });
    const unavailablePromotionAuthority = createUnavailablePersonalKnowledgePromotionAuthorityGuard();
    const promotionAuthorityGuards = tenantRuntimeServices ? {
        request: createPersonalKnowledgePromotionAuthorityGuard(
            tenantRuntimeServices,
            'personal_knowledge_promotion:request'
        ),
        owner: createPersonalKnowledgePromotionAuthorityGuard(
            tenantRuntimeServices,
            'personal_knowledge_promotion:owner_consent'
        ),
        organization: createPersonalKnowledgePromotionAuthorityGuard(
            tenantRuntimeServices,
            'personal_knowledge_promotion:organization_review'
        )
    } : {
        request: unavailablePromotionAuthority,
        owner: unavailablePromotionAuthority,
        organization: unavailablePromotionAuthority
    };
    app.use(
        '/api/learning',
        personalKnowledgeAuthGuard,
        personalKnowledgeAccessGuard,
        createLearningRouter(learningService, learningHealthService)
    );
    if (personalKnowledgeService && personalKnowledgePromotionService) {
        app.use(
            '/api/personal-knowledge',
            personalKnowledgeAuthGuard,
            personalKnowledgeAccessGuard,
            createPersonalKnowledgeRouter({
                personalKnowledgeService,
                promotionService: personalKnowledgePromotionService,
                promotionAuthorityGuards
            })
        );
    }
    app.use('/api/companion', createCompanionRouter({
        replyDraftService: new ReplyDraftService({
            infoSSOTService,
            learningService
        }),
        companionApprovalInboxService,
        infoSSOTService,
        decisionEventService: createDecisionEventService(runtimePaths),
        canonicalTaskService,
        authGuard: requireAuth(authService),
        accessGuardOptions: {
            ownerPersonId: canonicalTaskStoreConfig?.ownerPersonId,
            ownerAliasIds: canonicalTaskStoreConfig?.ownerAliasIds
        }
    }));
    app.use('/api/admin', adminNoCacheMiddleware, requireAuth(authService), adminTenantGuard, createAdminVisualizationRouter(new AdminVisualizationService({
        infoSSOTService,
        candidateRepository
    })));
    registerOnboardingApiRoute(app, { authService, onboardingRuntimeService });
    registerKnowledgeResolutionApiRoute(app, { authService });
    if (knowledgeEventService && knowledgeFeedbackService && knowledgeCycleQueryService) {
        registerKnowledgeEventApiRoutes(app, {
            authService,
            eventService: knowledgeEventService,
            feedbackService: knowledgeFeedbackService,
            cycleQueryService: knowledgeCycleQueryService
        });
    }
    registerJudgmentResolutionApiRoute(app, { authService });
    if (candidateRepository) {
        // cross-repo source (mana / salestailor / zeims / SNS) からの
        // Raw Ledger envelope 受信。 STR-006 / ADR-010 で確定した
        // canonical Memory Promotion Kernel の外部受け口。
        app.use('/api/candidate-store', createCandidateStoreRouter({
            candidateRepository,
            auditPersonalAccess,
            allowedSources: process.env.CANDIDATE_STORE_ALLOWED_SOURCES
                ? process.env.CANDIDATE_STORE_ALLOWED_SOURCES.split(',').map((s) => s.trim()).filter(Boolean)
                : null
        }));
    }
    const snsPostingLedgerRepository = createSnsPostingLedgerRepository(runtimePaths);
    app.use(
        '/api/sns-growth',
        requireAuth(authService, { allowInsecureHeaders: false }),
        adminTenantGuard,
        createSnsGrowthRouter({
            repository: snsPostingLedgerRepository,
            publishService: new SnsLedgerPublishService({
                ledgerRepository: snsPostingLedgerRepository,
                postExecutor: snsPostExecutor || createSnsPostScriptExecutor()
            }),
            accountService: createSnsAccountService(),
            accountProvider: createSnsAccountProvider()
        })
    );
    app.use('/api/wiki', createWikiRouter(wikiService));
    app.use('/api/usage', createUsageRouter(tokenUsageService));
    const workflowAuthGuard = requireAuth(authService);
    app.use('/api/workflows', workflowAuthGuard, createWorkflowRouter({
        agentControlCatalogService,
        loopIntentService,
        meetingAutomationService
    }));
    app.use('/api/workflow-runs', workflowAuthGuard, createWorkflowRunRouter(automationRunService));
    app.use('/api/workflow-human-steps', workflowAuthGuard, createWorkflowHumanStepRouter(automationRunService));
    app.use('/api/external-runner', workflowAuthGuard, createExternalRunnerRouter(externalRunnerIngestService));
    app.use('/api/run-receipts', workflowAuthGuard, createRunReceiptRouter({
        ingestService: runReceiptIngestService,
        queryService: runReceiptQueryService,
        routineLivenessService
    }));
    app.use(
        '/api/meeting-minutes/context-receipts',
        workflowAuthGuard,
        createMeetingMinutesContextReceiptRouter({
            service: new MeetingMinutesContextReceiptService({
                infoSSOTService,
                canonicalTaskService,
                repository: new JsonFileMeetingMinutesContextReceiptRepository({
                    filePath: path.join(runtimePaths.varDir, 'meeting-minutes-context-receipts.json')
                })
            })
        })
    );
    if (routineCycleExecutor) {
        app.use(
            '/api/routines',
            workflowAuthGuard,
            personalKnowledgeAccessGuard,
            createRoutineRouter({ routineCycleExecutor })
        );
    }
    if (meetingSourceMcpSyncService) {
        app.use('/api/settings/meeting-sources', workflowAuthGuard, createMeetingSourceSettingsRouter(meetingSourceMcpSyncService));
    }
    app.use('/api/setup', createSetupRouter(authService, infoSSOTService, configParser));
    app.use('/api', createMiscRouter(appVersion, uploadMiddleware, workspaceRoot, uploadsDir, runtimeInfo, {
        brainbaseRoot,
        projectsRoot
    }));
}
