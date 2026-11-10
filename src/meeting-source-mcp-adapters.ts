import { SUPPORTED_MEETING_SOURCE_PROVIDERS, type MeetingSourceProvider } from './meeting-source-sync.js';

/**
 * Provider adapters only translate provider-specific MCP responses into the
 * provider-neutral artifact shape consumed by the sync core.  Transport,
 * OAuth, credentials, filesystem paths, and persistence stay with the host
 * and are supplied through this client port.
 */
export const MEETING_SOURCE_MCP_ADAPTER_VERSION = 'brainbase.meeting-source-mcp-adapters.v1' as const;

type UnknownRecord = Record<string, unknown>;
type MaybePromise<T> = T | Promise<T>;

export type MeetingSourceMcpCallTool = (name: string, args: Record<string, unknown>) => MaybePromise<unknown>;

export interface MeetingSourceMcpClient {
  readonly callTool: MeetingSourceMcpCallTool;
  readonly listTools?: () => MaybePromise<unknown>;
  readonly listResources?: () => MaybePromise<unknown>;
}

export interface MeetingSourceMcpAdapterConfig {
  readonly tool?: string;
  readonly poll_tool?: string;
  readonly list_tool?: string;
  readonly detail_tool?: string;
  readonly transcript_tool?: string;
  readonly note_tool?: string;
  readonly provider_poll?: boolean;
  readonly limit?: number;
  readonly page_size?: number;
  readonly arguments?: Readonly<Record<string, unknown>>;
  readonly resource_prefix?: string;
  readonly resourcePrefix?: string;
}

export interface MeetingSourceMcpAdapterOptions {
  readonly provider: MeetingSourceProvider;
  readonly client: MeetingSourceMcpClient;
  readonly config?: MeetingSourceMcpAdapterConfig;
  readonly log?: { readonly warn?: (...args: unknown[]) => void };
}

export interface MeetingSourceMcpPollInput {
  /** The provider state is accepted for Host compatibility and is not persisted here. */
  readonly provider?: UnknownRecord;
  readonly cursor?: UnknownRecord;
  readonly since?: string | null;
  readonly until?: string | null;
}

export interface MeetingSourceMcpTestResult {
  readonly ok: true;
  readonly auth_status: 'connected';
  readonly capabilities: readonly string[];
  readonly configured_tool: string | null;
}

export type MeetingSourceMcpArtifact = UnknownRecord;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function parseJsonMaybe(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** Extracts an array from the common MCP tool response envelopes. */
export function extractMeetingSourceArtifactList(payload: unknown): MeetingSourceMcpArtifact[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload.filter((item): item is UnknownRecord => Boolean(asRecord(item)));
  const record = asRecord(payload);
  if (!record) {
    const parsed = parseJsonMaybe(payload);
    return parsed === payload ? [] : extractMeetingSourceArtifactList(parsed);
  }
  for (const key of ['artifacts', 'items', 'records', 'results', 'files', 'data', 'transcripts', 'recordings']) {
    const value = record[key];
    if (Array.isArray(value)) return value.filter((item): item is UnknownRecord => Boolean(asRecord(item)));
  }
  if (record.structuredContent !== undefined) return extractMeetingSourceArtifactList(record.structuredContent);
  if (Array.isArray(record.content)) {
    const parsedItems = record.content.flatMap((item) => {
      const entry = asRecord(item);
      if (!entry || entry.type !== 'text' || typeof entry.text !== 'string') return [];
      const parsed = parseJsonMaybe(entry.text);
      return parsed === null ? [] : extractMeetingSourceArtifactList(parsed);
    });
    if (parsedItems.length) return parsedItems;
  }
  return [];
}

/** Returns the structured payload or the textual payload from a CallToolResult. */
export function extractMeetingSourceToolPayload(payload: unknown): unknown {
  if (!payload) return null;
  const record = asRecord(payload);
  if (!record) return parseJsonMaybe(payload);
  if (record.structuredContent !== undefined) return record.structuredContent;
  if (Array.isArray(record.content)) {
    const textItems = record.content
      .map((item) => asRecord(item))
      .filter((item): item is UnknownRecord => Boolean(item && item.type === 'text' && typeof item.text === 'string'));
    for (const item of textItems) {
      const parsed = parseJsonMaybe(item.text);
      if (parsed !== null) return parsed;
    }
    return textItems.map((item) => item.text as string).join('\n');
  }
  return payload;
}

/** Reads transcript/note text from provider-specific nested envelopes. */
export function extractMeetingSourceToolText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractMeetingSourceToolText).filter(Boolean).join('\n');
  const record = asRecord(value);
  if (!record) return '';
  for (const key of ['text', 'transcript', 'transcript_text', 'data_content', 'content', 'markdown', 'summary']) {
    if (typeof record[key] === 'string') return record[key] as string;
  }
  return extractMeetingSourceToolText(record.detailedSummary ?? record.data);
}

