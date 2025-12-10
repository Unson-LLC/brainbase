import express from 'express';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import net from 'net';
import util from 'util';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { createProxyMiddleware } from 'http-proxy-middleware';

// Import our modules
import { TaskParser } from './lib/task-parser.js';
import { ScheduleParser } from './lib/schedule-parser.js';
import { StateStore } from './lib/state-store.js';
import { ConfigParser } from './lib/config-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execPromise = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const TASKS_FILE = path.join(__dirname, '../_tasks/index.md');
const SCHEDULES_DIR = path.join(__dirname, '../_schedules');
const STATE_FILE = path.join(__dirname, 'state.json');
const WORKTREES_DIR = path.join(__dirname, '../.worktrees');
const CODEX_PATH = path.join(__dirname, '../_codex');
const CONFIG_PATH = path.join(__dirname, '../config.yml');

// Initialize Modules
const taskParser = new TaskParser(TASKS_FILE);
const scheduleParser = new ScheduleParser(SCHEDULES_DIR);
const stateStore = new StateStore(STATE_FILE);
const configParser = new ConfigParser(CODEX_PATH, CONFIG_PATH);

// Middleware
app.use(express.static('public'));
app.use(express.json());

// State
let activeSessions = new Map(); // sessionId -> { port, process }
let sessionHookStatus = new Map(); // sessionId -> { status: 'working'|'done', timestamp: number }
let nextPort = 3001;

// Initialize State Store
stateStore.init();

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


// API Routes
app.get('/api/tasks', async (req, res) => {
    const tasks = await taskParser.getAllTasks();
    res.json(tasks);
});

app.post('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const success = await taskParser.updateTask(id, updates);
    if (success) {
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Task not found or update failed' });
    }
});

// PUT endpoint for updating tasks (client uses PUT)
app.put('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const success = await taskParser.updateTask(id, updates);
    if (success) {
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Task not found or update failed' });
    }
});

// DELETE endpoint for removing tasks
app.delete('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const success = await taskParser.deleteTask(id);
    if (success) {
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Task not found or delete failed' });
    }
});

app.get('/api/schedule/today', async (req, res) => {
    const schedule = await scheduleParser.getTodaySchedule();
    res.json(schedule);
});

app.get('/api/state', (req, res) => {
    res.json(stateStore.get());
});

app.post('/api/state', async (req, res) => {
    const newState = await stateStore.update(req.body);
    res.json(newState);
});

// --- Config API ---

// Get all config (Slack + Projects)
app.get('/api/config', async (req, res) => {
    const config = await configParser.getAll();
    res.json(config);
});

// Get Slack workspaces
app.get('/api/config/slack/workspaces', async (req, res) => {
    const workspaces = await configParser.getWorkspaces();
    res.json(workspaces);
});

// Get Slack channels
app.get('/api/config/slack/channels', async (req, res) => {
    const channels = await configParser.getChannels();
    res.json(channels);
});

// Get Slack members
app.get('/api/config/slack/members', async (req, res) => {
    const members = await configParser.getMembers();
    res.json(members);
});

// Get projects from config.yml
app.get('/api/config/projects', async (req, res) => {
    const projects = await configParser.getProjects();
    res.json(projects);
});

// Get GitHub mappings from config.yml
app.get('/api/config/github', async (req, res) => {
    const github = await configParser.getGitHubMappings();
    res.json(github);
});

// Check integrity
app.get('/api/config/integrity', async (req, res) => {
    const result = await configParser.checkIntegrity();
    res.json(result);
});

