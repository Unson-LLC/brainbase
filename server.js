import express from 'express';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import net from 'net';
import util from 'util';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { readFileSync } from 'fs';

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
import { createInboxRouter } from './server/routes/inbox.js';
import { createScheduleRouter } from './server/routes/schedule.js';
import { createMiscRouter } from './server/routes/misc.js';
import { createSessionRouter } from './server/routes/sessions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execPromise = util.promisify(exec);

// Load version from package.json
const packageJson = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const APP_VERSION = `v${packageJson.version}`;

// Environment variable for root directory (supports multi-machine setups)
const BRAINBASE_ROOT = process.env.BRAINBASE_ROOT || '/Users/ksato/workspace';
console.log(`[BRAINBASE] Root directory: ${BRAINBASE_ROOT}`);

// Worktree検知: .worktrees配下で実行されている場合はport 3001をデフォルトに
const isWorktree = __dirname.includes('.worktrees');
const DEFAULT_PORT = isWorktree ? 3001 : 3000;

const app = express();
const PORT = process.env.PORT || DEFAULT_PORT;

// Configuration
const TASKS_FILE = path.join(__dirname, '_tasks/index.md');
const SCHEDULES_DIR = path.join(__dirname, '_schedules');
const STATE_FILE = path.join(__dirname, 'state.json');
const WORKTREES_DIR = path.join(BRAINBASE_ROOT, '.worktrees');
const CODEX_PATH = path.join(BRAINBASE_ROOT, '_codex');
const CONFIG_PATH = path.join(BRAINBASE_ROOT, 'config.yml');
const INBOX_FILE = path.join(BRAINBASE_ROOT, '_inbox/pending.md');

// Initialize Modules
const taskParser = new TaskParser(TASKS_FILE);
const scheduleParser = new ScheduleParser(SCHEDULES_DIR);
const stateStore = new StateStore(STATE_FILE, BRAINBASE_ROOT);
const configParser = new ConfigParser(CODEX_PATH, CONFIG_PATH, BRAINBASE_ROOT);
const inboxParser = new InboxParser(INBOX_FILE);

// Middleware
app.use(express.json());

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
const sessionManager = new SessionManager({
    serverDir: __dirname,
    execPromise,
    stateStore
});

const worktreeService = new WorktreeService(
    WORKTREES_DIR,
    BRAINBASE_ROOT, // Canonical root (environment variable or default)
    execPromise
);

// Initialize State Store and restore session state
(async () => {
    await stateStore.init();
    await sessionManager.restoreHookStatus();
    await sessionManager.cleanupOrphans();
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
const workspaceRoot = path.join(__dirname, '..');

app.use('/api/tasks', createTaskRouter(taskParser));
app.use('/api/state', createStateRouter(stateStore, sessionManager.getActiveSessions()));
app.use('/api/config', createConfigRouter(configParser));
app.use('/api/inbox', createInboxRouter(inboxParser));
app.use('/api/schedule', createScheduleRouter(scheduleParser));
app.use('/api/sessions', createSessionRouter(sessionManager, worktreeService, stateStore));
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
    await sessionManager.cleanupOrphans();
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Serving static files from ${path.join(__dirname, 'public')}`);
    console.log(`Reading tasks from: ${TASKS_FILE}`);
    console.log(`Reading schedules from: ${SCHEDULES_DIR}`);
});

// Handle WebSocket Upgrades
server.on('upgrade', ttydProxy.upgrade);
