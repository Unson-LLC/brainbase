import path from 'path';
import multer from 'multer';

import { TaskParser } from '../../lib/task-parser.js';
import { ScheduleParser } from '../../lib/schedule-parser.js';
import { StateStore } from '../../lib/state-store.js';
import { ConfigParser } from '../../lib/config-parser.js';
import { InboxParser } from '../../lib/inbox-parser.js';
import { createSessionServices } from '../services/create-session-services.js';
import { TerminalTransportService } from '../services/terminal-transport-service.js';
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

    const sessionServices = createSessionServices({
        serverDir,
        execPromise,
        stateStore,
        worktreeService,
        uiPort: port
    });
    const tmuxCaptureCache = new TmuxCaptureCache({ snapshotService: sessionServices.terminal.snapshot });
    const tmuxControlRegistry = new TmuxControlRegistry();
    const terminalTransportService = new TerminalTransportService({
        ownershipService: sessionServices.ownership,
        runtimeQuery: sessionServices.runtime.query,
        runtimeRegistry: sessionServices.runtime.registry,
        terminalIo: sessionServices.terminal.io,
        snapshotService: sessionServices.terminal.snapshot,
        captureCache: tmuxCaptureCache,
        controlRegistry: tmuxControlRegistry
    });
    const conversationLinker = new ConversationLinker({
        stateStore,
        workspaceService: sessionServices.workspace
    });

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
        sessionServices,
        tmuxCaptureCache,
        tmuxControlRegistry,
        terminalTransportService,
        conversationLinker,
        uploadMiddleware: upload.single('file')
    };
}
