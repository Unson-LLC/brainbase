import { readdir, readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LocalWebExtension, LocalWebModule, LocalWebModuleContext } from './local-web-host.js';
import { requestUrl, writeJson } from './local-web-security.js';

/**
 * Experimental world view (W1–W4, provisional adoption on 2026-10-04).
 *
 * The world is a read-only projection.  Businesses come from the owner's
 * organization Graph (read-only, ledger P3/C1); judgments come from the
 * existing value-proof home on the browser side.  Nothing here writes, and a
 * failure to read is reported as a state, never as zero businesses.
 */
export const EXPERIMENTAL_WORLD_ID = 'world';
export const EXPERIMENTAL_WORLD_VERSION = 'experimental-world.v0' as const;

const BUSINESS_KINDS = ['product', 'client', 'internal', 'research'] as const;
type BusinessKind = (typeof BUSINESS_KINDS)[number];
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 9_000_000;

export interface WorldEngagement {
  readonly id: string;
  readonly name: string;
  readonly summary: string | null;
  readonly status: string | null;
}

export interface WorldBusiness {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: BusinessKind;
  readonly purpose: string | null;
  readonly status: string | null;
  /** Repository names the Graph registers for this business (`repository_roots[].repository`). */
  readonly repositories: readonly string[];
  readonly engagements: readonly WorldEngagement[];
}

export interface WorldBusinessProjection {
  readonly businesses: readonly WorldBusiness[];
  /** Active records that belong to no listed business (kept visible, never dropped silently). */
  readonly unplaced: readonly WorldEngagement[];
  readonly excluded: { readonly inactive: number; readonly unnamed: number };
}

