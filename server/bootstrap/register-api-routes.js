import path from 'path';
import { createConfigRouter, requireProjectProfileWriteRole } from '../routes/config.js';
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
import { createOutcomeCaseRouter } from '../routes/outcome-cases.js';
import { createVibeproHandoffRouter } from '../routes/vibepro-handoffs.js';
import { createMeetingMinutesContextReceiptRouter } from '../routes/meeting-minutes-context-receipts.js';
import { createRoutineRouter } from '../routes/routines.js';
import { createMeetingSourceSettingsRouter } from '../routes/meeting-source-settings.js';
import { adminNoCacheMiddleware, createAdminVisualizationRouter } from '../routes/admin-visualization.js';
import { createSetupRouter } from '../routes/setup.js';
import { createWikiRouter } from '../routes/wiki.js';
import { createMiscRouter } from '../routes/misc.js';
import { createUsageRouter } from '../routes/usage.js';
import { createTenantRuntimeRouter } from '../routes/tenant-runtime.js';
import { createSlackInstallationControlPlaneRouter } from '../routes/slack-installation-control-plane.js';
import { createProjectProvisioningRouter } from '../routes/project-provisioning.js';
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
import { requireRoutineCompanyAuthority } from '../middleware/routine-company-authority.js';
import {
    createPersonalKnowledgePromotionAuthorityGuard,
    createUnavailablePersonalKnowledgePromotionAuthorityGuard
} from '../middleware/personal-knowledge-promotion-authority.js';
import { AdminVisualizationService } from '../services/admin-visualization-service.js';
import { ReplyDraftService } from '../services/companion/reply-draft-service.js';
import { DecisionEventService } from '../services/companion/decision-event-service.js';
import { KnowledgeResolutionService } from '../services/knowledge-resolution-service.js';
import { JudgmentResolutionService } from '../services/judgment-resolution-service.js';
import {
    JsonFileMeetingMinutesContextReceiptRepository,
    MeetingMinutesContextReceiptService
} from '../services/meeting-minutes/context-receipt-service.js';

function createDecisionEventService(runtimePaths) {
    return new DecisionEventService({
        dataDir: path.join(runtimePaths.varDir, 'companion-decision-events')
    });
}

async function resolveLocalRoutineProviderSubjectIds({ configParser, ownerPersonId, projectId }) {
    if (!configParser?.getMembers || !ownerPersonId || !projectId) return [];
    const members = await configParser.getMembers();
    return [...new Set((Array.isArray(members) ? members : [])
        .filter((member) => member?.person_id === ownerPersonId)
        .filter((member) => String(member?.status || 'active').toLowerCase() !== 'inactive')
        .filter((member) => Array.isArray(member?.projects)
            && member.projects.some((project) => project?.name === projectId || project?.id === projectId))
        .map((member) => String(member?.slack_id || '').trim())
        .filter(Boolean))];
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
    maxFutureSkewMs,
    receiptWriter
}) {
    app.use(
        '/api/judgment',
        requireAuth(authService, { allowInsecureHeaders: false }),
        createJudgmentResolutionRouter({ service, bindingSecret, now, maxAgeMs, maxFutureSkewMs, receiptWriter })
    );
}

