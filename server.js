// Load environment variables from .env file
import 'dotenv/config';

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

// Import our modules
import { TaskParser } from './lib/task-parser.js';
import { ScheduleParser } from './lib/schedule-parser.js';
import { StateStore } from './lib/state-store.js';
import { ConfigParser } from './lib/config-parser.js';
import { InboxParser } from './lib/inbox-parser.js';
import { TimelineStorage } from './lib/timeline-storage.js';

// Import services
import { SessionManager } from './server/services/session-manager.js';
import { WorktreeService } from './server/services/worktree-service.js';

// Import routers
import { createTaskRouter } from './server/routes/tasks.js';
import { createStateRouter } from './server/routes/state.js';
import { createConfigRouter } from './server/routes/config.js';
import { createInboxRouter } from './server/routes/inbox.js';
import { createScheduleRouter } from './server/routes/schedule.js';
import { createTimelineRouter } from './server/routes/timeline.js';
import { createMiscRouter } from './server/routes/misc.js';
import { createSessionRouter } from './server/routes/sessions.js';
import { createBrainbaseRouter } from './server/routes/brainbase.js';

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
// PROJECTS_ROOT: Project code location (where projects are stored)
//
// Auto-detection logic:
// 1. If BRAINBASE_ROOT env var is set, use it
// 2. If running from worktree (.worktrees/...), use parent of .worktrees
// 3. If running from projects directory, look for ../shared
// 4. Fall back to __dirname
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

    return __dirname;
}

const BRAINBASE_ROOT = detectBrainbaseRoot();
const PROJECTS_ROOT = process.env.PROJECTS_ROOT || path.join(path.dirname(BRAINBASE_ROOT), 'projects');
console.log(`[BRAINBASE] Root directory: ${BRAINBASE_ROOT}`);
console.log(`[BRAINBASE] Projects directory: ${PROJECTS_ROOT}`);

// Worktree検知: .worktrees配下で実行されている場合はport 3001をデフォルトに
const isWorktree = __dirname.includes('.worktrees');
const DEFAULT_PORT = isWorktree ? 3001 : 3000;

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

// Configuration
const USE_KIRO_FORMAT = process.env.KIRO_TASK_FORMAT === 'true';
const USE_KIRO_SCHEDULE_FORMAT = process.env.KIRO_SCHEDULE_FORMAT === 'true';
if (USE_KIRO_FORMAT) {
    console.log('[BRAINBASE] 📋 Kiro task format ENABLED');
    console.log('[BRAINBASE] Tasks will be stored in _tasks/{project}/tasks.md and done.md');
} else {
    console.log('[BRAINBASE] 📋 YAML task format (default)');
    console.log('[BRAINBASE] Tasks will be stored in _tasks/index.md');
}
if (USE_KIRO_SCHEDULE_FORMAT) {
    console.log('[BRAINBASE] 📅 Kiro schedule format ENABLED');
    console.log('[BRAINBASE] Schedules will be stored in _schedules/{date}/schedule.md');
} else {
    console.log('[BRAINBASE] 📅 Legacy schedule format (default)');
}
const TASKS_DIR = path.join(BRAINBASE_ROOT, '_tasks');
const TASKS_FILE = path.join(TASKS_DIR, 'index.md');
const SCHEDULES_DIR = path.join(BRAINBASE_ROOT, '_schedules');
// Phase 4: worktree環境では正本のstate.jsonを参照（E2Eテスト用）
const STATE_FILE = isWorktree
    ? path.join(PROJECTS_ROOT, 'brainbase', 'state.json')
    : path.join(__dirname, 'state.json');
const WORKTREES_DIR = path.join(BRAINBASE_ROOT, '.worktrees');
const CODEX_PATH = path.join(BRAINBASE_ROOT, '_codex');
const CONFIG_PATH = path.join(BRAINBASE_ROOT, 'config.yml');
const INBOX_FILE = path.join(BRAINBASE_ROOT, '_inbox/pending.md');
const TIMELINE_DIR = path.join(BRAINBASE_ROOT, '_timeline');

// Initialize Modules
// Kiro format: tasks stored in _tasks/{project}/tasks.md and _tasks/{project}/done.md
// YAML format (default): tasks stored in _tasks/index.md
const taskParser = USE_KIRO_FORMAT
    ? new TaskParser(TASKS_DIR, { useKiroFormat: true })
    : new TaskParser(TASKS_FILE);
const scheduleParser = new ScheduleParser(SCHEDULES_DIR, { useKiroFormat: USE_KIRO_SCHEDULE_FORMAT });
const stateStore = new StateStore(STATE_FILE, BRAINBASE_ROOT);
const configParser = new ConfigParser(CODEX_PATH, CONFIG_PATH, BRAINBASE_ROOT, PROJECTS_ROOT);
const inboxParser = new InboxParser(INBOX_FILE);
const timelineStorage = new TimelineStorage(TIMELINE_DIR);

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
        res.status(500).send('Error loading page');
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
    worktreeService  // Phase 2: Archived session cleanup用
});

// Initialize State Store and restore session state
(async () => {
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
})();

// Configure Multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
        // Keep original extension
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname))
    }
});
const upload = multer({ storage: storage });

// Proxy Middleware for ttyd consoles
// Route: /console/:sessionId -> http://localhost:PORT/console/:sessionId
const ttydProxy = createProxyMiddleware({
    ws: true, // Enable WebSocket proxying
    changeOrigin: true,
    pathRewrite: function (path, req) {
        // Handle both full path (Upgrade) and stripped path (Express)
        // If it starts with /console, leave it (ttyd expects /console/SESSION_ID...)
        if (path.startsWith('/console')) {
            return path;
        }
        // Otherwise prepend /console
        return '/console' + path;
    },
    router: function (req) {
        // Handle both full path (Upgrade) and stripped path (Express)
        const url = req.url;
        const activeSessions = sessionManager.getActiveSessions();

        // 1. Try full path match: /console/SESSION_ID/...
        let match = url.match(/^\/console\/([^/]+)/);
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

        return null; // 404 if session not found
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

app.use('/api/tasks', createTaskRouter(taskParser));
app.use('/api/state', createStateRouter(stateStore, sessionManager.getActiveSessions(), TEST_MODE));
app.use('/api/config', createConfigRouter(configParser));
app.use('/api/inbox', createInboxRouter(inboxParser));
app.use('/api/schedule', createScheduleRouter(scheduleParser));
app.use('/api/timeline', createTimelineRouter(timelineStorage));
app.use('/api/sessions', createSessionRouter(sessionManager, worktreeService, stateStore, TEST_MODE));
app.use('/api/brainbase', createBrainbaseRouter({ taskParser, worktreeService, configParser }));
app.use('/api', createMiscRouter(APP_VERSION, upload.single('file'), workspaceRoot));

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
    if (USE_KIRO_FORMAT) {
        console.log(`[KIRO] Reading tasks from: ${TASKS_DIR}/{project}/tasks.md`);
    } else {
        console.log(`[YAML] Reading tasks from: ${TASKS_FILE}`);
    }
    console.log(`Reading schedules from: ${SCHEDULES_DIR}`);
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
