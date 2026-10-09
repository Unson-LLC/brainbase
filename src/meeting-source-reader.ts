import { createHash } from 'node:crypto';

/**
 * Reads meeting lists and full transcripts from the official Plaud and Tactiq
 * MCP servers. The caller supplies `callTool`; this module owns no connection,
 * OAuth, credential, storage, or sync state. A transcript is `complete` only
 * when every page was read. Anything else is returned as a classified failure,
 * never as an empty or partial transcript.
 */

export type MeetingSourceProvider = 'plaud' | 'tactiq';

/** Calls one MCP tool and returns its `CallToolResult`, or throws. */
export type MeetingSourceCallTool = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export type MeetingSourceFailureReason =
  | 'reauth_required'
  | 'access_required'
  | 'rate_limited'
  | 'timeout'
  | 'not_ready'
  | 'incomplete'
  | 'provider_error';

export type MeetingSourceAccessCause = 'plan' | 'connection' | 'ai_credits' | 'preview_only' | 'unknown';

export interface MeetingSourceAccessDetail {
  action: string | null;
  title: string | null;
  message: string | null;
  url: string | null;
  cause: MeetingSourceAccessCause;
}

export interface MeetingSourceFailure {
  reason: MeetingSourceFailureReason;
  /** `connection` affects every meeting of the connection; `meeting` only this one. */
  scope: 'connection' | 'meeting';
  message: string;
  retryAt: string | null;
  access?: MeetingSourceAccessDetail;
}

export interface MeetingSourceMeeting {
  provider: MeetingSourceProvider;
  externalId: string;
  title: string | null;
  startedAt: string | null;
  durationSeconds: number | null;
  participants: string[];
  url: string | null;
}

export interface MeetingSourceWindow {
  since: string;
  until: string;
}

export type MeetingSourceListResult =
  | { status: 'ok'; meetings: MeetingSourceMeeting[]; complete: boolean; incompleteWindows: MeetingSourceWindow[] }
  | { status: 'failed'; failure: MeetingSourceFailure };

export interface MeetingSourceSegment {
  speaker: string | null;
  text: string;
  startMs: number | null;
  endMs: number | null;
}

export type MeetingSourceTranscriptResult =
  | {
      status: 'complete';
      segments: MeetingSourceSegment[];
      text: string;
      digest: string;
      pageCount: number;
      segmentCount: number;
    }
  | { status: 'unavailable'; failure: MeetingSourceFailure };

export interface MeetingSourceProviderSummary {
  kind: 'provider_summary';
  text: string;
}

export type MeetingSourceSummaryResult =
  | { status: 'ok'; summary: MeetingSourceProviderSummary | null }
  | { status: 'unavailable'; failure: MeetingSourceFailure };

export interface TactiqTranscriptRead {
  meetingId: string;
  readAt: string;
}

export interface TactiqTranscriptBudget {
  /** Reserves a read for `meetingId`. Re-reading a meeting inside the window is free. */
  tryAcquire(meetingId: string, now: Date): { ok: true } | { ok: false; retryAt: string };
  /** Reads still inside the window, for the caller to persist across runs. */
  reads(now: Date): TactiqTranscriptRead[];
}

export const TACTIQ_TRANSCRIPT_READS_PER_HOUR = 10;
export const TACTIQ_SEARCH_LIMIT = 50;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MIN_TACTIQ_WINDOW_MS = 60 * 1000;
const MAX_PAGES = 500;

export function createTactiqTranscriptBudget(options: {
  limit?: number;
  windowMs?: number;
  reads?: TactiqTranscriptRead[];
} = {}): TactiqTranscriptBudget {
  const limit = options.limit ?? TACTIQ_TRANSCRIPT_READS_PER_HOUR;
  const windowMs = options.windowMs ?? HOUR_MS;
  let reads = [...(options.reads ?? [])];
  const prune = (now: Date) => {
    const floor = now.getTime() - windowMs;
    reads = reads.filter((read) => Date.parse(read.readAt) > floor);
  };
  return {
    tryAcquire(meetingId, now) {
      prune(now);
      if (reads.some((read) => read.meetingId === meetingId)) return { ok: true };
      if (reads.length < limit) {
        reads.push({ meetingId, readAt: now.toISOString() });
        return { ok: true };
      }
      const oldest = Math.min(...reads.map((read) => Date.parse(read.readAt)));
      return { ok: false, retryAt: new Date(oldest + windowMs).toISOString() };
    },
    reads(now) {
      prune(now);
      return reads.map((read) => ({ ...read }));
    },
  };
}

