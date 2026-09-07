#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);

export function supportedNodeVersion(nodeVersion) {
    const majorVersion = Number.parseInt(nodeVersion.split('.')[0], 10);
    return majorVersion >= 20 && majorVersion <= 22;
}

export function vitestExecArguments(executablePath, args) {
    return [executablePath, ...args];
}

function run() {
    if (!supportedNodeVersion(process.versions.node)) {
        console.error(`Unsupported Node.js ${process.versions.node}. Use Node.js 20-22 (the repository pins 22.23.2).`);
        process.exitCode = 1;
        return;
    }

    const vitestPath = path.resolve(path.dirname(scriptPath), '../node_modules/vitest/vitest.mjs');
    const child = spawn(
        process.execPath,
        vitestExecArguments(vitestPath, process.argv.slice(2)),
        { env: process.env, stdio: 'inherit' }
    );

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => child.kill(signal));
    }

    child.once('error', (error) => {
        console.error(`Failed to start Vitest: ${error.message}`);
        process.exitCode = 1;
    });
    child.once('exit', (code, signal) => {
        process.exitCode = signal ? 1 : (code ?? 1);
    });
}

if (path.resolve(process.argv[1] || '') === scriptPath) {
    run();
}
