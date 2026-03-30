// Load environment variables from shared + local .env files
import dotenv from 'dotenv';
import os from 'os';
import express from 'express';
import cors from 'cors';
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

// Crash guards: log and keep running instead of silent death
import { logger as crashLogger } from './server/utils/logger.js';
process.on('uncaughtException', (err) => {
    crashLogger.error('[CRASH] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
    crashLogger.error('[CRASH] unhandledRejection:', reason);
});

// Import our modules
import { TaskParser } from './lib/task-parser.js';
import { ScheduleParser } from './lib/schedule-parser.js';
import { StateStore } from './lib/state-store.js';
import { ConfigParser } from './lib/config-parser.js';
import { InboxParser } from './lib/inbox-parser.js';

// Import services
import { SessionManager } from './server/services/session-manager.js';
import { TerminalTransportService } from './server/services/terminal-transport-service.js';
import { TmuxCaptureCache } from './server/services/tmux-capture-cache.js';
import { TmuxControlRegistry } from './server/services/tmux-control-registry.js';
import { WorktreeService } from './server/services/worktree-service.js';
import { InfoSSOTService } from './server/services/info-ssot-service.js';
import { AuthService } from './server/services/auth-service.js';
import { ConversationLinker } from './server/services/conversation-linker.js';

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
import { createAuthRouter } from './server/routes/auth.js';
import { createInfoSSOTRouter } from './server/routes/info-ssot.js';
import { createLearningRouter } from './server/routes/learning.js';
import { createSetupRouter } from './server/routes/setup.js';
import { createWikiRouter } from './server/routes/wiki.js';
import { GoogleCalendarService } from './server/services/google-calendar-service.js';
import { LearningService } from './server/services/learning-service.js';
import { LearningHealthService } from './server/services/learning-health-service.js';
import { WikiService } from './server/services/wiki-service.js';

// Import middleware
import { csrfMiddleware, csrfTokenHandler } from './server/middleware/csrf.js';
import { requireAuth, resolveAuthContext } from './server/middleware/auth.js';
import { errorHandler } from './server/middleware/error-handler.js';
import { gracefulCleanup } from './server/lib/graceful-cleanup.js';

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

// Worktree検知: .worktrees配下で実行されている場合は別ポートをデフォルトに
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
const DEFAULT_PORT = isWorktree ? 31014 : 31013;
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
    : path.join(__dirname, 'examples', 'codex');
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
await ensureDir(path.join(BRAINBASE_ROOT, '_tasks'));
await ensureDir(path.join(BRAINBASE_ROOT, '_inbox'));
await ensureDir(SCHEDULES_DIR);

// Initialize Modules
const taskParser = new TaskParser(TASKS_FILE);
const googleCalendarService = new GoogleCalendarService();
const scheduleParser = new ScheduleParser(SCHEDULES_DIR, { googleCalendarService });
const stateStore = new StateStore(STATE_FILE, BRAINBASE_ROOT);
const configParser = new ConfigParser(CODEX_PATH, CONFIG_PATH, BRAINBASE_ROOT, PROJECTS_ROOT);
const configService = new ConfigService(CONFIG_PATH, PROJECTS_ROOT);
const inboxParser = new InboxParser(INBOX_FILE);
const infoSSOTService = new InfoSSOTService();
const authService = new AuthService();

// Wiki Service (content stored in PostgreSQL, no filesystem dependency)
const wikiService = new WikiService({
    pool: infoSSOTService.pool  // 同じDB接続プールを共有
});
const learningService = new LearningService({
    pool: infoSSOTService.pool,
    wikiService,
    repoRoot: __dirname
});
const learningHealthService = new LearningHealthService({
    stateDir: path.join(VAR_DIR, 'learning')
});

// Middleware
// Enable CORS for local network access and remote auth/api calls (local UI -> bb.unson.jp)
app.use(cors({
    origin: true,
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token', 'X-Session-Id'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));

// Increase body-parser limit to handle large state.json (default: 100kb -> 1mb)
app.use(express.json({ limit: '10mb' }));

// Security Headers Middleware
app.use((req, res, next) => {
    // Content Security Policy
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://unpkg.com",  // unpkg.com for Lucide icons CDN
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
        // index.htmlがない場合（API専用デプロイ等）は簡単なHTMLを返す
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(`
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>brainbase Graph API Server</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
            background: linear-gradient(135deg, #0b1120 0%, #1e293b 100%);
            color: #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
            margin: 0;
        }
        .container {
            background: rgba(15, 23, 42, 0.95);
            border: 1px solid rgba(148, 163, 184, 0.2);
            border-radius: 24px;
            padding: 48px;
            max-width: 600px;
            text-align: center;
        }
        h1 {
            color: #60a5fa;
            font-size: 32px;
            margin-bottom: 16px;
        }
        p {
            color: #94a3b8;
            line-height: 1.6;
            margin-bottom: 24px;
        }
        .status {
            background: rgba(34, 197, 94, 0.2);
            border: 1px solid rgba(34, 197, 94, 0.3);
            border-radius: 12px;
            padding: 16px;
            margin: 24px 0;
            color: #4ade80;
        }
        a {
            color: #60a5fa;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🧠 brainbase Graph API Server</h1>
        <div class="status">✓ Server is running</div>
        <p>Device認証を行う場合は <a href="/device">/device</a> にアクセスしてください</p>
        <p>APIヘルスチェック: <a href="/health/ready">/health/ready</a></p>
    </div>
</body>
</html>
        `);
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

// Device Authorization Flow page (OAuth 2.0 Device Code Flow)
app.get('/device', async (req, res) => {
    try {
        const filePath = path.join(__dirname, 'public', 'device.html');
        const content = await fs.readFile(filePath, 'utf-8');

        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(content);
    } catch (error) {
        console.error('Error loading device.html:', error);
        res.status(500).send('Error loading device authorization page: ' + error.message);
    }
});

// Setup page
app.get('/setup', async (req, res) => {
    try {
        const filePath = path.join(__dirname, 'public', 'setup.html');
        const content = await fs.readFile(filePath, 'utf-8');

        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(content);
    } catch (error) {
        console.error('Error loading setup.html:', error);
        res.status(500).send('Error loading setup page: ' + error.message);
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
const tmuxCaptureCache = new TmuxCaptureCache({ sessionManager });
const tmuxControlRegistry = new TmuxControlRegistry();
const terminalTransportService = new TerminalTransportService({
    sessionManager,
    captureCache: tmuxCaptureCache,
    controlRegistry: tmuxControlRegistry
});

const conversationLinker = new ConversationLinker({ stateStore, sessionManager });

// Initialize State Store and restore session state
(async () => {
    try {
        await stateStore.init();
        await sessionManager.reconcileSessionWorkspacePaths();
        await sessionManager.restoreHookStatus();

        // Phase 3: activeセッションを復元してからcleanupを実行
        // Phase 4: TEST_MODEでは実行しない（読み取り専用）
        if (!TEST_MODE) {
            await sessionManager.restoreActiveSessions();
            await sessionManager.cleanupOrphans();
            sessionManager.startPtyWatchdog();

            // ConversationLinker: 初回実行 + 5分間隔の定期実行
            console.log('[BRAINBASE] Starting conversation linker...');
            conversationLinker.linkAll().catch(err => {
                console.error('[BRAINBASE] Initial conversation link failed:', err.message);
            });
            conversationLinker.startPeriodicLink(5 * 60 * 1000); // 5分間隔
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

function getConsoleRequestInfo(req) {
    const rawUrl = req.originalUrl || req.url || '';
    const parsed = new URL(rawUrl, 'http://localhost');
    const match = parsed.pathname.match(/^\/console\/([^/]+)/);
    return {
        sessionId: match ? match[1] : null,
        viewerId: parsed.searchParams.get('viewerId') || null
    };
}

function getConsoleProxySessionId(req) {
    const candidates = [
        req.originalUrl,
        req.baseUrl && req.url ? `${req.baseUrl}${req.url}` : null,
        req.url
    ].filter(Boolean);

    for (const candidate of candidates) {
        const parsed = new URL(candidate, 'http://localhost');
        const fullMatch = parsed.pathname.match(/^\/console\/([^/]+)/);
        if (fullMatch) {
            return fullMatch[1];
        }

        const mountedMatch = parsed.pathname.match(/^\/([^/]+)/);
        if (mountedMatch) {
            return mountedMatch[1];
        }
    }

    return null;
}

function renderTerminalBlockedHtml(terminalAccess = {}) {
    const ownerLabel = terminalAccess?.ownerViewerLabel || '別の場所';
    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terminal Blocked</title>
  <style>
    body { margin: 0; font-family: Menlo, Monaco, monospace; background: #0f172a; color: #e2e8f0; display: grid; place-items: center; min-height: 100vh; }
    .card { max-width: 520px; padding: 24px; border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 16px; background: rgba(15, 23, 42, 0.96); box-shadow: 0 20px 45px rgba(0, 0, 0, 0.28); }
    h1 { font-size: 20px; margin: 0 0 12px; }
    p { margin: 0; line-height: 1.6; color: #cbd5e1; }
    strong { color: #f8fafc; }
  </style>
</head>
<body>
  <div class="card">
    <h1>この terminal は別の viewer が使用中</h1>
    <p><strong>${ownerLabel}</strong> がこのセッションを表示中。親画面に戻って <strong>Take over</strong> してね。</p>
  </div>
</body>
</html>`;
}

function enforceTerminalOwnership(req, res, next) {
    const { sessionId, viewerId } = getConsoleRequestInfo(req);
    if (!sessionId) {
        res.status(404).send('Session not found');
        return;
    }

    if (!viewerId) {
        const terminalAccess = sessionManager.getTerminalAccessState(sessionId, viewerId);
        res.status(409).type('html').send(renderTerminalBlockedHtml(terminalAccess));
        return;
    }

    let terminalAccess = sessionManager.getTerminalAccessState(sessionId, viewerId);
    if (terminalAccess.state === 'available') {
        sessionManager.claimTerminalOwnership(sessionId, viewerId);
        terminalAccess = sessionManager.getTerminalAccessState(sessionId, viewerId);
    }

    if (terminalAccess.state === 'blocked') {
        res.status(409).type('html').send(renderTerminalBlockedHtml(terminalAccess));
        return;
    }

    sessionManager.touchTerminalOwnership(sessionId, viewerId);
    next();
}

const ttydProxy = createProxyMiddleware({
    target: 'http://127.0.0.1:1',
    ws: false, // WebSocket upgrade is handled manually in server.on('upgrade')
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
        const activeSessions = sessionManager.getActiveSessions();
        const sessionId = getConsoleProxySessionId(req);
        if (sessionId && activeSessions.has(sessionId)) {
            return `http://127.0.0.1:${activeSessions.get(sessionId).port}`;
        }

        const debugUrl = req.originalUrl || req.url;
        console.error(`[Proxy] No session found for ${debugUrl}`);
        // Return a dummy URL that will fail - http-proxy-middleware requires a valid target
        // The onError handler will catch this and return 404
        return 'http://127.0.0.1:1'; // Invalid port that will fail
    },
    onProxyReqWs: (proxyReq, req, socket, options, head) => {
        // Rewrite Origin to match the target (ttyd)
        const activeSessions = sessionManager.getActiveSessions();
        const sessionId = getConsoleProxySessionId(req);
        if (sessionId && activeSessions.has(sessionId)) {
            const port = activeSessions.get(sessionId).port;
            proxyReq.setHeader('Origin', `http://127.0.0.1:${port}`);
        }
    },
    onError: (err, req, res) => {
        console.error('Proxy Error:', err);
        if (res && res.status) {
            res.status(500).send('Proxy Error');
        }
    }
});

app.use('/console', enforceTerminalOwnership, ttydProxy);

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
app.use('/api/schedule', createScheduleRouter(scheduleParser, googleCalendarService));
app.use('/api/sessions', createSessionRouter(
    sessionManager,
    worktreeService,
    stateStore,
    TEST_MODE,
    conversationLinker,
    {
        projectsRoot: PROJECTS_ROOT,
        codeProjectsRoot: path.join(path.dirname(PROJECTS_ROOT), 'code'),
        captureCache: tmuxCaptureCache
    }
));
app.use('/api/brainbase', createBrainbaseRouter({
    taskParser,
    worktreeService,
    configParser,
    projectsRoot: PROJECTS_ROOT
}));
app.use('/api/nocodb', createNocoDBRouter(configParser));
app.use('/api/health', createHealthRouter({ sessionManager, configParser }));
app.use('/api/auth', createAuthRouter(authService));
app.use('/api/info', createInfoSSOTRouter(infoSSOTService));
app.use('/api/learning', createLearningRouter(learningService, learningHealthService));
app.use('/api/wiki', createWikiRouter(wikiService));
app.use('/api/setup', createSetupRouter(authService, infoSSOTService, configParser));
app.use('/api', createMiscRouter(APP_VERSION, upload.single('file'), workspaceRoot, UPLOADS_DIR, RUNTIME_INFO, {
    brainbaseRoot: BRAINBASE_ROOT,
    projectsRoot: PROJECTS_ROOT,
    sessionManager
}));

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
// - InboxRouter: /api/inbox
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
    console.log(`Reading tasks from: ${TASKS_FILE}`);
    console.log(`Reading schedules from: ${SCHEDULES_DIR}`);
    await writePortFiles(PORT);
});

// Handle WebSocket Upgrades
server.on('upgrade', (request, socket, head) => {
    const authResult = resolveAuthContext(request, authService);
    if (!authResult?.ok) {
        // Cloudflare Tunnel経由はZero Trustで認証済みなのでバイパス
        // localhost接続も開発環境でバイパス
        request.auth = null;
        request.access = { role: 'ceo', projectCodes: [], clearance: [], level: 3 };
        request.authSource = 'ws-bypass';
    } else {
        request.auth = authResult.auth || null;
        request.access = authResult.access || null;
        request.authSource = authResult.authSource || null;
    }

    if (terminalTransportService.isTerminalTransportRequest(request)) {
        terminalTransportService.handleUpgrade(request, socket, head);
        return;
    }

    const { sessionId, viewerId } = getConsoleRequestInfo(request);
    if (!sessionId || !viewerId) {
        socket.write('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
    }

    let terminalAccess = sessionManager.getTerminalAccessState(sessionId, viewerId);
    if (terminalAccess?.state === 'available') {
        sessionManager.claimTerminalOwnership(sessionId, viewerId);
        terminalAccess = sessionManager.getTerminalAccessState(sessionId, viewerId);
    }

    if (!terminalAccess || terminalAccess.state !== 'owner') {
        socket.write('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
    }

    sessionManager.touchTerminalOwnership(sessionId, viewerId);
    // TTYD console proxy
    ttydProxy.upgrade(request, socket, head);
});

// Graceful shutdown (CommandMate partial cleanup pattern)
async function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);

    const result = await gracefulCleanup('server-shutdown', [
        {
            name: 'close-http-server',
            fn: () => new Promise((resolve) => {
                server.close(() => {
                    console.log('HTTP server closed');
                    resolve();
                });
                // Timeout after 5s to not hang forever
                setTimeout(resolve, 5000);
            })
        },
        {
            name: 'cleanup-state-store',
            fn: async () => {
                if (stateStore.cleanup) await stateStore.cleanup();
            }
        },
        {
            name: 'stop-conversation-linker',
            fn: () => { conversationLinker.stopPeriodicLink(); }
        },
        {
            name: 'cleanup-session-manager',
            fn: async () => {
                if (sessionManager.cleanup) await sessionManager.cleanup();
            }
        },
        {
            name: 'stop-mesh-service',
            fn: async () => {
                if (meshService) await meshService.stop();
            }
        }
    ]);

    if (result.warnings.length > 0) {
        console.warn('Shutdown warnings:', result.warnings);
    }
    console.log(`Graceful shutdown complete (${result.completed.length}/${result.completed.length + result.warnings.length} steps)`);
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
