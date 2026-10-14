import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  JUDGMENT_HISTORY_ENTRYPOINTS,
  MAX_JUDGMENT_HISTORY_RESOLUTION_BATCH,
  createJudgmentHistoryReader,
  JudgmentHistoryFeedbackConflictError,
  type JudgmentHistoryFeedbackWriter,
  type JudgmentHistoryEntrypoint,
  type JudgmentHistoryReadTimings,
  type JudgmentHistoryReader,
  type JudgmentHistoryQuery
} from './judgment-history.js';
import { LocalWebHttpError, readJsonObjectBody, writeJson } from './local-web-security.js';

export const JUDGMENT_HISTORY_HTTP_VERSION = 'judgment-history-http.v1' as const;
export const JUDGMENT_HISTORY_HTTP_PREFIX = '/api/judgment-history' as const;
export const JUDGMENT_HISTORY_FEEDBACK_BODY_LIMIT_BYTES = 64 * 1024;

export interface JudgmentHistoryHttpOptions {
  readonly reader: JudgmentHistoryReader;
  readonly basePath?: string;
  /** Host-owned authorization callback. Browser input never selects its owner. */
  readonly assertWriteAllowed?: (request: IncomingMessage) => void | Promise<void>;
  /** Append-only writer; GET-only compositions can omit this seam. */
  readonly writeFeedback?: JudgmentHistoryFeedbackWriter;
}

export type JudgmentHistoryHttpHandler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;

type Route = { readonly name: 'home' } | { readonly name: 'detail'; readonly recordId: string } | { readonly name: 'feedback' } | { readonly name: 'resolutions' };

function serverTimingHeader(timings: JudgmentHistoryReadTimings | null, handlerMs: number): string {
  const parts = [`total;dur=${handlerMs.toFixed(1)}`];
  if (timings) {
    parts.push(`journal;dur=${timings.journal_ms.toFixed(1)}`);
    parts.push(`page;dur=${timings.page_ms.toFixed(1)}`);
    parts.push(`cache;desc="hits=${timings.cache_hits},misses=${timings.cache_misses}"`);
    parts.push(`parallel;desc="${timings.parallel_limit}"`);
  }
  parts.push('order;desc="newest-first"');
  return parts.join(', ');
}

function methodNotAllowed(): Error & { statusCode: number; code: string } {
  const error = new Error('Use GET or POST') as Error & { statusCode: number; code: string };
  error.statusCode = 405;
  error.code = 'method_not_allowed';
  return error;
}

function matchRoute(pathname: string, basePath: string): Route | null {
  if (pathname === `${basePath}/home`) return { name: 'home' };
  if (pathname === `${basePath}/feedback`) return { name: 'feedback' };
  if (pathname === `${basePath}/resolutions`) return { name: 'resolutions' };
  if (!pathname.startsWith(`${basePath}/records/`)) return null;
  const encoded = pathname.slice(`${basePath}/records/`.length);
  if (!encoded || encoded.includes('/')) return null;
  let recordId: string;
  try {
    recordId = decodeURIComponent(encoded);
  } catch {
    const error = new Error('record_id is not valid percent-encoding') as Error & { statusCode: number; code: string };
    error.statusCode = 400;
    error.code = 'invalid_record_id';
    throw error;
  }
  return { name: 'detail', recordId };
}

function queryValue(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  return value === null ? undefined : value;
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/u.test(value)) throw readerError(400, 'invalid_limit', 'limit must be between 1 and 100');
  return Number(value);
}

function readerError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function parseResolutionIds(url: URL): string[] {
  for (const key of url.searchParams.keys()) {
    if (key !== 'id') throw readerError(400, 'unknown_query', `Unknown query parameter: ${key}`);
  }
  const ids = url.searchParams.getAll('id');
  if (ids.length < 1 || ids.length > MAX_JUDGMENT_HISTORY_RESOLUTION_BATCH) {
    throw readerError(400, 'invalid_resolution_ids', `id must be repeated between 1 and ${MAX_JUDGMENT_HISTORY_RESOLUTION_BATCH} times`);
  }
  return ids;
}

