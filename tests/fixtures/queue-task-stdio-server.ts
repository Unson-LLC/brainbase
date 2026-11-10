import { writeFileSync, renameSync } from 'node:fs';
import { createQueueReferenceBackend } from '../../src/testing/queue-task-reference-backend.js';
import { createQueueTaskTools } from '../../src/queue-task-tools.js';
import { runLocalMcpServer } from '../../src/mcp-runtime.js';
const options = JSON.parse(process.env.QUEUE_FIXTURE_SEED!);
const file = process.env.QUEUE_FIXTURE_STATE!;
function save(state: unknown) {
    writeFileSync(`${file}.tmp`, JSON.stringify(state));
    renameSync(`${file}.tmp`, file);
}
const backend = createQueueReferenceBackend(options.state, {
    onChange: save,
    expectedAgentCredentials: options.agent ? { [options.agent.agentId]: options.agent.credential } : {},
});
save(backend.snapshot());
const hostCredentials = { agent: options.agent, sharedServiceToken: options.sharedServiceToken };
let counter = 0;
await runLocalMcpServer({
    name: 'queue-fixture',
    version: '0.0.0',
    tools: createQueueTaskTools({
        backend,
        resolveAgent: () => (hostCredentials.agent ? { kind: 'agent', ...hostCredentials.agent } : null),
        generateKey: () => options.generatedKeys?.[counter++] ?? `generated-${counter}`,
    }),
});
