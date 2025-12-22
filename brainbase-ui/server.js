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
import { createMiscRouter } from './server/routes/misc.js';
import { createSessionRouter } from './server/routes/sessions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execPromise = util.promisify(exec);

// Load version from package.json
const packageJson = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const APP_VERSION = `v${packageJson.version}`;

// Worktree検知: .worktrees配下で実行されている場合はport 3001をデフォルトに
const isWorktree = __dirname.includes('.worktrees');
const DEFAULT_PORT = isWorktree ? 3001 : 3000;

const app = express();
const PORT = process.env.PORT || DEFAULT_PORT;

// Configuration
const TASKS_FILE = path.join(__dirname, '../_tasks/index.md');
const SCHEDULES_DIR = path.join(__dirname, '../_schedules');
const STATE_FILE = path.join(__dirname, 'state.json');
const WORKTREES_DIR = path.join(__dirname, '../.worktrees');
const CODEX_PATH = path.join(__dirname, '../_codex');
const CONFIG_PATH = path.join(__dirname, '../config.yml');
const INBOX_FILE = path.join(__dirname, '../_inbox/pending.md');

// Initialize Modules
const taskParser = new TaskParser(TASKS_FILE);
const scheduleParser = new ScheduleParser(SCHEDULES_DIR);
const stateStore = new StateStore(STATE_FILE);
const configParser = new ConfigParser(CODEX_PATH, CONFIG_PATH);
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
    path.dirname(__dirname), // Canonical root (parent of current directory)
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
app.use('/api/tasks', createTaskRouter(taskParser));
app.use('/api/state', createStateRouter(stateStore, sessionManager.getActiveSessions()));
app.use('/api/config', createConfigRouter(configParser));
app.use('/api/inbox', createInboxRouter(inboxParser));
app.use('/api/sessions', createSessionRouter(sessionManager, worktreeService, stateStore));
app.use('/api', createMiscRouter(APP_VERSION, upload.single('file')));

// ========================================
// Legacy API Routes (TO BE REMOVED)
// ========================================

// [LEGACY - Replaced by TaskRouter]
// Tasks endpoints are now handled by server/routes/tasks.js
/*
app.get('/api/tasks', async (req, res) => { ... });
app.post('/api/tasks/:id', async (req, res) => { ... });
app.put('/api/tasks/:id', async (req, res) => { ... });
app.delete('/api/tasks/:id', async (req, res) => { ... });
*/

app.get('/api/schedule/today', async (req, res) => {
    const schedule = await scheduleParser.getTodaySchedule();
    res.json(schedule);
});

// [LEGACY - Replaced by MiscRouter]
// version, restart endpoints are now handled by server/routes/misc.js
/*
app.get('/api/version', (req, res) => { ... });
app.post('/api/restart', (req, res) => { ... });
*/

// [LEGACY - Replaced by StateRouter]
// state endpoints are now handled by server/routes/state.js
/*
app.get('/api/state', (req, res) => { ... });
app.post('/api/state', async (req, res) => { ... });
*/

// [LEGACY - Replaced by ConfigRouter]
// config endpoints are now handled by server/routes/config.js
/*
app.get('/api/config', async (req, res) => { ... });
app.get('/api/config/slack/workspaces', async (req, res) => { ... });
app.get('/api/config/slack/channels', async (req, res) => { ... });
app.get('/api/config/slack/members', async (req, res) => { ... });
app.get('/api/config/projects', async (req, res) => { ... });
app.get('/api/config/github', async (req, res) => { ... });
app.get('/api/config/integrity', async (req, res) => { ... });
app.get('/api/config/unified', async (req, res) => { ... });
*/

// [LEGACY - Replaced by InboxRouter]
// inbox endpoints are now handled by server/routes/inbox.js
/*
app.get('/api/inbox/pending', async (req, res) => { ... });
app.get('/api/inbox/count', async (req, res) => { ... });
app.post('/api/inbox/:id/done', async (req, res) => { ... });
app.post('/api/inbox/mark-all-done', async (req, res) => { ... });
*/

// Open file in editor (Cursor)
app.post('/api/open-file', async (req, res) => {
    try {
        const { filePath, line } = req.body;

        if (!filePath) {
            return res.status(400).json({ error: 'filePath is required' });
        }

        // Resolve relative paths from workspace root
        const workspaceRoot = path.join(__dirname, '..');
        const absolutePath = path.isAbsolute(filePath)
            ? filePath
            : path.join(workspaceRoot, filePath);

        // Build cursor command
        const lineArg = line ? `:${line}` : '';
        const command = `cursor "${absolutePath}${lineArg}"`;

        console.log(`Opening file: ${command}`);

        exec(command, (error) => {
            if (error) {
                console.error('Error opening file:', error);
            }
        });

        res.json({ success: true, path: absolutePath });
    } catch (error) {
        console.error('Error in /api/open-file:', error);
        res.status(500).json({ error: error.message });
    }
});

