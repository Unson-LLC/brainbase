import path from 'path';
import crypto from 'crypto';
import multer from 'multer';

import { ScheduleParser } from '../../lib/schedule-parser.js';
import { ConfigParser } from '../../lib/config-parser.js';
import { InfoSSOTService } from '../services/info-ssot-service.js';
import {
    canonicalTaskBackendIdentityHash,
    createCanonicalTaskStoreConfig,
    resolveCanonicalTaskBackend
} from '../services/companion/canonical-task-store-config.js';
import { CanonicalTaskNocoDBRepository } from '../services/companion/canonical-task-nocodb-repository.js';
import { CanonicalTaskPostgresRepository } from '../services/companion/canonical-task-postgres-repository.js';
import { CanonicalTaskOperationRepository } from '../services/companion/canonical-task-operation-repository.js';
import { CanonicalTaskReadiness } from '../services/companion/canonical-task-readiness.js';
import { createCanonicalTaskSourceHeadGuard } from '../services/companion/canonical-task-source-head-guard.js';
import { CanonicalTaskService } from '../services/companion/canonical-task-service.js';
import { AuthService } from '../services/auth-service.js';
import { ConfigService } from '../services/config-service.js';
import { GoogleCalendarService } from '../services/google-calendar-service.js';
import { LearningService } from '../services/learning-service.js';
import { LearningHealthService } from '../services/learning-health-service.js';
import { PgCandidateRepository } from '../services/candidate-store/candidate-repository.js';
import { PgKnowledgeEventRepository } from '../services/knowledge-event/pg-knowledge-event-repository.js';
import { InfoSSOTKnowledgeGraphRepository } from '../services/knowledge-event/info-ssot-knowledge-graph-repository.js';
import { KnowledgeEventService } from '../services/knowledge-event-service.js';
import { KnowledgeFeedbackService } from '../services/knowledge-feedback-service.js';
import { KnowledgeCycleQueryService } from '../services/knowledge-cycle-query-service.js';
import { MeetingKnowledgeEventBridge } from '../services/meeting-automation/meeting-knowledge-event-bridge.js';
import {
    JsonFileOnboardingRunRepository,
    OnboardingRuntimeService
} from '../services/onboarding/onboarding-runtime-service.js';
import { WikiService } from '../services/wiki-service.js';
import { TokenUsageService } from '../services/token-usage-service.js';
import { ExternalRunnerIngestService } from '../services/external-runner/ingest-service.js';
import { RunReceiptIngestService } from '../services/run-receipt/ingest-service.js';
import { resolveRoutineReceiptPaths } from '../../scripts/routines/runtime-paths.mjs';
import { countRoutineOutbox, listRoutineDeadLetters } from '../services/routine-runtime/dead-letter-reader.js';
import { loadRoutineExpectations } from '../services/routine-runtime/expectation-parser.js';
import { RoutineLivenessService } from '../services/routine-runtime/liveness-service.js';
import { RoutineCycleExecutor } from '../services/routine-runtime/cycle-executor.js';
import { ProductionRoutinePorts } from '../services/routine-runtime/production-routine-ports.js';
import {
    deliverJudgmentKnowledgeEventOutbox,
    listKnowledgeEventDeadLetters,
    listJudgmentKnowledgeEventOutboxExceptions,
    resolveJudgmentKnowledgeEventDeliveryAuth,
    resolveJudgmentKnowledgeEventOutboxPath
} from '../services/routine-runtime/judgment-event-outbox.js';
import { createMeetingSourceMcpAdaptersFromEnv } from '../services/meeting-source/meeting-source-mcp-adapters.js';
import { MeetingSourceMcpSyncService } from '../services/meeting-source/meeting-source-mcp-sync-service.js';
import { MeetingTaskOwnerResolver } from '../services/meeting-automation/meeting-task-owner-resolver.js';
import { ProjectAccessPolicy } from '../services/project-access/project-access-policy.js';
import { JsonFileWorkflowRepository } from '../services/workflow/workflow-repository.js';
import { WorkflowRunner } from '../services/workflow/workflow-runner.js';
import {
    createBrainbaseAliveWorkflow,
    createDefaultWorkflowHandlers
} from '../services/automation-runtime/automation-runtime-defaults-service.js';
import { createAutomationRuntimeServices } from '../services/automation-runtime/automation-runtime-services.js';

