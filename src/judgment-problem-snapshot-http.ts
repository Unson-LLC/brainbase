import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  JudgmentProblemSnapshotError,
  loadJudgmentProblemSnapshot,
  saveJudgmentProblemSnapshot,
  type JudgmentProblemReferenceProvider,
  type JudgmentProblemSnapshot,
  type JudgmentProblemSnapshotAccessProvider,
  type JudgmentProblemSnapshotErrorCode,
} from './judgment-problem-snapshot.js';

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_BASE_PATH = '/judgment-problem-snapshots';
const snapshotIdPattern = /^sha256:[0-9a-f]{64}$/u;

type MaybePromise<T> = T | Promise<T>;

/** Identity resolved by the host after authentication. Request bodies never supply it. */
export interface TrustedJudgmentProblemSnapshotRequestContext {
  principal: string;
  /** A non-empty value means that the host already verified the mutation origin. */
  verifiedMutationOrigin?: string;
}

/**
 * The host binds the reference resolution (for example the Foundation store
 * and its own resolvers for authority, resource and deadline) to the trusted
 * request context. The access provider defaults to the snapshot read policy.
 */
export type JudgmentProblemSnapshotProviderFactory = (
  context: TrustedJudgmentProblemSnapshotRequestContext,
) => MaybePromise<{
  referenceProvider: JudgmentProblemReferenceProvider;
  accessProvider?: JudgmentProblemSnapshotAccessProvider;
}>;

export interface JudgmentProblemSnapshotHttpOptions {
  /** Artifact root of the immutable snapshot store. */
  root: string;
  providerFactory: JudgmentProblemSnapshotProviderFactory;
  basePath?: string;
  bodyLimitBytes?: number;
  /** Required for hosts that do not attach verifiedMutationOrigin to context. */
  verifyMutationRequest?: (input: {
    request: IncomingMessage;
    context: TrustedJudgmentProblemSnapshotRequestContext;
  }) => MaybePromise<boolean>;
}

/** A composable route handler. `false` means that the request is outside this route. */
export type JudgmentProblemSnapshotHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  context: TrustedJudgmentProblemSnapshotRequestContext | null,
) => Promise<boolean>;

class HttpInputError extends Error {}
class BodyLimitError extends Error {
  constructor() {
    super('Request body exceeds the configured limit');
  }
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

async function readJsonBody(request: IncomingMessage, limitBytes: number): Promise<unknown> {
  const contentLength = Number(headerValue(request, 'content-length'));
  if (Number.isFinite(contentLength) && contentLength > limitBytes) {
    request.resume();
    throw new BodyLimitError();
  }
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('error', onError);
      request.removeListener('aborted', onError);
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
    const onError = () => finish(new HttpInputError('Request body could not be read'));
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onError);
  });
  if (chunks.length === 0) throw new HttpInputError('Request body must be a JSON object');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HttpInputError('Request body must contain valid JSON');
  }
}

function normalizeBasePath(basePath: string | undefined): string {
  const value = basePath ?? DEFAULT_BASE_PATH;
  if (!value.startsWith('/')) throw new TypeError('basePath must be an absolute URL path');
  const normalized = value.replace(/\/+$/u, '');
  if (normalized.length === 0) throw new TypeError('basePath must not be root');
  return normalized;
}

type RouteMatch = { operation: 'save' } | { operation: 'read'; snapshotId: string | null } | { operation: 'unknown' };

function matchRoute(pathname: string, basePath: string): RouteMatch | null {
  const normalized = pathname.replace(/\/+$/u, '') || '/';
  if (normalized === basePath) return { operation: 'save' };
  if (!normalized.startsWith(`${basePath}/`)) return null;
  const rest = normalized.slice(basePath.length + 1);
  if (rest.length === 0 || rest.includes('/')) return { operation: 'unknown' };
  try {
    return { operation: 'read', snapshotId: decodeURIComponent(rest) };
  } catch {
    return { operation: 'read', snapshotId: null };
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function parseSaveBody(body: unknown): JudgmentProblemSnapshot {
  if (!isPlainRecord(body)) throw new HttpInputError('Request body must be a JSON object');
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'snapshot') throw new HttpInputError('Request body must contain only snapshot');
  if (!isPlainRecord(body.snapshot)) throw new HttpInputError('snapshot must be a JSON object');
  return body.snapshot as unknown as JudgmentProblemSnapshot;
}

const STATUS_BY_CODE: Record<JudgmentProblemSnapshotErrorCode, number> = {
  invalid_request: 400,
  missing_reference: 422,
  not_applicable: 422,
  unresolved_constraint: 422,
  unauthorized: 403,
  not_found: 404,
  conflict: 409,
  integrity_mismatch: 409,
  storage_io_error: 503,
};

function snapshotError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof JudgmentProblemSnapshotError) {
    return { status: STATUS_BY_CODE[error.code] ?? 500, code: error.code, message: error.message };
  }
  return { status: 500, code: 'internal_error', message: 'Judgment problem snapshot request failed' };
}