// ========================================
// [LEGACY - Replaced by SessionRouter]
// All Session-related endpoints and helper functions are now handled by:
// - server/services/session-manager.js
// - server/services/worktree-service.js
// - server/services/terminal-output-parser.js
// - server/controllers/session-controller.js
// - server/routes/sessions.js
// ========================================
/*
// Endpoint for hooks to report activity
app.post('/api/sessions/report_activity', async (req, res) => {
    const { sessionId, status } = req.body;
    if (!sessionId || !status) {
        return res.status(400).json({ error: 'Missing sessionId or status' });
    }

    console.log(`[Hook] Received status update from ${sessionId}: ${status}`);
    const hookStatus = {
        status,
        timestamp: Date.now()
    };

    sessionHookStatus.set(sessionId, hookStatus);

    // Persist to state.json
    const currentState = stateStore.get();
    const updatedSessions = currentState.sessions.map(session =>
        session.id === sessionId ? { ...session, hookStatus } : session
    );
    await stateStore.update({ sessions: updatedSessions });

    res.json({ success: true });
});

// Get session status from Hook reports only
function getSessionStatus() {
    const status = {};

    for (const [sessionId] of activeSessions) {
        let isWorking = false;
        let isDone = false;

        // Hook Status only - simple logic
        if (sessionHookStatus.has(sessionId)) {
            const hookData = sessionHookStatus.get(sessionId);
            if (hookData.status === 'working') isWorking = true;
            else if (hookData.status === 'done') isDone = true;
        }

        status[sessionId] = { isWorking, isDone };
    }

    return status;
}

app.get('/api/sessions/status', (req, res) => {
    const status = getSessionStatus();
    res.json(status);
});

// Helper to find a free port
function findFreePort(startPort) {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(startPort, () => {
            server.close(() => resolve(startPort));
        });
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(findFreePort(startPort + 1));
            } else {
                reject(err);
            }
        });
    });
}

// Kill all ttyd processes on startup to ensure clean state
async function cleanupOrphans() {
    try {
        console.log('Cleaning up orphaned ttyd processes...');
        await execPromise('pkill ttyd').catch(() => { }); // Ignore error if no processes found
    } catch (err) {
        console.error('Error cleaning up orphans:', err);
    }
}

// --- Worktree Management ---

// Ensure worktrees directory exists
async function ensureWorktreesDir() {
    try {
        await fs.mkdir(WORKTREES_DIR, { recursive: true });
    } catch (err) {
        console.error('Failed to create worktrees directory:', err);
    }
}

// Create a new worktree for a session
async function createWorktree(sessionId, repoPath) {
    await ensureWorktreesDir();

    const repoName = path.basename(repoPath);
    const worktreePath = path.join(WORKTREES_DIR, `${sessionId}-${repoName}`);
    const branchName = `session/${sessionId}`;

    try {
        // Check if repo is a git repository
        await execPromise(`git -C "${repoPath}" rev-parse --git-dir`);

        // Create worktree with new branch
        await execPromise(`git -C "${repoPath}" worktree add "${worktreePath}" -b "${branchName}"`);

        // Create symlink for .env if it exists in the source repo
        const sourceEnvPath = path.join(repoPath, '.env');
        const targetEnvPath = path.join(worktreePath, '.env');
        try {
            await fs.access(sourceEnvPath);
            await fs.symlink(sourceEnvPath, targetEnvPath);
            console.log(`Created .env symlink at ${targetEnvPath}`);
        } catch (envErr) {
            // .env doesn't exist or symlink failed - not critical
            if (envErr.code !== 'ENOENT') {
                console.log(`Note: Could not create .env symlink: ${envErr.message}`);
            }
        }

        // Set skip-worktree flag BEFORE creating symlinks
        // This must be done while files still exist in the worktree
        const excludePaths = ['_codex', '_tasks', '_inbox', '_schedules', '_ops', '.claude', 'config.yml'];
        const allFilesToSkip = [];

        // Collect all files first
        for (const p of excludePaths) {
            try {
                const { stdout } = await execPromise(
                    `git -C "${worktreePath}" ls-files ${p} 2>/dev/null || echo ""`
                );
                if (stdout.trim()) {
                    const files = stdout.trim().split('\n').filter(f => f.trim());
                    allFilesToSkip.push(...files);
                    console.log(`Found ${files.length} files under: ${p}`);
                }
            } catch (skipErr) {
                console.log(`Note: No files to skip-worktree under ${p}`);
            }
        }

        // Set skip-worktree for all files in batches
        if (allFilesToSkip.length > 0) {
            console.log(`Setting skip-worktree for ${allFilesToSkip.length} files...`);
            const batchSize = 100;
            for (let i = 0; i < allFilesToSkip.length; i += batchSize) {
                const batch = allFilesToSkip.slice(i, i + batchSize);
                const filesArg = batch.map(f => `"${f}"`).join(' ');
                await execPromise(
                    `git -C "${worktreePath}" update-index --skip-worktree ${filesArg}`
                );
                console.log(`Set skip-worktree for batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(allFilesToSkip.length/batchSize)} (${batch.length} files)`);
            }
            console.log(`Successfully set skip-worktree for ${allFilesToSkip.length} files`);
        }

        // Create symlinks for canonical directories (正本ディレクトリ)
        // These directories are shared across all worktrees and committed directly to main
        // IMPORTANT: 正本は常に /Users/ksato/workspace にある（プロジェクトリポジトリではない）
        const CANONICAL_ROOT = path.join(__dirname, '..');  // /Users/ksato/workspace
        const canonicalDirs = ['_codex', '_tasks', '_inbox', '_schedules', '_ops', '.claude'];
        const canonicalFiles = ['config.yml'];

        for (const dir of canonicalDirs) {
            const sourcePath = path.join(CANONICAL_ROOT, dir);
            const targetPath = path.join(worktreePath, dir);
            try {
                await fs.access(sourcePath);
                // Remove the directory/file created by worktree
                await fs.rm(targetPath, { recursive: true, force: true });
                // Create symlink to canonical path
                await fs.symlink(sourcePath, targetPath);
                console.log(`Created canonical symlink: ${dir} -> ${sourcePath}`);
            } catch (symlinkErr) {
                if (symlinkErr.code !== 'ENOENT') {
                    console.log(`Note: Could not create ${dir} symlink: ${symlinkErr.message}`);
                }
            }
        }

        for (const file of canonicalFiles) {
            const sourcePath = path.join(CANONICAL_ROOT, file);
            const targetPath = path.join(worktreePath, file);
            try {
                await fs.access(sourcePath);
                await fs.rm(targetPath, { force: true });
                await fs.symlink(sourcePath, targetPath);
                console.log(`Created canonical symlink: ${file} -> ${sourcePath}`);
            } catch (symlinkErr) {
                if (symlinkErr.code !== 'ENOENT') {
                    console.log(`Note: Could not create ${file} symlink: ${symlinkErr.message}`);
                }
            }
        }

        console.log(`Created worktree at ${worktreePath} with branch ${branchName}`);
        return { worktreePath, branchName, repoPath };
    } catch (err) {
        console.error(`Failed to create worktree for ${sessionId}:`, err.message);
        // If worktree creation fails (e.g., not a git repo), return null
        return null;
    }
}

// Remove a worktree
async function removeWorktree(sessionId, repoPath) {
    const repoName = path.basename(repoPath);
    const worktreePath = path.join(WORKTREES_DIR, `${sessionId}-${repoName}`);
    const branchName = `session/${sessionId}`;

    try {
        // Remove worktree
        await execPromise(`git -C "${repoPath}" worktree remove "${worktreePath}" --force`);
        console.log(`Removed worktree at ${worktreePath}`);

        // Delete branch
        await execPromise(`git -C "${repoPath}" branch -D "${branchName}"`).catch(() => {});
        console.log(`Deleted branch ${branchName}`);

        return true;
    } catch (err) {
        console.error(`Failed to remove worktree for ${sessionId}:`, err.message);
        return false;
    }
}

// Fix existing worktree by setting skip-worktree flags for symlinked paths
async function fixWorktreeSymlinks(sessionId, repoPath) {
    const repoName = path.basename(repoPath);
    const worktreePath = path.join(WORKTREES_DIR, `${sessionId}-${repoName}`);

    try {
        // Check if worktree exists
        await fs.access(worktreePath);

        // Set skip-worktree flag for symlinked paths
        // For existing worktrees, we need to reset the deletions first
        const excludePaths = ['_codex', '_tasks', '_inbox', '_schedules', '_ops', '.claude', 'config.yml'];
        let totalFixed = 0;

        // Get all deleted files that are in canonical paths
        const { stdout } = await execPromise(
            `git -C "${worktreePath}" diff main --name-status --diff-filter=D`
        );

        if (stdout.trim()) {
            const filesToFix = [];
            const lines = stdout.trim().split('\n');

            for (const line of lines) {
                // Format: "D\tpath/to/file"
                const match = line.match(/^D\s+(.+)$/);
                if (match) {
                    const file = match[1];
                    // Check if file is in one of the canonical paths
                    const isCanonical = excludePaths.some(p =>
                        file === p || file.startsWith(p + '/')
                    );

                    if (isCanonical) {
                        filesToFix.push(file);
                    }
                }
            }

            if (filesToFix.length > 0) {
                // Reset the deletions in index (restore files from main branch)
                const filesArg = filesToFix.map(f => `"${f}"`).join(' ');
                await execPromise(
                    `git -C "${worktreePath}" restore --source=main --staged ${filesArg}`
                );

                // Now set skip-worktree for all files
                for (const file of filesToFix) {
                    try {
                        await execPromise(
                            `git -C "${worktreePath}" update-index --skip-worktree "${file}"`
                        );
                        totalFixed++;
                    } catch (updateErr) {
                        console.log(`Note: Could not set skip-worktree for ${file}: ${updateErr.message}`);
                    }
                }
            }
        }

        console.log(`Fixed ${totalFixed} files in worktree ${sessionId}`);
        return { success: true, filesFixed: totalFixed };
    } catch (err) {
        console.error(`Failed to fix worktree symlinks for ${sessionId}:`, err.message);
        return { success: false, error: err.message };
    }
}

// Check if worktree has unmerged changes
async function getWorktreeStatus(sessionId, repoPath) {
    const repoName = path.basename(repoPath);
    const worktreePath = path.join(WORKTREES_DIR, `${sessionId}-${repoName}`);
    const branchName = `session/${sessionId}`;

    try {
        // Check if worktree exists
        await fs.access(worktreePath);

        // Get main branch name
        const { stdout: mainBranch } = await execPromise(
            `git -C "${repoPath}" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main"`
        );
        const mainBranchName = mainBranch.trim() || 'main';

        // Check if branch has commits ahead of main (use repoPath's main, not worktree's)
        // This ensures we compare against the canonical main branch, not a stale worktree reference
        const { stdout: mainCommit } = await execPromise(
            `git -C "${repoPath}" rev-parse ${mainBranchName} 2>/dev/null || echo ""`
        );
        const { stdout: headCommit } = await execPromise(
            `git -C "${worktreePath}" rev-parse HEAD 2>/dev/null || echo ""`
        );

        // Check if session branch commit is an ancestor of main (already merged)
        let ahead = 0;
        let behind = 0;
        if (mainCommit.trim() && headCommit.trim()) {
            // Check if HEAD is ancestor of main (meaning it's been merged)
            const { stdout: mergeBase } = await execPromise(
                `git -C "${repoPath}" merge-base ${mainCommit.trim()} ${headCommit.trim()} 2>/dev/null || echo ""`
            );
            if (mergeBase.trim() === headCommit.trim()) {
                // Session branch is ancestor of main = already merged
                ahead = 0;
            } else {
                // Count commits ahead
                const { stdout: aheadCount } = await execPromise(
                    `git -C "${repoPath}" rev-list --count ${mainCommit.trim()}..${headCommit.trim()} 2>/dev/null || echo "0"`
                );
                ahead = parseInt(aheadCount.trim()) || 0;
            }
        }

        // Check for uncommitted changes (excluding symlinked directories like .claude/)
        const { stdout: statusOutput } = await execPromise(
            `git -C "${worktreePath}" status --porcelain`
        );
        // Filter out symlinked directories/files (they show as deleted/typechange but are actually fine)
        const significantChanges = statusOutput.trim().split('\n').filter(line => {
            if (!line.trim()) return false;
            // Exclude .claude directory/file changes (symlink to canonical)
            // Matches: ".claude/xxx", ".claude" (standalone), "?? .claude"
            if (line.includes('.claude')) return false;
            // Exclude _codex/, _tasks/, _inbox/, _schedules/, _ops/ (all symlinked to canonical)
            // Also exclude the directory names themselves when shown as untracked
            if (line.match(/(_codex|_tasks|_inbox|_schedules|_ops)(\/|$|\s*$)/)) return false;
            // Exclude config.yml (symlinked to canonical)
            if (line.includes('config.yml')) return false;
            return true;
        });
        const hasUncommittedChanges = significantChanges.length > 0;

        return {
            exists: true,
            worktreePath,
            branchName,
            mainBranch: mainBranchName,
            commitsAhead: ahead || 0,
            commitsBehind: behind || 0,
            hasUncommittedChanges,
            needsMerge: (ahead || 0) > 0 || hasUncommittedChanges
        };
    } catch (err) {
        return {
            exists: false,
            worktreePath,
            branchName,
            needsMerge: false
        };
    }
}

// Merge worktree branch into main
async function mergeWorktree(sessionId, repoPath, sessionName = null) {
    const repoName = path.basename(repoPath);
    const worktreePath = path.join(WORKTREES_DIR, `${sessionId}-${repoName}`);
    const branchName = `session/${sessionId}`;

    try {
        // Get main branch name
        const { stdout: mainBranch } = await execPromise(
            `git -C "${repoPath}" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main"`
        );
        const mainBranchName = mainBranch.trim() || 'main';

        // Check for uncommitted changes in main repo before merge
        try {
            const { stdout: statusOutput } = await execPromise(
                `git -C "${repoPath}" status --porcelain`
            );
            if (statusOutput.trim()) {
                return {
                    success: false,
                    error: `マージ前にmainブランチの未コミット変更をコミットしてください:\n${statusOutput}`,
                    needsCommit: true
                };
            }
        } catch (statusErr) {
            console.error('Failed to check git status:', statusErr.message);
        }

        // Checkout main branch in original repo
        await execPromise(`git -C "${repoPath}" checkout ${mainBranchName}`);

        // Pre-merge conflict check (dry-run)
        try {
            await execPromise(
                `git -C "${repoPath}" merge --no-commit --no-ff ${branchName}`
            );
            // No conflicts - abort this dry-run merge
            await execPromise(`git -C "${repoPath}" merge --abort`);
        } catch (dryRunErr) {
            // Conflicts detected - abort and return error
            try {
                await execPromise(`git -C "${repoPath}" merge --abort`);
            } catch (abortErr) {
                // Ignore abort errors
            }
            return {
                success: false,
                error: `マージコンフリクトが検出されました。手動で解決してください:\n${dryRunErr.message}`,
                hasConflicts: true
            };
        }

        // Build merge message
        const displayName = sessionName || sessionId;
        const mergeMessage = `Merge session: ${displayName}`;

        // Merge session branch (actual merge)
        const { stdout: mergeOutput } = await execPromise(
            `git -C "${repoPath}" merge ${branchName} --no-ff -m "${mergeMessage}"`
        );

        console.log(`Merged ${branchName} into ${mainBranchName}`);
        return { success: true, message: mergeOutput };
    } catch (err) {
        console.error(`Failed to merge worktree for ${sessionId}:`, err.message);
        return { success: false, error: err.message };
    }
}

// Session Management API
app.post('/api/sessions/start', async (req, res) => {
    const { sessionId, initialCommand, cwd, engine = 'claude' } = req.body;

    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }

    // Validate engine
    if (!['claude', 'codex'].includes(engine)) {
        return res.status(400).json({ error: 'engine must be "claude" or "codex"' });
    }

    // Check if already running
    if (activeSessions.has(sessionId)) {
        return res.json({ port: activeSessions.get(sessionId).port, proxyPath: `/console/${sessionId}` });
    }

    try {
        // Allocate new port
        const port = await findFreePort(nextPort);
        nextPort = port + 1;

        console.log(`Starting ttyd for session '${sessionId}' on port ${port} with engine '${engine}'...`);
        if (cwd) console.log(`Working directory: ${cwd}`);

        // Spawn ttyd with Base Path
        const scriptPath = path.join(__dirname, 'login_script.sh');
        const customIndexPath = path.join(__dirname, 'custom_ttyd_index.html');
        // IMPORTANT: ttyd base path must match the proxy route
        const basePath = `/console/${sessionId}`;

        const args = [
            '-p', port.toString(),
            '-W',
            '-b', basePath, // Set Base Path
            '-t', 'disableLeaveAlert=true', // Disable "Leave site?" alert
            '-t', 'enableClipboard=true',   // Enable clipboard access for copy/paste
            '-t', 'fontSize=14',            // Readable font size for mobile
            '-t', 'fontFamily=monospace', // Use system default monospace (includes Japanese)
            '-t', 'scrollback=5000',        // Larger scrollback buffer
            '-t', 'scrollSensitivity=3',    // Touch scroll sensitivity for mobile
            // '-I', customIndexPath, // Use custom index - DISABLED: custom index overrides font settings
            'bash',
            scriptPath,
            sessionId
        ];
        if (initialCommand) {
            args.push(initialCommand);
        } else {
            args.push(''); // Empty initial command
        }
        args.push(engine); // Add engine as 3rd argument

        // Options for spawn
        const spawnOptions = {
            stdio: 'pipe'
        };

        // Set CWD if provided
        if (cwd) {
            spawnOptions.cwd = cwd;
        }

        const ttyd = spawn('ttyd', args, spawnOptions);

        ttyd.stdout.on('data', (data) => {
            console.log(`[ttyd:${sessionId}] ${data}`);
        });

        ttyd.stderr.on('data', (data) => {
            console.error(`[ttyd:${sessionId}] ${data}`);
        });

        ttyd.on('error', (err) => {
            console.error(`Failed to start ttyd for ${sessionId}:`, err);
        });

        ttyd.on('exit', (code) => {
            console.log(`ttyd for ${sessionId} exited with code ${code}`);
            activeSessions.delete(sessionId);
        });

        activeSessions.set(sessionId, { port, process: ttyd });

        // Give ttyd a moment to bind to the port and verify it's still running
        setTimeout(() => {
            if (activeSessions.has(sessionId)) {
                res.json({ port, proxyPath: basePath });
            } else {
                res.status(500).json({ error: 'Session failed to start (process exited)' });
            }
        }, 500);
    } catch (error) {
        console.error('Failed to start session:', error);
        res.status(500).json({ error: 'Failed to allocate port' });
    }
});

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('Shutting down...');
    for (const [id, session] of activeSessions) {
        console.log(`Killing ttyd for ${id}`);
        session.process.kill();
    }
    process.exit();
});

// Endpoint to send input to terminal (keys or text)
const ALLOWED_KEYS = ['M-Enter', 'C-c', 'C-d', 'C-l', 'Enter', 'Escape', 'Up', 'Down', 'Tab'];
app.post('/api/sessions/:id/input', async (req, res) => {
    const { id } = req.params;
    const { input, type } = req.body;

    if (!input) {
        return res.status(400).json({ error: 'Input required' });
    }

    try {
        if (type === 'key') {
            if (!ALLOWED_KEYS.includes(input)) {
                return res.status(400).json({ error: 'Key not allowed' });
            }
            await execPromise(`tmux send-keys -t "${id}" ${input}`);
        } else if (type === 'text') {
            // Use -l for literal text (don't interpret special keys)
            // Escape double quotes in input
            const escaped = input.replace(/"/g, '\\"');
            await execPromise(`tmux send-keys -t "${id}" -l "${escaped}"`);
        } else {
            return res.status(400).json({ error: 'Type must be key or text' });
        }
        res.json({ success: true });
    } catch (err) {
        console.error(`Failed to send input to ${id}:`, err.message);
        res.status(500).json({ error: 'Failed to send input' });
    }
});

// [LEGACY - Replaced by MiscRouter]
// upload endpoint is now handled by server/routes/misc.js
// app.post('/api/upload', upload.single('file'), async (req, res) => { ... });

// Endpoint to get terminal content (history)
app.get('/api/sessions/:id/content', async (req, res) => {
    const { id } = req.params;
    const lines = parseInt(req.query.lines) || 500;

    // We can run tmux capture-pane even if activeSessions doesn't track it locally
    // (e.g. if server restarted but tmux session is alive)
    // But checking activeSessions is good practice if we only want managed sessions.
    // For now, let's just try running the command.

    try {
        const { stdout } = await execPromise(`tmux capture-pane -t "${id}" -p -S -${lines}`);
        res.json({ content: stdout });
    } catch (err) {
        // console.error(`Failed to capture pane for ${id}:`, err.message);
        res.status(500).json({ error: 'Failed to capture content' });
    }
});

// Phase 3.1: Get terminal output with choice detection
app.get('/api/sessions/:id/output', async (req, res) => {
    const { id } = req.params;

    try {
        // -S -100: 最後100行の履歴を取得（選択肢がスクロールで上に行っても検出可能）
        // -J: 行の継続を結合
        const { stdout } = await execPromise(`tmux capture-pane -t "${id}" -p -J -S -100`);
        const choices = detectChoices(stdout);

        res.json({
            output: stdout,
            choices: choices,
            hasChoices: choices.length > 0
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Detect numbered choices in terminal output (Phase 3.1)
// @param {string} text - Terminal output text
// @returns {Array} Array of choice objects
function detectChoices(text) {
    // Check the last 30 lines of output to capture choices and prompt
    const lines = text.split('\n');
    const lastLines = lines.slice(-30).join('\n');

    // Strict check: only detect choices if "Enter to select" prompt is present
    if (!lastLines.includes('Enter to select')) {
        return [];
    }

    const choices = [];

    // Pattern 1: "1) Option" or "1. Option"
    // Also matches with selection marker: "❯ 1. Option" or "  1. Option"
    const pattern1 = /^\s*[❯>]?\s*(\d+)[).]\s+(.+)$/gm;
    let match;
    while ((match = pattern1.exec(lastLines)) !== null) {
        choices.push({
            number: match[1],
            text: match[2].trim(),
            originalText: match[0].trim(), // Claude Codeの出力をそのまま保持
            pattern: 'numbered'
        });
    }

    // Only return if we have sequential numbers starting from 1
    // and at least 2 choices
    if (choices.length >= 2) {
        const numbers = choices.map(c => parseInt(c.number));
        const isSequential = numbers.every((num, idx) =>
            idx === 0 || num === numbers[idx - 1] + 1
        );
        const startsFromOne = numbers[0] === 1;

        if (isSequential && startsFromOne) {
            return choices;
        }
    }

    return [];
}

// --- Worktree API Endpoints ---

// Create session with worktree
app.post('/api/sessions/create-with-worktree', async (req, res) => {
    const { sessionId, repoPath, name, initialCommand, engine = 'claude' } = req.body;

    if (!sessionId || !repoPath) {
        return res.status(400).json({ error: 'sessionId and repoPath are required' });
    }

    // Validate engine
    if (!['claude', 'codex'].includes(engine)) {
        return res.status(400).json({ error: 'engine must be "claude" or "codex"' });
    }

    try {
        // Create worktree
        const worktreeResult = await createWorktree(sessionId, repoPath);

        if (!worktreeResult) {
            return res.status(500).json({ error: 'Failed to create worktree. Is this a git repository?' });
        }

        const { worktreePath, branchName } = worktreeResult;

        // Start ttyd session with worktree as cwd
        const port = await findFreePort(nextPort);
        nextPort = port + 1;

        console.log(`Starting ttyd for session '${sessionId}' on port ${port} with worktree and engine '${engine}'...`);

        const scriptPath = path.join(__dirname, 'login_script.sh');
        const customIndexPath = path.join(__dirname, 'custom_ttyd_index.html');
        const basePath = `/console/${sessionId}`;

        const args = [
            '-p', port.toString(),
            '-W',
            '-b', basePath,
            '-t', 'disableLeaveAlert=true',
            '-t', 'enableClipboard=true',
            '-t', 'fontSize=14',            // Readable font size for mobile
            '-t', 'fontFamily=monospace', // Use system default monospace (includes Japanese)
            '-t', 'scrollback=5000',        // Larger scrollback buffer
            '-t', 'scrollSensitivity=3',    // Touch scroll sensitivity for mobile
            // '-I', customIndexPath, // Use custom index - DISABLED: custom index overrides font settings
            'bash',
            scriptPath,
            sessionId
        ];
        if (initialCommand) {
            args.push(initialCommand);
        } else {
            args.push(''); // Empty initial command
        }
        args.push(engine); // Add engine as 3rd argument

        const ttyd = spawn('ttyd', args, { stdio: 'pipe', cwd: worktreePath });

        ttyd.stdout.on('data', (data) => {
            console.log(`[ttyd:${sessionId}] ${data}`);
        });

        ttyd.stderr.on('data', (data) => {
            console.error(`[ttyd:${sessionId}] ${data}`);
        });

        ttyd.on('error', (err) => {
            console.error(`Failed to start ttyd for ${sessionId}:`, err);
        });

        ttyd.on('exit', (code) => {
            console.log(`ttyd for ${sessionId} exited with code ${code}`);
            activeSessions.delete(sessionId);
        });

        activeSessions.set(sessionId, { port, process: ttyd });

        // Update state with worktree info
        const currentState = stateStore.get();
        const newSession = {
            id: sessionId,
            name: name || sessionId,
            engine,  // claude or codex
            path: worktreePath,
            initialCommand,
            worktree: {
                repo: repoPath,
                branch: branchName
            },
            intendedState: 'active',
            hookStatus: null,
            created: new Date().toISOString()
        };

        const updatedSessions = [...(currentState.sessions || []), newSession];
        await stateStore.update({ sessions: updatedSessions });

        setTimeout(() => {
            if (activeSessions.has(sessionId)) {
                res.json({
                    port,
                    proxyPath: basePath,
                    worktreePath,
                    branchName,
                    session: newSession
                });
            } else {
                // Cleanup worktree if session failed
                removeWorktree(sessionId, repoPath);
                res.status(500).json({ error: 'Session failed to start' });
            }
        }, 500);

    } catch (error) {
        console.error('Failed to create session with worktree:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get worktree status for a session
app.get('/api/sessions/:id/worktree-status', async (req, res) => {
    const { id } = req.params;

    // Get session from state
    const state = stateStore.get();
    const session = state.sessions?.find(s => s.id === id);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.worktree) {
        return res.json({ hasWorktree: false });
    }

    const status = await getWorktreeStatus(id, session.worktree.repo);
    res.json({ hasWorktree: true, ...status });
});

// Fix worktree symlinks for a session (apply skip-worktree to existing worktrees)
app.post('/api/sessions/:id/fix-symlinks', async (req, res) => {
    const { id } = req.params;

    // Get session from state
    const state = stateStore.get();
    const session = state.sessions?.find(s => s.id === id);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.worktree) {
        return res.status(400).json({ error: 'Session does not have a worktree' });
    }

    const result = await fixWorktreeSymlinks(id, session.worktree.repo);
    res.json(result);
});

// Merge worktree for a session
app.post('/api/sessions/:id/merge', async (req, res) => {
    const { id } = req.params;

    // Get session from state
    const state = stateStore.get();
    const session = state.sessions?.find(s => s.id === id);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.worktree) {
        return res.status(400).json({ error: 'Session does not have a worktree' });
    }

    // Check for uncommitted changes before merge
    const status = await getWorktreeStatus(id, session.worktree.repo);
    if (status.hasUncommittedChanges) {
        return res.status(400).json({
            success: false,
            error: '未コミットの変更があります。先にコミットしてください。',
            hasUncommittedChanges: true
        });
    }

    // Check if there are any commits to merge
    if (status.commitsAhead === 0) {
        return res.json({
            success: true,
            message: 'マージする変更がありません',
            noChanges: true
        });
    }

    const result = await mergeWorktree(id, session.worktree.repo, session.name);

    if (result.success) {
        // Update session state to mark as merged
        const updatedSessions = state.sessions.map(s =>
            s.id === id ? { ...s, worktree: { ...s.worktree, merged: true } } : s
        );
        await stateStore.update({ sessions: updatedSessions });
    }

    res.json(result);
});

// Delete worktree for a session
app.delete('/api/sessions/:id/worktree', async (req, res) => {
    const { id } = req.params;

    // Get session from state
    const state = stateStore.get();
    const session = state.sessions?.find(s => s.id === id);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (!session.worktree) {
        return res.json({ success: true, message: 'No worktree to remove' });
    }

    const success = await removeWorktree(id, session.worktree.repo);

    if (success) {
        // Remove worktree info from session, keep session for reference
        const updatedSessions = state.sessions.map(s =>
            s.id === id ? { ...s, worktree: null, path: s.worktree.repo } : s
        );
        await stateStore.update({ sessions: updatedSessions });
    }

    res.json({ success });
});

// Stop ttyd process for a session
async function stopTtydProcess(sessionId) {
    if (activeSessions.has(sessionId)) {
        const sessionData = activeSessions.get(sessionId);
        console.log(`Stopping ttyd process for session ${sessionId} (port ${sessionData.port})`);

        try {
            sessionData.process.kill('SIGTERM');
            // Give it a moment to terminate gracefully
            await new Promise(resolve => setTimeout(resolve, 500));

            // Force kill if still running
            if (!sessionData.process.killed) {
                sessionData.process.kill('SIGKILL');
            }
        } catch (err) {
            console.error(`Error killing ttyd process for ${sessionId}:`, err.message);
        }

        activeSessions.delete(sessionId);
        sessionHookStatus.delete(sessionId);
        return true;
    }
    return false;
}

// Archive session (with optional merge check)
app.post('/api/sessions/:id/archive', async (req, res) => {
    const { id } = req.params;
    const { skipMergeCheck } = req.body;

    const state = stateStore.get();
    const session = state.sessions?.find(s => s.id === id);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    // Check if worktree needs merge
    if (session.worktree && !skipMergeCheck) {
        const status = await getWorktreeStatus(id, session.worktree.repo);
        if (status.needsMerge) {
            return res.json({
                needsConfirmation: true,
                status,
                message: 'Session has unmerged changes'
            });
        }
    }

    // Stop ttyd process first (release port)
    const ttydStopped = await stopTtydProcess(id);
    console.log(`ttyd process stopped for ${id}: ${ttydStopped}`);

    // Remove worktree if exists
    if (session.worktree) {
        await removeWorktree(id, session.worktree.repo);
    }

    // Archive session (keep worktree info for potential restore)
    const updatedSessions = state.sessions.map(s =>
        s.id === id ? {
            ...s,
            intendedState: 'archived',
            // Keep worktree.repo for restore, but mark as removed
            worktree: s.worktree ? { ...s.worktree, removed: true } : null
        } : s
    );
    await stateStore.update({ sessions: updatedSessions });

    res.json({ success: true, archived: true, ttydStopped });
});

// Restore (unarchive) session - restarts ttyd process
app.post('/api/sessions/:id/restore', async (req, res) => {
    const { id } = req.params;
    const { engine = 'claude' } = req.body;

    const state = stateStore.get();
    const session = state.sessions?.find(s => s.id === id);

    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (session.intendedState !== 'archived') {
        // Check if ttyd is already running
        if (activeSessions.has(id)) {
            return res.json({
                success: true,
                alreadyRunning: true,
                port: activeSessions.get(id).port,
                proxyPath: `/console/${id}`
            });
        }
    }

    // Determine working directory
    let cwd = session.path;
    let worktreeRecreated = false;

    if (session.worktree && session.worktree.repo) {
        // Worktree was removed on archive, recreate it
        const worktreeResult = await createWorktree(id, session.worktree.repo);
        if (worktreeResult) {
            cwd = worktreeResult.worktreePath;
            worktreeRecreated = true;

            // Update session with new worktree path
            const currentState = stateStore.get();
            const updatedSessions = currentState.sessions.map(s =>
                s.id === id ? {
                    ...s,
                    path: cwd,
                    worktree: { ...s.worktree, removed: false }
                } : s
            );
            await stateStore.update({ sessions: updatedSessions });
        }
    } else if (!cwd || cwd.includes('.worktrees')) {
        // Path was a worktree but worktree info is lost - cannot restore
        return res.status(400).json({
            error: 'Cannot restore session: worktree information is missing. Please create a new session.'
        });
    }

    // Verify cwd exists
    try {
        await fs.access(cwd);
    } catch (err) {
        return res.status(400).json({ error: `Working directory not found: ${cwd}` });
    }

    // Start ttyd process
    try {
        const port = await findFreePort(nextPort);
        nextPort = port + 1;

        console.log(`Restoring session '${id}' on port ${port}...`);

        const scriptPath = path.join(__dirname, 'login_script.sh');
        const customIndexPath = path.join(__dirname, 'custom_ttyd_index.html');
        const basePath = `/console/${id}`;

        const args = [
            '-p', port.toString(),
            '-W',
            '-b', basePath,
            '-t', 'disableLeaveAlert=true',
            '-t', 'enableClipboard=true',
            '-t', 'fontSize=14',
            '-t', 'fontFamily=monospace', // Use system default monospace (includes Japanese)
            '-t', 'scrollback=5000',
            '-t', 'scrollSensitivity=3',
            // '-I', customIndexPath, // Use custom index - DISABLED: custom index overrides font settings
            'bash',
            scriptPath,
            id,
            '', // Empty initial command (use claude --resume in login_script)
            session.engine || engine
        ];

        const ttyd = spawn('ttyd', args, { stdio: 'pipe', cwd });

        ttyd.stdout.on('data', (data) => {
            console.log(`[ttyd:${id}] ${data}`);
        });

        ttyd.stderr.on('data', (data) => {
            console.error(`[ttyd:${id}] ${data}`);
        });

        ttyd.on('error', (err) => {
            console.error(`Failed to start ttyd for ${id}:`, err);
        });

        ttyd.on('exit', (code) => {
            console.log(`ttyd for ${id} exited with code ${code}`);
            activeSessions.delete(id);
        });

        activeSessions.set(id, { port, process: ttyd });

        // Update session state
        const updatedSessions = state.sessions.map(s =>
            s.id === id ? { ...s, intendedState: 'active' } : s
        );
        await stateStore.update({ sessions: updatedSessions });

        setTimeout(() => {
            if (activeSessions.has(id)) {
                res.json({
                    success: true,
                    port,
                    proxyPath: basePath,
                    restored: true,
                    worktreeRecreated,
                    cwd
                });
            } else {
                res.status(500).json({ error: 'Failed to restore session (process exited)' });
            }
        }, 500);

    } catch (error) {
        console.error('Failed to restore session:', error);
        res.status(500).json({ error: error.message });
    }
});

// Stop ttyd process only (without archiving)
app.post('/api/sessions/:id/stop', async (req, res) => {
    const { id } = req.params;

    const stopped = await stopTtydProcess(id);

    if (stopped) {
        // Update intendedState to 'stopped'
        const currentState = stateStore.get();
        const updatedSessions = currentState.sessions.map(session =>
            session.id === id ? { ...session, intendedState: 'stopped' } : session
        );
        await stateStore.update({ sessions: updatedSessions });

        res.json({ success: true, message: `ttyd process for ${id} stopped` });
    } else {
        res.json({ success: false, message: `No active ttyd process found for ${id}` });
    }
});
*/
// ========================================
// End of Legacy Session Code
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