export function createCanonicalTaskRepository({
    backend = resolveCanonicalTaskBackend(),
    pool,
    storeConfig
} = {}) {
    const resolvedBackend = resolveCanonicalTaskBackend(backend);
    return resolvedBackend === 'postgres'
        ? new CanonicalTaskPostgresRepository({ pool, storeConfig })
        : new CanonicalTaskNocoDBRepository({ storeConfig });
}

export function createCoreServices({
    varDir,
    brainbaseRoot,
    projectsRoot,
    codexPath,
    configPath,
    uploadsDir,
    serverDir,
    port,
    sourceHead = null
}) {
    const googleCalendarService = new GoogleCalendarService();
    const scheduleParser = new ScheduleParser({ googleCalendarService });

    process.env.BRAINBASE_VAR_DIR = varDir;
    const catalogMode = process.env.BRAINBASE_PROJECT_CATALOG_MODE === 'disabled'
        ? 'disabled'
        : 'required';
    const configParser = new ConfigParser(
        codexPath,
        configPath,
        brainbaseRoot,
        projectsRoot,
        { catalogMode }
    );
    const configService = new ConfigService(configPath, projectsRoot, configParser);
    const infoSSOTService = new InfoSSOTService();
    const canonicalTaskStoreConfig = createCanonicalTaskStoreConfig();
    const canonicalTaskBackend = resolveCanonicalTaskBackend();
    const canonicalTaskOperationRepository = new CanonicalTaskOperationRepository({
        pool: infoSSOTService.pool,
        writerToken: process.env.BRAINBASE_SERVER_GENERATION || null,
        processIdentity: {
            instance_id: crypto.randomUUID(),
            pid: process.pid,
            port,
            source_head: sourceHead,
            entrypoint: process.env.BRAINBASE_STARTED_BY_START_JS === '1' ? 'start.js' : 'server.js'
        }
    });
    const canonicalTaskReadiness = new CanonicalTaskReadiness({
        operationRepository: canonicalTaskOperationRepository,
        manifestHash: canonicalTaskBackendIdentityHash(canonicalTaskStoreConfig, canonicalTaskBackend),
        schemaVersion: canonicalTaskStoreConfig.schemaVersion,
        sourceHead,
        sourceHeadRebindGuard: createCanonicalTaskSourceHeadGuard({ repoDir: serverDir })
    });
    const workflowRepository = new JsonFileWorkflowRepository({
        filePath: path.join(varDir, 'workflow-ledger.json'),
        seedWorkflows: [createBrainbaseAliveWorkflow()]
    });
    const canonicalTaskRepository = createCanonicalTaskRepository({
        backend: canonicalTaskBackend,
        pool: infoSSOTService.pool,
        storeConfig: canonicalTaskStoreConfig
    });
    const canonicalTaskService = new CanonicalTaskService({
        repository: canonicalTaskRepository,
        infoSSOTService,
        readiness: canonicalTaskReadiness,
        operationRepository: canonicalTaskOperationRepository,
        auditRepository: workflowRepository,
        ownerPersonId: canonicalTaskStoreConfig.ownerPersonId
    });
    const authService = new AuthService();
    const wikiService = new WikiService({ pool: infoSSOTService.pool });
    // Memory Promotion Kernel is the sole memory_candidates access boundary.
    // Construct it before LearningService so the compatibility API delegates to it.
    const candidateRepository = infoSSOTService.pool
        ? new PgCandidateRepository({ pool: infoSSOTService.pool })
        : null;
    const knowledgeEventRepository = infoSSOTService.pool
        ? new PgKnowledgeEventRepository({ pool: infoSSOTService.pool })
        : null;
    const knowledgeGraphRepository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });
    const knowledgeEventService = knowledgeEventRepository && candidateRepository
        ? new KnowledgeEventService({
            eventRepository: knowledgeEventRepository,
            candidateRepository,
            graphRepository: knowledgeGraphRepository
        })
        : null;
    const knowledgeFeedbackService = knowledgeEventRepository
        ? new KnowledgeFeedbackService({
            repository: knowledgeEventRepository,
            knowledgeEventService,
            candidateRepository,
            graphRepository: knowledgeGraphRepository
        })
        : null;
    const knowledgeCycleQueryService = knowledgeEventRepository && candidateRepository
        ? new KnowledgeCycleQueryService({
            eventRepository: knowledgeEventRepository,
            candidateRepository
        })
        : null;
    const meetingKnowledgeEventBridge = knowledgeEventService && candidateRepository
        ? new MeetingKnowledgeEventBridge({ knowledgeEventService, candidateRepository })
        : null;
    const learningService = new LearningService({
        pool: infoSSOTService.pool,
        wikiService,
        repoRoot: serverDir,
        candidateRepository
    });
    const learningHealthService = new LearningHealthService({
        stateDir: path.join(varDir, 'learning')
    });
    const workflowRunner = new WorkflowRunner({
        repository: workflowRepository,
        handlers: createDefaultWorkflowHandlers()
    });
    const meetingTaskOwnerResolver = new MeetingTaskOwnerResolver({ infoSSOTService });
    const projectAccessPolicy = new ProjectAccessPolicy({ configParser });
    const automationRuntime = createAutomationRuntimeServices({
        repository: workflowRepository,
        runner: workflowRunner,
        configParser,
        googleCalendarService,
        infoSSOTService,
        meetingKnowledgeEventBridge,
        meetingTaskOwnerResolver,
        projectAccessPolicy,
        canonicalTaskService
    });
    const meetingSourceMcpSyncService = new MeetingSourceMcpSyncService({
        stateFile: path.join(varDir, 'meeting-source-mcp-state.json'),
        meetingAutomationService: automationRuntime.meetingAutomationService,
        adapters: createMeetingSourceMcpAdaptersFromEnv(),
        syncConfig: {
            enabled: process.env.BRAINBASE_MEETING_SOURCE_SYNC_ENABLED === '1',
            immediate: process.env.BRAINBASE_MEETING_SOURCE_SYNC_IMMEDIATE === '1',
            interval_ms: process.env.BRAINBASE_MEETING_SOURCE_SYNC_INTERVAL_MS,
            lookback_ms: process.env.BRAINBASE_MEETING_SOURCE_SYNC_LOOKBACK_MS,
            org_id: process.env.BRAINBASE_MEETING_SOURCE_SYNC_ORG_ID || null,
            project_id: process.env.BRAINBASE_MEETING_SOURCE_SYNC_PROJECT_ID || null,
            case_scope: process.env.BRAINBASE_MEETING_SOURCE_SYNC_CASE_SCOPE || null
        }
    });

    const onboardingRuntimeService = candidateRepository
        ? new OnboardingRuntimeService({
            repository: new JsonFileOnboardingRunRepository({
                filePath: path.join(varDir, 'onboarding-runs.json')
            }),
            candidateRepository,
            infoSSOTService
        })
        : null;
    const externalRunnerIngestService = new ExternalRunnerIngestService({
        workflowRepository,
        candidateRepository
    });
    const runReceiptIngestService = new RunReceiptIngestService({ workflowRepository });
    const routineReceiptPaths = resolveRoutineReceiptPaths({ repoDir: serverDir });
    const judgmentKnowledgeEventOutboxDir = resolveJudgmentKnowledgeEventOutboxPath({
        env: process.env,
        varDir
    });
    const judgmentKnowledgeEventDeadLetterDir = path.join(
        varDir,
        'knowledge-event-dead-letter',
        'codex-judgment'
    );
    const judgmentKnowledgeEventEndpoint = process.env.BRAINBASE_KNOWLEDGE_EVENT_INGEST_URL
        || `http://127.0.0.1:${port}/api/knowledge/events`;
    const judgmentKnowledgeEventDeliveryAuth = resolveJudgmentKnowledgeEventDeliveryAuth({
        endpoint: judgmentKnowledgeEventEndpoint,
        env: process.env
    });
    const listJudgmentOutboxExceptions = () => listJudgmentKnowledgeEventOutboxExceptions({
        directory: judgmentKnowledgeEventOutboxDir
    });
    const routineLivenessService = new RoutineLivenessService({
        expectations: loadRoutineExpectations(path.join(serverDir, 'server', 'config', 'routine-expectations.json')),
        runReceiptQueryService: automationRuntime.runReceiptQueryService,
        listDeadLetters: () => listRoutineDeadLetters({
            directory: routineReceiptPaths.deadLetterDir
        }),
        listKnowledgeEventDeadLetters: () => listKnowledgeEventDeadLetters({
            directory: judgmentKnowledgeEventDeadLetterDir
        }),
        listKnowledgeEventOutboxExceptions: listJudgmentOutboxExceptions
    });
    const productionRoutinePorts = new ProductionRoutinePorts({
        knowledgeEventRepository,
        candidateRepository,
        infoSSOTService,
        runReceiptQueryService: automationRuntime.runReceiptQueryService,
        listJudgmentOutboxExceptions,
        knowledgeFeedbackService,
        countRunReceiptOutbox: () => countRoutineOutbox({ directory: routineReceiptPaths.outboxDir })
    });
    const oyasumiReconciler = productionRoutinePorts;
    const episodeCompressor = productionRoutinePorts;
    const retrievabilityVerifier = productionRoutinePorts;
    const livenessService = routineLivenessService;
    const recallService = productionRoutinePorts;
    const feedbackService = productionRoutinePorts;
    const ohayoGenerator = productionRoutinePorts;
    const retroService = productionRoutinePorts;
    const judgmentOutboxDeliveryService = {
        deliverPending: () => deliverJudgmentKnowledgeEventOutbox({
            outboxDir: judgmentKnowledgeEventOutboxDir,
            deadLetterDir: judgmentKnowledgeEventDeadLetterDir,
            endpoint: judgmentKnowledgeEventEndpoint,
            ...judgmentKnowledgeEventDeliveryAuth
        })
    };
    const routineCycleExecutor = new RoutineCycleExecutor({
        oyasumiReconciler,
        episodeCompressor,
        retrievabilityVerifier,
        livenessService,
        recallService,
        feedbackService,
        ohayoGenerator,
        retroService,
        judgmentOutboxDeliveryService
    });

    const tokenUsageService = new TokenUsageService();

    const storage = multer.diskStorage({
        destination(req, file, cb) {
            cb(null, uploadsDir);
        },
        filename(req, file, cb) {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, uniqueSuffix + path.extname(file.originalname));
        }
    });
    const upload = multer({ storage });

    return {
        googleCalendarService,
        scheduleParser,
        configParser,
        configService,
        infoSSOTService,
        canonicalTaskStoreConfig,
        canonicalTaskReadiness,
        canonicalTaskOperationRepository,
        canonicalTaskRepository,
        canonicalTaskService,
        authService,
        wikiService,
        learningService,
        learningHealthService,
        candidateRepository,
        knowledgeEventRepository,
        knowledgeEventService,
        knowledgeFeedbackService,
        knowledgeCycleQueryService,
        meetingKnowledgeEventBridge,
        onboardingRuntimeService,
        tokenUsageService,
        ...automationRuntime,
        meetingSourceMcpSyncService,
        externalRunnerIngestService,
        runReceiptIngestService,
        routineLivenessService,
        routineCycleExecutor,
        uploadMiddleware: upload.single('file')
    };
}
