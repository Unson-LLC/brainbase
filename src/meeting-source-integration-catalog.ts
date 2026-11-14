/**
 * The meeting source providers Brainbase treats as effective (Tactiq for
 * online meetings, Plaud.ai for offline recordings and calls), with an
 * optional live check of their public integration surfaces on integrations.sh.
 *
 * Moved unchanged from brainbase-unson server/services/meeting-source/meeting-source-integration-catalog.js
 * (story-document-and-meeting-source-exits-v1).
 */

const INTEGRATIONS_SH_BASE_URL = 'https://integrations.sh';

export interface MeetingSourceCatalogSurface {
  type: string;
  transport: string;
  configured_by: string;
  confidence: string;
  purpose: string;
}

export interface MeetingSourceCatalogProvider {
  provider: string;
  domain: string;
  label: string;
  role: string;
  source_role: string;
  catalog_source: string;
  catalog_status: string;
  surfaces: readonly MeetingSourceCatalogSurface[];
  auth: {
    managed_by: string;
    credential_ref_required: boolean;
    local_secret_storage: boolean;
    user_action: string;
  };
  notes: readonly string[];
}

export interface MeetingSourceUpstreamDetect {
  ok: boolean;
  status?: number;
  found?: unknown[];
  mcp?: unknown[];
  integrations_json?: unknown;
  auth?: unknown[];
  error?: string;
}

export interface MeetingSourceCatalogEntry extends MeetingSourceCatalogProvider {
  effective: true;
  upstream: {
    name: 'integrations.sh';
    domain: string;
    detect_url: string;
    detect_status: 'pending' | 'not_queried';
  };
  upstream_detect: MeetingSourceUpstreamDetect | null;
}

export interface MeetingSourceCatalog {
  version: 1;
  generated_at: string;
  upstream: { name: 'integrations.sh'; base_url: string; purpose: string };
  providers: MeetingSourceCatalogEntry[];
}

type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface MeetingSourceIntegrationCatalogOptions {
  baseURL?: string;
  fetchImpl?: FetchLike | null;
  clock?: () => string;
}

const MEETING_SOURCE_PROVIDER_CATALOG: Readonly<Record<string, MeetingSourceCatalogProvider>> = Object.freeze({
  tactiq: Object.freeze({
    provider: 'tactiq',
    domain: 'tactiq.io',
    label: 'Tactiq',
    role: 'online_primary',
    source_role: 'online meetings',
    catalog_source: 'brainbase_override',
    catalog_status: 'override_required',
    surfaces: Object.freeze([
      Object.freeze({
        type: 'mcp',
        transport: 'brainbase_runtime',
        configured_by: 'brainbase_mcp_runtime',
        confidence: 'manual_override',
        purpose: 'online meeting transcripts and speaker timeline',
      }),
    ]),
    auth: Object.freeze({
      managed_by: 'brainbase_runtime',
      credential_ref_required: true,
      local_secret_storage: false,
      user_action: 'provider login is completed outside Mac Companion and stored by Brainbase runtime',
    }),
    notes: Object.freeze([
      'integrations.sh may not detect a published MCP surface yet; Brainbase keeps Tactiq as an effective provider override.',
      'Calendar data is context only. Tactiq is the primary source for online meetings.',
    ]),
  }),
  plaud: Object.freeze({
    provider: 'plaud',
    domain: 'plaud.ai',
    label: 'Plaud.ai',
    role: 'offline_or_call_primary',
    source_role: 'offline recordings, calls, and online meetings without Tactiq',
    catalog_source: 'brainbase_override',
    catalog_status: 'override_required',
    surfaces: Object.freeze([
      Object.freeze({
        type: 'mcp',
        transport: 'brainbase_runtime',
        configured_by: 'brainbase_mcp_runtime',
        confidence: 'manual_override',
        purpose: 'offline recordings, calls, and fallback meeting transcripts',
      }),
    ]),
    auth: Object.freeze({
      managed_by: 'brainbase_runtime',
      credential_ref_required: true,
      local_secret_storage: false,
      user_action: 'provider login is completed outside Mac Companion and stored by Brainbase runtime',
    }),
    notes: Object.freeze([
      'integrations.sh may not detect a published MCP surface yet; Brainbase keeps Plaud.ai as an effective provider override.',
      'Calendar data is context only. Plaud.ai is the primary source for offline meetings and calls.',
    ]),
  }),
});

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeProvider(provider: unknown): string {
  return String(provider || '').trim().toLowerCase();
}