/** Speaker-attributed text, normalized the same way as `brainbase-unson` `transcript_hash` input. */
export function meetingTranscriptText(segments: readonly MeetingSourceSegment[]): string {
  const lines: string[] = [];
  for (const segment of segments) {
    const line = normalizeWhitespace(segment.text);
    if (!line) continue;
    lines.push(segment.speaker ? `${segment.speaker}: ${line}` : line);
  }
  return normalizeMultilineText(lines.join('\n'));
}

export function meetingTranscriptDigest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export async function listMeetings(input: {
  provider: MeetingSourceProvider;
  callTool: MeetingSourceCallTool;
  since: string;
  until: string;
  plaudUtcOffsetMinutes?: number;
  plaudPageSize?: number;
  now?: () => Date;
}): Promise<MeetingSourceListResult> {
  const now = input.now ?? (() => new Date());
  const since = parseInstant(input.since, 'since');
  const until = parseInstant(input.until, 'until');
  if (since > until) throw new RangeError('since must not be after until');
  try {
    if (input.provider === 'plaud') {
      return await listPlaud(input.callTool, since, until, input.plaudUtcOffsetMinutes ?? 540, input.plaudPageSize ?? 50);
    }
    return await listTactiq(input.callTool, since, until);
  } catch (error) {
    return { status: 'failed', failure: await classifyFailure(error, input.provider, input.callTool, 'connection', now()) };
  }
}

export async function readTranscript(input: {
  provider: MeetingSourceProvider;
  callTool: MeetingSourceCallTool;
  meetingId: string;
  budget?: TactiqTranscriptBudget;
  plaudPageLimit?: number;
  now?: () => Date;
}): Promise<MeetingSourceTranscriptResult> {
  const now = input.now ?? (() => new Date());
  if (input.provider === 'tactiq') {
    const budget = input.budget ?? createTactiqTranscriptBudget();
    const slot = budget.tryAcquire(input.meetingId, now());
    if (!slot.ok) {
      return unavailable('rate_limited', 'connection', 'Tactiq transcript read limit reached for this hour', slot.retryAt);
    }
  }
  try {
    const read = input.provider === 'plaud'
      ? await readPlaudTranscript(input.callTool, input.meetingId, input.plaudPageLimit ?? 200)
      : await readTactiqTranscript(input.callTool, input.meetingId);
    if (read.segments.every((segment) => !normalizeWhitespace(segment.text))) {
      return unavailable('not_ready', 'meeting', 'The transcript has no utterances yet', null);
    }
    const text = meetingTranscriptText(read.segments);
    return {
      status: 'complete',
      segments: read.segments,
      text,
      digest: meetingTranscriptDigest(text),
      pageCount: read.pageCount,
      segmentCount: read.segments.length,
    };
  } catch (error) {
    if (error instanceof IncompleteTranscriptError) {
      return unavailable('incomplete', 'meeting', error.message, null);
    }
    return { status: 'unavailable', failure: await classifyFailure(error, input.provider, input.callTool, 'meeting', now()) };
  }
}

export async function readProviderSummary(input: {
  provider: MeetingSourceProvider;
  callTool: MeetingSourceCallTool;
  meetingId: string;
  now?: () => Date;
}): Promise<MeetingSourceSummaryResult> {
  const now = input.now ?? (() => new Date());
  try {
    if (input.provider === 'plaud') {
      const payload = await invoke(input.callTool, 'get_note', { file_id: input.meetingId });
      return { status: 'ok', summary: toSummary(extractText(payload)) };
    }
    const payload = asRecord(await invoke(input.callTool, 'get_meeting', { meetingId: input.meetingId }));
    const detailed = asRecord(payload?.detailedSummary);
    if (!detailed || detailed.status !== 'ready') return { status: 'ok', summary: null };
    return { status: 'ok', summary: toSummary(extractText(detailed.content)) };
  } catch (error) {
    return { status: 'unavailable', failure: await classifyFailure(error, input.provider, input.callTool, 'meeting', now()) };
  }
}