export function meetingSourceArtifactInWindow(
  value: unknown,
  window: { readonly since?: string | null; readonly until?: string | null } = {},
): boolean {
  if (!value) return true;
  const timestamp = Date.parse(String(value));
  if (Number.isNaN(timestamp)) return true;
  if (window.since && timestamp < Date.parse(window.since)) return false;
  if (window.until && timestamp > Date.parse(window.until)) return false;
  return true;
}

function extractResourceList(payload: unknown): UnknownRecord[] {
  const record = asRecord(payload);
  if (Array.isArray(payload)) return payload.filter((item): item is UnknownRecord => Boolean(asRecord(item)));
  if (!record) return [];
  if (Array.isArray(record.resources)) return record.resources.filter((item): item is UnknownRecord => Boolean(asRecord(item)));
  if (record.structuredContent !== undefined) return extractResourceList(record.structuredContent);
  return [];
}

function configuredTool(config: MeetingSourceMcpAdapterConfig): string | null {
  return config.tool ?? config.poll_tool ?? config.list_tool ?? null;
}

function boundedNumber(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), maximum);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function logFailure(
  logger: MeetingSourceMcpAdapterOptions['log'],
  provider: MeetingSourceProvider,
  kind: string,
  externalId: string,
): void {
  // Do not include provider response/error text: it can contain an access token.
  logger?.warn?.(`[meeting-source] ${provider} ${kind} fetch failed for ${externalId}`);
}

function toolNames(payload: unknown): string[] {
  const record = asRecord(payload);
  const tools = record && Array.isArray(record.tools) ? record.tools : [];
  return tools
    .map((tool) => asRecord(tool)?.name)
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
}

export class MeetingSourceMcpAdapter {
  readonly provider: MeetingSourceProvider;
  readonly client: MeetingSourceMcpClient;
  readonly config: MeetingSourceMcpAdapterConfig;
  readonly log: MeetingSourceMcpAdapterOptions['log'];

  constructor(options: MeetingSourceMcpAdapterOptions) {
    if (!options?.client || typeof options.client.callTool !== 'function') {
      throw new TypeError('client.callTool is required');
    }
    if (!(SUPPORTED_MEETING_SOURCE_PROVIDERS as readonly string[]).includes(options.provider)) {
      throw new Error(`unsupported meeting source provider adapter: ${String(options.provider)}`);
    }
    this.provider = options.provider;
    this.client = options.client;
    this.config = Object.freeze({ ...(options.config ?? {}) });
    this.log = options.log;
  }

  private toolArgs(input: MeetingSourceMcpPollInput): Record<string, unknown> {
    return {
      ...(this.config.arguments ?? {}),
      since: input.since ?? null,
      until: input.until ?? null,
      updated_since: input.since ?? null,
      cursor: input.cursor ?? {},
    };
  }

  private async pollTactiq(input: MeetingSourceMcpPollInput): Promise<MeetingSourceMcpArtifact[]> {
    const result = await this.client.callTool(this.config.tool ?? this.config.poll_tool ?? 'list_recent_meetings', {
      ...(this.config.arguments ?? {}),
      limit: boundedNumber(this.config.limit ?? this.config.page_size, 50, 50),
    });
    const meetings = extractMeetingSourceArtifactList(result).filter((meeting) => meetingSourceArtifactInWindow(
      meeting.createdAt ?? meeting.created_at ?? meeting.started_at,
      input,
    ));
    const artifacts: MeetingSourceMcpArtifact[] = [];
    for (const meeting of meetings) {
      const meetingId = stringValue(meeting.id ?? meeting.external_id);
      let detail: UnknownRecord | null = null;
      if (meetingId) {
        try {
          detail = asRecord(extractMeetingSourceToolPayload(await this.client.callTool(
            this.config.detail_tool ?? 'get_meeting',
            { id: meetingId },
          )));
        } catch {
          logFailure(this.log, this.provider, 'detail', meetingId);
        }
      }
      const summary = asRecord(detail?.detailedSummary ?? meeting.detailedSummary);
      const noteText = summary?.status === 'ready'
        ? extractMeetingSourceToolText(summary.content)
        : extractMeetingSourceToolText(summary);
      artifacts.push({
        ...meeting,
        ...(detail ?? {}),
        ...(meetingId ? { external_id: meetingId } : {}),
        title: detail?.title ?? meeting.title,
        started_at: meeting.createdAt ?? detail?.createdAt ?? meeting.created_at ?? detail?.created_at ?? null,
        updated_at: meeting.createdAt ?? detail?.createdAt ?? meeting.updated_at ?? detail?.updated_at ?? null,
        participants: meeting.attendees ?? detail?.attendees ?? meeting.participants ?? [],
        note_text: noteText,
        meeting_mode: 'online',
        resource_uri: meeting.url ?? detail?.url ?? meeting.resource_uri ?? null,
      });
    }
    return artifacts;
  }

