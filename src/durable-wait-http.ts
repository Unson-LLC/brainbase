import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  DURABLE_WAIT_VERSION,
  DurableWaitError,
  type DurableWaitClaimInput,
  type DurableWaitCreateInput,
  type DurableWaitEffectUnknownInput,
  type DurableWaitHandoffInput,
  type DurableWaitPremiseChangedInput,
  type DurableWaitResumeInput,
  type DurableWaitStore,
} from './durable-waits.js';

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_BASE_PATH = '/api/v1/durable-waits';
const snapshotIdPattern = /^sha256:[0-9a-f]{64}$/u;

/** Version of the HTTP boundary. The store version is returned separately. */
export const DURABLE_WAIT_HTTP_VERSION = 'durable-wait-http.v1' as const;

type MaybePromise<T> = T | Promise<T>;

/** Context resolved by the host after authentication and tenant selection. */
export interface TrustedDurableWaitRequestContext {
  readonly tenantId: string;
  readonly principal: string;
  readonly scopeId: string;
  /** A non-empty value means that the host already verified the mutation origin. */
  readonly verifiedMutationOrigin?: string;
}

/** A host creates the store with current ACL and Problem snapshot providers. */
export type DurableWaitStoreFactory = (
  context: TrustedDurableWaitRequestContext,
) => MaybePromise<DurableWaitStore>;

export interface DurableWaitMutationVerificationInput {
  readonly request: IncomingMessage;
  readonly context: TrustedDurableWaitRequestContext;
}

export interface DurableWaitHttpOptions {
  readonly storeFactory: DurableWaitStoreFactory;
  readonly basePath?: string;
  readonly bodyLimitBytes?: number;
  /** Required for hosts that do not attach verifiedMutationOrigin to context. */
  readonly verifyMutationRequest?: (
    input: DurableWaitMutationVerificationInput,
  ) => MaybePromise<boolean>;
}

/**
 * The smallest canonical Node host composition for this transport.
 *
 * Authentication and tenant/scope resolution remain host-owned.  The resolver
 * must return a context only after those checks have completed; a missing or
 * failed resolution is deliberately passed to the handler as an unauthenticated
 * request.  This helper only mounts the canonical handler and never infers
 * identity from request headers or body fields.
 */
export interface DurableWaitHttpHostOptions extends DurableWaitHttpOptions {
  readonly resolveContext: (
    request: IncomingMessage,
  ) => MaybePromise<TrustedDurableWaitRequestContext | null>;
}

/** A composable route handler. `false` means that another host route may handle it. */
export type DurableWaitHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  context: TrustedDurableWaitRequestContext | null,
) => Promise<boolean>;

const boundedText = z.string().min(1).max(512).refine(
  (value) => !/[\u0000-\u001f\u007f]/u.test(value),
  'must be a bounded text value',
);

const scopeSchema = z.object({
  type: z.enum(['personal', 'project', 'organization']),
  id: boundedText,
}).strict();

const aclSchema = z.object({
  visibility: z.enum(['private', 'project', 'organization', 'public']),
  ownerId: boundedText,
  readerIds: z.array(boundedText),
  writerIds: z.array(boundedText),
}).strict();

const problemSchema = z.object({
  snapshot_id: z.string().min(1).max(512).regex(snapshotIdPattern),
  problem_id: boundedText,
  revision: boundedText,
}).strict();

const conditionSchema = z.object({
  event: z.object({
    event_type: boundedText,
    event_id: boundedText.optional(),
    predicate: boundedText.optional(),
  }).strict().optional(),
  expression: boundedText.optional(),
}).strict();

const deadlineSchema = z.object({
  due_at: boundedText.optional(),
  review_interval_ms: z.number().int().positive().finite().optional(),
  next_review_at: boundedText.optional(),
}).strict();

const responsibleSchema = z.object({
  principal: boundedText,
  scope: boundedText.optional(),
}).strict();

const runRefSchema = z.object({
  run_id: boundedText,
  node_id: boundedText.optional(),
}).strict();

const identitySchema = z.object({
  tenantId: boundedText,
  principal: boundedText,
  scopeId: boundedText,
});