function parseQuery(url: URL): JudgmentHistoryQuery {
  const allowed = new Set(['period', 'project', 'entrypoint', 'cursor', 'limit']);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) throw readerError(400, 'unknown_query', `Unknown query parameter: ${key}`);
  }
  const periodValue = queryValue(url, 'period');
  const period = periodValue === undefined ? undefined : periodValue as JudgmentHistoryQuery['period'];
  const entrypointValue = queryValue(url, 'entrypoint');
  const entrypoint = entrypointValue === undefined ? undefined : entrypointValue as JudgmentHistoryEntrypoint;
  if (period !== undefined && period !== 'week' && period !== 'past30days' && period !== 'all') {
    throw readerError(400, 'invalid_period', 'period is invalid');
  }
  if (entrypoint !== undefined && !(JUDGMENT_HISTORY_ENTRYPOINTS as readonly string[]).includes(entrypoint)) {
    throw readerError(400, 'invalid_entrypoint', 'entrypoint is invalid');
  }
  const project = queryValue(url, 'project');
  const cursor = queryValue(url, 'cursor');
  const limit = parseLimit(queryValue(url, 'limit'));
  return {
    ...(period === undefined ? {} : { period }),
    ...(project === undefined ? {} : { project }),
    ...(entrypoint === undefined ? {} : { entrypoint }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit })
  };
}

function toError(error: unknown): Error & { statusCode: number; code: string } {
  if (error && typeof error === 'object'
    && typeof (error as { statusCode?: unknown }).statusCode === 'number'
    && typeof (error as { code?: unknown }).code === 'string') {
    return error as Error & { statusCode: number; code: string };
  }
  return readerError(500, 'judgment_history_failed', error instanceof Error ? error.message : 'Judgment history read failed');
}

/** Node-style GET route for the common normal-judgment history contract. */
export function createJudgmentHistoryHttpHandler(options: JudgmentHistoryHttpOptions): JudgmentHistoryHttpHandler {
  if (!options?.reader || typeof options.reader.home !== 'function' || typeof options.reader.detail !== 'function') {
    throw new TypeError('reader is required');
  }
  const basePath = (options.basePath ?? JUDGMENT_HISTORY_HTTP_PREFIX).replace(/\/+$/u, '');
  const reader = options.reader;
  return async (request, response): Promise<boolean> => {
    const started = performance.now();
    const writeTimed = (statusCode: number, body: unknown): void => {
      if (!response.headersSent) {
        const timings = typeof reader.timings === 'function' ? reader.timings() : null;
        response.setHeader('Server-Timing', serverTimingHeader(timings, performance.now() - started));
      }
      writeJson(response, statusCode, body);
    };
    const url = new URL(request.url ?? '/', 'http://localhost');
    let route: Route | null;
    try {
      route = matchRoute(url.pathname, basePath);
    } catch (error) {
      const normalized = toError(error);
      writeTimed(normalized.statusCode, {
        error: { code: normalized.code, message: normalized.message }
      });
      return true;
    }
    if (!route) return false;
    try {
      if (route.name === 'feedback') {
        if (request.method !== 'POST') throw methodNotAllowed();
        if (!options.assertWriteAllowed) {
          throw new LocalWebHttpError(403, 'feedback_write_unconfigured', 'Feedback writes are not configured for this host');
        }
        if (!options.writeFeedback) {
          throw new LocalWebHttpError(503, 'feedback_write_unavailable', 'Feedback writes are unavailable');
        }
        await options.assertWriteAllowed(request);
        const input = await readJsonObjectBody(request, JUDGMENT_HISTORY_FEEDBACK_BODY_LIMIT_BYTES);
        const result = await options.writeFeedback(input);
        const responseBody = {
          status: result.status,
          saved: true,
          created: result.created,
          feedback_event: result.event,
          ...result.event
        };
        writeTimed(result.created ? 201 : 200, responseBody);
      } else {
        if (request.method !== 'GET') throw methodNotAllowed();
        if (route.name === 'resolutions') {
          if (typeof reader.findByResolutionIds !== 'function') {
            throw readerError(501, 'resolution_batch_unavailable', 'This reader cannot look up resolution ids in one read');
          }
          writeTimed(200, await reader.findByResolutionIds(parseResolutionIds(url)));
        } else if (route.name === 'home') {
          writeTimed(200, await reader.home(parseQuery(url)));
        } else {
          const result = await reader.detail(route.recordId);
          if (result.status === 'unavailable') {
            writeTimed(200, result);
          } else if (result.status === 'available' && !result.record) {
            throw readerError(404, 'judgment_history_not_found', 'No judgment history record matches this id');
          } else {
            writeTimed(200, result);
          }
        }
      }
    } catch (error) {
      const normalized = toError(error);
      if (error instanceof JudgmentHistoryFeedbackConflictError) {
        writeTimed(normalized.statusCode, {
          error: { code: normalized.code, message: normalized.message },
          feedback_event: error.existing
        });
      } else {
        writeTimed(normalized.statusCode, {
          error: { code: normalized.code, message: normalized.message }
        });
      }
    }
    return true;
  };
}

/** Convenience composition seam for adapters that want the HTTP contract without a local journal. */
export function createJudgmentHistoryHttpReader(options: Parameters<typeof createJudgmentHistoryReader>[0]): JudgmentHistoryReader {
  return createJudgmentHistoryReader(options);
}
