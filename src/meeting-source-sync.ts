import { createHash } from 'node:crypto';

export const MEETING_SOURCE_SYNC_VERSION = 'brainbase.meeting-source-sync.v1' as const;
export const SUPPORTED_MEETING_SOURCE_PROVIDERS = Object.freeze(['tactiq', 'plaud'] as const);
export type MeetingSourceProvider = typeof SUPPORTED_MEETING_SOURCE_PROVIDERS[number];

type UnknownRecord = Record<string, unknown>;
type MaybePromise<T> = T | Promise<T>;

export interface MeetingSourceArtifact extends UnknownRecord {
  readonly provider: MeetingSourceProvider;
  readonly external_id: string;
  readonly title: string;
  readonly meeting_mode: string;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly updated_at: string;
  readonly participants: readonly unknown[];
  readonly mcp_resource_uri: string;
  readonly transcript_hash: string | null;
  readonly has_text: boolean;
  readonly source_text: string;
  readonly source_text_kind: string;
  readonly source_text_length: number;
  readonly text_preview: string;
  readonly raw_metadata: UnknownRecord;
  readonly dedupe_key: string;
}
export interface MeetingSourceCluster {
  readonly source_cluster_id: string;
  readonly dedupe_key: string;
  readonly primary_source: MeetingSourceArtifact;
  readonly supporting_sources: readonly MeetingSourceArtifact[];
  readonly providers: readonly MeetingSourceProvider[];
  readonly title: string;
  readonly started_at: string | null;
  readonly meeting_mode: string;
}

export interface MeetingSourceSyncPorts {
  readonly provider: (input: { provider: MeetingSourceProvider; cursor: UnknownRecord; since?: string | null; until?: string | null }) => MaybePromise<readonly UnknownRecord[]>;
  readonly sink: {
    findByIdempotencyKey?: (key: string) => MaybePromise<MeetingSourceSyncResult | null>;
    save: (result: MeetingSourceSyncResult) => MaybePromise<MeetingSourceSyncResult | void>;
    readback?: (idempotencyKey: string) => MaybePromise<MeetingSourceSyncResult | null>;
  };
  readonly now?: () => Date;
  readonly max_attempts?: number;
  readonly is_retryable?: (error: unknown) => boolean;
}

export interface MeetingSourceSyncResult {
  readonly schema_version: typeof MEETING_SOURCE_SYNC_VERSION;
  readonly idempotency_key: string;
  readonly provider: MeetingSourceProvider;
  readonly artifacts: readonly MeetingSourceArtifact[];
  readonly clusters: readonly MeetingSourceCluster[];
  readonly cursor: UnknownRecord;
  readonly synced_at: string;
  readonly fingerprint: string;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as UnknownRecord).sort().map((key) => [key, stable((value as UnknownRecord)[key])]));
}

export function stableMeetingSourceHash(value: unknown): string {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function stableMeetingSourceFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function normalizeWhitespace(value: unknown): string { return String(value || '').replace(/\s+/g, ' ').trim(); }
function normalizeMultilineText(value: unknown): string { return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(); }

export function transcriptSegmentsToText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return value;
  let segments: unknown;
  try { segments = JSON.parse(trimmed); } catch { return value; }
  if (!Array.isArray(segments) || segments.length === 0) return value;
  const lines: string[] = [];
  for (const segment of segments) {
    if (!segment || typeof segment !== 'object' || Array.isArray(segment)) return value;
    const item = segment as UnknownRecord;
    const content = typeof item.content === 'string' ? item.content : (typeof item.text === 'string' ? item.text : null);
    if (content === null) return value;
    const speaker = normalizeWhitespace(item.speaker ?? item.original_speaker);
    const line = normalizeWhitespace(content);
    if (line) lines.push(speaker ? `${speaker}: ${line}` : line);
  }
  return lines.length ? lines.join('\n') : value;
}

function safeProvider(input: unknown): MeetingSourceProvider {
  const provider = String(input ?? '').toLowerCase();
  if (!(SUPPORTED_MEETING_SOURCE_PROVIDERS as readonly string[]).includes(provider)) throw new Error(`unsupported meeting source provider: ${input}`);
  return provider as MeetingSourceProvider;
}

function minuteBucket(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  date.setSeconds(0, 0);
  return date.toISOString().slice(0, 16);
}

