import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  assertSameOrigin,
  LocalWebHttpError,
  readJsonObjectBody,
  requestUrl,
  writeHttpError,
  writeJson,
} from './local-web-security.js';
import {
  MeetingMinutesLineageError,
  type AcceptMinutesLineageResultRequest,
  type AdoptMinutesLineageRequest,
  type CreateMinutesLineageCandidateRequest,
  type ConfirmMinutesLineageCandidateRequest,
  type MarkMinutesLineageCorrectionRequest,
  type MinutesLineageAccess,
  type MinutesLineageActor,
  type MinutesLineageStore,
  type RecordMinutesLineageExecutionRequest,
} from './meeting-minutes-lineage.js';

/** HTTP seam mounted beside the native `/api/meeting-minutes` routes. */
export const MEETING_MINUTES_LINEAGE_HTTP_VERSION = 'brainbase.meeting-minutes-lineage-http.v1' as const;
export const MEETING_MINUTES_LINEAGE_HTTP_PREFIX = '/api/meeting-minutes-lineage' as const;

const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024;
type MaybePromise<T> = T | Promise<T>;

export interface MeetingMinutesLineageHttpOptions {
  readonly store: MinutesLineageStore;
  /** The host resolves current principal and scope; request JSON never supplies access. */
  readonly resolveAccess: (request: IncomingMessage) => MaybePromise<MinutesLineageAccess>;
  /** The host resolves the current actor; request JSON is an audit hint only. */
  readonly resolveActor?: (request: IncomingMessage, access: MinutesLineageAccess) => MaybePromise<MinutesLineageActor>;
  /** Optional host CSRF/origin policy for mutations. */
  readonly assertWriteAllowed?: (request: IncomingMessage, access: MinutesLineageAccess) => MaybePromise<void>;
  readonly basePath?: string;
  readonly bodyLimitBytes?: number;
}

