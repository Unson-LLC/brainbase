import publicContract from '../contracts/brainbase-public-contract.v1.json';
import { it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLocalMcpServer } from '../src/mcp-runtime.js';
import { createServer, toolDefinitions } from '../src/server.js';
import { createQueueTaskTools, QUEUE_TASK_TOOL_NAMES, QueueTaskToolsConfigError } from '../src/queue-task-tools.js';
import { createQueueReferenceBackend, createQueueReferenceSeed } from '../src/testing/queue-task-tools-contract.js';
it('AC-1 registers approved queue tools only when a backend is injected', async () => {
    const backend = createQueueReferenceBackend(createQueueReferenceSeed());
    const tools = createQueueTaskTools({ backend, resolveAgent: () => ({ kind: 'agent', agentId: 'A', credential: 'synthetic' }) });
    expect(tools.map(t => t.definition.name)).toEqual(QUEUE_TASK_TOOL_NAMES);
    expect(createQueueTaskTools({ resolveAgent: () => { throw new Error('must not call'); } })).toEqual([]);
    expect(() => createQueueTaskTools({ backend })).toThrow(QueueTaskToolsConfigError);
    const base = { definition: { name: 'base', inputSchema: { type: 'object' as const } }, handler: () => ({ content: [] }) };
    for (const queue of [tools, createQueueTaskTools({})]) {
        const server = createLocalMcpServer({ name: 'fixture', version: '0', tools: [base, ...queue] });
        const [a, b] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'test', version: '0' });
        try {
            await server.connect(a);
            await client.connect(b);
            expect((await client.listTools()).tools.map(t => t.name)).toEqual(['base', ...queue.map(t => t.definition.name)]);
        }
        finally {
            await client.close();
            await server.close();
        }
    }
    const localNames = publicContract.mcp.toolGroups.find(group => group.id === 'local')!.tools!.map(tool => tool.name);
    expect(toolDefinitions.map(tool => tool.name).sort()).toEqual(localNames);
    const server = createServer();
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '0' });
    try {
        await server.connect(a);
        await client.connect(b);
        const local = (await client.listTools()).tools;
        expect(local.map(tool => tool.name).sort()).toEqual(localNames);
        expect(local.some(t => QUEUE_TASK_TOOL_NAMES.includes(t.name as any))).toBe(false);
    }
    finally {
        await client.close();
        await server.close();
    }
    for (const t of tools) {
        expect(['close', 'complete']).not.toContain(t.definition.name);
        expect(t.definition.inputSchema.additionalProperties).toBe(false);
    }
});