function participantKey(participants: readonly unknown[]): string {
  return participants.map((participant) => normalizeWhitespace(typeof participant === 'string' ? participant : (participant as UnknownRecord)?.name ?? (participant as UnknownRecord)?.email ?? (participant as UnknownRecord)?.id).toLowerCase()).filter(Boolean).sort().join('|');
}

function inferMeetingMode(raw: UnknownRecord): string {
  const explicit = String(raw.meeting_mode ?? raw.mode ?? raw.kind ?? '').toLowerCase();
  if (['online', 'offline', 'call'].includes(explicit)) return explicit;
  if (raw.calendar_event_id || raw.conference_url || raw.meet_url || raw.zoom_url) return 'online';
  if (raw.phone_number || raw.call_id || raw.is_call) return 'call';
  if (raw.location && !raw.conference_url) return 'offline';
  return 'unknown';
}

function sourcePriority(artifact: MeetingSourceArtifact): number {
  if (artifact.meeting_mode === 'online' && artifact.provider === 'tactiq') return 100;
  if (['offline', 'call'].includes(artifact.meeting_mode) && artifact.provider === 'plaud') return 100;
  if (artifact.provider === 'tactiq') return 70;
  if (artifact.provider === 'plaud') return 60;
  return 10;
}

function completenessScore(artifact: MeetingSourceArtifact): number {
  return (artifact.has_text ? 4 : 0) + (artifact.started_at ? 2 : 0) + (artifact.ended_at ? 1 : 0) + (artifact.participants.length ? 1 : 0) + (artifact.title ? 1 : 0) + (artifact.mcp_resource_uri ? 1 : 0);
}

export function normalizeMeetingSourceArtifact(raw: UnknownRecord = {}, providerInput: unknown = raw.provider): MeetingSourceArtifact {
  const provider = safeProvider(providerInput);
  const transcript = transcriptSegmentsToText(raw.text ?? raw.transcript ?? raw.transcript_text ?? '');
  const normalizedText = normalizeMultilineText(transcript);
  const providerNote = normalizeWhitespace(raw.note_text ?? raw.content ?? raw.markdown ?? raw.summary ?? raw.ai_summary ?? raw.meeting_summary ?? '');
  const startedAt = typeof (raw.started_at ?? raw.start_time ?? raw.created_at ?? raw.recorded_at) === 'string' ? String(raw.started_at ?? raw.start_time ?? raw.created_at ?? raw.recorded_at) : null;
  const title = normalizeWhitespace(raw.title ?? raw.meeting_title ?? raw.name ?? 'Untitled meeting source');
  const participants = Array.isArray(raw.participants) ? raw.participants : [];
  const resourceUri = String(raw.mcp_resource_uri ?? raw.resource_uri ?? raw.url ?? raw.permalink ?? raw.file_url ?? `${provider}:${raw.id ?? raw.external_id ?? stableMeetingSourceHash(JSON.stringify(raw)).slice(0, 16)}`);
  const externalId = String(raw.external_id ?? raw.id ?? stableMeetingSourceHash(`${provider}:${resourceUri}`).slice(0, 24));
  const transcriptHash = normalizedText ? stableMeetingSourceHash(normalizedText) : null;
  const sourceTextKind = normalizedText ? 'transcript' : (providerNote ? 'provider_note_available' : 'empty');
  const updatedAt = String(raw.updated_at ?? raw.modified_at ?? raw.created_at ?? startedAt ?? new Date().toISOString());
  return {
    provider,
    external_id: externalId,
    title,
    meeting_mode: inferMeetingMode(raw),
    started_at: startedAt,
    ended_at: typeof raw.ended_at === 'string' ? raw.ended_at : (typeof raw.end_time === 'string' ? raw.end_time : null),
    updated_at: updatedAt,
    participants,
    mcp_resource_uri: resourceUri,
    transcript_hash: transcriptHash,
    has_text: Boolean(normalizedText),
    source_text: normalizedText,
    source_text_kind: sourceTextKind,
    source_text_length: normalizedText.length,
    text_preview: normalizedText.slice(0, 280),
    raw_metadata: {
      calendar_event_id: raw.calendar_event_id ?? null,
      source_url: raw.url ?? raw.permalink ?? null,
      slack_permalink: raw.slack_permalink ?? raw.slack_permalink_url ?? null,
      provider_role: provider === 'tactiq' ? 'online_primary' : 'offline_or_call_primary',
      source_text_kind: sourceTextKind,
      provider_note_authoritative: false,
      provider_note_preview: providerNote ? providerNote.slice(0, 280) : null,
    },
    dedupe_key: transcriptHash ? `hash:${transcriptHash}` : `shape:${stableMeetingSourceHash(`${title.toLowerCase()}|${minuteBucket(startedAt)}|${participantKey(participants)}`)}`,
  };
}

