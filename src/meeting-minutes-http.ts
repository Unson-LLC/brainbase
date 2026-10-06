import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  MeetingMinutesError,
  type ConfirmMinutesVersionInput,
  type CreateMinutesInput,
  type MeetingMinutesDetail,
  type MeetingCreateInput,
  type MeetingMinutesRequestContext,
  type MeetingMinutesStore,
  type SaveMinutesVersionInput
} from './meeting-minutes.js';
import {
  LocalWebHttpError,
  readJsonObjectBody,
  requestUrl,
  writeHttpError,
  writeJson
} from './local-web-security.js';

/** HTTP contract shared by the local and organization meeting-minutes hosts. */
export const MEETING_MINUTES_HTTP_VERSION = 'brainbase.meeting-minutes-http.v1' as const;
export const MEETING_MINUTES_HTTP_PREFIX = '/api/meeting-minutes' as const;
const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

type MaybePromise<T> = T | Promise<T>;

export interface MeetingMinutesHttpOptions {
  readonly store: MeetingMinutesStore;
  /** The host supplies the trusted principal; request JSON is never used. */
  readonly resolveContext: (request: IncomingMessage) => MaybePromise<MeetingMinutesRequestContext>;
  /** Called only after a save has returned the core's readback detail. */
  readonly afterSave?: (input: {
    readonly before: MeetingMinutesDetail;
    readonly after: MeetingMinutesDetail;
    readonly context: MeetingMinutesRequestContext;
  }) => MaybePromise<unknown>;
  readonly basePath?: string;
  readonly bodyLimitBytes?: number;
}

export type MeetingMinutesHttpHandler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;

interface Route {
  readonly kind: 'collection' | 'meeting' | 'minutes' | 'save' | 'confirm' | 'version';
  readonly meetingId?: string;
  readonly minutesId?: string;
  readonly versionId?: string;
}

interface OperationResult {
  readonly statusCode: number;
  readonly body: unknown;
}

function normalizeBasePath(path: string | undefined): string {
  const value = (path ?? MEETING_MINUTES_HTTP_PREFIX).trim().replace(/\/+$/u, '');
  if (!value.startsWith('/') || value === '') throw new TypeError('basePath must be an absolute path');
  return value;
}

function decodePathSegment(value: string): string | undefined {
  try {
    const decoded = decodeURIComponent(value);
    return decoded === '' || decoded.includes('/') ? undefined : decoded;
  } catch {
    return undefined;
  }
}

