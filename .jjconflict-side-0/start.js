#!/usr/bin/env node
/**
 * Startup guard entrypoint.
 * Checks for .server-disabled marker before launching server.js.
 */
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const lockFile = join(__dirname, '.server-disabled');

if (existsSync(lockFile)) {
    console.error(`[BLOCKED] Server startup is disabled in this directory.`);
    console.error(`  dir: ${__dirname}`);
    console.error(`  Remove .server-disabled to unlock.`);
    process.exit(1);
}

await import('./server.js');
