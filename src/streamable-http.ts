import { randomUUID } from 'node:crypto';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse
} from 'node:http';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_MCP_PATH = '/mcp';
const DEFAULT_HEALTH_PATH = '/health';

type MaybePromise<T> = T | Promise<T>;

export interface StreamableHttpRequestScope<Auth = AuthInfo> {
  requestId: string;
  method: string;
  path: string;
  auth?: Auth;
  sessionId?: string;
}

export interface StreamableHttpRequestScopeInput<Auth = AuthInfo> {
  request: IncomingMessage;
  requestId: string;
  auth?: Auth;
  sessionId?: string;
}

export interface StreamableHttpHealthScope {
  request: IncomingMessage;
  requestId: string;
}

export interface StreamableHttpDependencies<Auth = AuthInfo> {
  /** Return null to reject the request. Undefined means anonymous access. */
  authenticate?: (request: IncomingMessage) => MaybePromise<Auth | null>;
  /** Build one MCP server for each initialized MCP session. */
  createServer: (scope: StreamableHttpRequestScope<Auth>) => MaybePromise<Server>;
  /** Add application request context without coupling the transport to an app. */
  requestScope?: (
    input: StreamableHttpRequestScopeInput<Auth>
  ) => MaybePromise<Partial<StreamableHttpRequestScope<Auth>>>;
  /** Health is deliberately independent from MCP authentication and application routes. */
  health?: (scope: StreamableHttpHealthScope) => MaybePromise<unknown>;
  bodyLimitBytes?: number;
  mcpPath?: string;
  healthPath?: string;
}

export interface StreamableHttpHandler {
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
  close(): Promise<void>;
  readonly activeSessionCount: number;
}

interface Session {
  id?: string;
  server: Server;
  transport: StreamableHTTPServerTransport;
  closed: boolean;
  serverCloseStarted: boolean;
  serverClosePromise?: Promise<void>;
}

class BodyLimitError extends Error {
  constructor() {
    super('Request body exceeds the configured limit');
    this.name = 'BodyLimitError';
  }
}

class InvalidJsonError extends Error {
  constructor() {
    super('Parse error: Invalid JSON');
    this.name = 'InvalidJsonError';
  }
}

function jsonRpcError(code: number, message: string): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    error: { code, message },
    id: null
  };
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {}
): void {
  if (response.headersSent) return;
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(JSON.stringify(body));
}

function requestPath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

async function readJsonBody(request: IncomingMessage, limitBytes: number): Promise<unknown> {
  const contentLengthHeader = headerValue(request, 'content-length');
  if (contentLengthHeader !== undefined) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > limitBytes) {
      request.resume();
      throw new BodyLimitError();
    }
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('error', onError);
      request.removeListener('aborted', onAborted);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > limitBytes) {
        request.resume();
        finish(new BodyLimitError());
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => finish();
    const onError = () => finish(new Error('Request body could not be read'));
    const onAborted = () => finish(new Error('Request was aborted'));
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAborted);
  });

  if (chunks.length === 0) throw new InvalidJsonError();
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new InvalidJsonError();
  }
}

function assignAuth(request: IncomingMessage, auth: unknown): IncomingMessage & { auth?: AuthInfo } {
  const authenticatedRequest = request as IncomingMessage & { auth?: AuthInfo };
  if (auth !== undefined) authenticatedRequest.auth = auth as AuthInfo;
  return authenticatedRequest;
}

