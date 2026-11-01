import { writeFileSync, renameSync } from 'node:fs';
import { createQueueReferenceBackend } from '../../src/testing/queue-task-reference-backend.js';
import { createQueueTaskTools } from '../../src/queue-task-tools.js';
import { runLocalMcpServer } from '../../src/mcp-runtime.js';
const options = JSON.parse(process.env.QUEUE_FIXTURE_SEED!);
const file = process.env.QUEUE_FIXTURE_STATE!;
function save(state: unknown) { writeFileSync(`${file}.tmp`, JSON.stringify(state)); renameSync(`${file}.tmp`, file); }
const backend = createQueueReferenceBackend(options.state, { onChange: save });
save(backend.snapshot());
let counter = 0;
await runLocalMcpServer({ name: 'queue-fixture', version: '0.0.0', tools: createQueueTaskTools({ backend, resolveAgent: () => options.agent ? { kind: 'agent', ...options.agent } : null, generateKey: () => options.generatedKeys?.[counter++] ?? `generated-${counter}` }) });