// ---------------------------------------------------------------------------
// Plaud

async function listPlaud(
  callTool: MeetingSourceCallTool,
  since: number,
  until: number,
  utcOffsetMinutes: number,
  pageSize: number,
): Promise<MeetingSourceListResult> {
  // Plaud filters by the server-local display date. Widen by a day on each side
  // so time-zone differences cannot drop meetings at the edges, then filter by
  // the exact start time.
  const dateFrom = localDate(since - DAY_MS, utcOffsetMinutes);
  const dateTo = localDate(until + DAY_MS, utcOffsetMinutes);
  const meetings: MeetingSourceMeeting[] = [];
  let complete = false;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const items = extractList(await invoke(callTool, 'list_files', { date_from: dateFrom, date_to: dateTo, page, page_size: pageSize }));
    for (const item of items) {
      const meeting = plaudMeeting(item, utcOffsetMinutes);
      if (!meeting) continue;
      const started = meeting.startedAt ? Date.parse(meeting.startedAt) : NaN;
      if (Number.isFinite(started) && (started < since || started > until)) continue;
      meetings.push(meeting);
    }
    if (items.length < pageSize) {
      complete = true;
      break;
    }
  }
  const window = { since: new Date(since).toISOString(), until: new Date(until).toISOString() };
  return { status: 'ok', meetings: dedupe(meetings), complete, incompleteWindows: complete ? [] : [window] };
}

function plaudMeeting(raw: unknown, utcOffsetMinutes: number): MeetingSourceMeeting | null {
  const item = asRecord(raw);
  const id = stringValue(item?.id) ?? stringValue(item?.file_id) ?? stringValue(item?.fileId);
  if (!item || !id) return null;
  const start = stringValue(item.start_at) ?? stringValue(item.created_at);
  const startMs = start ? parseLocalInstant(start, utcOffsetMinutes) : NaN;
  return {
    provider: 'plaud',
    externalId: id,
    title: stringValue(item.name) ?? stringValue(item.title),
    startedAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : null,
    durationSeconds: null,
    participants: [],
    url: null,
  };
}

