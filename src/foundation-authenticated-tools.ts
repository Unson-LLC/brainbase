import { randomUUID } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { foundationPublicToolDefinitions } from './foundation-public-provider.js';
import {
  philosophyRevisionDigest,
  type PhilosophyRevisionRecord,
} from './philosophy-revision-reader.js';

export type FoundationAuthenticatedProjectContext = {
  token: string;
  scope: string[];
};

export type FoundationAuthenticatedToolResult = {
  status: 'ok' | 'error' | 'unavailable';
  scope: { project_codes: string[] };
  data?: unknown;
  error?: { code: string; message: string; http_status?: number; details?: unknown };
};

export type FoundationAuthenticatedRequest = {
  path: string;
  method: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export type FoundationAuthenticatedJsonResponse =
  | { ok: true; response: Response; payload: unknown; payloadParsed: boolean }
  | { ok: false; result: FoundationAuthenticatedToolResult };

/**
 * Narrow host port for authentication and authenticated Graph requests.
 * The OSS adapter owns request validation, CSRF/session binding, and response
 * validation; a connected Host supplies its canonical auth implementation.
 */
export type FoundationAuthenticatedToolPort = {
  authenticateProject(
    args: Record<string, unknown>,
    options?: { requireProject?: boolean },
  ): Promise<FoundationAuthenticatedProjectContext | FoundationAuthenticatedToolResult>;
  fetchAuthenticatedJson(
    context: FoundationAuthenticatedProjectContext,
    request: FoundationAuthenticatedRequest,
  ): Promise<FoundationAuthenticatedJsonResponse>;
  toolError(
    status: 'error' | 'unavailable',
    code: string,
    message: string,
    scope: string[],
    httpStatus?: number,
    details?: unknown,
  ): FoundationAuthenticatedToolResult;
};

export type FoundationAuthenticatedToolDependencies = {
  apiUrl: string;
  fetch?: typeof globalThis.fetch;
  auth: FoundationAuthenticatedToolPort;
};

const FOUNDATION_READ_TYPES = new Set(['objective', 'variable', 'model', 'constraint', 'philosophy']);
const FOUNDATION_TOOL_NAMES = new Set([
  'foundation_describe',
  'foundation_read',
  'foundation_validate_reference',
  'foundation_validate_problem',
]);
const REVISION_PATTERN = /^[1-9]\d*$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MAX_SCOPE_ID_LENGTH = 256;

type FoundationPublicToolName =
  | 'foundation_describe'
  | 'foundation_read'
  | 'foundation_validate_reference'
  | 'foundation_validate_problem';

export type FoundationPublicToolDependencies = FoundationAuthenticatedToolDependencies;

/**
 * The public provider owns the contract and schemas.  The Host adds the
 * authenticated Graph scope to every public tool because a provider cannot
 * select a tenant on behalf of the caller.
 */
function withScopeSchema(definition: (typeof foundationPublicToolDefinitions)[number]): Tool {
  const inputSchema = definition.inputSchema as unknown as Record<string, unknown>;
  const properties = inputSchema.properties && typeof inputSchema.properties === 'object'
    ? inputSchema.properties as Record<string, unknown>
    : {};
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((value): value is string => typeof value === 'string')
    : [];
  return {
    ...definition,
    inputSchema: {
      ...inputSchema,
      properties: {
        ...properties,
        scope_id: {
          type: 'string',
          minLength: 1,
          maxLength: MAX_SCOPE_ID_LENGTH,
          description: 'Authenticated project scope used for this read or validation.',
        },
      },
      required: [...new Set([...required, 'scope_id'])],
      additionalProperties: inputSchema.additionalProperties ?? false,
    },
  } as unknown as Tool;
}

export const foundationPublicTools: Tool[] = foundationPublicToolDefinitions.map(withScopeSchema);

export function isFoundationPublicToolName(name: string): name is FoundationPublicToolName {
  return FOUNDATION_TOOL_NAMES.has(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Scope IDs are copied into x-brainbase-projects.  Reject delimiters and
 * control characters before authentication so a caller cannot turn one
 * selected project into an arbitrary project list.
 */
function readScopeId(args: Record<string, unknown>): string | null {
  if (typeof args.scope_id !== 'string') return null;
  const scopeId = args.scope_id.trim();
  if (!scopeId || scopeId.length > MAX_SCOPE_ID_LENGTH) return null;
  if (/[\u0000-\u001f\u007f,]/u.test(scopeId)) return null;
  return scopeId;
}

function invalidInput(message: string, dependencies: FoundationPublicToolDependencies): FoundationAuthenticatedToolResult {
  return dependencies.auth.toolError('error', 'foundation_request_invalid', message, []);
}

function rejectUnexpectedKeys(args: Record<string, unknown>, allowed: readonly string[], dependencies: FoundationPublicToolDependencies): FoundationAuthenticatedToolResult | null {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(args).find((key) => !allowedKeys.has(key));
  return unexpected ? invalidInput(`unexpected Foundation argument: ${unexpected}`, dependencies) : null;
}

function readRequiredString(args: Record<string, unknown>, key: string): string | null {
  return isNonEmptyString(args[key]) ? String(args[key]).trim() : null;
}

function validateReadArgs(args: Record<string, unknown>, dependencies: FoundationPublicToolDependencies): FoundationAuthenticatedToolResult | null {
  const type = readRequiredString(args, 'type');
  const id = readRequiredString(args, 'id');
  const revision = readRequiredString(args, 'revision');
  if (!type || !FOUNDATION_READ_TYPES.has(type)) return invalidInput('foundation type is invalid', dependencies);
  if (!id) return invalidInput('foundation id is required', dependencies);
  if (!revision || !REVISION_PATTERN.test(revision)) return invalidInput('foundation revision is invalid', dependencies);
  if (args.digest !== undefined && (!isNonEmptyString(args.digest) || !DIGEST_PATTERN.test(String(args.digest)))) {
    return invalidInput('foundation digest is invalid', dependencies);
  }
  return null;
}

function validateReferenceArgs(args: Record<string, unknown>, dependencies: FoundationPublicToolDependencies): FoundationAuthenticatedToolResult | null {
  if (!isRecord(args.reference)) return invalidInput('foundation reference is required', dependencies);
  const reference = args.reference;
  if (!isNonEmptyString(reference.kind) || !['objective', 'variable', 'model', 'constraint', 'philosophy'].includes(reference.kind)) {
    return invalidInput('foundation reference kind is invalid', dependencies);
  }
  if (!isNonEmptyString(reference.id) || !isNonEmptyString(reference.revision) || !REVISION_PATTERN.test(String(reference.revision))) {
    return invalidInput('foundation reference identity is invalid', dependencies);
  }
  if (!isNonEmptyString(reference.digest) || !DIGEST_PATTERN.test(String(reference.digest))) {
    return invalidInput('foundation reference digest is invalid', dependencies);
  }
  if (!isRecord(reference.scope) || !isNonEmptyString(reference.scope.type) || !isNonEmptyString(reference.scope.id)) {
    return invalidInput('foundation reference scope is invalid', dependencies);
  }
  if (!['personal', 'project', 'organization'].includes(reference.scope.type)) {
    return invalidInput('foundation reference scope type is invalid', dependencies);
  }
  if (!isNonEmptyString(reference.valid_from)) return invalidInput('foundation reference valid_from is required', dependencies);
  if (args.phase !== undefined && args.phase !== 'read' && args.phase !== 'historical_read') {
    return invalidInput('foundation validation phase is invalid', dependencies);
  }
  return null;
}

function validateProblemArgs(args: Record<string, unknown>, dependencies: FoundationPublicToolDependencies): FoundationAuthenticatedToolResult | null {
  if (!isRecord(args.snapshot)) return invalidInput('foundation snapshot is required', dependencies);
  return null;
}

function selectedContext(context: FoundationAuthenticatedProjectContext, scopeId: string): FoundationAuthenticatedProjectContext {
  // authenticateProject proves membership against both the token and the
  // configured allow-list.  Restrict the outbound header to the selected
  // project instead of forwarding every project in the token.
  return { token: context.token, scope: [scopeId] };
}

function requestFor(name: FoundationPublicToolName, args: Record<string, unknown>, scopeId: string) {
  const query = new URLSearchParams({ scope_id: scopeId });
  if (name === 'foundation_describe') {
    return { path: `/api/foundation/contract?${query.toString()}`, method: 'GET' };
  }
  if (name === 'foundation_read') {
    const type = String(args.type);
    const id = String(args.id);
    query.set('revision', String(args.revision));
    if (args.digest !== undefined) query.set('digest', String(args.digest));
    return {
      path: `/api/foundation/definitions/${encodeURIComponent(type)}/${encodeURIComponent(id)}?${query.toString()}`,
      method: 'GET',
    };
  }
  if (name === 'foundation_validate_reference') {
    const { scope_id: _scopeId, ...body } = args;
    return {
      path: `/api/foundation/judgment-references/validate?${query.toString()}`,
      method: 'POST',
      body,
    };
  }
  const { scope_id: _scopeId, ...body } = args;
  return {
    path: `/api/foundation/judgment-problems/validate?${query.toString()}`,
    method: 'POST',
    body,
  };
}

type FoundationRequest = ReturnType<typeof requestFor>;

async function fetchFoundationCsrfToken(
  dependencies: FoundationPublicToolDependencies,
  context: FoundationAuthenticatedProjectContext,
): Promise<
  | { ok: true; sessionId: string; token: string }
  | { ok: false; result: FoundationAuthenticatedToolResult }
> {
  const sessionId = `brainbase-mcp-foundation-${randomUUID()}`;
  let response: Response;
  try {
    response = await (dependencies.fetch || globalThis.fetch)(
      `${dependencies.apiUrl.replace(/\/+$/, '')}/api/csrf-token`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${context.token}`,
          'x-brainbase-projects': context.scope.join(','),
          'x-session-id': sessionId,
        },
      },
    );
  } catch (error) {
    return {
      ok: false,
      result: dependencies.auth.toolError(
        'unavailable',
        'foundation_csrf_unavailable',
        error instanceof Error ? error.message : String(error),
        context.scope,
      ),
    };
  }

  let payload: unknown = null;
  let payloadParsed = false;
  try {
    payload = await response.json();
    payloadParsed = true;
  } catch {
    // Keep the response fail-closed below; a 200 without a token is not a
    // usable CSRF handshake.
  }

  if (!response.ok) {
    return { ok: false, result: errorFromResponse(response, payload, context.scope, dependencies) };
  }
  const token = isRecord(payload) && typeof payload.token === 'string' ? payload.token.trim() : '';
  if (!payloadParsed || !token) {
    return {
      ok: false,
      result: dependencies.auth.toolError(
        'error',
        'foundation_csrf_response_invalid',
        'Brainbase API returned an invalid CSRF response',
        context.scope,
        response.status,
      ),
    };
  }
  return { ok: true, sessionId, token };
}

async function fetchFoundationRequest(
  dependencies: FoundationPublicToolDependencies,
  context: FoundationAuthenticatedProjectContext,
  request: FoundationRequest,
): Promise<
  | { ok: true; response: Response; payload: unknown; payloadParsed: boolean }
  | { ok: false; result: FoundationAuthenticatedToolResult }
> {
  if (request.method !== 'POST') {
    return dependencies.auth.fetchAuthenticatedJson(context, request);
  }

  const csrf = await fetchFoundationCsrfToken(dependencies, context);
  if (!csrf.ok) return csrf;
  return dependencies.auth.fetchAuthenticatedJson(context, {
    ...request,
    headers: {
      'x-session-id': csrf.sessionId,
      'x-csrf-token': csrf.token,
    },
  });
}

function errorFromResponse(
  response: Response,
  payload: unknown,
  scope: string[],
  dependencies: FoundationPublicToolDependencies,
): FoundationAuthenticatedToolResult {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
  const code = typeof error?.code === 'string' && error.code.trim()
    ? error.code
    : response.status === 404
      ? 'foundation_api_unavailable'
      : response.status >= 500
        ? 'foundation_api_unavailable'
        : 'foundation_api_error';
  const message = typeof error?.message === 'string' && error.message.trim()
    ? error.message
    : `${response.status} ${response.statusText}`.trim();
  const status = response.status === 404 || response.status >= 500 ? 'unavailable' : 'error';
  return dependencies.auth.toolError(status, code, message, scope, response.status, error?.details);
}

function isFoundationScope(value: unknown): value is { type: 'personal' | 'project' | 'organization'; id: string } {
  return isRecord(value)
    && (value.type === 'personal' || value.type === 'project' || value.type === 'organization')
    && isNonEmptyString(value.id);
}

function isFoundationAcl(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.ownerId)
    && (value.visibility === 'private'
      || value.visibility === 'project'
      || value.visibility === 'organization'
      || value.visibility === 'public')
    && Array.isArray(value.readerIds)
    && value.readerIds.every((readerId) => isNonEmptyString(readerId))
    && new Set(value.readerIds).size === value.readerIds.length
    && Array.isArray(value.writerIds)
    && value.writerIds.every((writerId) => isNonEmptyString(writerId))
    && new Set(value.writerIds).size === value.writerIds.length;
}

function isValidPhilosophyRevisionPayload(
  args: Record<string, unknown>,
  payload: Record<string, unknown>,
): boolean {
  if (payload.kind !== 'philosophy'
      || payload.id !== args.id
      || payload.revision !== args.revision
      || !isNonEmptyString(payload.digest)
      || !DIGEST_PATTERN.test(payload.digest)
      || !Object.prototype.hasOwnProperty.call(payload, 'payload')
      || !isRecord(payload.applicability)
      || !isFoundationScope(payload.applicability.scope)
      || !isFoundationAcl(payload.currentAcl)
      || !isFoundationScope(payload.currentScope)
      || (args.digest !== undefined && payload.digest !== args.digest)) {
    return false;
  }

  try {
    // The canonical helper validates the JSON payload and applicability, and
    // excludes read-time ACL/scope metadata from the immutable digest.
    return philosophyRevisionDigest(payload as unknown as PhilosophyRevisionRecord) === payload.digest;
  } catch {
    return false;
  }
}

function isValidSuccessPayload(name: FoundationPublicToolName, args: Record<string, unknown>, payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  if (name === 'foundation_describe') {
    return payload.contractVersion === 'foundation-public.v1'
      && payload.connection === 'configured'
      && isRecord(payload.foundation)
      && payload.executionPermission === 'none';
  }
  if (name === 'foundation_read') {
    if (args.type === 'philosophy') {
      return isValidPhilosophyRevisionPayload(args, payload);
    }
    const definition = isRecord(payload.definition) ? payload.definition : null;
    return definition !== null
      && isNonEmptyString(payload.digest)
      && DIGEST_PATTERN.test(payload.digest)
      && definition.id === args.id
      && definition.type === args.type
      && definition.revision === args.revision
      && (args.digest === undefined || payload.digest === args.digest);
  }
  // The canonical HTTP route returns 200 only for a resolved validation.  A
  // non-resolved result must remain an error/unavailable response even if an
  // incorrectly connected upstream serializes it with HTTP 200.
  return payload.status === 'resolved';
}

export async function handleFoundationPublicToolCall(
  name: string,
  args: Record<string, unknown>,
  dependencies: FoundationPublicToolDependencies,
): Promise<FoundationAuthenticatedToolResult | null> {
  if (!isFoundationPublicToolName(name)) return null;

  const scopeId = readScopeId(args);
  if (!scopeId) return invalidInput('scope_id is required and must be a safe project identifier', dependencies);
  const unexpected = rejectUnexpectedKeys(args, name === 'foundation_describe'
    ? ['scope_id']
    : name === 'foundation_read'
      ? ['scope_id', 'type', 'id', 'revision', 'digest']
      : name === 'foundation_validate_reference'
        ? ['scope_id', 'reference', 'phase']
        : ['scope_id', 'snapshot'], dependencies);
  if (unexpected) return unexpected;
  if (name === 'foundation_read') {
    const invalid = validateReadArgs(args, dependencies);
    if (invalid) return invalid;
  } else if (name === 'foundation_validate_reference') {
    const invalid = validateReferenceArgs(args, dependencies);
    if (invalid) return invalid;
  } else if (name === 'foundation_validate_problem') {
    const invalid = validateProblemArgs(args, dependencies);
    if (invalid) return invalid;
  }

  const authenticated = await dependencies.auth.authenticateProject(
    { project_code: scopeId },
    { requireProject: true },
  );
  if ('status' in authenticated) return authenticated;
  const context = selectedContext(authenticated, scopeId);
  const fetched = await fetchFoundationRequest(dependencies, context, requestFor(name, args, scopeId));
  if (!fetched.ok) return fetched.result;
  if (!fetched.response.ok) return errorFromResponse(fetched.response, fetched.payload, context.scope, dependencies);
  if (!fetched.payloadParsed || !isValidSuccessPayload(name, args, fetched.payload)) {
    return dependencies.auth.toolError(
      'error',
      'foundation_api_response_invalid',
      'Brainbase API returned an invalid Foundation response',
      context.scope,
      fetched.response.status,
    );
  }
  return { status: 'ok', scope: { project_codes: context.scope }, data: fetched.payload };
}
