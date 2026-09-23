import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  ResourceReservationError,
  ResourceReservationService,
  type ApproveResourceReservationInput,
  type EstimateResourceReservationInput,
  type ReserveResourceReservationInput,
  type ResourceReservationMutationInput,
} from './resource-reservations.js';

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_BASE_PATH = '/resource-reservations';
const snapshotIdPattern = /^sha256:[0-9a-f]{64}$/u;

type MaybePromise<T> = T | Promise<T>;

/** Context resolved by the host after authentication and tenant selection. */
export interface TrustedResourceReservationRequestContext {
  tenantId: string;
  principal: string;
  scopeId: string;
  /** A non-empty value means that the host already verified the mutation origin. */
  verifiedMutationOrigin?: string;
}

/** The factory is the boundary where a host binds a service to its trusted context. */
export type ResourceReservationServiceFactory = (
  context: TrustedResourceReservationRequestContext,
) => MaybePromise<ResourceReservationService>;

export interface ResourceReservationMutationVerificationInput {
  request: IncomingMessage;
  context: TrustedResourceReservationRequestContext;
}

export interface ResourceReservationHttpOptions {
  serviceFactory: ResourceReservationServiceFactory;
  basePath?: string;
  bodyLimitBytes?: number;
  /** Required for hosts that do not attach verifiedMutationOrigin to context. */
  verifyMutationRequest?: (
    input: ResourceReservationMutationVerificationInput,
  ) => MaybePromise<boolean>;
}

/**
 * A composable route handler.  `false` means that the request is outside this
 * route and may be passed to the host's next handler.
 */
export type ResourceReservationHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  context: TrustedResourceReservationRequestContext | null,
) => Promise<boolean>;

const boundedText = z.string().min(1).max(512).refine(
  (value) => !/[\u0000-\u001f\u007f]/u.test(value),
  'must be a bounded text value',
);

const periodSchema = z.object({
  startsAt: boundedText,
  endsAt: boundedText,
}).strict();

const problemSchema = z.object({
  problem_snapshot_id: z.string().min(1).max(512).regex(snapshotIdPattern),
  problem_id: boundedText,
  revision: boundedText,
}).strict();

const reservationRequestSchema = z.object({
  operationId: boundedText,
  tenantId: boundedText,
  principal: boundedText,
  scopeId: boundedText,
  resourceId: boundedText,
  period: periodSchema,
  amount: z.number().finite().positive(),
  unit: boundedText,
  runId: boundedText,
  problem: problemSchema,
}).strict();

const reserveRequestSchema = reservationRequestSchema.extend({
  approvalId: boundedText.optional(),
}).strict();

const mutationSchema = z.object({
  operationId: boundedText,
  tenantId: boundedText,
  principal: boundedText,
  scopeId: boundedText,
  reservationId: boundedText,
}).strict();

type RouteOperation = 'read' | 'estimate' | 'approve' | 'reserve' | 'release' | 'cancel' | 'consume';

