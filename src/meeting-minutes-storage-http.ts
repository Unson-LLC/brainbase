import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  MeetingMinutesError,
  type MeetingMinutesRequestContext,
  type MeetingMinutesStore,
} from './meeting-minutes.js';
import {
  MeetingMinutesStorageController,
  MeetingMinutesStorageControllerError,
  type MeetingMinutesControllerConfirmVersionInput,
  type MeetingMinutesControllerCreateMeetingInput,
  type MeetingMinutesControllerCreateMinutesInput,
  type MeetingMinutesControllerRebindInput,
  type MeetingMinutesControllerRequestContext,
  type MeetingMinutesStoragePlacement,
} from './meeting-minutes-storage-controller.js';
import {
  LocalWebHttpError,
  readJsonObjectBody,
  requestUrl,
  writeHttpError,
  writeJson,
} from './local-web-security.js';

/** HTTP boundary for host supplied native/external minutes placement. */
export const MEETING_MINUTES_STORAGE_HTTP_VERSION = 'brainbase.meeting-minutes-storage-http.v1' as const;
export const MEETING_MINUTES_STORAGE_HTTP_PREFIX = '/api/meeting-minutes' as const;

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
type MaybePromise<T> = T | Promise<T>;

export interface MeetingMinutesStorageHttpOptions {
  /** The same core store passed to MeetingMinutesStorageController. */
  readonly store: MeetingMinutesStore;
  readonly controller: MeetingMinutesStorageController;
  /** The host supplies the trusted principal; request JSON is never used. */
  readonly resolveContext: (request: IncomingMessage) => MaybePromise<MeetingMinutesRequestContext>;
  readonly basePath?: string;
  readonly bodyLimitBytes?: number;
}

export type MeetingMinutesStorageHttpHandler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBasePath(path: string | undefined): string {
  const value = (path ?? MEETING_MINUTES_STORAGE_HTTP_PREFIX).trim().replace(/\/+$/u, '');
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

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new MeetingMinutesError('invalid_input', `${label} is required`);
  return value.trim();
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return text(value, label);
}

function placement(value: unknown, fallbackBody: unknown, fallbackLabel: string): MeetingMinutesStoragePlacement {
  if (value === undefined) {
    return { kind: 'native', body: fallbackBody === undefined ? '' : text(fallbackBody, fallbackLabel) };
  }
  if (!isRecord(value) || (value.kind !== 'native' && value.kind !== 'external')) {
    throw new MeetingMinutesError('invalid_input', 'placement.kind must be native or external');
  }
  if (value.kind === 'native') {
    // Keep an omitted native body distinguishable from an explicit empty body.
    // Rebind uses the former to copy the current exact source under ACL; create
    // and save operations still normalize it to an empty native body in the
    // controller when no body was supplied.
    return { kind: 'native', body: value.body === undefined ? undefined : text(value.body, 'placement.body') };
  }
  if (hasOwn(value, 'body')) throw new MeetingMinutesError('invalid_input', 'External placement must not carry a native body');
  return {
    kind: 'external',
    provider: text(value.provider, 'placement.provider'),
    locator: text(value.locator, 'placement.locator'),
  };
}

function rebindPlacement(body: Record<string, unknown>): MeetingMinutesStoragePlacement {
  if (hasOwn(body, 'placement')) return placement(body.placement, body.body, 'body');
  // An omitted body means “keep the current exact version” for native rebind.
  // This lets the controller read an external current body under the current
  // ACL instead of replacing it with an empty native version.
  if (!hasOwn(body, 'body')) return { kind: 'native' };
  return { kind: 'native', body: text(body.body, 'body') };
}

function createInput(body: Record<string, unknown>, key?: string, fingerprint?: string): MeetingMinutesControllerCreateMeetingInput {
  return {
    title: text(body.title, 'title'),
    scheduled_at: optionalText(body.scheduled_at, 'scheduled_at'),
    ended_at: optionalText(body.ended_at, 'ended_at'),
    participant_ids: Array.isArray(body.participant_ids) ? body.participant_ids as string[] : undefined,
    metadata: isRecord(body.metadata) ? body.metadata : undefined,
    minutes_title: optionalText(body.minutes_title, 'minutes_title'),
    minutes_metadata: isRecord(body.minutes_metadata) ? body.minutes_metadata : undefined,
    ...idempotencyFields(key, fingerprint),
  };
}

function createMinutesInput(body: Record<string, unknown>, key?: string, fingerprint?: string): MeetingMinutesControllerCreateMinutesInput {
  return {
    title: optionalText(body.title, 'title'),
    metadata: isRecord(body.metadata) ? body.metadata : undefined,
    expected_revision: body.expected_revision as number,
    ...idempotencyFields(key, fingerprint),
  };
}

function saveInput(body: Record<string, unknown>, minutesId: string, meetingId: string, key?: string, fingerprint?: string): MeetingMinutesControllerRebindInput {
  return {
    meeting_id: meetingId,
    minutes_id: minutesId,
    metadata: isRecord(body.metadata) ? body.metadata : undefined,
    expected_revision: body.expected_revision as number,
    predecessor_version_id: optionalText(body.predecessor_version_id, 'predecessor_version_id'),
    ...idempotencyFields(key, fingerprint),
  };
}

