#!/usr/bin/env node

import { startCanonicalTaskLiveApiHarness } from '../tests/helpers/canonical-task-live-api-harness.js';

const requestedPort = Number(process.env.BRAINBASE_CANONICAL_TASK_HARNESS_PORT || 0);
const harness = await startCanonicalTaskLiveApiHarness({ port: requestedPort });

process.stdout.write(`${JSON.stringify({ status: 'ready', base_url: harness.baseURL })}\n`);

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
