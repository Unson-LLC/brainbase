import path from 'path';
import { createTaskRouter } from '../routes/tasks.js';
import { createStateRouter } from '../routes/state.js';
import { createConfigRouter } from '../routes/config.js';
import { createInboxRouter } from '../routes/inbox.js';
import { createScheduleRouter } from '../routes/schedule.js';
import { createSessionRouter } from '../routes/sessions.js';
import { createBrainbaseRouter } from '../routes/brainbase.js';
import { createNocoDBRouter } from '../routes/nocodb.js';
import { createHealthRouter } from '../routes/health.js';
import { createAuthRouter } from '../routes/auth.js';
import { createInfoSSOTRouter } from '../routes/info-ssot.js';
import { createLearningRouter } from '../routes/learning.js';
import { createSetupRouter } from '../routes/setup.js';
import { createWikiRouter } from '../routes/wiki.js';
import { createMiscRouter } from '../routes/misc.js';

export function registerApiRoutes(app, {
    taskParser,
    stateStore,
    sessionServices,
    testMode,
    configParser,
    configService,
    runtimePaths,
    inboxParser,
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
    wikiService,
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
    app.use('/api/config', createConfigRouter(configParser, configService, runtimePaths));
    app.use('/api/inbox', createInboxRouter(inboxParser));
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
        projectsRoot
    }));
    app.use('/api/nocodb', createNocoDBRouter(configParser));
    app.use('/api/health', createHealthRouter({ readiness: sessionServices.runtime.registry, configParser }));
    app.use('/api/auth', createAuthRouter(authService));
    app.use('/api/info', createInfoSSOTRouter(infoSSOTService));
    app.use('/api/learning', createLearningRouter(learningService, learningHealthService));
    app.use('/api/wiki', createWikiRouter(wikiService));
    app.use('/api/setup', createSetupRouter(authService, infoSSOTService, configParser));
    app.use('/api', createMiscRouter(appVersion, uploadMiddleware, workspaceRoot, uploadsDir, runtimeInfo, {
        brainbaseRoot,
        projectsRoot,
        sessionQuery: sessionServices.runtime.query,
        workspace: sessionServices.workspace
    }));
}