export type WorldBusinessesResponse =
  | ({ readonly status: 'ok'; readonly version: typeof EXPERIMENTAL_WORLD_VERSION; readonly source: { readonly server: string; readonly organization_id: string | null }; readonly as_of: string } & WorldBusinessProjection)
  | { readonly status: 'not_connected' | 'auth_failed' | 'unavailable'; readonly version: typeof EXPERIMENTAL_WORLD_VERSION; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function engagementOf(record: Record<string, unknown>, payload: Record<string, unknown>): WorldEngagement {
  return {
    id: String(record.id),
    name: text(payload.name) ?? String(record.id),
    summary: text(payload.summary) ?? text(payload.description) ?? text(payload.purpose),
    status: text(payload.operational_status) ?? text(payload.status),
  };
}

/**
 * Organization Graph project records → businesses (cities) and their
 * engagements (districts).  A business is an active catalog project with a
 * known kind; an engagement is an active record without a kind that names a
 * business through `project_code`.  Retired and superseded records are counted,
 * not drawn.
 */
export function projectWorldBusinesses(records: readonly unknown[]): WorldBusinessProjection {
  const businesses = new Map<string, { base: Omit<WorldBusiness, 'engagements'>; engagements: WorldEngagement[] }>();
  const candidates: { record: Record<string, unknown>; payload: Record<string, unknown> }[] = [];
  let inactive = 0;
  let unnamed = 0;
  for (const record of records) {
    if (!isRecord(record) || !isRecord(record.payload) || typeof record.id !== 'string') continue;
    const payload = record.payload;
    if (record.lifecycle_status !== 'active') {
      inactive += 1;
      continue;
    }
    if (!text(payload.name)) {
      unnamed += 1;
      continue;
    }
    const kind = payload.kind;
    const code = text(payload.code) ?? text(record.project_code);
    if (typeof kind === 'string' && (BUSINESS_KINDS as readonly string[]).includes(kind) && code && code === record.project_code) {
      businesses.set(code, {
        base: {
          id: record.id,
          code,
          name: text(payload.name) ?? code,
          kind: kind as BusinessKind,
          purpose: text(payload.purpose) ?? text(payload.summary),
          status: text(payload.operational_status) ?? text(payload.status),
          repositories: Array.isArray(payload.repository_roots)
            ? payload.repository_roots.filter(isRecord).map((root) => text(root.repository)).filter((name): name is string => name !== null)
            : [],
        },
        engagements: [],
      });
      continue;
    }
    candidates.push({ record, payload });
  }
  const unplaced: WorldEngagement[] = [];
  for (const { record, payload } of candidates) {
    const owner = typeof record.project_code === 'string' ? businesses.get(record.project_code) : undefined;
    if (owner) owner.engagements.push(engagementOf(record, payload));
    else unplaced.push(engagementOf(record, payload));
  }
  const order = (kind: BusinessKind) => BUSINESS_KINDS.indexOf(kind);
  return {
    businesses: [...businesses.values()]
      .map(({ base, engagements }) => ({ ...base, engagements: engagements.sort((a, b) => a.name.localeCompare(b.name, 'ja')) }))
      .sort((a, b) => order(a.kind) - order(b.kind) || a.name.localeCompare(b.name, 'ja')),
    unplaced,
    excluded: { inactive, unnamed },
  };
}

interface OrganizationAccess {
  readonly server: string;
  readonly token: string;
}

/** Reads the owner's Brainbase server and token at request time (tokens rotate hourly). */
async function readOrganizationAccess(home: string): Promise<OrganizationAccess | { readonly reason: string }> {
  try {
    const config = JSON.parse(await readFile(join(home, '.brainbase', 'config.json'), 'utf8')) as unknown;
    const tokens = JSON.parse(await readFile(join(home, '.brainbase', 'tokens.json'), 'utf8')) as unknown;
    const server = isRecord(config) ? text(config.server_url) : null;
    const token = isRecord(tokens) ? text(tokens.access_token) : null;
    if (!server || !/^https:\/\/[^/?#@]+$/u.test(server)) return { reason: 'server_url_missing_or_invalid' };
    if (!token) return { reason: 'access_token_missing' };
    return { server, token };
  } catch {
    return { reason: 'brainbase_auth_files_unreadable' };
  }
}

export async function readWorldBusinesses(options: { home?: string; fetch?: typeof fetch; now?: () => Date } = {}): Promise<WorldBusinessesResponse> {
  const access = await readOrganizationAccess(options.home ?? homedir());
  if ('reason' in access) return { status: 'not_connected', version: EXPERIMENTAL_WORLD_VERSION, reason: access.reason };
  const request = options.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await request(`${access.server}/api/info/graph/entities?type=project&limit=500`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${access.token}`, Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      return { status: 'auth_failed', version: EXPERIMENTAL_WORLD_VERSION, reason: `http_${response.status}` };
    }
    if (!response.ok) return { status: 'unavailable', version: EXPERIMENTAL_WORLD_VERSION, reason: `http_${response.status}` };
    const body = await response.text();
    if (body.length > MAX_RESPONSE_BYTES) return { status: 'unavailable', version: EXPERIMENTAL_WORLD_VERSION, reason: 'response_too_large' };
    const parsed = JSON.parse(body) as unknown;
    const records = isRecord(parsed) && Array.isArray(parsed.records) ? parsed.records : null;
    if (!records) return { status: 'unavailable', version: EXPERIMENTAL_WORLD_VERSION, reason: 'response_shape_invalid' };
    const organizationIds = new Set(records.filter(isRecord).map((record) => record.organization_id).filter((id): id is string => typeof id === 'string'));
    return {
      status: 'ok',
      version: EXPERIMENTAL_WORLD_VERSION,
      source: { server: access.server, organization_id: organizationIds.size === 1 ? [...organizationIds][0]! : null },
      as_of: (options.now ?? (() => new Date()))().toISOString(),
      ...projectWorldBusinesses(records),
    };
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'request_failed';
    return { status: 'unavailable', version: EXPERIMENTAL_WORLD_VERSION, reason };
  } finally {
    clearTimeout(timer);
  }
}

export interface WorldJudgmentPlace {
  readonly decision_attempt_id: string;
  /** Repository the judgment Host recorded for the turn (`turn-input.json` project_code); null when unrecorded. */
  readonly workspace: string | null;
}

const MAX_JUDGMENT_PLACES = 5_000;
const VALUE_PROOF_SUFFIX = '.value-proof.json';

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/**
 * Reads, for every saved value proof in the judgment journal, the repository
 * the Host recorded for that turn.  Read only; a missing journal is an empty
 * list with `status: 'unavailable'`, never invented places.
 */
export async function readJudgmentPlaces(journalRoot: string): Promise<{ readonly status: 'available' | 'unavailable'; readonly places: readonly WorldJudgmentPlace[]; readonly reason?: string }> {
  let sessions: string[];
  try {
    sessions = (await readdir(journalRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return { status: 'unavailable', places: [], reason: 'journal_unreadable' };
  }
  const places: WorldJudgmentPlace[] = [];
  // Proofs live in per-session folders; older ones may sit at the journal root.
  for (const session of ['', ...sessions]) {
    let files: string[];
    try {
      files = await readdir(join(journalRoot, session));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(VALUE_PROOF_SUFFIX) || places.length >= MAX_JUDGMENT_PLACES) continue;
      const base = join(journalRoot, session, file.slice(0, -VALUE_PROOF_SUFFIX.length));
      const proof = await readJsonFile(`${base}${VALUE_PROOF_SUFFIX}`);
      const decisionAttemptId = isRecord(proof) ? text(proof.decision_attempt_id) : null;
      if (!decisionAttemptId) continue;
      const turnInput = await readJsonFile(`${base}.turn-input.json`);
      places.push({ decision_attempt_id: decisionAttemptId, workspace: isRecord(turnInput) ? text(turnInput.project_code) : null });
    }
  }
  return { status: 'available', places };
}

function createWorldModule(context: LocalWebModuleContext, read: () => Promise<WorldBusinessesResponse>): LocalWebModule {
  return {
    id: EXPERIMENTAL_WORLD_ID,
    uiFiles: [],
    async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
      if (request.method !== 'GET') return false;
      const path = requestUrl(request).pathname;
      if (path === `/api/extensions/${EXPERIMENTAL_WORLD_ID}/businesses`) {
        response.setHeader('Cache-Control', 'no-store');
        writeJson(response, 200, await read());
        return true;
      }
      if (path === `/api/extensions/${EXPERIMENTAL_WORLD_ID}/judgment-places`) {
        response.setHeader('Cache-Control', 'no-store');
        writeJson(response, 200, { version: EXPERIMENTAL_WORLD_VERSION, ...(await readJudgmentPlaces(context.journalRoot)) });
        return true;
      }
      return false;
    },
  };
}

export function createExperimentalWorldExtension(options: { home?: string; fetch?: typeof fetch } = {}): LocalWebExtension {
  return {
    id: EXPERIMENTAL_WORLD_ID,
    uiDir: fileURLToPath(new URL('../ui/world/', import.meta.url)),
    uiFiles: ['world-view.js', 'world-view.css', 'world-vendor.js', 'world-placement.js'],
    screenEntry: 'world-view.js',
    // W1 (provisional): the world sits above the home and opens first.
    navPosition: 'first',
    createModule: (context) => createWorldModule(context, () => readWorldBusinesses(options)),
  };
}
