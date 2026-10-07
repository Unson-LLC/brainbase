import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFixturePersonalOs } from './fixtures.js';
import { createServer, handleToolCall } from '../src/server.js';

const dirs: string[] = [];
const clients: Client[] = [];

async function fixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'brainbase-mcp-authorization-'));
  dirs.push(dir);
  await createFixturePersonalOs(dir);
  return dir;
}

async function connectClient(options: Parameters<typeof createServer>[0] = {}): Promise<Client> {
  const server = createServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  serverTransport.sessionId = 'session-mcp-authorization-test';

  await server.connect(serverTransport);
  const client = new Client({
    name: 'brainbase-mcp-authorization-test',
    version: '0.0.0'
  });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('MCP tool authorization hook', () => {
  it('passes the exact call and SDK request context, and checks every invocation', async () => {
    const dataDir = await fixtureDir();
    const calls: Array<{
      name: string;
      arguments: Record<string, unknown>;
      requestId: string | number;
      sessionId?: string;
      metadata?: Record<string, unknown>;
      hasSignal: boolean;
    }> = [];
    const client = await connectClient({
      authorizeToolCall: async (request, context) => {
        calls.push({
          name: request.name,
          arguments: request.arguments,
          requestId: context.requestId,
          sessionId: context.sessionId,
          metadata: context._meta,
          hasSignal: context.signal instanceof AbortSignal
        });
        return true;
      }
    });

    await client.callTool({
      name: 'get_context',
      arguments: { dataDir, marker: 'first' },
      _meta: { caller: 'test-client' }
    });
    await client.callTool({
      name: 'get_context',
      arguments: { dataDir, marker: 'second' },
      _meta: { caller: 'test-client' }
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      name: 'get_context',
      arguments: { dataDir, marker: 'first' },
      sessionId: 'session-mcp-authorization-test',
      metadata: { caller: 'test-client' },
      hasSignal: true
    });
    expect(calls[1]).toMatchObject({
      name: 'get_context',
      arguments: { dataDir, marker: 'second' },
      sessionId: 'session-mcp-authorization-test',
      metadata: { caller: 'test-client' },
      hasSignal: true
    });
    expect(calls[0]?.requestId).not.toBe(calls[1]?.requestId);
  });

  it('awaits approval before loading the local SSOT and returns a safe denial result', async () => {
    const dataDir = await fixtureDir();
    await writeFile(join(dataDir, 'graph.json'), '{ malformed canonical data');
    const seen: string[] = [];
    const client = await connectClient({
      authorizeToolCall: async (request) => {
        seen.push(request.name);
        await Promise.resolve();
        return false;
      }
    });

    const result = await client.callTool({
      name: 'get_context',
      arguments: { dataDir }
    });

    expect(seen).toEqual(['get_context']);
    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: 'tool_call_not_authorized',
          message: 'Tool call was not authorized.'
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain('malformed canonical data');
  });

  it('contains callback failures and does not expose their value', async () => {
    const dataDir = await fixtureDir();
    await writeFile(join(dataDir, 'graph.json'), '{ malformed canonical data');
    const client = await connectClient({
      authorizeToolCall: () => {
        throw new Error('secret authorization backend response');
      }
    });

    const result = await client.callTool({
      name: 'get_context',
      arguments: { dataDir }
    });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: 'tool_call_not_authorized'
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain('secret authorization backend response');
  });

  it('retains only an allowlisted rejection code and safe correlation ID', async () => {
    const dataDir = await fixtureDir();
    await writeFile(join(dataDir, 'graph.json'), '{ malformed canonical data');
    const client = await connectClient({
      authorizeToolCall: () => ({
        authorized: false,
        code: 'scope_denied',
        correlationId: 'corr-mcp-123'
      })
    });

    const result = await client.callTool({
      name: 'get_context',
      arguments: { dataDir }
    });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: 'scope_denied',
          message: 'Tool call was not authorized.',
          correlationId: 'corr-mcp-123'
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain('malformed canonical data');
  });

  it('retains allowlisted fields from a thrown authorization error only', async () => {
    const dataDir = await fixtureDir();
    await writeFile(join(dataDir, 'graph.json'), '{ malformed canonical data');
    const client = await connectClient({
      authorizeToolCall: () => {
        throw Object.assign(new Error('secret authorization backend response'), {
          code: 'agent_tenant_mismatch',
          correlationId: 'corr-tenant-123',
          token: 'secret-token'
        });
      }
    });

    const result = await client.callTool({
      name: 'get_context',
      arguments: { dataDir }
    });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: 'agent_tenant_mismatch',
          message: 'Tool call was not authorized.',
          correlationId: 'corr-tenant-123'
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain('secret authorization backend response');
    expect(JSON.stringify(result)).not.toContain('secret-token');
    expect(JSON.stringify(result)).not.toContain('malformed canonical data');
  });

  it('does not authorize tool discovery and normalizes omitted arguments', async () => {
    const names: string[] = [];
    const client = await connectClient({
      authorizeToolCall: (request) => {
        names.push(request.name);
        expect(request.arguments).toEqual({});
        return true;
      }
    });

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toContain('get_context');
    expect(names).toEqual([]);

    const result = await handleToolCall(
      { name: 'onboarding_status' },
      {
        requestId: 1,
        signal: new AbortController().signal,
        sendNotification: async () => undefined,
        sendRequest: async () => ({})
      },
      {
        authorizeToolCall: (request) => {
          names.push(request.name);
          expect(request.arguments).toEqual({});
          return false;
        }
      }
    );

    expect(result).toMatchObject({ isError: true });
    expect(names).toEqual(['onboarding_status']);
  });
});
