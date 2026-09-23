import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  ExecutionAuthorityError,
  ExecutionAuthorityService,
  type ExecutionProblemReference,
  type ExecutionStartInput,
} from './execution-authority.js';

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_BASE_PATH = '/execution-authority';
const snapshotIdPattern = /^sha256:[0-9a-f]{64}$/u;

type MaybePromise<T> = T | Promise<T>;

/** Context resolved by the host after authentication and tenant selection. */
export interface TrustedExecutionAuthorityRequestContext {
  tenantId: string;
  principal: string;
  scopeId: string;
  /** A non-empty value means that the host already verified the mutation origin. */
  verifiedMutationOrigin?: string;
}

/** The factory is the boundary where a host binds a service to its trusted context. */
export type ExecutionAuthorityServiceFactory = (
  context: TrustedExecutionAuthorityRequestContext,
) => MaybePromise<Pick<ExecutionAuthorityService, 'start' | 'readIntent'>>;

export interface ExecutionAuthorityMutationVerificationInput {
  request: IncomingMessage;
  context: TrustedExecutionAuthorityRequestContext;
}

export interface ExecutionAuthorityHttpOptions {
  serviceFactory: ExecutionAuthorityServiceFactory;
  basePath?: string;
  bodyLimitBytes?: number;
  /** Required for hosts that do not attach verifiedMutationOrigin to context. */
  verifyMutationRequest?: (
    input: ExecutionAuthorityMutationVerificationInput,
  ) => MaybePromise<boolean>;
}

/** A composable route handler. `false` means that the request is outside this route. */
export type ExecutionAuthorityHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  context: TrustedExecutionAuthorityRequestContext | null,
) => Promise<boolean>;

const boundedText = z.string().min(1).max(512).refine(
  (value) => !/[\u0000-\u001f\u007f]/u.test(value),
  'must be a bounded text value',
);

const problemSchema = z.object({
  problem_snapshot_id: z.string().min(1).max(512).regex(snapshotIdPattern),
  problem_id: boundedText,
  revision: boundedText,
}).strict();

const startRequestSchema = z.object({
  operationId: boundedText,
  tenantId: boundedText,
  principal: boundedText,
  scopeId: boundedText,
  runId: boundedText,
  reservationId: boundedText,
  approvalId: boundedText,
  authorityRef: boundedText,
  constraintRefs: z.array(boundedText).max(128),
  problem: problemSchema,
}).strict();

type RouteOperation = 'start' | 'read' | 'unknown';

interface RouteMatch {
  operation: RouteOperation;
  operationId?: string;
}

class HttpInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HttpInputError';
  }
}

class BodyLimitError extends Error {
  constructor() {
    super('Request body exceeds the configured limit');
    this.name = 'BodyLimitError';
  }
}

class BodyReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodyReadError';
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
    const onError = () => finish(new BodyReadError('Request body could not be read'));
    const onAborted = () => finish(new BodyReadError('Request was aborted'));
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAborted);
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
  if (typeof value !== 'string' || !value.startsWith('/') || value === '/' || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('basePath must be an absolute URL path');
  }
  const normalized = value.replace(/\/+$/u, '');
  if (normalized.length === 0) throw new TypeError('basePath must not be root');
  return normalized;
}

function normalizePath(path: string): string {
  if (path.length > 1) return path.replace(/\/+$/u, '');
  return path;
}

