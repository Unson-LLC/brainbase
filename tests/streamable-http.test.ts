import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer as createMcpServer, toolDefinitions } from '../src/server.js';
import { createStreamableHttpHandler, type StreamableHttpHandler } from '../src/streamable-http.js';

const httpServers: HttpServer[] = [];
const handlers: StreamableHttpHandler[] = [];

async function start(handler: StreamableHttpHandler): Promise<{ baseUrl: string; server: HttpServer }> {
  const server = createHttpServer((request, response) => {
    void handler.handle(request, response);
  });
  httpServers.push(server);
  handlers.push(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP server did not bind to a TCP port');
  return { baseUrl: `http://127.0.0.1:${address.port}`, server };
}

async function request(
  baseUrl: string,
  path: string,
  init: { method: string; body?: string; headers?: Record<string, string> }
): Promise<{ response: Response; body: Record<string, any> | undefined }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json, text/event-stream',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) as Record<string, any> : undefined };
}

function jsonRpc(method: string, id: number, params: Record<string, unknown> = {}): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

afterEach(async () => {
  await Promise.all(handlers.splice(0).map((handler) => handler.close()));
  await Promise.all(httpServers.splice(0).map((server) => new Promise<void>((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  })));
  vi.unstubAllEnvs();
});

describe('public Streamable HTTP MCP transport', () => {
  it('supports initialize, list, call, health, and session cleanup through DI', async () => {
    vi.stubEnv('BRAINBASE_PERSONAL_KNOWLEDGE_MODE', 'local');
    const scopes: unknown[] = [];
    const mcpServer = createMcpServer();
    const closeSpy = vi.spyOn(mcpServer, 'close');
    let authenticateCalls = 0;
    const handler = createStreamableHttpHandler({
      authenticate: () => {
        authenticateCalls += 1;
        return { token: 'test-token', clientId: 'contract-test', scopes: [] };
      },
      createServer: (scope) => {
        scopes.push(scope);
        return mcpServer;
      },
      requestScope: (input) => ({ requestId: input.requestId, method: input.request.method ?? 'unknown', path: '/mcp' }),
      health: () => ({ status: 'ok', source: 'test' })
    });
    const { baseUrl } = await start(handler);

    const health = await request(baseUrl, '/health', { method: 'GET' });
    expect(health.response.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok', source: 'test' });
    expect(authenticateCalls).toBe(0);

    const initialized = await request(baseUrl, '/mcp', {
      method: 'POST',
      body: jsonRpc('initialize', 1, {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'streamable-http-test', version: '1.0.0' }
      })
    });
    expect(initialized.response.status).toBe(200);
    expect(initialized.body?.result?.protocolVersion).toBe('2025-06-18');
    const sessionId = initialized.response.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();
    expect(handler.activeSessionCount).toBe(1);
    expect(scopes).toHaveLength(1);

    const sessionHeaders = { 'Mcp-Session-Id': sessionId as string, 'MCP-Protocol-Version': '2025-06-18' };
    const listed = await request(baseUrl, '/mcp', {
      method: 'POST',
      headers: sessionHeaders,
      body: jsonRpc('tools/list', 2)
    });
    expect(listed.response.status).toBe(200);
    expect(listed.body?.result?.tools?.map((tool: { name: string }) => tool.name)).toEqual(
      toolDefinitions.map((tool) => tool.name)
    );

    const called = await request(baseUrl, '/mcp', {
      method: 'POST',
      headers: sessionHeaders,
      body: jsonRpc('tools/call', 3, { name: 'get_ontology', arguments: {} })
    });
    expect(called.response.status).toBe(200);
    expect(called.body?.result?.isError).not.toBe(true);

    const deleted = await request(baseUrl, '/mcp', { method: 'DELETE', headers: sessionHeaders });
    expect(deleted.response.status).toBe(200);
    expect(handler.activeSessionCount).toBe(0);
    expect(closeSpy).toHaveBeenCalled();
    expect(authenticateCalls).toBe(4);
  });

  it('rejects unauthorized requests and rejects GET /mcp', async () => {
    const createServer = vi.fn(() => createMcpServer());
    const handler = createStreamableHttpHandler({
      authenticate: () => null,
      createServer
    });
    const { baseUrl } = await start(handler);

    const unauthorized = await request(baseUrl, '/mcp', {
      method: 'POST',
      body: jsonRpc('initialize', 1, { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    });
    expect(unauthorized.response.status).toBe(401);
    expect(unauthorized.body?.error?.message).toBe('Unauthorized');
    expect(createServer).not.toHaveBeenCalled();

    const get = await request(baseUrl, '/mcp', { method: 'GET' });
    expect(get.response.status).toBe(405);
    expect(get.response.headers.get('allow')).toBe('POST, DELETE');
  });

  it('returns parse errors and enforces the request body limit before creating a server', async () => {
    const createServer = vi.fn(() => createMcpServer());
    const handler = createStreamableHttpHandler({ createServer, bodyLimitBytes: 64 });
    const { baseUrl } = await start(handler);

    const parseError = await request(baseUrl, '/mcp', { method: 'POST', body: '{"jsonrpc":' });
    expect(parseError.response.status).toBe(400);
    expect(parseError.body?.error?.code).toBe(-32700);
    expect(createServer).not.toHaveBeenCalled();

    const tooLarge = await request(baseUrl, '/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { padding: 'x'.repeat(128) } })
    });
    expect(tooLarge.response.status).toBe(413);
    expect(tooLarge.body?.error?.code).toBe(-32013);
    expect(createServer).not.toHaveBeenCalled();
  });

  it('closes an active session when the handler shuts down', async () => {
    const mcpServer = createMcpServer();
    const closeSpy = vi.spyOn(mcpServer, 'close');
    const handler = createStreamableHttpHandler({ createServer: () => mcpServer });
    const { baseUrl } = await start(handler);

    const initialized = await request(baseUrl, '/mcp', {
      method: 'POST',
      body: jsonRpc('initialize', 1, {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'shutdown-test', version: '1.0.0' }
      })
    });
    expect(initialized.response.status).toBe(200);
    expect(handler.activeSessionCount).toBe(1);

    await handler.close();
    expect(handler.activeSessionCount).toBe(0);
    expect(closeSpy).toHaveBeenCalled();
  });
});
