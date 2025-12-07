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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execPromise = util.promisify(exec);

const app = express();
const PORT = 3000;

// Configuration
const TASKS_FILE = path.join(__dirname, '../_tasks/index.md');
const SCHEDULES_DIR = path.join(__dirname, '../_schedules');
const STATE_FILE = path.join(__dirname, 'state.json');

// Initialize Modules
const taskParser = new TaskParser(TASKS_FILE);
const scheduleParser = new ScheduleParser(SCHEDULES_DIR);
const stateStore = new StateStore(STATE_FILE);

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

// Helper to get process tree
async function getSessionStatus() {
    try {
        // 1. Get all processes once (still useful for isRunning check)
        const { stdout: psOutput } = await execPromise('ps -ef');
        const lines = psOutput.split('\n').slice(1);
        const processes = lines.map(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 8) return null;
            return {
                pid: parseInt(parts[1]),
                ppid: parseInt(parts[2]),
                cmd: parts.slice(7).join(' ')
            };
        }).filter(p => p !== null);

        const status = {};

        // 2. Check each active session
        for (const [sessionId, session] of activeSessions) {
            let isRunning = false;
            let isWorking = false;

            // Priority 1: Check Hook Status
            if (sessionHookStatus.has(sessionId)) {
                const hookData = sessionHookStatus.get(sessionId);
                if (hookData.status === 'working') isWorking = true;
                // If hook says 'done', we leave isWorking=false
            }

            try {
                // Get tmux pane PID for this session
                const { stdout: tmuxPidOutput } = await execPromise(`tmux list-panes -t "${sessionId}" -F "#{pane_pid}"`);
                const shellPid = parseInt(tmuxPidOutput.trim());

                if (shellPid) {
                    // BFS to find 'claude' in descendants of the shell
                    const queue = [shellPid];
                    const visited = new Set([shellPid]);

                    while (queue.length > 0) {
                        const currentPid = queue.shift();

                        const children = processes.filter(p => p.ppid === currentPid);
                        for (const child of children) {
                            if (visited.has(child.pid)) continue;
                            visited.add(child.pid);
                            queue.push(child.pid);

                            if (child.cmd.includes('claude') || child.cmd.includes('node')) {
                                isRunning = true;
                            }
                        }
                        if (isRunning) break;
                    }
                }

                // If we don't have hook data, fallback to polling Prompt detection
                if (!sessionHookStatus.has(sessionId) && isRunning) {
                    const { stdout: paneContent } = await execPromise(`tmux capture-pane -t "${sessionId}" -p | tail -n 20`);
                    const trimmed = paneContent.trim();
                    const hasPrompt = />\s*$/.test(trimmed) || /❯\s*$/.test(trimmed) || /[$%]\s*$/.test(trimmed);
                    isWorking = !hasPrompt;
                }

            } catch (err) {
                // console.error(`[DEBUG:${sessionId}] Error: ${err.message}`);
            }

            status[sessionId] = { isRunning, isWorking };
        }
        return status;

    } catch (error) {
        console.error('Error checking process status:', error);
        return {};
    }
}

app.get('/api/sessions/status', async (req, res) => {
    const status = await getSessionStatus();
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