interface RouteMatch {
  operation: RouteOperation | null;
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
  if (normalized === basePath) return { operation: 'read' };
  const prefix = `${basePath}/`;
  if (!normalized.startsWith(prefix)) return null;
  const operation = normalized.slice(prefix.length);
  const operations: readonly RouteOperation[] = ['estimate', 'approve', 'reserve', 'release', 'cancel', 'consume'];
  return { operation: operations.includes(operation as RouteOperation) ? operation as RouteOperation : null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertContext(context: TrustedResourceReservationRequestContext | null): asserts context is TrustedResourceReservationRequestContext {
  if (!context
    || typeof context.tenantId !== 'string' || context.tenantId.length === 0
    || typeof context.principal !== 'string' || context.principal.length === 0
    || typeof context.scopeId !== 'string' || context.scopeId.length === 0) {
    throw new HttpInputError('Authenticated reservation context is required');
  }
}

function bindTrustedIdentity(
  body: unknown,
  context: TrustedResourceReservationRequestContext,
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

function parseOperationBody(operation: Exclude<RouteOperation, 'read'>, body: unknown, context: TrustedResourceReservationRequestContext):
  | EstimateResourceReservationInput
  | ApproveResourceReservationInput
  | ReserveResourceReservationInput
  | ResourceReservationMutationInput {
  const bound = bindTrustedIdentity(body, context);
  const parsed = operation === 'reserve'
    ? reserveRequestSchema.safeParse(bound)
    : operation === 'estimate' || operation === 'approve'
      ? reservationRequestSchema.safeParse(bound)
      : mutationSchema.safeParse(bound);
  if (!parsed.success) {
    throw new HttpInputError(parsed.error.issues[0]?.message ?? 'Request body is invalid');
  }
  return parsed.data as EstimateResourceReservationInput
    | ApproveResourceReservationInput
    | ReserveResourceReservationInput
    | ResourceReservationMutationInput;
}

function serviceError(error: unknown): { status: number; code: string; message: string } {
  if (!(error instanceof ResourceReservationError)) {
    return { status: 500, code: 'internal_error', message: 'Resource reservation operation failed' };
  }
  const status = (() => {
    switch (error.code) {
      case 'authorization_denied':
      case 'scope_mismatch':
        return 403;
      case 'reservation_not_found':
        return 404;
      case 'capacity_unknown':
        return 503;
      case 'operation_conflict':
      case 'approval_expired':
      case 'approval_revoked':
      case 'approval_required':
      case 'approval_mismatch':
      case 'capacity_exceeded':
      case 'reservation_state_conflict':
      case 'external_action_reconciliation_required':
        return 409;
      case 'ledger_invalid':
        return 500;
      case 'validation_error':
      case 'problem_snapshot_invalid':
        return 400;
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
  return operation === 'read' ? method === 'GET' : method === 'POST';
}

async function verifyMutationRequest(
  options: ResourceReservationHttpOptions,
  request: IncomingMessage,
  context: TrustedResourceReservationRequestContext,
): Promise<boolean> {
  if (typeof context.verifiedMutationOrigin === 'string' && context.verifiedMutationOrigin.trim().length > 0) return true;
  if (!options.verifyMutationRequest) return false;
  try {
    return Boolean(await options.verifyMutationRequest({ request, context }));
  } catch {
    return false;
  }
}

export function createResourceReservationHttpHandler(
  options: ResourceReservationHttpOptions,
): ResourceReservationHttpHandler {
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
      writeError(response, 401, 'unauthorized', 'Authenticated reservation context is required');
      return true;
    }
    try {
      assertContext(context);
    } catch (error) {
      writeError(response, 401, 'unauthorized', error instanceof Error ? error.message : 'Authenticated reservation context is required');
      return true;
    }
    if (!route.operation) {
      writeError(response, 404, 'not_found', 'Resource reservation route was not found');
      return true;
    }
    const method = (request.method ?? 'GET').toUpperCase();
    if (!methodAllowed(route.operation, method)) {
      writeError(
        response,
        405,
        'method_not_allowed',
        'Method is not allowed for this reservation route',
        { Allow: route.operation === 'read' ? 'GET' : 'POST' },
      );
      return true;
    }

    if (route.operation === 'read') {
      try {
        const service = await options.serviceFactory(context);
        const result = await service.readLedger({
          tenantId: context.tenantId,
          principal: context.principal,
          scopeId: context.scopeId,
        });
        writeJson(response, 200, { action: 'read', result });
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

    let parsed: EstimateResourceReservationInput
      | ApproveResourceReservationInput
      | ReserveResourceReservationInput
      | ResourceReservationMutationInput;
    try {
      parsed = parseOperationBody(route.operation, body, context);
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
      let result: unknown;
      switch (route.operation) {
        case 'estimate':
          result = await service.estimate(parsed as EstimateResourceReservationInput);
          break;
        case 'approve':
          result = await service.approve(parsed as ApproveResourceReservationInput);
          break;
        case 'reserve':
          result = await service.reserve(parsed as ReserveResourceReservationInput);
          break;
        case 'release':
          result = await service.release(parsed as ResourceReservationMutationInput);
          break;
        case 'cancel':
          result = await service.cancel(parsed as ResourceReservationMutationInput);
          break;
        case 'consume':
          result = await service.consume(parsed as ResourceReservationMutationInput);
          break;
      }
      const operationId = 'operationId' in parsed ? parsed.operationId : undefined;
      writeJson(response, 200, {
        action: route.operation,
        ...(operationId === undefined ? {} : { operationId }),
        result,
      });
    } catch (error) {
      const failure = serviceError(error);
      writeError(response, failure.status, failure.code, failure.message);
    }
    return true;
  };
}
