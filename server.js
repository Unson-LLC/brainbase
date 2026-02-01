// Load environment variables from shared + local .env files
import dotenv from 'dotenv';
import os from 'os';
import express from 'express';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import net from 'net';
import util from 'util';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { readFileSync, existsSync } from 'fs';

const envPaths = [
    process.env.BRAINBASE_ENV_PATH,
    path.join(os.homedir(), 'workspace', '.env'),
    path.join(process.cwd(), '.env')
].filter(Boolean);

for (const envPath of envPaths) {
    if (existsSync(envPath)) {
        dotenv.config({ path: envPath, override: false });
    }
}

// Import our modules
import { TaskParser } from './lib/task-parser.js';
import { ScheduleParser } from './lib/schedule-parser.js';
import { StateStore } from './lib/state-store.js';
import { ConfigParser } from './lib/config-parser.js';
import { InboxParser } from './lib/inbox-parser.js';

// Import services
import { SessionManager } from './server/services/session-manager.js';
import { WorktreeService } from './server/services/worktree-service.js';

// Import routers
import { createTaskRouter } from './server/routes/tasks.js';
import { createStateRouter } from './server/routes/state.js';
import { createConfigRouter } from './server/routes/config.js';
import { ConfigService } from './server/services/config-service.js';
import { createInboxRouter } from './server/routes/inbox.js';
import { createScheduleRouter } from './server/routes/schedule.js';
import { createMiscRouter } from './server/routes/misc.js';
import { createSessionRouter } from './server/routes/sessions.js';
import { createBrainbaseRouter } from './server/routes/brainbase.js';
import { createNocoDBRouter } from './server/routes/nocodb.js';
import { createHealthRouter } from './server/routes/health.js';

// Import middleware
import { csrfMiddleware, csrfTokenHandler } from './server/middleware/csrf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execPromise = util.promisify(exec);

// Load version from package.json
const packageJson = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const APP_VERSION = `v${packageJson.version}`;

// Environment variables for directory structure
// BRAINBASE_ROOT: Personal data location (_codex, _tasks, _schedules, config.yml)
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
console.log(`[BRAINBASE] Root directory: ${BRAINBASE_ROOT}`);
console.log(`[BRAINBASE] Projects directory: ${PROJECTS_ROOT}`);

// Worktree検知: .worktrees配下で実行されている場合はport 3001をデフォルトに
const isWorktree = __dirname.includes('.worktrees');

