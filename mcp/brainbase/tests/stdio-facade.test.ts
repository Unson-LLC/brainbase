import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { Transport, TransportSendOptions } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  McpError,
  type CallToolResult,
  type JSONRPCMessage,
} from '@modelcontextprotocol/sdk/types.js';

import {
  BackendReadinessError,
  BackendSession,
  ChildProcessTransport,
  createFacadeServer,
} from '../src/stdio-facade.js';
import type { BackendClient, BackendProcessParameters } from '../src/stdio-facade.js';

class FakeTransport implements Transport {
  closeCalls = 0;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  async start(): Promise<void> {}

  async send(_message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {}

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.onclose?.();
  }
}

interface FakeClientState {
  connectCalls: number;
  closeCalls: number;
  callToolCalls: number;
}

function makeFakeClient(
  state: FakeClientState,
  connectAction: (transport: Transport, options?: RequestOptions) => Promise<void>,
  callTool: () => Promise<CallToolResult> = async () => ({
    content: [{ type: 'text', text: 'backend result' }],
  }),
): BackendClient {
  const client = {
    connect: async (transport: Transport, options?: RequestOptions) => {
      state.connectCalls += 1;
      return connectAction(transport, options);
    },
    close: async () => {
      state.closeCalls += 1;
    },
    listResources: async () => ({ resources: [] }),
    listResourceTemplates: async () => ({ resourceTemplates: [] }),
    readResource: async () => ({ contents: [] }),
    callTool: async () => {
      state.callToolCalls += 1;
      return callTool();
    },
  };
  return client as unknown as BackendClient;
}