function providerEntry(provider: unknown): MeetingSourceCatalogProvider {
  const key = normalizeProvider(provider);
  const entry = MEETING_SOURCE_PROVIDER_CATALOG[key];
  if (!entry) {
    const error = new Error(`unsupported meeting source provider: ${provider}`) as Error & { statusCode?: number };
    error.statusCode = 404;
    throw error;
  }
  return structuredClone(entry);
}

function integrationDetectURL(baseURL: string, domain: string): string {
  return `${String(baseURL).replace(/\/$/, '')}/api/${encodeURIComponent(domain)}/detect`;
}

export class MeetingSourceIntegrationCatalogService {
  baseURL: string;
  fetchImpl: FetchLike | null | undefined;
  clock: () => string;

  constructor({
    baseURL = INTEGRATIONS_SH_BASE_URL,
    fetchImpl = globalThis.fetch as unknown as FetchLike,
    clock = nowIso,
  }: MeetingSourceIntegrationCatalogOptions = {}) {
    this.baseURL = baseURL;
    this.fetchImpl = fetchImpl;
    this.clock = clock;
  }

  async listCatalog({ includeLiveDetect = false }: { includeLiveDetect?: boolean } = {}): Promise<MeetingSourceCatalog> {
    const providers = Object.keys(MEETING_SOURCE_PROVIDER_CATALOG);
    const entries: MeetingSourceCatalogEntry[] = [];
    for (const provider of providers) {
      entries.push(await this.getCatalogEntry(provider, { includeLiveDetect }));
    }
    return {
      version: 1,
      generated_at: this.clock(),
      upstream: {
        name: 'integrations.sh',
        base_url: this.baseURL,
        purpose: 'detect public integration surfaces; Brainbase override decides effective meeting-source providers',
      },
      providers: entries,
    };
  }

  async getCatalogEntry(provider: unknown, { includeLiveDetect = false }: { includeLiveDetect?: boolean } = {}): Promise<MeetingSourceCatalogEntry> {
    const entry = providerEntry(provider);
    return {
      ...entry,
      effective: true,
      upstream: {
        name: 'integrations.sh',
        domain: entry.domain,
        detect_url: integrationDetectURL(this.baseURL, entry.domain),
        detect_status: includeLiveDetect ? 'pending' : 'not_queried',
      },
      upstream_detect: includeLiveDetect ? await this.detectUpstream(entry.domain) : null,
    };
  }

  async refreshProvider(provider: unknown): Promise<MeetingSourceCatalogEntry> {
    return this.getCatalogEntry(provider, { includeLiveDetect: true });
  }

  async detectUpstream(domain: string): Promise<MeetingSourceUpstreamDetect> {
    if (typeof this.fetchImpl !== 'function') {
      return {
        ok: false,
        error: 'fetch_not_available',
      };
    }
    try {
      const response = await this.fetchImpl(integrationDetectURL(this.baseURL, domain), {
        headers: { accept: 'application/json' },
      });
      const body = await response.json() as Record<string, unknown> | null;
      return {
        ok: response.ok,
        status: response.status,
        found: (body?.found as unknown[]) || [],
        mcp: (body?.mcp as unknown[]) || [],
        integrations_json: body?.integrationsJson || null,
        auth: (body?.auth as unknown[]) || [],
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as { message?: string } | null)?.message || 'upstream_detect_failed',
      };
    }
  }
}

export function createMeetingSourceIntegrationCatalogService(options: MeetingSourceIntegrationCatalogOptions = {}): MeetingSourceIntegrationCatalogService {
  return new MeetingSourceIntegrationCatalogService(options);
}
