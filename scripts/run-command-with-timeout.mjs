#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);

export function runCommandWithTimeout(command, args, options = {}) {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const stdio = options.stdio ?? 'inherit';

    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { env: options.env ?? process.env, stdio });
        let timedOut = false;
        let forceKillTimer;

        const timeout = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 1_000);
            forceKillTimer.unref();
        }, timeoutMs);
        timeout.unref();

        child.once('error', (error) => {
            clearTimeout(timeout);
            if (forceKillTimer) clearTimeout(forceKillTimer);
            reject(error);
        });
        child.once('exit', (code, signal) => {
            clearTimeout(timeout);
            if (forceKillTimer) clearTimeout(forceKillTimer);
            resolve({ exitCode: timedOut ? 124 : (code ?? 1), signal, timedOut });
        });
    });
}

async function runCli() {
    const separatorIndex = process.argv.indexOf('--');
    const timeoutIndex = process.argv.indexOf('--timeout-ms');
    const timeoutMs = timeoutIndex === -1 ? 10_000 : Number(process.argv[timeoutIndex + 1]);
    const command = separatorIndex === -1 ? undefined : process.argv[separatorIndex + 1];
    const args = separatorIndex === -1 ? [] : process.argv.slice(separatorIndex + 2);

    if (!command || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        console.error('Usage: run-command-with-timeout.mjs --timeout-ms <milliseconds> -- <command> [args...]');
        process.exitCode = 2;
        return;
    }

    try {
        const result = await runCommandWithTimeout(command, args, { timeoutMs });
        if (result.timedOut) {
            console.error(`Command timed out after ${timeoutMs}ms: ${command}`);
        }
        process.exitCode = result.exitCode;
    } catch (error) {
        console.error(`Failed to run ${command}: ${error.message}`);
        process.exitCode = 1;
    }
}

if (path.resolve(process.argv[1] || '') === scriptPath) {
    await runCli();
}
