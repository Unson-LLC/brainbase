#!/usr/bin/env node
/**
 * Startup guard entrypoint.
 * 1. Checks for .server-disabled marker
 * 2. Enforces single-instance via PID file lock
 * 3. Launches server.js
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Disabled check ---
const lockFile = join(__dirname, '.server-disabled');
if (existsSync(lockFile)) {
    console.error(`[BLOCKED] Server startup is disabled in this directory.`);
    console.error(`  dir: ${__dirname}`);
    console.error(`  Remove .server-disabled to unlock.`);
    process.exit(1);
}

// --- PID file single-instance guard ---
const varDir = process.env.BRAINBASE_VAR_DIR || join(__dirname, 'var');
const PID_FILE = join(varDir, 'brainbase.pid');

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0); // signal 0 = existence check
        return true;
    } catch {
        return false;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

try {
    mkdirSync(varDir, { recursive: true });

    if (existsSync(PID_FILE)) {
        const existingPid = parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10);
        if (existingPid && !isNaN(existingPid) && existingPid !== process.pid && isProcessAlive(existingPid)) {
            console.log(`[PID-LOCK] Existing brainbase server found (PID ${existingPid}). Sending SIGTERM...`);
            try { process.kill(existingPid, 'SIGTERM'); } catch { /* already dead */ }
            await sleep(3000);
            if (isProcessAlive(existingPid)) {
                console.log(`[PID-LOCK] PID ${existingPid} still alive after 3s. Sending SIGKILL...`);
                try { process.kill(existingPid, 'SIGKILL'); } catch { /* already dead */ }
                await sleep(500);
            }
            console.log(`[PID-LOCK] Previous server stopped.`);
        } else if (existingPid && !isNaN(existingPid) && !isProcessAlive(existingPid)) {
            console.log(`[PID-LOCK] Stale PID file found (PID ${existingPid} is dead). Cleaning up.`);
        }
    }

    // Write our PID
    writeFileSync(PID_FILE, String(process.pid));
    console.log(`[PID-LOCK] Acquired lock (PID ${process.pid}) -> ${PID_FILE}`);
} catch (err) {
    console.error(`[PID-LOCK] Failed to acquire PID lock:`, err.message);
    // Continue anyway — better to run without lock than to not run at all
}

// Clean up PID file on exit
function removePidFile() {
    try {
        const content = readFileSync(PID_FILE, 'utf-8').trim();
        if (content === String(process.pid)) {
            unlinkSync(PID_FILE);
        }
    } catch { /* file already gone */ }
}
process.on('exit', removePidFile);
process.on('SIGINT', () => { removePidFile(); process.exit(0); });
process.on('SIGTERM', () => { removePidFile(); process.exit(0); });

await import('./server.js');
