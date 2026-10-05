import type { IncomingMessage, ServerResponse } from 'node:http';
import { applyGraphCorrection, GraphCorrectionError } from './graph-corrections.js';
import {
  GraphWebError,
  listGraphProjects,
  readGraphEntity,
  readGraphOntology,
  readGraphProject,
  readGraphWebStatus,
  searchGraphEntities
} from './graph-web.js';

export const GRAPH_WEB_HTTP_VERSION = 'graph-web-http.v1' as const;

const DEFAULT_BASE_PATH = '/api/graph';
const MAX_BODY_BYTES = 16 * 1024;

export interface GraphWebHttpOptions {
  /** Personal OS data directory chosen by the host. Never taken from the request. */
  readonly dataDir: string;
  readonly basePath?: string;
  /**
   * Called before a write request body is read. The host checks its per-launch
   * token and same origin here and throws to refuse the write. Without it every
   * write is refused.
   */
  readonly assertWriteAllowed?: (request: IncomingMessage) => void | Promise<void>;
  readonly now?: () => Date;
}

export type GraphWebHttpHandler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {}
  ) {
    super(message);
  }
}

type Route =
  | { name: 'status' | 'projects' | 'search' | 'ontology' | 'corrections' }
  | { name: 'project' | 'entity'; id: string };

/**
 * Node-style handler for the local Graph read and correction API:
 *
 * - `GET {base}/status`, `GET {base}/projects`, `GET {base}/projects/:id`
 * - `GET {base}/search?q=&type=&as_of=&limit=`, `GET {base}/entities/:id`, `GET {base}/ontology`
 * - `POST {base}/corrections`
 *
 * It returns `false` for any other path so the host can compose other handlers
 * under the same base path. It never starts a server.
 */
export function createGraphWebHttpHandler(options: GraphWebHttpOptions): GraphWebHttpHandler {
  if (typeof options.dataDir !== 'string' || options.dataDir.trim() === '') {
    throw new TypeError('dataDir is required');
  }
  const basePath = (options.basePath ?? DEFAULT_BASE_PATH).replace(/\/+$/u, '');
  const now = options.now ?? (() => new Date());
  const dataDir = options.dataDir;

  return async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    let route: Route | undefined;
    try {
      route = matchRoute(url.pathname, basePath);
    } catch (error) {
      if (error instanceof HttpError) {
        writeError(response, error);
        return true;
      }
      throw error;
    }
    if (!route) return false;
    try {
      if (route.name === 'corrections') {
        if (request.method !== 'POST') throw methodNotAllowed('POST');
        await assertWriteAllowed(options.assertWriteAllowed, request);
        const body = await readJsonBody(request);
        const result = await applyGraphCorrection(dataDir, body, { now: now() });
        writeJson(response, 201, result);
        return true;
      }
      if (request.method !== 'GET') throw methodNotAllowed('GET');
      const asOf = queryValue(url, 'as_of');
      const readOptions = { ...(asOf !== undefined ? { asOf } : {}), now: now() };
      switch (route.name) {
        case 'status':
          writeJson(response, 200, await readGraphWebStatus(dataDir, readOptions));
          break;
        case 'projects':
          writeJson(response, 200, await listGraphProjects(dataDir, readOptions));
          break;
        case 'project':
          writeJson(response, 200, await readGraphProject(dataDir, route.id, readOptions));
          break;
        case 'search':
          writeJson(response, 200, await searchGraphEntities(dataDir, {
            q: queryValue(url, 'q'),
            type: queryValue(url, 'type'),
            asOf,
            limit: parseLimit(queryValue(url, 'limit')),
            now: readOptions.now
          }));
          break;
        case 'entity':
          writeJson(response, 200, await readGraphEntity(dataDir, route.id, readOptions));
          break;
        case 'ontology':
          writeJson(response, 200, await readGraphOntology(dataDir, readOptions));
          break;
      }
    } catch (error) {
      writeError(response, toHttpError(error));
    }
    return true;
  };
}

function matchRoute(pathname: string, basePath: string): Route | undefined {
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return undefined;
  const rest = pathname.slice(basePath.length);
  if (rest === '/status') return { name: 'status' };
  if (rest === '/projects') return { name: 'projects' };
  if (rest === '/search') return { name: 'search' };
  if (rest === '/ontology') return { name: 'ontology' };
  if (rest === '/corrections') return { name: 'corrections' };
  const match = /^\/(projects|entities)\/([^/]+)$/u.exec(rest);
  if (!match) return undefined;
  let id: string;
  try {
    id = decodeURIComponent(match[2]!);
  } catch {
    throw new HttpError(400, 'invalid_id', 'The id in the path is not valid percent-encoding');
  }
  if (id.trim() === '' || id.length > 500) throw new HttpError(400, 'invalid_id', 'The id in the path is not valid');
  return { name: match[1] === 'projects' ? 'project' : 'entity', id };
}

async function assertWriteAllowed(
  guard: GraphWebHttpOptions['assertWriteAllowed'],
  request: IncomingMessage
): Promise<void> {
  if (!guard) {
    throw new HttpError(403, 'write_protection_missing', 'Writes are disabled because the host did not provide write protection');
  }
  try {
    await guard(request);
  } catch (error) {
    const candidate = error as { statusCode?: unknown; code?: unknown; message?: unknown };
    const statusCode = typeof candidate.statusCode === 'number' && candidate.statusCode >= 400 && candidate.statusCode < 500
      ? candidate.statusCode
      : 403;
    const code = typeof candidate.code === 'string' && candidate.code ? candidate.code : 'write_not_allowed';
    const message = typeof candidate.message === 'string' && candidate.message ? candidate.message : 'Write is not allowed';
    throw new HttpError(statusCode, code, message);
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = String(request.headers['content-type'] ?? '');
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  }
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HttpError(413, 'payload_too_large', 'Request body is too large');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large', 'Request body is too large');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be JSON');
  }
}

function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof GraphCorrectionError) {
    if (error.kind === 'conflict') {
      return new HttpError(409, error.code, error.message, error.current ? { current: error.current } : {});
    }
    const status = error.kind === 'invalid' ? 400
      : error.kind === 'not_found' ? 404
        : error.kind === 'migration_required' ? 409
          : 500;
    return new HttpError(status, error.code, error.message);
  }
  if (error instanceof GraphWebError) {
    const status = error.kind === 'invalid' ? 400 : error.kind === 'not_found' ? 404 : 503;
    return new HttpError(status, error.code, error.message);
  }
  // Canonical files that cannot be read or written are reported, never hidden.
  return new HttpError(500, 'graph_operation_failed', error instanceof Error ? error.message : 'Unexpected error');
}

function methodNotAllowed(allow: string): HttpError {
  return new HttpError(405, 'method_not_allowed', `Use ${allow}`, {}, { Allow: allow });
}

function queryValue(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  return value === null ? undefined : value;
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^\d+$/u.test(value)) throw new HttpError(400, 'invalid_query', 'limit must be a positive integer');
  return Number(value);
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown, headers: Record<string, string> = {}): void {
  if (response.headersSent) return;
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(JSON.stringify(body));
}

function writeError(response: ServerResponse, error: HttpError): void {
  writeJson(response, error.statusCode, { error: { code: error.code, message: error.message, ...error.extra } }, error.headers);
}