function assertContext(context: TrustedJudgmentProblemSnapshotRequestContext): void {
  if (typeof context.principal !== 'string' || context.principal.trim().length === 0 || context.principal.length > 512) {
    throw new HttpInputError('Authenticated principal is required');
  }
}

async function mutationVerified(
  options: JudgmentProblemSnapshotHttpOptions,
  request: IncomingMessage,
  context: TrustedJudgmentProblemSnapshotRequestContext,
): Promise<boolean> {
  if (typeof context.verifiedMutationOrigin === 'string' && context.verifiedMutationOrigin.trim().length > 0) return true;
  if (!options.verifyMutationRequest) return false;
  try {
    return (await options.verifyMutationRequest({ request, context })) === true;
  } catch {
    return false;
  }
}

/**
 * Saves and reads immutable judgment problem snapshots over HTTP. The host
 * authenticates, binds the principal, and supplies the reference resolution;
 * this handler never takes identity from the request body.
 */
export function createJudgmentProblemSnapshotHttpHandler(
  options: JudgmentProblemSnapshotHttpOptions,
): JudgmentProblemSnapshotHttpHandler {
  if (!options || typeof options !== 'object') throw new TypeError('options are required');
  if (typeof options.root !== 'string' || options.root.trim().length === 0) throw new TypeError('root must be a non-empty path');
  if (typeof options.providerFactory !== 'function') throw new TypeError('providerFactory is required');
  const basePath = normalizeBasePath(options.basePath);
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  if (!Number.isInteger(bodyLimitBytes) || bodyLimitBytes <= 0) throw new TypeError('bodyLimitBytes must be a positive integer');

  return async (request, response, context): Promise<boolean> => {
    const route = matchRoute(requestPath(request), basePath);
    if (!route) return false;
    if (!context) {
      writeError(response, 401, 'unauthorized', 'Authenticated judgment problem snapshot context is required');
      return true;
    }
    try {
      assertContext(context);
    } catch (error) {
      writeError(response, 401, 'unauthorized', error instanceof Error ? error.message : 'Authenticated principal is required');
      return true;
    }
    if (route.operation === 'unknown') {
      writeError(response, 404, 'not_found', 'Judgment problem snapshot route was not found');
      return true;
    }
    const method = (request.method ?? 'GET').toUpperCase();
    const allowed = route.operation === 'save' ? 'POST' : 'GET';
    if (method !== allowed) {
      writeError(response, 405, 'method_not_allowed', 'Method is not allowed for this judgment problem snapshot route', { Allow: allowed });
      return true;
    }

    if (route.operation === 'read') {
      if (!route.snapshotId || !snapshotIdPattern.test(route.snapshotId)) {
        writeError(response, 400, 'invalid_request', 'snapshot_id must be sha256:<64 lowercase hex>');
        return true;
      }
      try {
        const providers = await options.providerFactory(context);
        const snapshot = await loadJudgmentProblemSnapshot({
          root: options.root,
          snapshot_id: route.snapshotId,
          access: { principal: context.principal },
          reference_resolution: 'current',
          referenceProvider: providers.referenceProvider,
          ...(providers.accessProvider ? { accessProvider: providers.accessProvider } : {}),
        });
        writeJson(response, 200, { action: 'read', snapshotId: route.snapshotId, result: snapshot });
      } catch (error) {
        const failure = snapshotError(error);
        writeError(response, failure.status, failure.code, failure.message);
      }
      return true;
    }

    let snapshot: JudgmentProblemSnapshot;
    try {
      snapshot = parseSaveBody(await readJsonBody(request, bodyLimitBytes));
    } catch (error) {
      if (error instanceof BodyLimitError) writeError(response, 413, 'body_too_large', error.message);
      else writeError(response, 400, 'invalid_request', error instanceof Error ? error.message : 'Request body is invalid');
      return true;
    }
    if (!await mutationVerified(options, request, context)) {
      writeError(response, 403, 'mutation_origin_unverified', 'Mutation origin could not be verified');
      return true;
    }
    try {
      const providers = await options.providerFactory(context);
      const receipt = await saveJudgmentProblemSnapshot({
        root: options.root,
        snapshot,
        access: { principal: context.principal },
        referenceProvider: providers.referenceProvider,
        ...(providers.accessProvider ? { accessProvider: providers.accessProvider } : {}),
      });
      writeJson(response, receipt.status === 'created' ? 201 : 200, { action: 'save', result: receipt });
    } catch (error) {
      const failure = snapshotError(error);
      writeError(response, failure.status, failure.code, failure.message);
    }
    return true;
  };
}

export const createJudgmentProblemSnapshotRoute = createJudgmentProblemSnapshotHttpHandler;