function routeFor(pathname: string, basePath: string): Route | undefined {
  if (pathname === basePath) return { kind: 'collection' };
  if (!pathname.startsWith(`${basePath}/`)) return undefined;
  const rawSegments = pathname.slice(basePath.length + 1).split('/');
  if (rawSegments.some((segment) => segment === '')) return { kind: 'meeting' };
  const segments = rawSegments.map(decodePathSegment);
  if (segments.some((segment) => segment === undefined)) return { kind: 'meeting' };
  const [meetingId, noun, minutesId, action, versionId] = segments as string[];
  if (!meetingId) return { kind: 'meeting' };
  if (segments.length === 1) return { kind: 'meeting', meetingId };
  if (segments.length === 2 && noun === 'minutes') return { kind: 'minutes', meetingId };
  if (segments.length === 3 && noun === 'minutes' && minutesId) return { kind: 'save', meetingId, minutesId };
  if (segments.length === 4 && noun === 'minutes' && minutesId && action === 'confirm') {
    return { kind: 'confirm', meetingId, minutesId };
  }
  if (segments.length === 5 && noun === 'minutes' && minutesId && action === 'versions' && versionId) {
    return { kind: 'version', meetingId, minutesId, versionId };
  }
  return { kind: 'meeting' };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`);
  return `{${entries.join(',')}}`;
}

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return typeof value === 'string' ? value : undefined;
}

function idempotencyKey(request: IncomingMessage): string | undefined {
  const value = headerValue(request, 'idempotency-key');
  if (value === undefined) return undefined;
  const key = value.trim();
  if (key === '' || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new LocalWebHttpError(422, 'invalid_idempotency_key', 'Idempotency-Key must be 1–200 characters');
  }
  return key;
}

function requestFingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

function idempotencyFields(key: string | undefined, fingerprint: string | undefined): {
  idempotency_key?: string;
  idempotency_fingerprint?: string;
} {
  if (key === undefined || fingerprint === undefined) return {};
  return { idempotency_key: key, idempotency_fingerprint: fingerprint };
}

function statusForDomainError(error: MeetingMinutesError): number {
  switch (error.code) {
    case 'invalid_input': return 422;
    case 'not_found': return 404;
    case 'revision_conflict':
    case 'idempotency_conflict': return 409;
    case 'authorization_denied': return 403;
    case 'corrupt_record':
    case 'storage_unavailable':
    case 'readback_mismatch': return 500;
  }
}

function publicDomainMessage(error: MeetingMinutesError): string {
  if (error.code === 'corrupt_record') return 'Meeting minutes storage contains an invalid record';
  if (error.code === 'storage_unavailable') return 'Meeting minutes storage is unavailable';
  if (error.code === 'readback_mismatch') return 'Meeting minutes storage did not confirm the saved record';
  return error.message;
}

function operationError(error: unknown): OperationResult {
  if (error instanceof MeetingMinutesError) {
    return {
      statusCode: statusForDomainError(error),
      body: { error: { code: error.code, message: publicDomainMessage(error) } }
    };
  }
  return { statusCode: 500, body: { error: { code: 'internal_error', message: 'Meeting minutes request failed' } } };
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function createInput(body: Record<string, unknown>, key?: string, fingerprint?: string): MeetingCreateInput {
  return {
    title: body.title as string,
    scheduled_at: body.scheduled_at as string | undefined,
    ended_at: body.ended_at as string | undefined,
    participant_ids: body.participant_ids as string[] | undefined,
    metadata: body.metadata as Record<string, unknown> | undefined,
    minutes_title: body.minutes_title as string | undefined,
    minutes_metadata: body.minutes_metadata as Record<string, unknown> | undefined,
    initial_body: body.initial_body as string | undefined,
    source_ref: body.source_ref as MeetingCreateInput['source_ref'],
    ...idempotencyFields(key, fingerprint)
  };
}

function createMinutesInput(body: Record<string, unknown>, key?: string, fingerprint?: string): CreateMinutesInput {
  return {
    title: body.title as string | undefined,
    metadata: body.metadata as Record<string, unknown> | undefined,
    ...(hasOwn(body, 'body') ? { body: body.body as string } : {}),
    ...(hasOwn(body, 'source_ref') ? { source_ref: body.source_ref as CreateMinutesInput['source_ref'] } : {}),
    expected_revision: body.expected_revision as number,
    ...idempotencyFields(key, fingerprint)
  };
}

function saveInput(body: Record<string, unknown>, minutesId?: string, key?: string, fingerprint?: string): SaveMinutesVersionInput {
  return {
    minutes_id: minutesId ?? body.minutes_id as string,
    ...(hasOwn(body, 'body') ? { body: body.body as string } : {}),
    ...(hasOwn(body, 'source_ref') ? { source_ref: body.source_ref as SaveMinutesVersionInput['source_ref'] } : {}),
    metadata: body.metadata as Record<string, unknown> | undefined,
    expected_revision: body.expected_revision as number,
    predecessor_version_id: body.predecessor_version_id as string | undefined,
    ...idempotencyFields(key, fingerprint)
  };
}

function confirmInput(body: Record<string, unknown>, minutesId: string, key?: string, fingerprint?: string): ConfirmMinutesVersionInput {
  return {
    minutes_id: minutesId,
    version_id: body.version_id as string,
    expected_revision: body.expected_revision as number,
    ...idempotencyFields(key, fingerprint)
  };
}

export function createMeetingMinutesHttpHandler(options: MeetingMinutesHttpOptions): MeetingMinutesHttpHandler {
  if (!options || !options.store || typeof options.resolveContext !== 'function') {
    throw new TypeError('store and resolveContext are required');
  }
  const basePath = normalizeBasePath(options.basePath);
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  if (!Number.isInteger(bodyLimitBytes) || bodyLimitBytes <= 0) throw new TypeError('bodyLimitBytes must be a positive integer');

  async function execute(
    route: Route,
    body: Record<string, unknown> | undefined,
    context: MeetingMinutesRequestContext,
    key?: string,
    fingerprint?: string
  ): Promise<OperationResult> {
    try {
      switch (route.kind) {
        case 'collection':
          if (body === undefined) return { statusCode: 200, body: { state: 'ready', meetings: await options.store.list_meetings(context), absence_confirmed: true } };
          return { statusCode: 201, body: await options.store.create_meeting(createInput(body, key, fingerprint), context) };
        case 'meeting':
          return { statusCode: 200, body: await options.store.get_meeting(route.meetingId ?? '', context) };
        case 'minutes': {
          if (body === undefined) throw new MeetingMinutesError('invalid_input', 'Request body is required');
          return { statusCode: 201, body: await options.store.create_minutes(route.meetingId ?? '', createMinutesInput(body, key, fingerprint), context) };
        }
        case 'save': {
          if (body === undefined) throw new MeetingMinutesError('invalid_input', 'Request body is required');
          const before = await options.store.get_meeting(route.meetingId ?? '', context);
          if (!before.minutes.some((candidate) => candidate.minutes_id === route.minutesId)) {
            throw new MeetingMinutesError('not_found', `Minutes document ${route.minutesId} was not found`);
          }
          const after = await options.store.save_version(saveInput(body, route.minutesId, key, fingerprint), context);
          const lineage = options.afterSave ? await options.afterSave({ before, after, context }) : undefined;
          return { statusCode: 201, body: lineage === undefined ? after : { ...after, lineage } };
        }
        case 'confirm': {
          if (body === undefined) throw new MeetingMinutesError('invalid_input', 'Request body is required');
          const detail = await options.store.get_meeting(route.meetingId ?? '', context);
          const document = detail.minutes.find((candidate) => candidate.minutes_id === route.minutesId);
          if (!document) throw new MeetingMinutesError('not_found', `Minutes document ${route.minutesId} was not found`);
          if (!detail.versions.some((candidate) => candidate.version_id === body.version_id && candidate.minutes_id === route.minutesId)) {
            throw new MeetingMinutesError('not_found', `Minutes version ${String(body.version_id)} was not found`);
          }
          return { statusCode: 200, body: await options.store.confirm_version(confirmInput(body, document.minutes_id, key, fingerprint), context) };
        }
        case 'version':
          return {
            statusCode: 200,
            body: await options.store.get_version(route.meetingId ?? '', route.minutesId ?? '', route.versionId ?? '', context)
          };
      }
    } catch (error) {
      return operationError(error);
    }
  }

  return async (request, response) => {
    const path = requestUrl(request).pathname;
    const route = routeFor(path, basePath);
    if (!route) return false;
    const method = (request.method ?? 'GET').toUpperCase();
    const allowed = route.kind === 'collection' ? ['GET', 'POST']
      : route.kind === 'meeting' || route.kind === 'version' ? ['GET']
        : ['POST'];
    if (!allowed.includes(method)) {
      response.setHeader('Allow', allowed.join(', '));
      writeJson(response, 405, { error: { code: 'method_not_allowed', message: `Use ${allowed.join(' or ')}` } });
      return true;
    }
    try {
      const context = await options.resolveContext(request);
      if (!context || typeof context.principal_id !== 'string' || context.principal_id.trim() === '') {
        throw new LocalWebHttpError(401, 'authorization_required', 'A trusted meeting-minutes principal is required');
      }
      const body = method === 'POST' ? await readJsonObjectBody(request, bodyLimitBytes) : undefined;
      const key = method === 'POST' ? idempotencyKey(request) : undefined;
      const fingerprint = key === undefined ? undefined : requestFingerprint({ method, path, body: body ?? null });
      // Idempotency is persisted by the domain store in the same CAS snapshot
      // as the mutation.  Keeping no result cache here ensures retries after a
      // restart, and retries after ACL changes, are reauthorized by the store.
      const result = await execute(route, body, context, key, fingerprint);
      writeJson(response, result.statusCode, result.body);
    } catch (error) {
      if (error instanceof LocalWebHttpError) writeHttpError(response, error);
      else writeJson(response, 500, { error: { code: 'internal_error', message: 'Meeting minutes request failed' } });
    }
    return true;
  };
}
