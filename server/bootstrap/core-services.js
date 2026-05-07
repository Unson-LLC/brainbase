import path from 'path';
import multer from 'multer';

import { TaskParser } from '../../lib/task-parser.js';
import { ScheduleParser } from '../../lib/schedule-parser.js';
import { SqliteStore as StateStore } from '../../lib/sqlite-store.js';
import { ConfigParser } from '../../lib/config-parser.js';
import { InboxParser } from '../../lib/inbox-parser.js';
import { createSessionServices } from '../services/create-session-services.js';
import { ArchiveFinalizerService } from '../services/archive-finalizer-service.js';
import { TerminalTransportService } from '../services/terminal-transport-service.js';
import { TerminalInputProbeService } from '../services/terminal-input-probe-service.js';
import { TerminalRuntimeReconciler } from '../services/terminal-runtime-reconciler.js';
import { TerminalRuntimeRegistry } from '../services/terminal-runtime-registry.js';
import { SessionActivityWsService } from '../services/session-activity-ws-service.js';
import { TmuxCaptureCache } from '../services/tmux-capture-cache.js';
import { TmuxControlRegistry } from '../services/tmux-control-registry.js';
import { WorktreeService } from '../services/worktree-service.js';
import { InfoSSOTService } from '../services/info-ssot-service.js';
import { AuthService } from '../services/auth-service.js';
import { ConversationLinker } from '../services/conversation-linker.js';
import { ConfigService } from '../services/config-service.js';
import { GoogleCalendarService } from '../services/google-calendar-service.js';
import { LearningService } from '../services/learning-service.js';
import { LearningHealthService } from '../services/learning-health-service.js';
import { WikiService } from '../services/wiki-service.js';
import { TokenUsageService } from '../services/token-usage-service.js';

export function createCoreServices({
    tasksFile,
    schedulesDir,
    varDir,
    stateFile,
    brainbaseRoot,
    projectsRoot,
    worktreesDir,
    codexPath,
    configPath,
    inboxFile,
    uploadsDir,
    serverDir,
    execPromise,
    port
}) {
    const taskParser = new TaskParser(tasksFile);
    const googleCalendarService = new GoogleCalendarService();
    const scheduleParser = new ScheduleParser(schedulesDir, { googleCalendarService });

    process.env.BRAINBASE_VAR_DIR = varDir;
    process.env.BRAINBASE_STATE_PATH = stateFile;

    const stateStore = new StateStore(stateFile, brainbaseRoot);
    const configParser = new ConfigParser(codexPath, configPath, brainbaseRoot, projectsRoot);
    const configService = new ConfigService(configPath, projectsRoot);
    const inboxParser = new InboxParser(inboxFile);
    const infoSSOTService = new InfoSSOTService();
    const authService = new AuthService();
    const wikiService = new WikiService({ pool: infoSSOTService.pool });
    const learningService = new LearningService({
        pool: infoSSOTService.pool,
        wikiService,
        repoRoot: serverDir
    });
    const learningHealthService = new LearningHealthService({
        stateDir: path.join(varDir, 'learning')
    });

    const worktreeService = new WorktreeService(
        worktreesDir,
        brainbaseRoot,
        execPromise
    );
    const archiveFinalizer = new ArchiveFinalizerService({
        stateStore,
        worktreeService,
        execPromise,
        repoRoot: serverDir
    });

    const sessionServices = createSessionServices({
        serverDir,
        execPromise,
        stateStore,
        worktreeService,
        uiPort: port
    });
    sessionServices.archiveFinalizer = archiveFinalizer;
    const tmuxCaptureCache = new TmuxCaptureCache({ snapshotService: sessionServices.terminal.snapshot });
    const tmuxControlRegistry = new TmuxControlRegistry();
    const terminalRuntimeRegistry = new TerminalRuntimeRegistry({
        filePath: path.join(varDir, 'terminal-runtime-registry.json'),
        serverGeneration: {
            id: process.env.BRAINBASE_SERVER_GENERATION || null,
            pid: process.pid,
            port,
            startedAt: new Date().toISOString(),
            entrypoint: process.env.BRAINBASE_STARTED_BY_START_JS === '1' ? 'start.js' : 'server.js'
        }
    });
    const terminalRuntimeReconciler = new TerminalRuntimeReconciler({
        stateStore,
        runtimeQuery: sessionServices.runtime.query,
        runtimeLifecycle: sessionServices.runtime.lifecycle,
        ownershipService: sessionServices.ownership,
        runtimeRegistry: terminalRuntimeRegistry,
        serverGeneration: process.env.BRAINBASE_SERVER_GENERATION || null
    });
    const terminalInputProbeService = new TerminalInputProbeService({
        ownershipService: sessionServices.ownership,
        runtimeQuery: sessionServices.runtime.query,
        terminalIo: sessionServices.terminal.io,
        snapshotService: sessionServices.terminal.snapshot,
        runtimeRegistry: terminalRuntimeRegistry,
        captureCache: tmuxCaptureCache
    });
    sessionServices.runtime.observedRegistry = terminalRuntimeRegistry;
    sessionServices.runtime.reconciler = terminalRuntimeReconciler;
    sessionServices.terminal.inputProbe = terminalInputProbeService;
    const terminalTransportService = new TerminalTransportService({
        ownershipService: sessionServices.ownership,
        runtimeQuery: sessionServices.runtime.query,
        runtimeRegistry: terminalRuntimeRegistry,
        terminalIo: sessionServices.terminal.io,
        snapshotService: sessionServices.terminal.snapshot,
        captureCache: tmuxCaptureCache,
        controlRegistry: tmuxControlRegistry
    });
    const sessionActivityWsService = new SessionActivityWsService({
        activityService: sessionServices.activity,
        fullStatusIntervalMs: 3000
    });
    sessionServices.shared._activityWsBroadcast = (sessionId, hookStatus) => {
        sessionActivityWsService.broadcast(sessionId, hookStatus);
    };

    const conversationLinker = new ConversationLinker({
        stateStore,
        workspaceService: sessionServices.workspace
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
        taskParser,
        googleCalendarService,
        scheduleParser,
        stateStore,
        configParser,
        configService,
        inboxParser,
        infoSSOTService,
        authService,
        wikiService,
        learningService,
        learningHealthService,
        worktreeService,
        archiveFinalizer,
        sessionServices,
        terminalRuntimeRegistry,
        terminalRuntimeReconciler,
        terminalInputProbeService,
        tmuxCaptureCache,
        tmuxControlRegistry,
        terminalTransportService,
        sessionActivityWsService,
        conversationLinker,
        tokenUsageService,
        uploadMiddleware: upload.single('file')
    };
}