function matchRoute(path: string, basePath: string): RouteMatch | null {
  const normalized = normalizePath(path);
  if (normalized === basePath) return { operation: 'unknown' };
  const prefix = `${basePath}/`;
  if (!normalized.startsWith(prefix)) return null;
  const suffix = normalized.slice(prefix.length);
  if (suffix === 'start') return { operation: 'start' };
  const intentPrefix = 'intents/';
  if (suffix.startsWith(intentPrefix)) {
    const encodedOperationId = suffix.slice(intentPrefix.length);
    if (encodedOperationId.length === 0 || encodedOperationId.includes('/')) return { operation: 'unknown' };
    try {
      return { operation: 'read', operationId: decodeURIComponent(encodedOperationId) };
    } catch {
      return { operation: 'read', operationId: undefined };
    }
  }
  return { operation: 'unknown' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertContext(context: TrustedExecutionAuthorityRequestContext | null): asserts context is TrustedExecutionAuthorityRequestContext {
  if (!context
    || !boundedText.safeParse(context.tenantId).success
    || !boundedText.safeParse(context.principal).success
    || !boundedText.safeParse(context.scopeId).success) {
    throw new HttpInputError('Authenticated execution authority context is required');
  }
}

function bindTrustedIdentity(
  body: unknown,
  context: TrustedExecutionAuthorityRequestContext,
): Record<string, unknown> {
  if (!isRecord(body)) throw new HttpInputError('Request body must be a JSON object');
  const input = { ...body };
  if (hasOwn(input, 'authority') || hasOwn(input, 'authorities')) {
    throw new HttpInputError('authority is not accepted in the request body');
  }

  const identityFields: ReadonlyArray<readonly [string, readonly string[], string]> = [
    ['tenantId', ['tenantId', 'tenant_id', 'tenant'], context.tenantId],
    ['principal', ['principal', 'actorId', 'actor_id', 'actor'], context.principal],
    ['scopeId', ['scopeId', 'scope_id'], context.scopeId],
  ];
  for (const [canonical, aliases, expected] of identityFields) {
    for (const alias of aliases) {
      if (!hasOwn(input, alias)) continue;
      if (typeof input[alias] !== 'string' || input[alias] !== expected) {
        throw new HttpInputError(`${canonical} does not match the trusted request context`);
      }
      delete input[alias];
    }
    input[canonical] = expected;
  }
  return input;
}

function parseStartBody(body: unknown, context: TrustedExecutionAuthorityRequestContext): ExecutionStartInput {
  const bound = bindTrustedIdentity(body, context);
  const parsed = startRequestSchema.safeParse(bound);
  if (!parsed.success) throw new HttpInputError(parsed.error.issues[0]?.message ?? 'Request body is invalid');
  return parsed.data as ExecutionStartInput;
}

function serviceError(error: unknown): { status: number; code: string; message: string } {
  if (!(error instanceof ExecutionAuthorityError)) {
    return { status: 500, code: 'internal_error', message: 'Execution authority operation failed' };
  }
  const status = (() => {
    switch (error.code) {
      case 'scope_mismatch':
      case 'authority_revoked':
      case 'authority_expired':
      case 'approval_revoked':
      case 'approval_expired':
      case 'constraint_revoked':
      case 'constraint_expired':
      case 'reservation_revoked':
      case 'reservation_expired':
      case 'read_revoked':
      case 'read_expired':
        return 403;
      case 'read_unknown':
      case 'authority_unknown':
      case 'approval_unknown':
      case 'constraint_unknown':
      case 'reservation_unknown':
        return 503;
      case 'operation_conflict':
      case 'revision_conflict':
      case 'fencing_unsupported':
      case 'capability_expired':
      case 'recovery_required':
      case 'reservation_mark_unknown':
      case 'effect_unknown':
        return 409;
      case 'validation_error':
        return 400;
      case 'ledger_invalid':
        return 500;
      default:
        return 500;
    }
  })();
  return { status, code: error.code, message: error.message };
}

function writeError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): void {
  writeJson(response, status, { error: { code, message } }, headers);
}

function methodAllowed(operation: RouteOperation, method: string): boolean {
  return operation === 'read' ? method === 'GET' : operation === 'start' ? method === 'POST' : false;
}

async function verifyMutationRequest(
  options: ExecutionAuthorityHttpOptions,
  request: IncomingMessage,
  context: TrustedExecutionAuthorityRequestContext,
): Promise<boolean> {
  if (typeof context.verifiedMutationOrigin === 'string' && context.verifiedMutationOrigin.trim().length > 0) return true;
  if (!options.verifyMutationRequest) return false;
  try {
    return (await options.verifyMutationRequest({ request, context })) === true;
  } catch {
    return false;
  }
}

export function createExecutionAuthorityHttpHandler(
  options: ExecutionAuthorityHttpOptions,
): ExecutionAuthorityHttpHandler {
  if (!options || typeof options !== 'object' || typeof options.serviceFactory !== 'function') {
    throw new TypeError('serviceFactory is required');
  }
  const basePath = normalizeBasePath(options.basePath);
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  if (!Number.isInteger(bodyLimitBytes) || bodyLimitBytes <= 0) {
    throw new TypeError('bodyLimitBytes must be a positive integer');
  }

  return async (request, response, context): Promise<boolean> => {
    const route = matchRoute(requestPath(request), basePath);
    if (!route) return false;
    if (!context) {
      writeError(response, 401, 'unauthorized', 'Authenticated execution authority context is required');
      return true;
    }
    try {
      assertContext(context);
    } catch (error) {
      writeError(response, 401, 'unauthorized', error instanceof Error ? error.message : 'Authenticated execution authority context is required');
      return true;
    }
    if (route.operation === 'unknown') {
      writeError(response, 404, 'not_found', 'Execution authority route was not found');
      return true;
    }

    const method = (request.method ?? 'GET').toUpperCase();
    if (!methodAllowed(route.operation, method)) {
      writeError(
        response,
        405,
        'method_not_allowed',
        'Method is not allowed for this execution authority route',
        { Allow: route.operation === 'read' ? 'GET' : 'POST' },
      );
      return true;
    }

    if (route.operation === 'read') {
      const parsedOperationId = boundedText.safeParse(route.operationId);
      if (!parsedOperationId.success) {
        writeError(response, 400, 'invalid_request', 'operationId is invalid');
        return true;
      }
      try {
        const service = await options.serviceFactory(context);
        const result = await service.readIntent({
          operationId: parsedOperationId.data,
          tenantId: context.tenantId,
          principal: context.principal,
          scopeId: context.scopeId,
        });
        if (!result) {
          writeError(response, 404, 'not_found', 'Execution intent was not found');
          return true;
        }
        writeJson(response, 200, { action: 'read', operationId: parsedOperationId.data, result });
      } catch (error) {
        const failure = serviceError(error);
        writeError(response, failure.status, failure.code, failure.message);
      }
      return true;
    }

    let body: unknown;
    try {
      body = await readJsonBody(request, bodyLimitBytes);
    } catch (error) {
      if (error instanceof BodyLimitError) {
        writeError(response, 413, 'body_too_large', error.message);
      } else {
        writeError(response, 400, 'invalid_request', error instanceof Error ? error.message : 'Request body is invalid');
      }
      return true;
    }

    let parsed: ExecutionStartInput;
    try {
      parsed = parseStartBody(body, context);
    } catch (error) {
      writeError(response, 400, 'invalid_request', error instanceof Error ? error.message : 'Request body is invalid');
      return true;
    }

    if (!await verifyMutationRequest(options, request, context)) {
      writeError(response, 403, 'mutation_origin_unverified', 'Mutation origin could not be verified');
      return true;
    }

    try {
      const service = await options.serviceFactory(context);
      const result = await service.start(parsed);
      writeJson(response, 200, { action: 'start', operationId: parsed.operationId, result });
    } catch (error) {
      const failure = serviceError(error);
      writeError(response, failure.status, failure.code, failure.message);
    }
    return true;
  };
}

export type { ExecutionProblemReference };