export function registerVibeproHandoffApiRoute(app, { authService, runtime }) {
    app.use(
        '/api/vibepro-handoffs',
        requireAuth(authService, { allowInsecureHeaders: false }),
        createVibeproHandoffRouter({ runtime })
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
    oauthFlow,
    resolvePreProvisionedConnection,
    authEnv = process.env,
    authNow
}) {
    if (!controlPlane) throw new Error('Slack installation control-plane is required');
    const guard = authMiddleware ?? createSlackInstallationControlPlaneAuthMiddleware({
        authService,
        env: authEnv,
        now: authNow,
        trustedAppId: appId
    });
    app.use(
        '/api/v1',
        guard,
        createSlackInstallationControlPlaneRouter({ controlPlane, appId, oauthFlow, resolvePreProvisionedConnection })
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
    projectProvisioningService,
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
    outcomeCaseService,
    outcomeCaseAuditSink,
    judgmentReceiptWriter,
    vibeproHandoffRuntime,
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
    slackInstallationOAuthFlow,
    resolvePreProvisionedSlackConnection,
    env = process.env
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
            oauthFlow: slackInstallationOAuthFlow,
            resolvePreProvisionedConnection: resolvePreProvisionedSlackConnection
        });
    }
    app.use('/api/state', createRetiredCapabilityRouter({
        capability: 'brainbase.session-state',
        owner: 'Codex app and CLI',
        replacement: 'Use Codex task state directly; historical Brainbase records are frozen'
    }));
    const runtimeProjectCatalog = projectProvisioningService?.runtimeCatalog || configParser;
    app.use('/api/config', createConfigRouter(configParser, configService, runtimePaths, {
        authGuard: requireAuth(authService),
        projectCatalogParser: runtimeProjectCatalog,
        profileAuthGuard: requireAuth(authService, { structuredErrors: true }),
        profileWriteGuard: requireProjectProfileWriteRole
    }));
    app.use('/api/schedule', createScheduleRouter(scheduleParser, googleCalendarService));
    app.use('/api/sessions', createRetiredCapabilityRouter({
        capability: 'brainbase.session-runtime',
        owner: 'Codex app and CLI',
        replacement: 'Use Codex tasks, worktrees, and terminals directly'
    }));
    app.use('/api/brainbase', createBrainbaseRouter({
        configParser,
        projectCatalogParser: runtimeProjectCatalog,
        projectsRoot,
        infoSSOTService,
        wikiService,
        canonicalTaskService,
        authGuard: requireAuth(authService),
        projectCatalogAuthGuard: requireAuth(authService)
    }));
    app.use('/api/nocodb', createNocoDBRouter(configParser, { canonicalTaskStoreConfig }));
    app.use('/api/health', createHealthRouter({ configParser: runtimeProjectCatalog }));
    app.use('/api/terminal', createRetiredCapabilityRouter({
        capability: 'brainbase.terminal-runtime',
        owner: 'Codex app and CLI',
        replacement: 'Use the terminal attached to the Codex task'
    }));
    app.use('/api/auth', createAuthRouter(authService));
    app.use(
        '/api/project-provisioning',
        requireAuth(authService, { allowInsecureHeaders: false }),
        createProjectProvisioningRouter({ service: projectProvisioningService })
    );
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
    const routineCompanyAuthorityGuard = requireRoutineCompanyAuthority({
        env,
        ownerPersonId: canonicalTaskStoreConfig?.ownerPersonId,
        projectId: canonicalTaskStoreConfig?.project || 'brainbase',
        resolveCanonicalRoutineAuthority: authService?.resolveCanonicalRoutineAuthority
            ? async (input) => authService.resolveCanonicalRoutineAuthority({
                ...input,
                providerSubjectIds: await resolveLocalRoutineProviderSubjectIds({
                    configParser,
                    ownerPersonId: input.ownerPersonId,
                    projectId: input.projectId
                })
            })
            : null
    });
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
    registerJudgmentResolutionApiRoute(app, { authService, receiptWriter: judgmentReceiptWriter });
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
    app.use('/api/sns-growth', createRetiredCapabilityRouter({
        capability: 'brainbase.sns-growth',
        owner: 'Brainbase',
        replacement: 'SNS運用は廃止済みです。既存台帳は保全しています。'
    }));
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
    app.use('/api/outcome-cases', workflowAuthGuard, createOutcomeCaseRouter({
        service: outcomeCaseService,
        auditSink: outcomeCaseAuditSink
    }));
    registerVibeproHandoffApiRoute(app, { authService, runtime: vibeproHandoffRuntime });
    app.use(
        '/api/meeting-minutes/context-receipts',
        workflowAuthGuard,
        createMeetingMinutesContextReceiptRouter({
            service: tenantRuntimeServices?.meetingMinutesContextReceiptService
                ?? new MeetingMinutesContextReceiptService({
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
            routineCompanyAuthorityGuard,
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