export function dedupeMeetingSourceArtifacts(artifacts: readonly MeetingSourceArtifact[]): MeetingSourceCluster[] {
  const groups = new Map<string, MeetingSourceArtifact[]>();
  for (const artifact of artifacts) {
    const key = artifact.dedupe_key || `${artifact.provider}:${artifact.external_id}`;
    groups.set(key, [...(groups.get(key) ?? []), artifact]);
  }
  return [...groups.entries()].map(([dedupeKey, members]) => {
    const sorted = [...members].sort((left, right) => sourcePriority(right) - sourcePriority(left) || completenessScore(right) - completenessScore(left) || String(right.updated_at).localeCompare(String(left.updated_at)));
    const primary = sorted[0];
    return {
      source_cluster_id: `msrc_${stableMeetingSourceHash(`${dedupeKey}:${primary.provider}:${primary.external_id}`).slice(0, 24)}`,
      dedupe_key: dedupeKey,
      primary_source: primary,
      supporting_sources: sorted.slice(1),
      providers: sorted.map((item) => item.provider),
      title: primary.title,
      started_at: primary.started_at,
      meeting_mode: primary.meeting_mode,
    };
  });
}

export function providerCursorAfterArtifacts(artifacts: readonly MeetingSourceArtifact[], previousCursor: UnknownRecord = {}): UnknownRecord {
  const latest = [...artifacts].map((artifact) => ({ timestamp: artifact.updated_at || artifact.started_at, external_id: artifact.external_id })).filter((item) => item.timestamp).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || String(a.external_id).localeCompare(String(b.external_id))).at(-1);
  const updatedSince = [previousCursor.updated_since, latest?.timestamp].filter(Boolean).sort().at(-1) ?? null;
  return { ...previousCursor, updated_since: updatedSince, last_seen_external_id: latest && updatedSince === latest.timestamp ? latest.external_id : previousCursor.last_seen_external_id ?? null };
}

export async function runMeetingSourceSync(
  input: { provider: MeetingSourceProvider; cursor?: UnknownRecord; since?: string | null; until?: string | null; idempotency_key?: string | null },
  ports: MeetingSourceSyncPorts,
): Promise<MeetingSourceSyncResult> {
  const provider = safeProvider(input.provider);
  const cursor = input.cursor ?? {};
  const rawArtifacts = await ports.provider({ provider, cursor, since: input.since, until: input.until });
  const artifacts = rawArtifacts.map((raw) => normalizeMeetingSourceArtifact(raw, provider));
  const clusters = dedupeMeetingSourceArtifacts(artifacts);
  const nextCursor = providerCursorAfterArtifacts(artifacts, cursor);
  const idempotencyKey = input.idempotency_key ?? `meeting-source:${provider}:${stableMeetingSourceFingerprint({ artifacts, cursor: nextCursor })}`;
  const fingerprint = stableMeetingSourceFingerprint({ provider, artifacts, clusters, cursor: nextCursor });
  const replay = await ports.sink.findByIdempotencyKey?.(idempotencyKey);
  if (replay) {
    if (replay.fingerprint !== fingerprint) throw new Error('meeting source sync idempotency conflict');
    return replay;
  }
  const result: MeetingSourceSyncResult = { schema_version: MEETING_SOURCE_SYNC_VERSION, idempotency_key: idempotencyKey, provider, artifacts, clusters, cursor: nextCursor, synced_at: (ports.now ?? (() => new Date()))().toISOString(), fingerprint };
  const maxAttempts = Math.max(1, Math.min(5, ports.max_attempts ?? 2));
  let saved: MeetingSourceSyncResult | void = undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try { saved = await ports.sink.save(result); break; }
    catch (error) {
      if (!(ports.is_retryable?.(error) ?? Boolean((error as { retryable?: boolean } | null)?.retryable)) || attempt >= maxAttempts) throw error;
    }
  }
  const persisted = saved ?? result;
  const readback = await ports.sink.readback?.(idempotencyKey) ?? persisted;
  if (readback.fingerprint !== fingerprint) throw new Error('meeting source sync readback mismatch');
  return persisted;
}
