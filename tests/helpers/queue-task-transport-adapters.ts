import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createLocalMcpServer } from '../../src/mcp-runtime.js';
import { createStreamableHttpHandler } from '../../src/streamable-http.js';
import { createQueueTaskTools } from '../../src/queue-task-tools.js';
import { createQueueReferenceBackend, type QueueTaskContractAdapter, type QueueTaskContractConnectOptions } from '../../src/testing/queue-task-tools-contract.js';
export function createStdioQueueAdapter(): QueueTaskContractAdapter {
    return { transport: 'stdio', async connect(options) {
            const root = await mkdtemp(path.join(tmpdir(), 'queue-stdio-'));
            const file = path.join(root, 'state.json');
            const client = new Client({ name: 'queue-test', version: '0.0.0' });
            const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', path.resolve('tests/fixtures/queue-task-stdio-server.ts')], env: { PATH: process.env.PATH!, QUEUE_FIXTURE_SEED: JSON.stringify(options), QUEUE_FIXTURE_STATE: file }, stderr: 'pipe' });
            try {
                await client.connect(transport);
            }
            catch (e) {
                await rm(root, { recursive: true, force: true });
                throw e;
            }
            return { listTools: async () => (await client.listTools()).tools, callTool: async (name, args) => await client.callTool({ name, arguments: args }) as CallToolResult, snapshot: async () => JSON.parse(await readFile(file, 'utf8')), close: async () => { await client.close(); await rm(root, { recursive: true, force: true }); } };
        } };
}
export async function createQueueHttpFixture(options: QueueTaskContractConnectOptions) {
    const backend = createQueueReferenceBackend(options.state);
    let created = 0;
    let closed = 0;
    let counter = 0;
    const tokens = new Map<string, AuthInfo>([['synthetic-A', { token: 'synthetic-A', clientId: 'A', scopes: [] }], ['synthetic-B', { token: 'synthetic-B', clientId: 'B', scopes: [] }]]);
    if (options.agent)
        tokens.set(`synthetic-${options.agent.agentId}`, { token: `synthetic-${options.agent.agentId}`, clientId: options.agent.agentId, scopes: [] });
    const handler = createStreamableHttpHandler<AuthInfo>({ authenticate: req => tokens.get(req.headers.authorization?.replace(/^Bearer /, '') ?? '') ?? null, createServer: scope => {
            created++;
            const bound = scope.auth?.clientId;
            const server = createLocalMcpServer({ name: 'queue-fixture', version: '0.0.0', tools: createQueueTaskTools({ backend, resolveAgent: extra => extra.authInfo?.clientId === bound && options.agent?.agentId === bound ? { kind: 'agent', ...options.agent } : null, generateKey: () => options.generatedKeys?.[counter++] ?? `generated-${counter}` }) });
            const close = server.close.bind(server);
            server.close = async () => { closed++; await close(); };
            return server;
        } });
    const server = createServer((req, res) => { void handler.handle(req, res); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as {
        port: number;
    };
    const url = new URL(`http://127.0.0.1:${address.port}/mcp`);
    return { url, handler, backend, tokens, get created() { return created; }, get closed() { return closed; }, async close() { await handler.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
export function createHttpQueueAdapter(): QueueTaskContractAdapter {
    return { transport: 'http', async connect(options) {
            const fixture = await createQueueHttpFixture(options);
            const client = new Client({ name: 'queue-test', version: '0.0.0' });
            const transport = new StreamableHTTPClientTransport(fixture.url, { requestInit: { headers: { Authorization: `Bearer synthetic-${options.agent?.agentId ?? 'A'}` } } });
            try {
                await client.connect(transport);
            }
            catch (e) {
                await fixture.close();
                throw e;
            }
            return { listTools: async () => (await client.listTools()).tools, callTool: async (name, args) => await client.callTool({ name, arguments: args }) as CallToolResult, snapshot: async () => fixture.backend.snapshot(), close: async () => { try {
                    await transport.terminateSession();
                }
                finally {
                    await client.close();
                    await fixture.close();
                } } };
        } };
}
