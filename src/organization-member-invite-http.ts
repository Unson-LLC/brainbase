import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  OrganizationMemberInviteError,
  type OrganizationMemberInviteService,
} from './organization-member-invite.js';

/**
 * HTTP boundary for the organization member invite kernel.
 *
 * Authentication, tenant selection, the organization-selected login method,
 * and mutation-origin checks stay host-owned. The host passes a trusted
 * context; identity is never read from the request body.
 */

const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;
const DEFAULT_BASE_PATH = '/api/v1/organization-member-invites';

export const ORGANIZATION_MEMBER_INVITE_HTTP_VERSION = 'organization-member-invite-http.v1' as const;

type MaybePromise<T> = T | Promise<T>;

/** Context resolved by the host after authentication and tenant selection. */
export interface TrustedOrganizationMemberInviteRequestContext {
  readonly tenantId: string;
  readonly personId: string;
  /** Email asserted by the organization-selected login method. */
  readonly email?: string | null;
  readonly emailVerified?: boolean;
  readonly inviterDisplayName?: string | null;
  /** A non-empty value means that the host already verified the mutation origin. */
  readonly verifiedMutationOrigin?: string;
}

export interface OrganizationMemberInviteHttpOptions {
  readonly service: OrganizationMemberInviteService;
  readonly basePath?: string;
  readonly bodyLimitBytes?: number;
  readonly verifyMutationRequest?: (input: {
    readonly request: IncomingMessage;
    readonly context: TrustedOrganizationMemberInviteRequestContext;
  }) => MaybePromise<boolean>;
}

export type OrganizationMemberInviteHttpHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  context: TrustedOrganizationMemberInviteRequestContext | null,
) => Promise<boolean>;

type Route =
  | { operation: 'create' }
  | { operation: 'accept' }
  | { operation: 'read'; inviteId: string }
  | { operation: 'revoke' | 'resend' | 'reissue'; inviteId: string }
  | { operation: null };

class HttpInputError extends Error {}
class BodyLimitError extends Error {}

const IDENTITY_KEYS = [
  'tenantId', 'tenant_id', 'tenant', 'personId', 'person_id', 'actor', 'actorId', 'actor_id',
  'inviterPersonId', 'person', 'binding', 'emailVerified', 'email',
];

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  if (response.headersSent) return;
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Brainbase-Organization-Member-Invite-Protocol', ORGANIZATION_MEMBER_INVITE_HTTP_VERSION);
  response.end(JSON.stringify(body));
}

function writeError(response: ServerResponse, status: number, code: string, message: string, details?: { inviteId: string }): void {
  writeJson(response, status, {
    protocol_version: ORGANIZATION_MEMBER_INVITE_HTTP_VERSION,
    error: { code, status, message, ...(details ? { details } : {}) },
  });
}

function normalizeBasePath(basePath: string | undefined): string {
  const value = basePath ?? DEFAULT_BASE_PATH;
  if (typeof value !== 'string' || !value.startsWith('/') || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError('basePath must be an absolute URL path');
  }
  const normalized = value.replace(/\/+$/u, '');
  if (!normalized) throw new TypeError('basePath must not be root');
  return normalized;
}

function requestPath(request: IncomingMessage): string {
  try {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    return path.length > 1 ? path.replace(/\/+$/u, '') : path;
  } catch {
    return '/';
  }
}

function matchRoute(path: string, basePath: string): Route | null {
  if (path === basePath) return { operation: 'create' };
  if (!path.startsWith(`${basePath}/`)) return null;
  const parts = path.slice(basePath.length + 1).split('/');
  if (parts.length === 1 && parts[0] === 'accept') return { operation: 'accept' };
  let inviteId: string;
  try {
    inviteId = decodeURIComponent(parts[0] ?? '');
  } catch {
    return { operation: null };
  }
  if (!inviteId || inviteId.length > 128) return { operation: null };
  if (parts.length === 1) return { operation: 'read', inviteId };
  if (parts.length === 2 && (parts[1] === 'revoke' || parts[1] === 'resend' || parts[1] === 'reissue')) {
    return { operation: parts[1], inviteId };
  }
  return { operation: null };
}

async function readJsonBody(request: IncomingMessage, limitBytes: number): Promise<Record<string, unknown>> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > limitBytes) {
    request.resume();
    throw new BodyLimitError('Request body exceeds the configured limit');
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buffer.byteLength;
    if (total > limitBytes) throw new BodyLimitError('Request body exceeds the configured limit');
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpInputError('Request body must contain valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpInputError('Request body must be a JSON object');
  }
  const body = parsed as Record<string, unknown>;
  for (const key of IDENTITY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      throw new HttpInputError('Identity is taken from the authenticated context, not the request body');
    }
  }
  return body;
}

function isValidContext(context: TrustedOrganizationMemberInviteRequestContext | null): context is TrustedOrganizationMemberInviteRequestContext {
  return Boolean(context) &&
    typeof context!.tenantId === 'string' && context!.tenantId.length > 0 &&
    typeof context!.personId === 'string' && context!.personId.length > 0;
}