export function createStreamableHttpHandler<Auth = AuthInfo>(
  dependencies: StreamableHttpDependencies<Auth>
): StreamableHttpHandler {
  const bodyLimitBytes = dependencies.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  const mcpPath = dependencies.mcpPath ?? DEFAULT_MCP_PATH;
  const healthPath = dependencies.healthPath ?? DEFAULT_HEALTH_PATH;
  if (!Number.isInteger(bodyLimitBytes) || bodyLimitBytes <= 0) {
    throw new Error('bodyLimitBytes must be a positive integer');
  }

  const sessions = new Map<string, Session>();

  const closeServer = async (session: Session): Promise<void> => {
    if (session.serverClosePromise) return session.serverClosePromise;
    session.serverCloseStarted = true;
    session.serverClosePromise = session.server.close();
    await session.serverClosePromise;
  };

  const disposeSession = async (session: Session): Promise<void> => {
    if (session.id) sessions.delete(session.id);
    if (session.closed && session.serverCloseStarted) {
      await session.serverClosePromise;
      return;
    }
    session.closed = true;
    try {
      await session.transport.close();
    } finally {
      await closeServer(session);
    }
  };

  const createSession = async (scope: StreamableHttpRequestScope<Auth>): Promise<Session> => {
    const server = await dependencies.createServer(scope);
    let session!: Session;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        session.id = id;
        sessions.set(id, session);
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
        session.closed = true;
      }
    });
    session = {
      server,
      transport,
      closed: false,
      serverCloseStarted: false
    };
    transport.onclose = () => {
      session.closed = true;
      if (session.id) sessions.delete(session.id);
      void closeServer(session).catch(() => undefined);
    };
    await server.connect(transport);
    return session;
  };

  const resolveScope = async (
    request: IncomingMessage,
    auth: Auth | undefined,
    sessionId: string | undefined,
    requestId: string
  ): Promise<StreamableHttpRequestScope<Auth>> => {
    const base: StreamableHttpRequestScope<Auth> = {
      requestId,
      method: request.method ?? 'GET',
      path: requestPath(request),
      ...(auth === undefined ? {} : { auth }),
      ...(sessionId === undefined ? {} : { sessionId })
    };
    const custom = await dependencies.requestScope?.({ request, requestId, auth, sessionId });
    return custom ? { ...base, ...custom } : base;
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const path = requestPath(request);
    const requestId = randomUUID();

    if (path === healthPath && request.method === 'GET') {
      try {
        const result = await dependencies.health?.({ request, requestId });
        writeJson(response, 200, result ?? { status: 'ok' });
      } catch {
        writeJson(response, 503, { status: 'unavailable' });
      }
      return;
    }

    if (path !== mcpPath) {
      writeJson(response, 404, { error: 'Not Found' });
      return;
    }
    if (request.method === 'GET') {
      writeJson(response, 405, jsonRpcError(-32000, 'GET is not supported'), { Allow: 'POST, DELETE' });
      return;
    }
    if (request.method !== 'POST' && request.method !== 'DELETE') {
      writeJson(response, 405, jsonRpcError(-32000, 'Method not allowed'), { Allow: 'POST, DELETE' });
      return;
    }

    let auth: Auth | undefined;
    if (dependencies.authenticate) {
      try {
        const authenticated = await dependencies.authenticate(request);
        if (authenticated === null) {
          writeJson(response, 401, jsonRpcError(-32000, 'Unauthorized'), { 'WWW-Authenticate': 'Bearer' });
          return;
        }
        auth = authenticated;
      } catch {
        writeJson(response, 401, jsonRpcError(-32000, 'Unauthorized'), { 'WWW-Authenticate': 'Bearer' });
        return;
      }
    }

    const sessionId = headerValue(request, 'mcp-session-id');
    let session = sessionId ? sessions.get(sessionId) : undefined;
    if (sessionId && !session) {
      writeJson(response, 404, jsonRpcError(-32001, 'Session not found'));
      return;
    }

    try {
      const body = request.method === 'POST' ? await readJsonBody(request, bodyLimitBytes) : undefined;
      const scope = await resolveScope(request, auth, sessionId, requestId);
      if (!session) session = await createSession(scope);

      let aborted = false;
      const onClose = () => {
        if (!response.writableFinished) {
          aborted = true;
          if (session) void disposeSession(session).catch(() => undefined);
        }
      };
      response.once('close', onClose);
      try {
        await session.transport.handleRequest(assignAuth(request, auth), response, body);
      } finally {
        response.removeListener('close', onClose);
      }

      // An uninitialized, stateless request creates no session and must not leak
      // its server. Initialized sessions remain available for list/call/delete.
      if (!session.transport.sessionId && !sessionId && !aborted) await disposeSession(session);
    } catch (error) {
      if (response.headersSent) {
        if (!response.writableEnded) response.destroy();
        return;
      }
      if (error instanceof BodyLimitError) {
        writeJson(response, 413, jsonRpcError(-32013, error.message));
        return;
      }
      if (error instanceof InvalidJsonError) {
        writeJson(response, 400, jsonRpcError(-32700, error.message));
        return;
      }
      writeJson(response, 500, jsonRpcError(-32603, 'Internal server error'));
    }
  };

  return {
    handle,
    close: async () => {
      await Promise.all([...sessions.values()].map((session) => disposeSession(session)));
      sessions.clear();
    },
    get activeSessionCount() {
      return sessions.size;
    }
  };
}

export function createStreamableHttpServer<Auth = AuthInfo>(
  dependencies: StreamableHttpDependencies<Auth>
): HttpServer {
  const handler = createStreamableHttpHandler(dependencies);
  const server = createHttpServer((request, response) => {
    void handler.handle(request, response);
  });
  server.once('close', () => {
    void handler.close().catch(() => undefined);
  });
  return server;
}
