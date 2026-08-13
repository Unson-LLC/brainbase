import express from 'express';
import cors from 'cors';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import util from 'util';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { loadRuntimeEnv } from './lib/load-runtime-env.js';

loadRuntimeEnv();

// Crash guards: log and keep running instead of silent death
import { logger as crashLogger } from './server/utils/logger.js';
process.on('uncaughtException', (err) => {
    crashLogger.error('[CRASH] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
    crashLogger.error('[CRASH] unhandledRejection:', reason);
});

import { resolveRuntimePaths } from './lib/runtime-paths.js';

// Import services
import { createCoreServices } from './server/bootstrap/core-services.js';
import { registerGracefulShutdown } from './server/bootstrap/graceful-shutdown.js';
import { registerApiRoutes } from './server/bootstrap/register-api-routes.js';
import { registerStaticRoutes } from './server/bootstrap/static-routes.js';
import { assertAllowedServerEntrypoint } from './server/bootstrap/direct-launch-guard.js';
import { BRAINBASE_CORS_OPTIONS } from './server/bootstrap/cors-options.js';

// Import middleware
import { csrfMiddleware, csrfTokenHandler } from './server/middleware/csrf.js';
import { requireAuth } from './server/middleware/auth.js';
import { errorHandler } from './server/middleware/error-handler.js';
import { captureCandidateStoreRawBody } from './server/middleware/candidate-store-hmac.js';
import { adminNoCacheMiddleware } from './server/routes/admin-visualization.js';

// Import mesh modules (optional, enabled when MESH_RELAY_URL is set)
import { MeshService } from './server/mesh/mesh-service.js';
import { generateKeyPair, loadKeyPair, saveKeyPair } from './server/mesh/crypto/key-manager.js';
import { buildNodeProfile } from './server/mesh/node-profile.js';
import { QueryHandler } from './server/mesh/query/query-handler.js';
import { LocalContextCollector } from './server/mesh/query/local-context-collector.js';
import { checkQueryPermission } from './server/mesh/query/permission-checker.js';
import { ENVELOPE_TYPES } from './server/mesh/envelope.js';
import { createMeshRouter } from './server/routes/mesh.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execPromise = util.promisify(exec);

// Load version from package.json
const packageJson = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const APP_VERSION = `v${packageJson.version}`;

// Environment variables for directory structure
// BRAINBASE_ROOT: Personal data location (config.yml)
// BRAINBASE_VAR_DIR: Runtime data location (state.json, uploads, logs)
// PROJECTS_ROOT: Project code location (where projects are stored)
//
// Auto-detection logic:
// 1. If BRAINBASE_ROOT env var is set, use it
// 2. If running from worktree (.worktrees/...), use parent of .worktrees
// 3. If running from projects directory, look for ../shared
// 4. Fall back to __dirname/data
function detectBrainbaseRoot() {
    if (process.env.BRAINBASE_ROOT) {
        return process.env.BRAINBASE_ROOT;
    }

    // Worktree detection: /path/to/shared/.worktrees/session-xxx/
    if (__dirname.includes('.worktrees')) {
        const match = __dirname.match(/(.+)\/\.worktrees\//);
        if (match) {
            return match[1];
        }
    }

    // Projects directory detection: /path/to/workspace/projects/brainbase/
    if (__dirname.includes('/projects/')) {
        const match = __dirname.match(/(.+)\/projects\//);
        if (match) {
            const sharedPath = path.join(match[1], 'shared');
            // Check if shared directory exists
            if (existsSync(sharedPath)) {
                return sharedPath;
            }
        }
    }

    return path.join(__dirname, 'data');
}

const BRAINBASE_ROOT = detectBrainbaseRoot();
const PROJECTS_ROOT = process.env.PROJECTS_ROOT || path.join(path.dirname(BRAINBASE_ROOT), 'projects');
const RUNTIME_PATHS = resolveRuntimePaths({ repoDir: __dirname });
console.log(`[BRAINBASE] Root directory: ${BRAINBASE_ROOT}`);
console.log(`[BRAINBASE] Projects directory: ${PROJECTS_ROOT}`);
console.log(`[BRAINBASE] Runtime var directory: ${RUNTIME_PATHS.varDir}`);
console.log(`[BRAINBASE] Runtime state file: ${RUNTIME_PATHS.stateFile}`);

// Worktree検知: .worktrees配下で実行されている場合は別ポートをデフォルトに
const isWorktree = __dirname.includes('.worktrees') || __dirname.includes('brainbase-worktrees');

async function resolveGitInfo(repoDir) {
    const info = {
        sha: process.env.BRAINBASE_GIT_SHA || process.env.GIT_SHA || null,
        branch: null,
        dirty: null,
        error: null
    };

    try {
        const { stdout } = await execPromise(`git -C "${repoDir}" rev-parse HEAD`);
        const sha = stdout.trim();
        if (sha) info.sha = sha;
    } catch (error) {
        info.error = error?.message || String(error);
    }

    try {
        const { stdout } = await execPromise(`git -C "${repoDir}" rev-parse --abbrev-ref HEAD`);
        const branch = stdout.trim();
        info.branch = branch || null;
    } catch {
        info.branch = info.branch || null;
    }

    try {
        const { stdout } = await execPromise(`git -C "${repoDir}" status --porcelain`);
        info.dirty = stdout.trim().length > 0;
    } catch {
        info.dirty = info.dirty ?? null;
    }

    return info;
}

async function buildRuntimeInfo({ repoDir, port, defaultPort }) {
    return {
        cwd: process.cwd(),
        dirname: repoDir,
        pid: process.pid,
        node: process.version,
        execArgv: process.execArgv,
        isWorktree,
        port,
        defaultPort,
        git: await resolveGitInfo(repoDir),
        startedAt: new Date().toISOString()
    };
}

function registerRuntimeRevisionGuard({
    repoDir,
    startupGit,
    port,
    testMode,
    log = console
}) {
    const startupSha = startupGit?.sha || null;
    const startupBranch = startupGit?.branch || null;
    const isCanonicalPort = String(port) === '31013';

    if (testMode || !isCanonicalPort || !startupSha) {
        return;
    }

    const intervalMs = 5000;
    const timer = setInterval(async () => {
        try {
            const currentGit = await resolveGitInfo(repoDir);
            if (!currentGit?.sha) return;

            const branchChanged = Boolean(startupBranch && currentGit.branch && currentGit.branch !== startupBranch);
            const shaChanged = currentGit.sha !== startupSha;
            if (!branchChanged && !shaChanged) return;

            log.warn('[BRAINBASE] Stale 31013 server detected; exiting for restart.', {
                startupSha,
                currentSha: currentGit.sha,
                startupBranch,
                currentBranch: currentGit.branch
            });
            process.exit(0);
        } catch (error) {
            log.warn('[BRAINBASE] Runtime revision guard failed:', error?.message || String(error));
        }
    }, intervalMs);

    timer.unref?.();
}
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
const VAR_DIR = RUNTIME_PATHS.varDir;
const UPLOADS_DIR = RUNTIME_PATHS.uploadsDir;

// Test Mode: セッション管理を無効化し、読み取り専用モードで起動
// worktreeでのE2Eテスト・UI検証時に使用
// Phase 4: worktreeで起動された場合は自動的にTEST_MODEを有効化
// ただし、BRAINBASE_TEST_MODE=falseが明示的に指定された場合は無効化（E2Eテスト用）
const TEST_MODE = process.env.BRAINBASE_TEST_MODE === 'false'
    ? false
    : (process.env.BRAINBASE_TEST_MODE === 'true' || isWorktree);
if (TEST_MODE) {
    const reason = isWorktree ? 'Auto-enabled (worktree detected)' : 'Manually enabled';
    console.log(`[BRAINBASE] 🧪 TEST MODE ENABLED - ${reason}`);
    console.log('[BRAINBASE] Session management is disabled');
    console.log('[BRAINBASE] This server is read-only and will not modify state.json');
} else if (isWorktree && process.env.BRAINBASE_TEST_MODE === 'false') {
    console.log('[BRAINBASE] ⚠️  TEST MODE DISABLED - Explicitly disabled for E2E testing');
    console.log('[BRAINBASE] Session management is ENABLED in worktree environment');
}

const app = express();
const PORT = process.env.BRAINBASE_E2E_PORT || (isWorktree ? DEFAULT_PORT : (process.env.BRAINBASE_PORT || process.env.PORT || DEFAULT_PORT));
try {
    assertAllowedServerEntrypoint({
        port: PORT,
        canonicalPort: 31013,
        startedByStartJs: process.env.BRAINBASE_STARTED_BY_START_JS === '1',
        allowDirectServer: process.env.BRAINBASE_ALLOW_DIRECT_SERVER === '1',
        testMode: TEST_MODE,
        isWorktree
    });
} catch (error) {
    console.error(`[BRAINBASE] ${error.message}`);
    process.exit(1);
}
const RUNTIME_INFO = await buildRuntimeInfo({
    repoDir: __dirname,
    port: PORT,
    defaultPort: DEFAULT_PORT
});
registerRuntimeRevisionGuard({
    repoDir: __dirname,
    startupGit: RUNTIME_INFO.git,
    port: PORT,
    testMode: TEST_MODE,
    log: console
});
const PORT_FILE_FALLBACK = path.join(VAR_DIR, '.brainbase-port');
const HOME_PORT_FILE = process.env.HOME
    ? path.join(process.env.HOME, '.brainbase', 'active-port')
    : null;

async function writePortFiles(port) {
    const portValue = String(port);

    if (HOME_PORT_FILE) {
        try {
            await fs.mkdir(path.dirname(HOME_PORT_FILE), { recursive: true });
            await fs.writeFile(HOME_PORT_FILE, portValue);
        } catch (error) {
            console.warn('[BRAINBASE] Failed to write home port file:', error.message);
        }
    }

    try {
        await fs.writeFile(PORT_FILE_FALLBACK, portValue);
    } catch (error) {
        console.warn('[BRAINBASE] Failed to write port file:', error.message);
    }
}

// Configuration
const CODEX_PATH = path.join(__dirname, 'examples', 'codex');
const CONFIG_PATH = existsSync(path.join(BRAINBASE_ROOT, 'config.yml'))
    ? path.join(BRAINBASE_ROOT, 'config.yml')
    : path.join(__dirname, 'config.yml');

const ensureDir = async (dir) => {
    try {
        await fs.mkdir(dir, { recursive: true });
    } catch (error) {
        console.warn(`[BRAINBASE] Failed to create directory: ${dir}`, error.message);
    }
};

await ensureDir(BRAINBASE_ROOT);
await ensureDir(VAR_DIR);
await ensureDir(UPLOADS_DIR);
const {
    googleCalendarService,
    scheduleParser,
    configParser,
    configService,
    infoSSOTService,
    canonicalTaskStoreConfig,
    canonicalTaskReadiness,
    canonicalTaskOperationRepository,
    canonicalTaskService,
    authService,
    wikiService,
    learningService,
    learningHealthService,
    candidateRepository,
    knowledgeEventService,
    knowledgeFeedbackService,
    knowledgeCycleQueryService,
    onboardingRuntimeService,
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
    uploadMiddleware
} = createCoreServices({
    varDir: VAR_DIR,
    brainbaseRoot: BRAINBASE_ROOT,
    projectsRoot: PROJECTS_ROOT,
    codexPath: CODEX_PATH,
    configPath: CONFIG_PATH,
    uploadsDir: UPLOADS_DIR,
    serverDir: __dirname,
    port: PORT,
    sourceHead: RUNTIME_INFO.git.sha
});

const canonicalTaskRuntime = await canonicalTaskReadiness.initialize();
if (canonicalTaskRuntime.ready) {
    console.log('[canonical-task] writer claimed and persisted readiness verified');
} else {
    console.warn(`[canonical-task] mutation disabled: ${canonicalTaskRuntime.reason}`);
}

// Middleware
// Enable CORS for local network access and remote auth/api calls (local UI -> bb.unson.jp)
app.use(cors(BRAINBASE_CORS_OPTIONS));

// Increase body-parser limit to handle large state.json (default: 100kb -> 1mb)
// Preserve the exact Candidate Store ingest bytes here because this application-
// level parser consumes the stream before the mounted Candidate Store router.
app.use(express.json({ limit: '10mb', verify: captureCandidateStoreRawBody }));

// Security Headers Middleware
app.use((req, res, next) => {
    // Content Security Policy
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://unpkg.com",  // unpkg.com for Lucide icons CDN.
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",  // Google Fonts CSS + xterm.css
        "font-src 'self' https://fonts.gstatic.com",  // Google Fonts files
        "img-src 'self' data:",
        "connect-src 'self' ws: wss: https://unpkg.com https://bb.unson.jp",  // allow remote API
        "frame-src 'self' http://127.0.0.1:* http://localhost:*",
        "frame-ancestors 'self'"
    ].join('; '));
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Clickjacking protection
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // XSS filter (legacy browsers)
    res.setHeader('X-XSS-Protection', '1; mode=block');
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// CSRF Protection Middleware
app.use('/api/admin', adminNoCacheMiddleware);
app.use(csrfMiddleware());

// CSRF Token Endpoint
app.get('/api/csrf-token', csrfTokenHandler);
// Active port registration (UI -> hook target)
app.get('/api/active-port', async (req, res) => {
    await writePortFiles(PORT);
    res.json({ port: PORT });
});

registerStaticRoutes(app, {
    publicDir: path.join(__dirname, 'public'),
    log: console
});

app.use('/console', (_req, res) => {
    res.status(410).json({
        error: 'capability_retired',
        capability: 'brainbase.console-proxy',
        owner: 'Codex app and CLI',
        replacement: 'Use the terminal attached to the Codex task'
    });
});

// ========================================
// MVC Router Registration (Phase 3)
// ========================================

// Register routers with dependency injection
// workspaceRoot should point to the current workspace directory (__dirname)
// not its parent, to correctly resolve file paths for open-file API
const workspaceRoot = __dirname;

app.get('/health/ready', (req, res) => {
    res.status(200).json({ ready: true });
});

registerApiRoutes(app, {
    configParser,
    configService,
    runtimePaths: RUNTIME_PATHS,
    scheduleParser,
    googleCalendarService,
    projectsRoot: PROJECTS_ROOT,
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
    appVersion: APP_VERSION,
    workspaceRoot,
    uploadsDir: UPLOADS_DIR,
    runtimeInfo: RUNTIME_INFO,
    brainbaseRoot: BRAINBASE_ROOT
});

// ========================================
// Mesh Service (optional, enabled when MESH_RELAY_URL is set)
// ========================================
let meshService = null;
if (process.env.MESH_RELAY_URL) {
    try {
        let keyPair = await loadKeyPair();
        if (!keyPair) {
            keyPair = await generateKeyPair();
            await saveKeyPair(keyPair);
            console.log('[Mesh] Generated new keypair');
        }

        const config = configParser.getConfig();
        const slackUserId = process.env.MESH_SLACK_USER_ID || '';
        const roleRank = parseInt(process.env.MESH_ROLE_RANK || '1');

        const nodeProfile = buildNodeProfile({
            config,
            slackUserId,
            roleRank,
            brainbaseRoot: BRAINBASE_ROOT,
            nodeId: process.env.MESH_NODE_ID,
        });

        // TODO: 複数プロジェクト担当時は各プロジェクトごとにcollectorを作るか、
        //       collectGeneral()で全プロジェクトをループする設計に変更する。
        //       MVPでは最初のプロジェクトのみ対応。
        const firstProject = nodeProfile.projects[0];
        const collector = new LocalContextCollector({
            nocodbUrl: process.env.NOCODB_URL || 'https://noco.unson.jp',
            nocodbToken: process.env.NOCODB_TOKEN,
            taskTableId: firstProject?.nocodbBaseId || '',
            milestoneTableId: '',
            workDir: firstProject?.localPath || process.cwd(),
        });

        const queryHandler = new QueryHandler({
            localContextCollector: collector,
            permissionChecker: { checkQueryPermission },
        });
        queryHandler.setOwnProjects(nodeProfile.projects.map(p => p.projectId));

        meshService = new MeshService({
            keyManager: keyPair,
            relayUrl: process.env.MESH_RELAY_URL,
            nodeId: nodeProfile.nodeId,
            role: roleRank >= 3 ? 'ceo' : roleRank >= 2 ? 'gm' : 'member',
        });

        meshService.messageRouter.registerHandler(ENVELOPE_TYPES.QUERY, async (message) => {
            const response = await queryHandler.handleQuery({
                from: message.from,
                fromRole: roleRank,
                fromProjects: [],
                question: message.payload?.question,
                scope: message.payload?.scope || 'general',
            });
            await meshService.sendResponse(message.from, message.id, JSON.parse(response));
        });

        meshService.messageRouter.registerHandler('peer_joined', async (message) => {
            if (message.nodeId && message.publicKey) {
                meshService.peerRegistry.addPeer({
                    nodeId: message.nodeId,
                    publicKey: message.publicKey,
                    boxPublicKey: message.boxPublicKey || null,
                    roleRank: message.roleRank || 1,
                    projects: message.projects || [],
                    role: message.role || 'member',
                    online: true,
                });
                console.log(`[Mesh] Peer joined: ${message.nodeId}`);
            }
        });

        meshService.messageRouter.registerHandler('peer_left', async (message) => {
            if (message.nodeId) {
                meshService.peerRegistry.updateStatus(message.nodeId, false);
                console.log(`[Mesh] Peer left: ${message.nodeId}`);
            }
        });

        await meshService.start();
        console.log(`[Mesh] Connected to relay: ${process.env.MESH_RELAY_URL} (node: ${nodeProfile.nodeId})`);
    } catch (err) {
        console.error('[Mesh] Failed to start:', err.message);
        // Non-fatal: Brainbase works without mesh
    }
}

app.use('/api/mesh', createMeshRouter(meshService));

// ========================================
// All API routes are now handled by routers:
// - TaskRouter: /api/tasks
// - StateRouter: /api/state
// - ConfigRouter: /api/config
// - ScheduleRouter: /api/schedule
// - SessionRouter: /api/sessions
// - MeshRouter: /api/mesh
// - MiscRouter: /api (version, restart, upload, open-file)
// ========================================

// Centralized error handler (must be registered after all routes)
app.use(errorHandler);

// Start server
const server = app.listen(PORT, async () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Serving static files from ${path.join(__dirname, 'public')}`);
    await writePortFiles(PORT);

    const meetingSourceSchedule = meetingSourceMcpSyncService?.startScheduledSync?.();
    if (meetingSourceSchedule?.started) {
        console.log(`[meeting-source] MCP sync scheduler started (${meetingSourceSchedule.interval_ms}ms)`);
    }

});

registerGracefulShutdown({
    server,
    meetingSourceMcpSyncService,
    canonicalTaskOperationRepository,
    getMeshService: () => meshService,
    log: console
});