function confirmInput(body: Record<string, unknown>, meetingId: string, minutesId: string, key?: string, fingerprint?: string): MeetingMinutesControllerConfirmVersionInput {
  return {
    meeting_id: meetingId,
    minutes_id: minutesId,
    version_id: text(body.version_id, 'version_id'),
    expected_revision: body.expected_revision as number,
    ...idempotencyFields(key, fingerprint),
  };
}

function versionPayload(resolved: Awaited<ReturnType<MeetingMinutesStorageController['get_version']>>): Record<string, unknown> {
  const body = resolved.body === undefined ? {} : { body: resolved.body };
  return {
    ...resolved.version,
    ...body,
    placement: resolved.placement,
    source_status: resolved.source_status,
    ...(resolved.capabilities ? { capabilities: resolved.capabilities } : {}),
    ...(resolved.source_result ? { source_result: resolved.source_result } : {}),
    ...(resolved.reason ? { reason: resolved.reason } : {}),
  };
}

function statusForStorageError(error: MeetingMinutesStorageControllerError): number {
  switch (error.code) {
    case 'source_denied': return 403;
    case 'source_changed': return 409;
    case 'source_unavailable': return 503;
    case 'idempotency_conflict': return 409;
    case 'invalid_configuration': return 422;
    case 'storage_unavailable': return 500;
  }
}

function operationError(error: unknown): OperationResult {
  if (error instanceof MeetingMinutesError) {
    const statusCode = error.code === 'invalid_input' ? 422
      : error.code === 'not_found' ? 404
        : error.code === 'authorization_denied' ? 403
          : error.code === 'revision_conflict' || error.code === 'idempotency_conflict' ? 409 : 500;
    return { statusCode, body: { error: { code: error.code, message: error.message } } };
  }
  if (error instanceof MeetingMinutesStorageControllerError) {
    return { statusCode: statusForStorageError(error), body: { error: { code: error.code, message: error.message } } };
  }
  return { statusCode: 500, body: { error: { code: 'internal_error', message: 'Meeting minutes request failed' } } };
}

export function createMeetingMinutesStorageHttpHandler(options: MeetingMinutesStorageHttpOptions): MeetingMinutesStorageHttpHandler {
  if (!options || !options.store || !options.controller || typeof options.resolveContext !== 'function') {
    throw new TypeError('store, controller and resolveContext are required');
  }
  const basePath = normalizeBasePath(options.basePath);
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  if (!Number.isInteger(bodyLimitBytes) || bodyLimitBytes <= 0) throw new TypeError('bodyLimitBytes must be a positive integer');

  async function execute(
    route: Route,
    body: Record<string, unknown> | undefined,
    context: MeetingMinutesControllerRequestContext,
    key?: string,
    fingerprint?: string,
  ): Promise<OperationResult> {
    try {
      switch (route.kind) {
        case 'collection': {
          if (body === undefined) {
            return { statusCode: 200, body: { state: 'ready', meetings: await options.store.list_meetings(context), absence_confirmed: true } };
          }
          const input = createInput(body, key, fingerprint);
          return {
            statusCode: 201,
            body: await options.controller.create_meeting(input, placement(body.placement, body.initial_body, 'initial_body'), context),
          };
        }
        case 'meeting':
          return { statusCode: 200, body: await options.store.get_meeting(route.meetingId ?? '', context) };
        case 'minutes': {
          if (body === undefined) throw new MeetingMinutesError('invalid_input', 'Request body is required');
          return {
            statusCode: 201,
            body: await options.controller.create_minutes(
              route.meetingId ?? '',
              createMinutesInput(body, key, fingerprint),
              placement(body.placement, body.body, 'body'),
              context,
            ),
          };
        }
        case 'save': {
          if (body === undefined) throw new MeetingMinutesError('invalid_input', 'Request body is required');
          const detail = await options.store.get_meeting(route.meetingId ?? '', context);
          if (!detail.minutes.some((candidate) => candidate.minutes_id === route.minutesId)) {
            throw new MeetingMinutesError('not_found', `Minutes document ${route.minutesId} was not found`);
          }
          return {
            statusCode: 201,
            body: await options.controller.rebind(
              saveInput(body, route.minutesId ?? '', route.meetingId ?? '', key, fingerprint),
              rebindPlacement(body),
              context,
            ),
          };
        }
        case 'confirm': {
          if (body === undefined) throw new MeetingMinutesError('invalid_input', 'Request body is required');
          return {
            statusCode: 200,
            body: await options.controller.confirm_version(
              confirmInput(body, route.meetingId ?? '', route.minutesId ?? '', key, fingerprint),
              context,
            ),
          };
        }
        case 'version':
          return {
            statusCode: 200,
            body: versionPayload(await options.controller.get_version(route.meetingId ?? '', route.minutesId ?? '', route.versionId ?? '', context)),
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
      : route.kind === 'meeting' || route.kind === 'version' ? ['GET'] : ['POST'];
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
      const result = await execute(route, body, context, key, fingerprint);
      writeJson(response, result.statusCode, result.body);
    } catch (error) {
      if (error instanceof LocalWebHttpError) writeHttpError(response, error);
      else writeJson(response, 500, { error: { code: 'internal_error', message: 'Meeting minutes request failed' } });
    }
    return true;
  };
}