const createSchema = identitySchema.extend({
  wait_id: boundedText.optional(),
  owner_scope: scopeSchema,
  read_policy: aclSchema,
  problem_snapshot: problemSchema.optional(),
  problem: problemSchema.optional(),
  condition: conditionSchema,
  deadline: deadlineSchema.optional(),
  responsible: responsibleSchema,
  resume_method: z.enum(['resume_run', 'new_problem', 'reconcile_external_effect', 'manual_review']),
  failure_policy: z.enum(['handoff', 'new_problem', 'reconciliation_wait', 'fail']),
  run_ref: runRefSchema,
  created_at: boundedText.optional(),
}).strict();

const claimSchema = identitySchema.extend({
  wait_id: boundedText,
  request_id: boundedText,
  trigger: z.enum(['event', 'timer', 'manual']),
  event_type: boundedText.optional(),
  event_id: boundedText.optional(),
  occurred_at: boundedText.optional(),
  lease_ms: z.number().int().positive().finite().optional(),
}).strict();

const resumeSchema = identitySchema.extend({
  wait_id: boundedText,
  request_id: boundedText,
  claim_id: boundedText,
  lease_id: boundedText,
  lease_token: boundedText,
}).strict();

const handoffSchema = identitySchema.extend({
  wait_id: boundedText,
  request_id: boundedText,
  responsible: responsibleSchema,
  lease_ms: z.number().int().positive().finite().optional(),
  now: boundedText.optional(),
  reason: boundedText.optional(),
}).strict();

const premiseChangedSchema = identitySchema.extend({
  wait_id: boundedText,
  new_problem_snapshot: problemSchema.optional(),
  new_problem: problemSchema.optional(),
  responsible: responsibleSchema.optional(),
  reason: boundedText,
}).strict();

const effectUnknownSchema = identitySchema.extend({
  wait_id: boundedText,
  reason: boundedText,
  responsible: responsibleSchema.optional(),
}).strict();

type RouteOperation =
  | 'create'
  | 'read'
  | 'claim'
  | 'resume'
  | 'handoff'
  | 'premise-changed'
  | 'effect-unknown';