async function mutationVerified(
  options: OrganizationMemberInviteHttpOptions,
  request: IncomingMessage,
  context: TrustedOrganizationMemberInviteRequestContext,
): Promise<boolean> {
  if (typeof context.verifiedMutationOrigin === 'string' && context.verifiedMutationOrigin.trim()) return true;
  if (!options.verifyMutationRequest) return false;
  try {
    return Boolean(await options.verifyMutationRequest({ request, context }));
  } catch {
    return false;
  }
}

export function createOrganizationMemberInviteHttpHandler(
  options: OrganizationMemberInviteHttpOptions,
): OrganizationMemberInviteHttpHandler {
  if (!options?.service) throw new TypeError('service is required');
  const basePath = normalizeBasePath(options.basePath);
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  if (!Number.isInteger(bodyLimitBytes) || bodyLimitBytes <= 0) {
    throw new TypeError('bodyLimitBytes must be a positive integer');
  }
  const { service } = options;

  return async (request, response, context) => {
    const route = matchRoute(requestPath(request), basePath);
    if (!route) return false;
    if (!isValidContext(context)) {
      writeError(response, 401, 'unauthorized', 'Authenticated invite context is required');
      return true;
    }
    if (route.operation === null) {
      writeError(response, 404, 'not_found', 'Invite route was not found');
      return true;
    }
    const method = (request.method ?? 'GET').toUpperCase();
    const expected = route.operation === 'read' ? 'GET' : 'POST';
    if (method !== expected) {
      response.setHeader('Allow', expected);
      writeError(response, 405, 'method_not_allowed', 'Method is not allowed for this invite route');
      return true;
    }

    try {
      const actor = { tenantId: context.tenantId, personId: context.personId };
      if (route.operation === 'read') {
        const invite = await service.readInvite({ actor, inviteId: route.inviteId });
        writeJson(response, 200, { protocol_version: ORGANIZATION_MEMBER_INVITE_HTTP_VERSION, invite });
        return true;
      }

      const body = await readJsonBody(request, bodyLimitBytes);
      if (!await mutationVerified(options, request, context)) {
        writeError(response, 403, 'mutation_origin_unverified', 'Mutation origin could not be verified');
        return true;
      }

      switch (route.operation) {
        case 'create': {
          const result = await service.createInvite({
            actor,
            inviteeEmail: body.inviteeEmail as string,
            role: body.role as string,
            inviterDisplayName: context.inviterDisplayName ?? null,
            metadata: body.metadata,
          });
          // The raw token appears only inside the accept URL.
          writeJson(response, 201, {
            protocol_version: ORGANIZATION_MEMBER_INVITE_HTTP_VERSION,
            invite: result.invite,
            acceptUrl: result.acceptUrl,
            delivered: result.delivered,
          });
          return true;
        }
        case 'accept': {
          const result = await service.acceptInvite({
            tenantId: context.tenantId,
            token: body.token as string,
            person: {
              personId: context.personId,
              email: context.email ?? null,
              emailVerified: context.emailVerified === true,
            },
          });
          writeJson(response, 200, {
            protocol_version: ORGANIZATION_MEMBER_INVITE_HTTP_VERSION,
            invite: result.invite,
            acceptedAt: result.acceptedAt,
          });
          return true;
        }
        case 'revoke': {
          const invite = await service.revokeInvite({ actor, inviteId: route.inviteId });
          writeJson(response, 200, { protocol_version: ORGANIZATION_MEMBER_INVITE_HTTP_VERSION, invite });
          return true;
        }
        case 'resend': {
          const result = await service.resendInvite({
            actor,
            inviteId: route.inviteId,
            token: body.token as string,
          });
          writeJson(response, 200, {
            protocol_version: ORGANIZATION_MEMBER_INVITE_HTTP_VERSION,
            invite: result.invite,
            delivered: result.delivered,
          });
          return true;
        }
        case 'reissue': {
          const result = await service.reissue({ actor, inviteId: route.inviteId });
          writeJson(response, 201, {
            protocol_version: ORGANIZATION_MEMBER_INVITE_HTTP_VERSION,
            invite: result.invite,
            previous: result.previous,
            acceptUrl: result.acceptUrl,
            delivered: result.delivered,
          });
          return true;
        }
      }
    } catch (error) {
      if (error instanceof BodyLimitError) writeError(response, 413, 'body_too_large', error.message);
      else if (error instanceof HttpInputError) writeError(response, 400, 'validation_error', error.message);
      else if (error instanceof OrganizationMemberInviteError) {
        const inviteId = error.details.inviteId;
        const details = typeof inviteId === 'string' && /^omi_[A-Za-z0-9_-]{16,64}$/u.test(inviteId)
          ? { inviteId } : undefined;
        writeError(response, error.status, error.code, error.message, details);
      } else writeError(response, 500, 'internal_error', 'Invite operation failed');
    }
    return true;
  };
}
