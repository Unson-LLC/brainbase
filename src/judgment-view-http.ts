import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createJudgmentViewService,
  type JudgmentViewAccessContext,
  type JudgmentViewDocument,
  type JudgmentViewReadPort,
  type JudgmentViewService,
} from './judgment-view.js';

const DEFAULT_BASE_PATH = '/judgment-views';

/** Identity supplied by the authenticated host, never by the request body. */
export interface TrustedJudgmentViewRequestContext extends JudgmentViewAccessContext {}

export type JudgmentViewServiceFactory = (
  context: TrustedJudgmentViewRequestContext,
) => JudgmentViewService | Promise<JudgmentViewService>;

export interface JudgmentViewHttpOptions {
  /** Bind the common read-only service to the host's trusted tenant/scope. */
  readonly serviceFactory?: JudgmentViewServiceFactory;
  /** Convenience for hosts that share one read port across contexts. */
  readonly readPort?: JudgmentViewReadPort;
  readonly basePath?: string;
}

export type JudgmentViewHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  context: TrustedJudgmentViewRequestContext | null,
) => Promise<boolean>;

interface RouteMatch {
  readonly runId: string;
}

function requestPath(request: IncomingMessage): string {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '/';
  }
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown, headers: Record<string, string> = {}): void {
  if (response.headersSent) return;
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(JSON.stringify(body));
}

function writeError(response: ServerResponse, statusCode: number, code: string, message: string, headers: Record<string, string> = {}): void {
  writeJson(response, statusCode, { error: { code, message } }, headers);
}

function normalizeBasePath(basePath: string | undefined): string {
  const value = basePath ?? DEFAULT_BASE_PATH;
  if (typeof value !== 'string' || !value.startsWith('/') || value === '/' || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('basePath must be an absolute URL path');
  }
  const normalized = value.replace(/\/+$/u, '');
  if (normalized.length === 0) throw new TypeError('basePath must not be root');
  return normalized;
}

function matchRoute(pathname: string, basePath: string): RouteMatch | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname;
  const prefix = `${basePath}/`;
  if (!normalized.startsWith(prefix)) return null;
  const encodedRunId = normalized.slice(prefix.length);
  if (!encodedRunId || encodedRunId.includes('/')) return null;
  try {
    const runId = decodeURIComponent(encodedRunId);
    if (!runId.trim() || /[\u0000-\u001f\u007f]/u.test(runId)) return null;
    return { runId };
  } catch {
    return null;
  }
}

function validContext(context: TrustedJudgmentViewRequestContext | null): context is TrustedJudgmentViewRequestContext {
  return context !== null
    && typeof context === 'object'
    && typeof context.tenantId === 'string'
    && context.tenantId.trim().length > 0
    && typeof context.principal === 'string'
    && context.principal.trim().length > 0
    && typeof context.scopeId === 'string'
    && context.scopeId.trim().length > 0;
}

function queryEvaluationId(request: IncomingMessage): string | undefined {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const value = url.searchParams.get('evaluationId');
    if (value === null || value.trim().length === 0) return undefined;
    if (/[\u0000-\u001f\u007f]/u.test(value)) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

function httpStatusForDocument(document: JudgmentViewDocument): number {
  if (document.status === 'permission_denied') return 403;
  if (document.status === 'invalid') return 400;
  if (document.status === 'unavailable') return 503;
  return 200;
}

function serviceFromOptions(options: JudgmentViewHttpOptions, context: TrustedJudgmentViewRequestContext): Promise<JudgmentViewService> {
  if (options.serviceFactory) return Promise.resolve(options.serviceFactory(context));
  if (options.readPort) return Promise.resolve(createJudgmentViewService(options.readPort));
  return Promise.reject(new TypeError('serviceFactory or readPort is required'));
}

/**
 * Composable GET handler.  It returns false outside `/judgment-views/:runId`
 * so an organization host can compose it with reservation or other routes in
 * one local server.
 */
export function createJudgmentViewHttpHandler(options: JudgmentViewHttpOptions): JudgmentViewHttpHandler {
  if (!options || typeof options !== 'object') throw new TypeError('options are required');
  if (typeof options.serviceFactory !== 'function' && !options.readPort) {
    throw new TypeError('serviceFactory or readPort is required');
  }
  const basePath = normalizeBasePath(options.basePath);
  return async (request, response, context): Promise<boolean> => {
    const route = matchRoute(requestPath(request), basePath);
    if (!route) return false;
    if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
      writeError(response, 405, 'method_not_allowed', 'Method is not allowed for this judgment view route', { Allow: 'GET' });
      return true;
    }
    if (!validContext(context)) {
      writeError(response, 401, 'unauthorized', 'Authenticated judgment view context is required');
      return true;
    }
    const evaluationId = queryEvaluationId(request);
    try {
      const service = await serviceFromOptions(options, context);
      const document = await service.read({ runId: route.runId, ...(evaluationId ? { evaluationId } : {}), access: context });
      writeJson(response, httpStatusForDocument(document), document);
    } catch {
      writeError(response, 503, 'unavailable', 'Judgment view is temporarily unavailable');
    }
    return true;
  };
}

/** Alias matching hosts that name all composable adapters as routes. */
export const createJudgmentViewRoute = createJudgmentViewHttpHandler;