async function readPlaudTranscript(callTool: MeetingSourceCallTool, fileId: string, limit: number) {
  const segments: MeetingSourceSegment[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pageCount = 0;
  let total: number | null = null;
  do {
    const args: Record<string, unknown> = { file_id: fileId, block: 'transaction', limit };
    if (cursor) args.cursor = cursor;
    const payload = asRecord(await invoke(callTool, 'get_transcript', args));
    if (!payload || !Array.isArray(payload.segments)) throw new UnexpectedShapeError('Plaud get_transcript returned no segments');
    pageCount += 1;
    if (typeof payload.total === 'number') total = payload.total;
    for (const raw of payload.segments) {
      const segment = asRecord(raw);
      if (!segment) continue;
      segments.push({
        speaker: trimmed(segment.speaker) ?? trimmed(segment.original_speaker),
        text: typeof segment.content === 'string' ? segment.content : (typeof segment.text === 'string' ? segment.text : ''),
        startMs: numberValue(segment.start_time),
        endMs: numberValue(segment.end_time),
      });
    }
    cursor = stringValue(payload.next_cursor);
    if (cursor && seenCursors.has(cursor)) throw new IncompleteTranscriptError('Plaud returned the same cursor twice');
    if (cursor) seenCursors.add(cursor);
    if (cursor && pageCount >= MAX_PAGES) throw new IncompleteTranscriptError('Plaud transcript exceeded the page limit');
  } while (cursor);
  if (total !== null && segments.length < total) {
    throw new IncompleteTranscriptError(`Plaud returned ${segments.length} of ${total} utterances`);
  }
  return { segments, pageCount };
}

// ---------------------------------------------------------------------------
// Tactiq

async function listTactiq(callTool: MeetingSourceCallTool, since: number, until: number): Promise<MeetingSourceListResult> {
  const meetings: MeetingSourceMeeting[] = [];
  const incompleteWindows: MeetingSourceWindow[] = [];
  const windows: Array<[number, number]> = [[since, until]];
  while (windows.length) {
    const [from, to] = windows.shift() as [number, number];
    const payload = asRecord(await invoke(callTool, 'search_meetings', {
      dateFrom: new Date(from).toISOString(),
      dateTo: new Date(to).toISOString(),
      limit: TACTIQ_SEARCH_LIMIT,
    }));
    const results = Array.isArray(payload?.results) ? payload.results : extractList(payload);
    if (results.length >= TACTIQ_SEARCH_LIMIT) {
      if (to - from > MIN_TACTIQ_WINDOW_MS) {
        const middle = from + Math.floor((to - from) / 2);
        windows.unshift([from, middle], [middle + 1, to]);
        continue;
      }
      incompleteWindows.push({ since: new Date(from).toISOString(), until: new Date(to).toISOString() });
    }
    for (const raw of results) {
      const meeting = tactiqMeeting(raw);
      if (meeting) meetings.push(meeting);
    }
  }
  return { status: 'ok', meetings: dedupe(meetings), complete: incompleteWindows.length === 0, incompleteWindows };
}

function tactiqMeeting(raw: unknown): MeetingSourceMeeting | null {
  const item = asRecord(raw);
  const id = stringValue(item?.id);
  if (!item || !id) return null;
  const created = stringValue(item.createdAt);
  const createdMs = created ? Date.parse(created) : NaN;
  return {
    provider: 'tactiq',
    externalId: id,
    title: stringValue(item.title),
    startedAt: Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : null,
    durationSeconds: numberValue(item.durationSeconds),
    participants: Array.isArray(item.attendees) ? item.attendees.filter((value): value is string => typeof value === 'string') : [],
    url: stringValue(item.url),
  };
}

async function readTactiqTranscript(callTool: MeetingSourceCallTool, meetingId: string) {
  const segments: MeetingSourceSegment[] = [];
  let page = 1;
  let pageCount = 0;
  for (;;) {
    const payload = asRecord(await invoke(callTool, 'get_transcript', { meetingId, page }));
    if (!payload || !Array.isArray(payload.entries)) throw new UnexpectedShapeError('Tactiq get_transcript returned no entries');
    pageCount += 1;
    for (const raw of payload.entries) {
      const entry = asRecord(raw);
      if (!entry) continue;
      const start = numberValue(entry.startSeconds);
      const end = numberValue(entry.endSeconds);
      segments.push({
        speaker: trimmed(entry.speaker),
        text: typeof entry.text === 'string' ? entry.text : '',
        startMs: start === null ? null : Math.round(start * 1000),
        endMs: end === null ? null : Math.round(end * 1000),
      });
    }
    if (payload.hasMore !== true) break;
    const totalPages = numberValue(payload.totalPages);
    if ((totalPages !== null && page >= totalPages) || page >= MAX_PAGES) {
      throw new IncompleteTranscriptError(`Tactiq reported more pages after page ${page}`);
    }
    page += 1;
  }
  return { segments, pageCount };
}

// ---------------------------------------------------------------------------
// Tool invocation and failure classification

class ToolCallError extends Error {
  constructor(message: string, readonly body: unknown) {
    super(message);
    this.name = 'ToolCallError';
  }
}

class UnexpectedShapeError extends Error {}
class IncompleteTranscriptError extends Error {}

async function invoke(callTool: MeetingSourceCallTool, name: string, args: Record<string, unknown>): Promise<unknown> {
  let result: unknown;
  try {
    result = await callTool(name, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ToolCallError(message, findJsonObject(message));
  }
  const record = asRecord(result);
  if (record?.isError === true) {
    const text = contentText(record);
    throw new ToolCallError(text || `${name} failed`, parseJson(text) ?? findJsonObject(text));
  }
  return payloadOf(result);
}

async function classifyFailure(
  error: unknown,
  provider: MeetingSourceProvider,
  callTool: MeetingSourceCallTool,
  defaultScope: 'connection' | 'meeting',
  now: Date,
): Promise<MeetingSourceFailure> {
  const message = error instanceof Error ? error.message : String(error);
  const body = error instanceof ToolCallError ? asRecord(error.body) : null;
  if (provider === 'tactiq' && (body?.error === 'access_required' || /access_required/.test(message))) {
    const access = await readAccessOptions(callTool);
    return {
      reason: 'access_required',
      scope: access.cause === 'preview_only' ? 'meeting' : 'connection',
      message,
      retryAt: null,
      access,
    };
  }
  if (/oauth authorization is required|unauthori[sz]ed|\b401\b|invalid[_ ]token|not authenticated|login first|please log ?in|token (?:has )?expired/i.test(message)) {
    return { reason: 'reauth_required', scope: 'connection', message, retryAt: null };
  }
  if (/rate.?limit|\b429\b|too many requests/i.test(message)) {
    return { reason: 'rate_limited', scope: 'connection', message, retryAt: new Date(now.getTime() + HOUR_MS).toISOString() };
  }
  if (/timed? ?out|-32001|ETIMEDOUT|AbortError/i.test(message)) {
    return { reason: 'timeout', scope: defaultScope, message, retryAt: null };
  }
  return { reason: 'provider_error', scope: defaultScope, message, retryAt: null };
}

async function readAccessOptions(callTool: MeetingSourceCallTool): Promise<MeetingSourceAccessDetail> {
  try {
    const access = asRecord(asRecord(await invoke(callTool, 'get_access_options', {}))?.access);
    const detail = {
      action: stringValue(access?.action),
      title: stringValue(access?.title),
      message: stringValue(access?.message),
      url: stringValue(access?.url),
    };
    return { ...detail, cause: accessCause(`${detail.action ?? ''} ${detail.title ?? ''} ${detail.message ?? ''}`) };
  } catch {
    return { action: null, title: null, message: null, url: null, cause: 'unknown' };
  }
}

function accessCause(text: string): MeetingSourceAccessCause {
  const value = text.toLowerCase();
  if (/preview/.test(value)) return 'preview_only';
  if (/credit/.test(value)) return 'ai_credits';
  if (/plan|upgrade|seat|team/.test(value)) return 'plan';
  if (/connect|permission|authori/.test(value)) return 'connection';
  return 'unknown';
}

function unavailable(
  reason: MeetingSourceFailureReason,
  scope: 'connection' | 'meeting',
  message: string,
  retryAt: string | null,
): MeetingSourceTranscriptResult {
  return { status: 'unavailable', failure: { reason, scope, message, retryAt } };
}

// ---------------------------------------------------------------------------
// Helpers

function payloadOf(result: unknown): unknown {
  const record = asRecord(result);
  if (!record) return result;
  if (record.structuredContent !== undefined) return record.structuredContent;
  if (Array.isArray(record.content)) {
    const text = contentText(record);
    return parseJson(text) ?? text;
  }
  return result;
}

function contentText(record: Record<string, unknown>): string {
  if (!Array.isArray(record.content)) return '';
  return record.content
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string)
    .join('\n');
}

function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of ['data', 'files', 'items', 'results', 'records', 'recordings']) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join('\n');
  const record = asRecord(value);
  if (!record) return '';
  for (const key of ['markdown', 'text', 'content', 'summary', 'data_content', 'data']) {
    const text = extractText(record[key]);
    if (text) return text;
  }
  return '';
}

function toSummary(text: string): MeetingSourceProviderSummary | null {
  const normalized = normalizeMultilineText(text);
  return normalized ? { kind: 'provider_summary', text: normalized } : null;
}

function dedupe(meetings: MeetingSourceMeeting[]): MeetingSourceMeeting[] {
  const seen = new Map<string, MeetingSourceMeeting>();
  for (const meeting of meetings) if (!seen.has(meeting.externalId)) seen.set(meeting.externalId, meeting);
  return [...seen.values()];
}

function parseInstant(value: string, label: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new RangeError(`${label} must be an ISO 8601 instant`);
  return ms;
}

/** Plaud times without an offset are server-local; interpret them with the given offset. */
function parseLocalInstant(value: string, utcOffsetMinutes: number): number {
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return Date.parse(value);
  const ms = Date.parse(`${value.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? ms - utcOffsetMinutes * 60 * 1000 : NaN;
}

function localDate(ms: number, utcOffsetMinutes: number): string {
  return new Date(ms + utcOffsetMinutes * 60 * 1000).toISOString().slice(0, 10);
}

function normalizeWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeMultilineText(value: string): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value : null;
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function findJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? parseJson(text.slice(start, end + 1)) : null;
}