async function resolveGitInfo(repoDir) {
    const info = {
        sha: process.env.BRAINBASE_GIT_SHA || process.env.GIT_SHA || null,
        branch: null,
        dirty: null,
        error: null
    };

    try {
        const { stdout } = await execPromise(`git -C "${repoDir}" rev-parse --short HEAD`);
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
const DEFAULT_PORT = isWorktree ? 3001 : 3000;
const VAR_DIR = process.env.BRAINBASE_VAR_DIR || (
    isWorktree
        ? path.join(PROJECTS_ROOT, 'brainbase', 'var')
        : path.join(__dirname, 'var')
);
const UPLOADS_DIR = path.join(VAR_DIR, 'uploads');

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
const PORT = process.env.PORT || DEFAULT_PORT;
const RUNTIME_INFO = await buildRuntimeInfo({
    repoDir: __dirname,
    port: PORT,
    defaultPort: DEFAULT_PORT
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
const TASKS_FILE = path.join(BRAINBASE_ROOT, '_tasks/index.md');
const SCHEDULES_DIR = path.join(BRAINBASE_ROOT, '_schedules');
// Phase 4: worktree環境では正本のstate.jsonを参照（E2Eテスト用）
const STATE_FILE = isWorktree
    ? path.join(PROJECTS_ROOT, 'brainbase', 'var', 'state.json')
    : path.join(VAR_DIR, 'state.json');
const WORKTREES_DIR = process.env.BRAINBASE_WORKTREES_DIR || path.join(BRAINBASE_ROOT, '.worktrees');
const CODEX_PATH = existsSync(path.join(BRAINBASE_ROOT, '_codex'))
    ? path.join(BRAINBASE_ROOT, '_codex')
    : path.join(__dirname, '_codex-sample');
const CONFIG_PATH = existsSync(path.join(BRAINBASE_ROOT, 'config.yml'))
    ? path.join(BRAINBASE_ROOT, 'config.yml')
    : path.join(__dirname, 'config.yml');
const INBOX_FILE = path.join(BRAINBASE_ROOT, '_inbox/pending.md');

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

// Initialize Modules
const taskParser = new TaskParser(TASKS_FILE);
const scheduleParser = new ScheduleParser(SCHEDULES_DIR);
const stateStore = new StateStore(STATE_FILE, BRAINBASE_ROOT);
const configParser = new ConfigParser(CODEX_PATH, CONFIG_PATH, BRAINBASE_ROOT, PROJECTS_ROOT);
const configService = new ConfigService(CONFIG_PATH, PROJECTS_ROOT);
const inboxParser = new InboxParser(INBOX_FILE);

// Middleware
// Increase body-parser limit to handle large state.json (default: 100kb -> 1mb)
app.use(express.json({ limit: '1mb' }));

// Security Headers Middleware
app.use((req, res, next) => {
    // Content Security Policy
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://unpkg.com",  // unpkg.com for Lucide icons CDN
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",  // Google Fonts CSS
        "font-src 'self' https://fonts.gstatic.com",  // Google Fonts files
        "img-src 'self' data:",
        "connect-src 'self' ws: wss: https://unpkg.com",  // unpkg.com for source maps
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
app.use(csrfMiddleware());

// CSRF Token Endpoint
app.get('/api/csrf-token', csrfTokenHandler);
// Active port registration (UI -> hook target)
app.get('/api/active-port', async (req, res) => {
    await writePortFiles(PORT);
    res.json({ port: PORT });
});

// ルートパスは明示的にindex.htmlを配信（キャッシュ無効） - 最初に定義
app.get('/', async (req, res) => {
    try {
        const filePath = path.join(__dirname, 'public', 'index.html');
        const content = await fs.readFile(filePath, 'utf-8');

        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(content);
    } catch (error) {
        console.error('Error loading index.html:', error);
        res.status(500).send('Error loading page: ' + error.message);
    }
});

// 静的ファイル配信（その他のファイル）
// app.jsにno-cacheヘッダーを設定
app.get('/app.js', async (req, res) => {
    try {
        const filePath = path.join(__dirname, 'public', 'app.js');
        const content = await fs.readFile(filePath, 'utf-8');

        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Content-Type', 'application/javascript; charset=utf-8');
        res.send(content);
    } catch (error) {
        res.status(500).send('Error loading app.js');
    }
});

app.use(express.static('public', {
    index: false,
    setHeaders: (res, path) => {
        // Disable caching for JS and CSS files to prevent stale content
        if (path.endsWith('.js') || path.endsWith('.css')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// Initialize Services
// Phase 2: WorktreeServiceを先に初期化（SessionManagerで使用するため）
const worktreeService = new WorktreeService(
    WORKTREES_DIR,
    BRAINBASE_ROOT, // Canonical root (正本ディレクトリルート)
    execPromise
);

const sessionManager = new SessionManager({
    serverDir: __dirname,
    execPromise,
    stateStore,
    worktreeService,  // Phase 2: Archived session cleanup用
    uiPort: PORT
});

// Initialize State Store and restore session state
(async () => {
    try {
        await stateStore.init();
        await sessionManager.restoreHookStatus();

        // Phase 3: activeセッションを復元してからcleanupを実行
        // Phase 4: TEST_MODEでは実行しない（読み取り専用）
        if (!TEST_MODE) {
            await sessionManager.restoreActiveSessions();
            await sessionManager.cleanupOrphans();
        } else {
            console.log('[BRAINBASE] Skipping session restoration and cleanup (TEST_MODE)');
        }
    } catch (error) {
        console.error('[BRAINBASE] Initialization failed:', error);
    } finally {
        sessionManager.markReady();
    }
})();

// Configure Multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR)
    },
    filename: function (req, file, cb) {
        // Keep original extension
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname))
    }
});
const upload = multer({ storage: storage });

// Proxy Middleware for ttyd consoles
// Route: /console/:sessionId -> http://localhost:PORT/...
// On Windows, ttyd doesn't support base-path, so we strip /console/SESSION_ID prefix
// On other platforms, ttyd uses base-path and expects the full path
const isWindows = process.platform === 'win32';
const ttydProxy = createProxyMiddleware({
    ws: true, // Enable WebSocket proxying
    changeOrigin: true,
    pathRewrite: function (path, req) {
        if (isWindows) {
            // Windows: Strip /console/SESSION_ID prefix since ttyd doesn't use base-path
            // /console/SESSION_ID/ws -> /ws
            // /console/SESSION_ID/ -> /
            const match = path.match(/^\/console\/[^/]+(\/.*)?$/);
            if (match) {
                return match[1] || '/';
            }
            return '/';
        } else {
            // Non-Windows: Keep full path (ttyd expects /console/SESSION_ID...)
            if (path.startsWith('/console')) {
                return path;
            }
            return '/console' + path;
        }
    },
    router: function (req) {
        // Handle both full path (Upgrade) and stripped path (Express)
        const url = req.url;
        const originalUrl = req.originalUrl || url;
        const activeSessions = sessionManager.getActiveSessions();

        // 1. Try full path match: /console/SESSION_ID/...
        let match = originalUrl.match(/^\/console\/([^/]+)/);
        if (match) {
            const sessionId = match[1];
            if (activeSessions.has(sessionId)) {
                return `http://localhost:${activeSessions.get(sessionId).port}`;
            }
        }

        // 2. Try stripped path match: /SESSION_ID/...
        match = url.match(/^\/?([^/]+)/);
        if (match) {
            const sessionId = match[1];
            if (activeSessions.has(sessionId)) {
                return `http://localhost:${activeSessions.get(sessionId).port}`;
            }
        }

        console.error(`[Proxy] No session found for ${url}`);
        // Return a dummy URL that will fail - http-proxy-middleware requires a valid target
        // The onError handler will catch this and return 404
        return 'http://127.0.0.1:1'; // Invalid port that will fail
    },
    onProxyReqWs: (proxyReq, req, socket, options, head) => {
        // Rewrite Origin to match the target (ttyd)
        const url = req.url;
        const activeSessions = sessionManager.getActiveSessions();
        let match = url.match(/^\/console\/([^/]+)/);
        if (!match) match = url.match(/^\/?([^/]+)/); // Fallback

        if (match) {
            const sessionId = match[1];
            if (activeSessions.has(sessionId)) {
                const port = activeSessions.get(sessionId).port;
                proxyReq.setHeader('Origin', `http://localhost:${port}`);
            }
        }
    },
    onError: (err, req, res) => {
        console.error('Proxy Error:', err);
        if (res && res.status) {
            res.status(500).send('Proxy Error');
        }
    }
});

app.use('/console', ttydProxy);

// ========================================
// MVC Router Registration (Phase 3)
// ========================================

// Register routers with dependency injection
// workspaceRoot should point to the current workspace directory (__dirname)
// not its parent, to correctly resolve file paths for open-file API
const workspaceRoot = __dirname;

app.get('/health/ready', (req, res) => {
    const ready = sessionManager.isReady();
    res.status(ready ? 200 : 503).json({ ready });
});

app.use('/api/tasks', createTaskRouter(taskParser));
app.use('/api/state', createStateRouter(stateStore, sessionManager, TEST_MODE));
app.use('/api/config', createConfigRouter(configParser, configService));
app.use('/api/inbox', createInboxRouter(inboxParser));
app.use('/api/schedule', createScheduleRouter(scheduleParser));
app.use('/api/sessions', createSessionRouter(sessionManager, worktreeService, stateStore, TEST_MODE));
app.use('/api/brainbase', createBrainbaseRouter({
    taskParser,
    worktreeService,
    configParser,
    projectsRoot: PROJECTS_ROOT
}));
app.use('/api/nocodb', createNocoDBRouter(configParser));
app.use('/api/health', createHealthRouter({ sessionManager, configParser }));
app.use('/api', createMiscRouter(APP_VERSION, upload.single('file'), workspaceRoot, UPLOADS_DIR, RUNTIME_INFO, { brainbaseRoot: BRAINBASE_ROOT, projectsRoot: PROJECTS_ROOT }));

// ========================================
// All API routes are now handled by routers:
// - TaskRouter: /api/tasks
// - StateRouter: /api/state
// - ConfigRouter: /api/config
// - InboxRouter: /api/inbox
// - ScheduleRouter: /api/schedule
// - SessionRouter: /api/sessions
// - MiscRouter: /api (version, restart, upload, open-file)
// ========================================

// Start server
const server = app.listen(PORT, async () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Serving static files from ${path.join(__dirname, 'public')}`);
    console.log(`Reading tasks from: ${TASKS_FILE}`);
    console.log(`Reading schedules from: ${SCHEDULES_DIR}`);
    await writePortFiles(PORT);
});

// Handle WebSocket Upgrades
server.on('upgrade', ttydProxy.upgrade);

// Graceful shutdown
async function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);

    // 1. Stop accepting new connections
    server.close(() => {
        console.log('✅ HTTP server closed');
    });

    // 2. Cleanup StateStore lock (if cleanup method exists)
    if (stateStore.cleanup) {
        await stateStore.cleanup();
    }

    // 3. Cleanup SessionManager (if cleanup method exists)
    if (sessionManager.cleanup) {
        await sessionManager.cleanup();
    }

    console.log('✅ Graceful shutdown complete');
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