// Endpoint for hooks to report activity
app.post('/api/sessions/report_activity', (req, res) => {
    const { sessionId, status } = req.body;
    if (!sessionId || !status) {
        return res.status(400).json({ error: 'Missing sessionId or status' });
    }

    console.log(`[Hook] Received status update from ${sessionId}: ${status}`);
    sessionHookStatus.set(sessionId, {
        status,
        timestamp: Date.now()
    });

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

        // Create symlinks for canonical directories (正本ディレクトリ)
        // These directories are shared across all worktrees and committed directly to main
        const canonicalDirs = ['_codex', '_tasks', '_inbox', '_schedules', '_ops', '.claude'];
        const canonicalFiles = ['config.yml'];

        for (const dir of canonicalDirs) {
            const sourcePath = path.join(repoPath, dir);
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
            const sourcePath = path.join(repoPath, file);
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
        // Filter out symlinked directories (they show as deleted but are actually fine)
        const significantChanges = statusOutput.trim().split('\n').filter(line => {
            if (!line.trim()) return false;
            // Exclude .claude/ directory changes (symlink to canonical)
            if (line.includes('.claude/')) return false;
            // Exclude _codex/, _tasks/, _inbox/, _schedules/, _ops/ (all symlinked)
            if (line.match(/\s(_codex|_tasks|_inbox|_schedules|_ops)\//)) return false;
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
    const { sessionId, initialCommand, cwd } = req.body;

    if (!sessionId) {
        return res.status(400).json({ error: 'sessionId is required' });
    }

    // Check if already running
    if (activeSessions.has(sessionId)) {
        return res.json({ port: activeSessions.get(sessionId).port, proxyPath: `/console/${sessionId}` });
    }

    try {
        // Allocate new port
        const port = await findFreePort(nextPort);
        nextPort = port + 1;

        console.log(`Starting ttyd for session '${sessionId}' on port ${port}...`);
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
            '-I', customIndexPath, // Use custom index
            'bash',
            scriptPath,
            sessionId
        ];
        if (initialCommand) {
            args.push(initialCommand);
        }

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
const ALLOWED_KEYS = ['M-Enter', 'C-c', 'C-d', 'Enter', 'Escape'];
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

// File Upload Endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const absolutePath = path.resolve(__dirname, 'uploads', req.file.filename);
    res.json({ path: absolutePath, filename: req.file.filename });
});

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

// --- Worktree API Endpoints ---

// Create session with worktree
app.post('/api/sessions/create-with-worktree', async (req, res) => {
    const { sessionId, repoPath, name, initialCommand } = req.body;

    if (!sessionId || !repoPath) {
        return res.status(400).json({ error: 'sessionId and repoPath are required' });
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

        console.log(`Starting ttyd for session '${sessionId}' on port ${port} with worktree...`);

        const scriptPath = path.join(__dirname, 'login_script.sh');
        const customIndexPath = path.join(__dirname, 'custom_ttyd_index.html');
        const basePath = `/console/${sessionId}`;

        const args = [
            '-p', port.toString(),
            '-W',
            '-b', basePath,
            '-t', 'disableLeaveAlert=true',
            '-t', 'enableClipboard=true',
            '-I', customIndexPath,
            'bash',
            scriptPath,
            sessionId
        ];
        if (initialCommand) {
            args.push(initialCommand);
        }

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
            path: worktreePath,
            initialCommand,
            worktree: {
                repo: repoPath,
                branch: branchName
            },
            archived: false,
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

    // Remove worktree if exists
    if (session.worktree) {
        await removeWorktree(id, session.worktree.repo);
    }

    // Archive session
    const updatedSessions = state.sessions.map(s =>
        s.id === id ? { ...s, archived: true, worktree: null } : s
    );
    await stateStore.update({ sessions: updatedSessions });

    res.json({ success: true, archived: true });
});

// Start server
const server = app.listen(PORT, async () => {
    await cleanupOrphans();
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Serving static files from ${path.join(__dirname, 'public')}`);
    console.log(`Reading tasks from: ${TASKS_FILE}`);
    console.log(`Reading schedules from: ${SCHEDULES_DIR}`);
});

// Handle WebSocket Upgrades
server.on('upgrade', ttydProxy.upgrade);
