import express from 'express';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import net from 'net';
import util from 'util';
import { fileURLToPath } from 'url';
import multer from 'multer';

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
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
    }
});
const upload = multer({ storage: storage });

// --- API Endpoints ---

// File Upload Endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    // Return absolute path
    const absolutePath = path.resolve(req.file.path);
    res.json({ path: absolutePath });
});

// Send Input to Session Endpoint
app.post('/api/sessions/:id/input', async (req, res) => {
    const { id } = req.params;
    const { input, type } = req.body; // type: 'text' (default) or 'key'
    
    const session = activeSessions.get(id);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    if (!input) {
        return res.status(400).json({ error: 'Input is required' });
    }

    const sendCommand = async (cmd, retries = 5) => {
        try {
            await execPromise(cmd);
        } catch (err) {
            // Check for both stdout and stderr for error messages
            const errorMsg = (err.stderr || '') + (err.stdout || '');
            if (retries > 0 && errorMsg.includes("can't find pane")) {
                console.log(`[Input] Session ${id} not ready, retrying... (${retries})`);
                await new Promise(r => setTimeout(r, 500));
                await sendCommand(cmd, retries - 1);
            } else {
                throw err;
            }
        }
    };

    try {
        if (type === 'key') {
            // Send as key command (no quotes, trust the input is a valid key)
            if (/^[a-zA-Z0-9-]+$/.test(input)) {
                await sendCommand(`tmux send-keys -t "${id}" ${input}`);
            } else {
                return res.status(400).json({ error: 'Invalid key format' });
            }
        } else {
            // Use tmux send-keys to paste the text
            const escapedInput = input.replace(/"/g, '\\"'); // Basic escaping
            await sendCommand(`tmux send-keys -t "${id}" "${escapedInput}"`);
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Failed to send input:', error);
        res.status(500).json({ error: 'Failed to send input' });
    }
});

app.get('/api/tasks', async (req, res) => {
    const tasks = await taskParser.getTasks();
    res.json(tasks);
});

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

// Helper to get process tree
async function getSessionStatus() {
    try {
        // 1. Get all processes once
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

                            // Loose matching for node/claude AND sleep for testing
                            if (child.cmd.includes('claude') || child.cmd.includes('node') || child.cmd.includes('sleep')) {
                                // console.log(`[DEBUG:${sessionId}] Found relevant process: ${child.cmd}`);
                                isRunning = true;
                            }
                        }
                        if (isRunning) break;
                    }

                    // If claude is running, check if it's working (not at prompt)
                    if (isRunning) {
                        const { stdout: paneContent } = await execPromise(`tmux capture-pane -t "${sessionId}" -p | tail -n 20`);
                        
                        const trimmed = paneContent.trim();
                        // Relaxed prompt check: > or ❯, or standard shell prompt $
                        // If it ends with > or ❯ or $ or %, we assume waiting for input
                        const hasPrompt = />\s*$/.test(trimmed) || /❯\s*$/.test(trimmed) || /[$%]\s*$/.test(trimmed);
                        isWorking = !hasPrompt;
                        
                        // Debug log 
                        console.log(`[DEBUG:${sessionId}] isWorking: ${isWorking} (Prompt found: ${hasPrompt}, Tail: "${trimmed.slice(-20)}")`);
                    } else {
                        console.log(`[DEBUG:${sessionId}] Not running claude/node/sleep`);
                    }
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
        await execPromise('pkill ttyd').catch(() => {}); // Ignore error if no processes found
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
        return res.json({ port: activeSessions.get(sessionId).port });
    }

    try {
        // Allocate new port
        const port = await findFreePort(nextPort);
        nextPort = port + 1;
        
        console.log(`Starting ttyd for session '${sessionId}' on port ${port}...`);
        if (cwd) console.log(`Working directory: ${cwd}`);
        
        // Spawn ttyd
        const scriptPath = path.join(__dirname, 'login_script.sh');
        const customIndexPath = path.join(__dirname, 'custom_ttyd_index.html');
        const args = [
            '-p', port.toString(), 
            '-W', 
            '-t', 'disableLeaveAlert=true', // Disable "Leave site?" alert
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
                res.json({ port });
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

// Start server
app.listen(PORT, async () => {
    await cleanupOrphans();
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Serving static files from ${path.join(__dirname, 'public')}`);
    console.log(`Reading tasks from: ${TASKS_FILE}`);
    console.log(`Reading schedules from: ${SCHEDULES_DIR}`);
});
