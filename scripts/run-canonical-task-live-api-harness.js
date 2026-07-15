#!/usr/bin/env node

import { startCanonicalTaskLiveApiHarness } from '../tests/helpers/canonical-task-live-api-harness.js';
import { execFileSync } from 'node:child_process';

const requestedPort = Number(process.env.BRAINBASE_CANONICAL_TASK_HARNESS_PORT || 0);
const harness = await startCanonicalTaskLiveApiHarness({ port: requestedPort });

const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8'
}).trim();
const runtime = {
    pid: process.pid,
    cwd: process.cwd(),
    source_head: sourceHead,
    command: process.argv.join(' '),
    base_url: harness.baseURL
};

process.stdout.write(`${JSON.stringify({ status: 'ready', ...runtime })}\n`);
if (typeof process.send === 'function') process.send({ status: 'ready', ...runtime });

let stopping = false;
async function stop() {
    if (stopping) return;
    stopping = true;
    await harness.close();
    process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await new Promise(() => {});