  private async pollPlaud(input: MeetingSourceMcpPollInput): Promise<MeetingSourceMcpArtifact[]> {
    const result = await this.client.callTool(this.config.tool ?? this.config.poll_tool ?? 'list_files', {
      page: 1,
      page_size: boundedNumber(this.config.page_size, 20, 200),
      ...(input.since ? { date_from: input.since.slice(0, 10) } : {}),
      ...(input.until ? { date_to: input.until.slice(0, 10) } : {}),
      ...(this.config.arguments ?? {}),
    });
    const files = extractMeetingSourceArtifactList(result).filter((file) => meetingSourceArtifactInWindow(
      file.start_at ?? file.created_at ?? file.started_at,
      input,
    ));
    const artifacts: MeetingSourceMcpArtifact[] = [];
    for (const file of files) {
      const fileId = stringValue(file.id ?? file.file_id ?? file.fileId);
      let transcriptText = '';
      let noteText = '';
      if (fileId) {
        try {
          transcriptText = extractMeetingSourceToolText(extractMeetingSourceToolPayload(await this.client.callTool(
            this.config.transcript_tool ?? 'get_transcript',
            { file_id: fileId },
          )));
        } catch {
          logFailure(this.log, this.provider, 'transcript', fileId);
        }
        try {
          noteText = extractMeetingSourceToolText(extractMeetingSourceToolPayload(await this.client.callTool(
            this.config.note_tool ?? 'get_note',
            { file_id: fileId },
          )));
        } catch {
          logFailure(this.log, this.provider, 'note', fileId);
        }
      }
      artifacts.push({
        ...file,
        ...(fileId ? { external_id: fileId } : {}),
        title: file.name ?? file.title,
        started_at: file.start_at ?? file.created_at ?? null,
        updated_at: file.created_at ?? file.start_at ?? null,
        transcript_text: transcriptText,
        note_text: noteText,
        meeting_mode: 'offline',
        resource_uri: fileId ? `plaud:${fileId}` : null,
      });
    }
    return artifacts;
  }

  async test(_input?: unknown): Promise<MeetingSourceMcpTestResult> {
    let capabilities: string[] = [];
    if (typeof this.client.listTools === 'function') {
      try {
        capabilities = toolNames(await this.client.listTools());
      } catch {
        capabilities = [];
      }
    }
    return {
      ok: true,
      auth_status: 'connected',
      capabilities,
      configured_tool: configuredTool(this.config),
    };
  }

  async poll(input: MeetingSourceMcpPollInput = {}): Promise<MeetingSourceMcpArtifact[]> {
    // Preserve the legacy Host predicate: provider polling is selected when it
    // is explicitly enabled or when no primary tool is configured. The legacy
    // provider path intentionally treats poll_tool/list_tool as provider
    // configuration and only uses them inside the provider-specific adapter.
    const providerPoll = this.config.provider_poll === true || !this.config.tool;
    if (this.provider === 'tactiq' && providerPoll) return this.pollTactiq(input);
    if (this.provider === 'plaud' && providerPoll) return this.pollPlaud(input);
    const tool = configuredTool(this.config);
    if (tool) {
      return extractMeetingSourceArtifactList(await this.client.callTool(tool, this.toolArgs(input)));
    }
    if (typeof this.client.listResources !== 'function') return [];
    const prefix = this.config.resource_prefix ?? this.config.resourcePrefix;
    return extractResourceList(await this.client.listResources())
      .filter((resource) => !prefix || String(resource.uri ?? '').startsWith(prefix))
      .map((resource) => ({
        id: resource.uri,
        title: resource.name ?? resource.title ?? resource.uri,
        resource_uri: resource.uri,
        updated_at: resource.updated_at ?? resource.modified_at ?? null,
        provider: this.provider,
      }));
  }
}

export function createMeetingSourceMcpAdapter(options: MeetingSourceMcpAdapterOptions): MeetingSourceMcpAdapter {
  return new MeetingSourceMcpAdapter(options);
}