async function connectFacade(backend: Pick<BackendSession, 'ensureReady'>, tools = undefined) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createFacadeServer(backend, tools ? { tools } : undefined);
  const client = new Client({ name: 'stdio-facade-test', version: '1' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

async function closeFacade(client: Client, server: { close(): Promise<void> }): Promise<void> {
  await client.close().catch(() => undefined);
  await server.close().catch(() => undefined);
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for test state');
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

test('initialize, tools/list, and resource template discovery do not wait for backend startup', async () => {
  const state: FakeClientState = {
    connectCalls: 0,
    closeCalls: 0,
    callToolCalls: 0,
  };
  let release!: () => void;
  const connectGate = new Promise<void>((resolve) => { release = resolve; });
  const transport = new FakeTransport();
  const client = makeFakeClient(state, async () => connectGate);
  const session = new BackendSession({
    maxAttempts: 2,
    retryBackoffMs: 0,
    startupTimeoutMs: 5_000,
    transportFactory: () => transport,
    clientFactory: () => client,
  });
  session.kickoff();
  assert.equal(session.state, 'starting');

  const facade = await connectFacade(session);
  try {
    const catalog = await facade.client.listTools();
    assert.ok(catalog.tools.length > 0);
    assert.equal(state.connectCalls, 1, 'kickoff owns the only pending backend connect');
    const templates = await facade.client.listResourceTemplates();
    assert.equal(templates.resourceTemplates.length, 1);
    const readiness = await facade.client.callTool({ name: 'get_entity', arguments: {} });
    assert.equal(readiness.isError, true);
    assert.equal((readiness._meta as Record<string, unknown>)['brainbase.retryable'], true);
  } finally {
    release();
    await session.close();
    await closeFacade(facade.client, facade.server);
  }
});

test('resource readiness errors preserve retryability and reason', async () => {
  const backend = {
    ensureReady: async () => {
      throw new BackendReadinessError('starting');
    },
  };
  const facade = await connectFacade(backend);
  try {
    await assert.rejects(
      facade.client.listResources(),
      (error: unknown) => {
        assert.ok(error instanceof McpError);
        assert.deepEqual(error.data, { retryable: true, reason: 'starting' });
        return true;
      },
    );
  } finally {
    await closeFacade(facade.client, facade.server);
  }
});

test('startup failures retry on the same connection without replaying a business call', async () => {
  const state: FakeClientState = {
    connectCalls: 0,
    closeCalls: 0,
    callToolCalls: 0,
  };
  let attempt = 0;
  const backendClient = makeFakeClient(state, async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('preflight failed');
  });
  const session = new BackendSession({
    maxAttempts: 2,
    retryBackoffMs: 0,
    startupTimeoutMs: 500,
    transportFactory: () => new FakeTransport(),
    clientFactory: () => backendClient,
  });
  session.kickoff();
  const facade = await connectFacade(session);
  try {
    const first = await facade.client.callTool({ name: 'get_entity', arguments: {} });
    assert.equal(first.isError, true);
    await waitUntil(() => session.state === 'failed');

    const second = await facade.client.callTool({ name: 'get_entity', arguments: {} });
    assert.equal(second.isError, true);
    await waitUntil(() => session.state === 'ready');

    const third = await facade.client.callTool({ name: 'get_entity', arguments: {} });
    assert.equal(third.isError, undefined);
    assert.equal(state.connectCalls, 2);
    assert.equal(state.callToolCalls, 1, 'only the explicit ready request reaches the backend');
  } finally {
    await session.close();
    await closeFacade(facade.client, facade.server);
  }
});

test('a bounded startup burst can recover on the same connection after cooldown', async () => {
  const state: FakeClientState = {
    connectCalls: 0,
    closeCalls: 0,
    callToolCalls: 0,
  };
  let now = 0;
  const backendClient = makeFakeClient(state, async () => {
    throw new Error('preflight failed');
  });
  const session = new BackendSession({
    maxAttempts: 1,
    retryBackoffMs: 100,
    now: () => now,
    transportFactory: () => new FakeTransport(),
    clientFactory: () => backendClient,
  });
  session.kickoff();
  try {
    await waitUntil(() => session.state === 'failed');
    await assert.rejects(
      session.ensureReady(),
      (error: unknown) => error instanceof BackendReadinessError
        && error.reason === 'exhausted'
        && error.retryable,
    );

    now = 100;
    await assert.rejects(
      session.ensureReady(),
      (error: unknown) => error instanceof BackendReadinessError
        && error.reason === 'starting'
        && error.retryable,
    );
    assert.equal(state.connectCalls, 2, 'cooldown starts a fresh bounded burst');
  } finally {
    await session.close();
  }
});

test('concurrent dependent calls share one startup attempt', async () => {
  const state: FakeClientState = {
    connectCalls: 0,
    closeCalls: 0,
    callToolCalls: 0,
  };
  let release!: () => void;
  const connectGate = new Promise<void>((resolve) => { release = resolve; });
  const backendClient = makeFakeClient(state, async () => connectGate);
  const session = new BackendSession({
    maxAttempts: 2,
    retryBackoffMs: 0,
    startupTimeoutMs: 5_000,
    transportFactory: () => new FakeTransport(),
    clientFactory: () => backendClient,
  });
  session.kickoff();
  const facade = await connectFacade(session);
  try {
    const [first, second] = await Promise.all([
      facade.client.callTool({ name: 'get_entity', arguments: {} }),
      facade.client.callTool({ name: 'get_entity', arguments: {} }),
    ]);
    assert.equal(first.isError, true);
    assert.equal(second.isError, true);
    assert.equal(state.connectCalls, 1);
    release();
    await waitUntil(() => session.state === 'ready');
    const result = await facade.client.callTool({ name: 'get_entity', arguments: {} });
    assert.equal(result.isError, undefined);
    assert.equal(state.callToolCalls, 1);
  } finally {
    release();
    await session.close();
    await closeFacade(facade.client, facade.server);
  }
});

test('backend call failures are returned once and are never automatically replayed', async () => {
  const state: FakeClientState = {
    connectCalls: 0,
    closeCalls: 0,
    callToolCalls: 0,
  };
  const backendClient = makeFakeClient(state, async () => undefined, async () => {
    throw new Error('business failure');
  });
  const session = new BackendSession({
    retryBackoffMs: 0,
    transportFactory: () => new FakeTransport(),
    clientFactory: () => backendClient,
  });
  session.kickoff();
  await waitUntil(() => session.state === 'ready');
  const facade = await connectFacade(session);
  try {
    const first = await facade.client.callTool({ name: 'write_something', arguments: {} });
    const second = await facade.client.callTool({ name: 'write_something', arguments: {} });
    assert.equal(first.isError, true);
    assert.equal(second.isError, true);
    assert.equal(state.callToolCalls, 2);
    assert.deepEqual(first._meta, { 'brainbase.retryable': false });
  } finally {
    await session.close();
    await closeFacade(facade.client, facade.server);
  }
});

test('closing while startup is pending closes captured dependencies without waiting for connect', async () => {
  const state: FakeClientState = {
    connectCalls: 0,
    closeCalls: 0,
    callToolCalls: 0,
  };
  let release!: () => void;
  const connectGate = new Promise<void>((resolve) => { release = resolve; });
  const transport = new FakeTransport();
  const backendClient = makeFakeClient(state, async () => connectGate);
  const session = new BackendSession({
    startupTimeoutMs: 5_000,
    transportFactory: () => transport,
    clientFactory: () => backendClient,
  });
  session.kickoff();
  const startedAt = Date.now();
  await session.close();
  assert.ok(Date.now() - startedAt < 500);
  assert.equal(state.closeCalls, 1);
  assert.equal(transport.closeCalls, 1);
  release();
});

test('process group cleanup kills descendants after the direct child exits', { timeout: 10_000 }, async () => {
  if (process.platform === 'win32') return;
  const directory = await mkdtemp(join(tmpdir(), 'brainbase-stdio-facade-'));
  const pidFile = join(directory, 'grandchild.pid');
  const script = [
    "const fs = require('node:fs');",
    "const { spawn } = require('node:child_process');",
    "const file = process.argv[1];",
    // Inherit the direct child's stdout/stderr so the ChildProcess `close`
    // event waits for this descendant after the direct child has exited.
    "const child = spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\"], { stdio: ['ignore', 'inherit', 'inherit'] });",
    "fs.writeFileSync(file, String(child.pid));",
    'setTimeout(() => process.exit(0), 25);',
  ].join('\n');
  const transport = new ChildProcessTransport({
    command: process.execPath,
    args: ['-e', script, pidFile],
    env: { ...process.env },
  });
  let grandchildPid: number | undefined;
  try {
    await transport.start();
    for (let i = 0; i < 100; i += 1) {
      try {
        grandchildPid = Number(await readFile(pidFile, 'utf8'));
        break;
      } catch {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
    }
    assert.ok(grandchildPid && grandchildPid > 0);
    // The direct child exits on its own.  Cleanup must run from `exit`,
    // before `close`, because the inherited stdout pipe remains open in the
    // grandchild and delays `close` until that grandchild is killed.
    await waitUntil(() => {
      try {
        process.kill(grandchildPid as number, 0);
        return false;
      } catch {
        return true;
      }
    });
    await transport.close();
  } finally {
    await transport.close().catch(() => undefined);
    if (grandchildPid) {
      try { process.kill(grandchildPid, 'SIGKILL'); } catch {}
    }
    await rm(directory, { recursive: true, force: true });
  }
});

test('retired search calls do not wait for or call the facade backend', async () => {
  let readinessCalls = 0;
  let toolCalls = 0;
  const facade = await connectFacade({ensureReady: async () => {
    readinessCalls++;
    return {callTool: async () => { toolCalls++; throw new Error('must not forward'); }} as unknown as BackendClient;
  }});
  try {
    for (const [name, args] of [['get_context', {topic: 'q'}], ['search_wiki', {query: 'q'}], ['search', {query: 'q', mode: 'lexical'}]] as const) {
      const result = await facade.client.callTool({name, arguments: args});
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result), /removed|disabled/);
    }
    assert.equal(readinessCalls, 0);
    assert.equal(toolCalls, 0);
  } finally { await closeFacade(facade.client, facade.server); }
});