export type MeetingMinutesLineageHttpHandler = (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;

export function createMeetingMinutesLineageHttpHandler(options: MeetingMinutesLineageHttpOptions): MeetingMinutesLineageHttpHandler {
  if (!options?.store || typeof options.store.readByMinutesVersion !== 'function'
    || typeof options.store.readByTarget !== 'function') throw new TypeError('a complete lineage store is required');
  if (typeof options.resolveAccess !== 'function') throw new TypeError('resolveAccess is required');
  const basePath = normalizeBasePath(options.basePath);
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  if (!Number.isInteger(bodyLimitBytes) || bodyLimitBytes <= 0) throw new TypeError('bodyLimitBytes must be a positive integer');

  return async (request, response) => {
    const path = requestUrl(request).pathname;
    if (path !== basePath && !path.startsWith(`${basePath}/`)) return false;
    try {
      const access = await options.resolveAccess(request);
      if (!access || typeof access.principal !== 'string' || access.principal.trim() === '') {
        throw new LocalWebHttpError(403, 'authorization_denied', 'A trusted principal is required');
      }
      const route = routeFor(path, basePath, request.method);
      if (!route) {
        writeJson(response, 404, { error: { code: 'not_found', message: 'Lineage route was not found' } });
        return true;
      }
      const body = request.method === 'GET' ? undefined : await readJsonObjectBody(request, bodyLimitBytes);
      if (request.method !== 'GET') assertSameOrigin(request);
      if (route.write) {
        if (options.assertWriteAllowed) await options.assertWriteAllowed(request, access);
      }
      const actor = route.write
        ? await (options.resolveActor?.(request, access) ?? { type: 'person', id: access.principal } as MinutesLineageActor)
        : undefined;
      const result = await execute(route, body, access, actor);
      writeJson(response, result.statusCode, result.body);
    } catch (error) {
      if (error instanceof LocalWebHttpError) writeHttpError(response, error);
      else if (error instanceof MeetingMinutesLineageError) {
        const status = lineageStatus(error.code);
        writeJson(response, status, { error: { code: error.code, message: publicLineageMessage(error) } });
      } else {
        writeJson(response, 500, { error: { code: 'internal_error', message: 'Meeting minutes lineage request failed' } });
      }
    }
    return true;
  };

  async function execute(
    route: Route,
    body: Record<string, unknown> | undefined,
    access: MinutesLineageAccess,
    actor: MinutesLineageActor | undefined,
  ): Promise<OperationResult> {
    switch (route.kind) {
      case 'candidate_read': {
        requireMethod(route.method, 'GET');
        const candidate = await options.store.readCandidate(route.candidateId, access);
        if (!candidate) return { statusCode: 404, body: { error: { code: 'not_found', message: 'Candidate was not found' } } };
        return { statusCode: 200, body: candidate };
      }
      case 'by_version': {
        requireMethod(route.method, 'POST');
        return { statusCode: 200, body: await options.store.readByMinutesVersion(requireBody(body).reference as never, access) };
      }
      case 'by_target': {
        requireMethod(route.method, 'POST');
        return { statusCode: 200, body: await options.store.readByTarget(requireBody(body).target as never, access) };
      }
      case 'candidate_create': {
        requireMethod(route.method, 'POST');
        const value = requireBody(body);
        const request: CreateMinutesLineageCandidateRequest = {
          id: value.id as string,
          idempotencyKey: stringValue(value.idempotencyKey ?? value.idempotency_key, 'idempotencyKey'),
          actor: requireTrustedActor(actor),
          evidence: value.evidence as CreateMinutesLineageCandidateRequest['evidence'],
          kind: value.kind as CreateMinutesLineageCandidateRequest['kind'],
          proposal: value.proposal,
          epistemicStatus: value.epistemicStatus as CreateMinutesLineageCandidateRequest['epistemicStatus'],
          access,
        };
        const candidate = await options.store.createCandidate(request);
        return { statusCode: 201, body: candidate };
      }
      case 'candidate_confirm': {
        requireMethod(route.method, 'POST');
        const value = requireBody(body);
        const request: ConfirmMinutesLineageCandidateRequest = {
          id: value.id as string,
          idempotencyKey: stringValue(value.idempotencyKey ?? value.idempotency_key, 'idempotencyKey'),
          candidateId: route.candidateId,
          actor: requireTrustedActor(actor),
          evidenceDigest: value.evidenceDigest as string,
          access,
        };
        return { statusCode: 201, body: await options.store.confirmCandidate(request) };
      }
      case 'candidate_adopt': {
        requireMethod(route.method, 'POST');
        const value = requireBody(body);
        const request: AdoptMinutesLineageRequest = {
          id: value.id as string,
          idempotencyKey: stringValue(value.idempotencyKey ?? value.idempotency_key, 'idempotencyKey'),
          candidateId: route.candidateId,
          actor: requireTrustedActor(actor),
          access,
        };
        const adoption = route.targetKind === 'judgment'
          ? await options.store.adoptJudgment(request)
          : await options.store.adoptTask(request);
        return { statusCode: 201, body: adoption };
      }
      case 'correction': {
        requireMethod(route.method, 'POST');
        const value = requireBody(body);
        const request: MarkMinutesLineageCorrectionRequest = {
          id: value.id as string,
          idempotencyKey: stringValue(value.idempotencyKey ?? value.idempotency_key, 'idempotencyKey'),
          previousVersion: value.previousVersion as MarkMinutesLineageCorrectionRequest['previousVersion'],
          replacementVersion: value.replacementVersion as MarkMinutesLineageCorrectionRequest['replacementVersion'],
          actor: requireTrustedActor(actor),
          reason: value.reason as string,
          access,
        };
        return { statusCode: 201, body: await options.store.markCorrection(request) };
      }
      default:
        throw new LocalWebHttpError(404, 'not_found', 'Lineage route was not found');
    }
  }
}

type Route =
  | { readonly kind: 'by_version' | 'by_target' | 'candidate_create' | 'correction'; readonly method: string; readonly write: boolean }
  | { readonly kind: 'candidate_read' | 'candidate_confirm' | 'candidate_adopt'; readonly method: string; readonly candidateId: string; readonly write: boolean; readonly targetKind?: 'judgment' | 'task' };

interface OperationResult { readonly statusCode: number; readonly body: unknown }

function routeFor(pathname: string, basePath: string, method: string | undefined): Route | undefined {
  if (pathname === `${basePath}/by-version`) return { kind: 'by_version', method: method ?? '', write: false };
  if (pathname === `${basePath}/by-target`) return { kind: 'by_target', method: method ?? '', write: false };
  if (pathname === `${basePath}/candidates`) return { kind: 'candidate_create', method: method ?? '', write: true };
  if (pathname === `${basePath}/corrections`) return { kind: 'correction', method: method ?? '', write: true };
  if (!pathname.startsWith(`${basePath}/candidates/`)) return undefined;
  const segments = pathname.slice(`${basePath}/candidates/`.length).split('/').map(decodePathSegment);
  if (segments.some((segment) => segment === undefined || segment === '')) return undefined;
  const candidateId = segments[0] as string;
  if (segments.length === 1) return { kind: 'candidate_read', method: method ?? '', candidateId, write: false };
  if (segments.length === 2 && segments[1] === 'confirm') return { kind: 'candidate_confirm', method: method ?? '', candidateId, write: true };
  if (segments.length === 3 && segments[1] === 'adopt' && (segments[2] === 'judgment' || segments[2] === 'task')) {
    return { kind: 'candidate_adopt', method: method ?? '', candidateId, targetKind: segments[2], write: true };
  }
  return undefined;
}

function normalizeBasePath(path: string | undefined): string {
  const value = (path ?? MEETING_MINUTES_LINEAGE_HTTP_PREFIX).trim().replace(/\/+$/u, '');
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

function requireBody(body: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!body) throw new LocalWebHttpError(400, 'invalid_json', 'Request body is required');
  return body;
}

function requireMethod(actual: string | undefined, expected: string): void {
  if (actual !== expected) throw new LocalWebHttpError(405, 'method_not_allowed', `Use ${expected}`);
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new LocalWebHttpError(422, 'invalid_input', `${label} is required`);
  return value;
}

function requireTrustedActor(value: MinutesLineageActor | undefined): MinutesLineageActor {
  if (!value || (value.type !== 'person' && value.type !== 'agent' && value.type !== 'service' && value.type !== 'system')
    || typeof value.id !== 'string' || value.id.trim() === '') {
    throw new LocalWebHttpError(403, 'authorization_denied', 'A trusted actor is required');
  }
  return { type: value.type, id: value.id.trim() };
}

function lineageStatus(code: string): number {
  switch (code) {
    case 'invalid_input': return 422;
    case 'not_found':
    case 'source_not_found':
    case 'target_unavailable': return 404;
    case 'authorization_denied': return 403;
    case 'revision_conflict': return 409;
    case 'provider_unavailable': return 503;
    case 'integrity_mismatch':
    case 'corrupt_record':
    case 'readback_mismatch':
    case 'source_unavailable': return 500;
    default: return 500;
  }
}

function publicLineageMessage(error: MeetingMinutesLineageError): string {
  if (error.code === 'provider_unavailable' || error.code === 'source_unavailable' || error.code === 'target_unavailable') {
    return 'Meeting minutes lineage provider is unavailable';
  }
  if (error.code === 'corrupt_record' || error.code === 'integrity_mismatch' || error.code === 'readback_mismatch') {
    return 'Meeting minutes lineage record could not be verified';
  }
  return error.message;
}