interface RouteMatch {
  readonly operation: RouteOperation | null;
  readonly waitId?: string;
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

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  if (response.headersSent) return;
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('X-Brainbase-Durable-Wait-Protocol', DURABLE_WAIT_HTTP_VERSION);
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
  if (normalized === basePath) return { operation: null };
  const prefix = `${basePath}/`;
  if (!normalized.startsWith(prefix)) return null;
  const suffix = normalized.slice(prefix.length);
  const operationNames: readonly RouteOperation[] = [
    'create', 'claim', 'resume', 'handoff', 'premise-changed', 'effect-unknown',
  ];
  if (operationNames.includes(suffix as RouteOperation)) return { operation: suffix as RouteOperation };
  if (!suffix.includes('/')) {
    try {
      const waitId = decodeURIComponent(suffix);
      if (waitId.length > 0 && waitId.length <= 512) return { operation: 'read', waitId };
    } catch {
      return { operation: null };
    }
  }
  return { operation: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function assertContext(
  context: TrustedDurableWaitRequestContext | null,
): asserts context is TrustedDurableWaitRequestContext {
  if (!context
    || typeof context.tenantId !== 'string' || context.tenantId.length === 0
    || typeof context.principal !== 'string' || context.principal.length === 0
    || typeof context.scopeId !== 'string' || context.scopeId.length === 0) {
    throw new HttpInputError('Authenticated durable-wait context is required');
  }
}

/** Bind all identity fields to the host-authenticated context; body identity never widens it. */
function bindTrustedIdentity(
  body: unknown,
  context: TrustedDurableWaitRequestContext,
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

function assertOwnerScope(result: unknown, context: TrustedDurableWaitRequestContext): void {
  if (!isRecord(result) || !isRecord(result.owner_scope) || result.owner_scope.id !== context.scopeId) {
    throw new DurableWaitError('unauthorized', 'Durable wait scope does not match the trusted request context');
  }
}

function serviceError(error: unknown): { status: number; code: string; message: string } {
  if (!(error instanceof DurableWaitError)) {
    return { status: 500, code: 'internal_error', message: 'Durable wait operation failed' };
  }
  const status = (() => {
    switch (error.code) {
      case 'unauthorized': return 403;
      case 'not_found': return 404;
      case 'invalid_request':
      case 'problem_snapshot_invalid': return 400;
      case 'reconciliation_required':
      case 'condition_unmet':
      case 'lease_active':
      case 'lease_expired':
      case 'state_conflict': return 409;
      case 'ledger_invalid': return 500;
      default: return 500;
    }
  })();
  return { status, code: error.code, message: error.message };
}

function writeError(response: ServerResponse, status: number, code: string, message: string): void {
  writeJson(response, status, {
    protocol_version: DURABLE_WAIT_HTTP_VERSION,
    error: { code, message },
  });
}

function methodAllowed(operation: RouteOperation | null, method: string): boolean {
  return operation === 'read' ? method === 'GET' : operation !== null && method === 'POST';
}

async function verifyMutationRequest(
  options: DurableWaitHttpOptions,
  request: IncomingMessage,
  context: TrustedDurableWaitRequestContext,
): Promise<boolean> {
  if (typeof context.verifiedMutationOrigin === 'string' && context.verifiedMutationOrigin.trim().length > 0) return true;
  if (!options.verifyMutationRequest) return false;
  try {
    return Boolean(await options.verifyMutationRequest({ request, context }));
  } catch {
    return false;
  }
}

function success(
  context: TrustedDurableWaitRequestContext,
  action: RouteOperation,
  result: unknown,
): Record<string, unknown> {
  return {
    protocol_version: DURABLE_WAIT_HTTP_VERSION,
    store_version: DURABLE_WAIT_VERSION,
    tenant_id: context.tenantId,
    scope_id: context.scopeId,
    action,
    result,
  };
}

function parseBody(operation: Exclude<RouteOperation, 'read'>, body: unknown, context: TrustedDurableWaitRequestContext):
  | DurableWaitCreateInput
  | DurableWaitClaimInput
  | DurableWaitResumeInput
  | DurableWaitHandoffInput
  | DurableWaitPremiseChangedInput
  | DurableWaitEffectUnknownInput {
  const bound = bindTrustedIdentity(body, context);
  const parsed = (() => {
    switch (operation) {
      case 'create': return createSchema.safeParse(bound);
      case 'claim': return claimSchema.safeParse(bound);
      case 'resume': return resumeSchema.safeParse(bound);
      case 'handoff': return handoffSchema.safeParse(bound);
      case 'premise-changed': return premiseChangedSchema.safeParse(bound);
      case 'effect-unknown': return effectUnknownSchema.safeParse(bound);
    }
  })();
  if (!parsed.success) throw new HttpInputError(parsed.error.issues[0]?.message ?? 'Request body is invalid');
  const value = parsed.data as Record<string, unknown>;
  if ('owner_scope' in value && isRecord(value.owner_scope) && value.owner_scope.id !== context.scopeId) {
    throw new HttpInputError('owner_scope does not match the trusted request context');
  }
  const { tenantId: _tenantId, scopeId: _scopeId, ...storeInput } = value;
  return storeInput as unknown as DurableWaitCreateInput
    | DurableWaitClaimInput
    | DurableWaitResumeInput
    | DurableWaitHandoffInput
    | DurableWaitPremiseChangedInput
    | DurableWaitEffectUnknownInput;
}

export function createDurableWaitHttpHandler(options: DurableWaitHttpOptions): DurableWaitHttpHandler {
  if (!options || typeof options !== 'object' || typeof options.storeFactory !== 'function') {
    throw new TypeError('storeFactory is required');
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
      writeError(response, 401, 'unauthorized', 'Authenticated durable-wait context is required');
      return true;
    }
    try {
      assertContext(context);
    } catch (error) {
      writeError(response, 401, 'unauthorized', error instanceof Error ? error.message : 'Authenticated durable-wait context is required');
      return true;
    }
    if (!route.operation) {
      writeError(response, 404, 'not_found', 'Durable wait route was not found');
      return true;
    }
    const method = (request.method ?? 'GET').toUpperCase();
    if (!methodAllowed(route.operation, method)) {
      writeError(response, 405, 'method_not_allowed', 'Method is not allowed for this durable-wait route');
      return true;
    }

    if (route.operation === 'read') {
      try {
        const store = await options.storeFactory(context);
        const result = await store.read({ wait_id: route.waitId!, principal: context.principal });
        assertOwnerScope(result, context);
        writeJson(response, 200, success(context, route.operation, result));
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
      if (error instanceof BodyLimitError) writeError(response, 413, 'body_too_large', error.message);
      else writeError(response, 400, 'invalid_request', error instanceof Error ? error.message : 'Request body is invalid');
      return true;
    }

    let parsed: DurableWaitCreateInput
      | DurableWaitClaimInput
      | DurableWaitResumeInput
      | DurableWaitHandoffInput
      | DurableWaitPremiseChangedInput
      | DurableWaitEffectUnknownInput;
    try {
      parsed = parseBody(route.operation, body, context);
    } catch (error) {
      writeError(response, 400, 'invalid_request', error instanceof Error ? error.message : 'Request body is invalid');
      return true;
    }
    if (!await verifyMutationRequest(options, request, context)) {
      writeError(response, 403, 'mutation_origin_unverified', 'Mutation origin could not be verified');
      return true;
    }

    try {
      const store = await options.storeFactory(context);
      if (route.operation !== 'create') {
        // owner_scope is immutable after creation. Resolve it through the
        // current ACL before entering any mutation so a principal shared by
        // two scopes cannot mutate a wait and receive a 403 only afterwards.
        // The store's own compare-and-swap preflight then rechecks the current
        // record while holding its mutation boundary for concurrent updates.
        const waitId = (parsed as { readonly wait_id: string }).wait_id;
        const current = await store.read({ wait_id: waitId, principal: context.principal });
        assertOwnerScope(current, context);
      }
      let result: unknown;
      switch (route.operation) {
        case 'create':
          result = await store.create(parsed as DurableWaitCreateInput);
          assertOwnerScope(result, context);
          break;
        case 'claim': {
          result = await store.claim(parsed as DurableWaitClaimInput);
          assertOwnerScope((result as { wait: unknown }).wait, context);
          break;
        }
        case 'resume':
          result = await store.resume(parsed as DurableWaitResumeInput);
          break;
        case 'handoff':
          result = await store.handoff(parsed as DurableWaitHandoffInput);
          assertOwnerScope(result, context);
          break;
        case 'premise-changed':
          result = await store.markPremiseChanged(parsed as DurableWaitPremiseChangedInput);
          assertOwnerScope(result, context);
          break;
        case 'effect-unknown':
          result = await store.markEffectUnknown(parsed as DurableWaitEffectUnknownInput);
          assertOwnerScope(result, context);
          break;
      }
      writeJson(response, 200, success(context, route.operation, result));
    } catch (error) {
      const failure = serviceError(error);
      writeError(response, failure.status, failure.code, failure.message);
    }
    return true;
  };
}

/**
 * Create a startable Node HTTP host around the canonical handler.
 *
 * The caller owns `server.listen()` and the authentication implementation.
 * A route outside the durable-wait base path is answered with a generic 404 so
 * a standalone fixture cannot leave the request hanging; larger hosts can use
 * `createDurableWaitHttpHandler` directly when they need route delegation.
 */
export function createDurableWaitHttpHost(options: DurableWaitHttpHostOptions): Server {
  if (!options || typeof options !== 'object' || typeof options.resolveContext !== 'function') {
    throw new TypeError('resolveContext is required');
  }
  const handler = createDurableWaitHttpHandler(options);
  return createServer((request, response) => {
    void Promise.resolve()
      .then(() => options.resolveContext(request))
      .catch(() => null)
      .then((context) => handler(request, response, context))
      .then((handled) => {
        if (handled || response.headersSent) return;
        writeError(response, 404, 'not_found', 'Route was not found');
      })
      .catch(() => {
        writeError(response, 500, 'internal_error', 'Durable wait host failed');
      });
  });
}
