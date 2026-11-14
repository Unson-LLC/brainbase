import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  JudgmentValueProofJournalCache,
  readJudgmentValueProofJournal,
} from './judgment-value-proof-review.js';
import { projectOrganizationGraph, projectVocabularyTerms } from './organization-graph-web.js';
import { readLocalGraphState, type GraphVocabularyTerm, type LocalWebExtension, type LocalWebModule, type LocalWebModuleContext } from './local-web-host.js';
import { loadPersonalOs } from './ssot.js';
import type { CanonicalEntity, GraphFileV2 } from './types.js';
import { requestUrl, writeJson } from './local-web-security.js';
import { WORLD_WORK_VERSION } from './world-work.js';

export * from './world-work.js';

/**
 * World view (ledger P17, adopted 2026-10-04): the home's upper layer.
 *
 * The world is a read-only projection.  Businesses come from the same Graph
 * the other screens read (the organization Graph under C1, else the local
 * Graph); judgments come from the existing value-proof home on the browser
 * side.  Nothing here writes, and a failure to read is reported as a state,
 * never as zero businesses.
 */
export const WORLD_EXTENSION_ID = 'world';
export const WORLD_EXTENSION_VERSION = 'world-extension.v1' as const;

const LIFECYCLE_PHASES = ['active', 'maintenance', 'finished', 'concept'] as const;
/** How a status looks in the world: lit, muted, an empty lot, or a scaffold. */
export type WorldLifecyclePhase = (typeof LIFECYCLE_PHASES)[number];
const BUILDING_FORMS = ['tower', 'hall', 'dome', 'office'] as const;
export type WorldBuildingForm = (typeof BUILDING_FORMS)[number];

/**
 * The words of the owner's Graph, given by the host (`--world-vocabulary`):
 * the project kinds in display order with their label and building, and the
 * statuses with their label and lifecycle phase.  None of it is required: a
 * kind the vocabulary does not name is drawn under its own value, and a status
 * it does not name keeps its value and the active look.
 */
export interface WorldVocabularyConfig {
  readonly kinds?: Readonly<Record<string, { readonly label?: string; readonly form?: WorldBuildingForm; readonly color?: string }>>;
  readonly statuses?: Readonly<Record<string, { readonly label?: string; readonly phase?: WorldLifecyclePhase }>>;
  /** The owner's words for the states of a business's tools (story-world-business-exits-v1 AC-04). */
  readonly exit_states?: Readonly<Partial<Record<WorldExitState, { readonly label?: string }>>>;
}

const EXIT_STATES = ['available', 'restricted', 'unknown', 'unavailable'] as const;
/** The state a host gives a tool of a business (`businessExits` in the world view). */
export type WorldExitState = (typeof EXIT_STATES)[number];

export interface WorldVocabulary {
  readonly kinds: readonly {
    readonly key: string | null;
    readonly label: string;
    /** Where the label came from: the organization's term, the host's vocabulary file, or the value itself. */
    readonly label_source: 'graph' | 'config' | 'value';
    readonly definition: string | null;
    readonly form: WorldBuildingForm;
    readonly color: string;
    readonly configured: boolean;
  }[];
  /** Whether the organization's terms were read: `unavailable` when they could not be, `none` without an organization Graph. */
  readonly terms: 'read' | 'unavailable' | 'none';
  readonly statuses: readonly { readonly key: string; readonly label: string; readonly phase: WorldLifecyclePhase }[];
  /** The words for the four tool states, the owner's over the defaults, in a fixed order. */
  readonly exit_states: readonly { readonly key: WorldExitState; readonly label: string }[];
}

/** Lifecycle words common to any Graph; a host vocabulary may relabel or add to them. */
const DEFAULT_STATUSES: Readonly<Record<string, { label: string; phase: WorldLifecyclePhase }>> = Object.freeze({
  active: { label: '進行中', phase: 'active' },
  maintenance: { label: '保守', phase: 'maintenance' },
  completed: { label: '完了', phase: 'finished' },
  closed: { label: '終了', phase: 'finished' },
  archived: { label: '保管', phase: 'finished' },
  concept: { label: '構想', phase: 'concept' },
});
/** The words for the states of a business's tools when the owner gives none. */
const DEFAULT_EXIT_STATES: Readonly<Record<WorldExitState, string>> = Object.freeze({
  available: '使える',
  restricted: '権限が必要',
  unknown: '未確認',
  unavailable: '読めない',
});
const KIND_PALETTE = ['#1261ad', '#b07a1f', '#35684c', '#6b4fa0', '#a8433a', '#2f7d86', '#7a6a2b', '#5b6470'];
const UNCLASSIFIED_COLOR = '#69746d';
const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

export interface WorldEngagement {
  readonly id: string;
  /** The project's own code in its Graph (`metadata.code`), or null when it has none. */
  readonly code: string | null;
  readonly name: string;
  readonly summary: string | null;
  readonly status: string | null;
}

export interface WorldBusiness {
  readonly id: string;
  /** The project's code in its Graph (`metadata.code`), else its id; judgments are placed by it. */
  readonly code: string;
  readonly name: string;
  /** `metadata.kind`, or null when the Graph does not classify the project. */
  readonly kind: string | null;
  readonly purpose: string | null;
  readonly status: string | null;
  /** Repository names the Graph registers for this project (`metadata.repositories`). */
  readonly repositories: readonly string[];
  readonly engagements: readonly WorldEngagement[];
  /** How much happened lately: decisions of this business (or its engagements) in the last 30 days. */
  readonly activity: WorldBusinessActivity;
}

export interface WorldBusinessActivity {
  readonly window_days: 30;
  /** Decisions decided in the window, belonging to this business by scope code or a `governs` edge. */
  readonly decisions: number;
  /** The newest decision date of this business at any time, or null when it has none dated. */
  readonly latest_decision_at: string | null;
}

const ACTIVITY_WINDOW_DAYS = 30;

export interface WorldBusinessProjection {
  readonly businesses: readonly WorldBusiness[];
  /** Projects that name a parent the Graph does not hold (kept visible as a count, never dropped silently). */
  readonly unplaced: readonly WorldEngagement[];
  readonly excluded: { readonly inactive: number };
}

export type WorldSource =
  | { readonly authority: 'organization_graph'; readonly server: string }
  | { readonly authority: 'local'; readonly dataDir: string };

export type WorldBusinessesResponse =
  | ({ readonly status: 'ok'; readonly version: typeof WORLD_EXTENSION_VERSION; readonly source: WorldSource; readonly as_of: string; readonly vocabulary: WorldVocabulary } & WorldBusinessProjection)
  | { readonly status: 'not_initialized' | 'migration_required' | 'unavailable'; readonly version: typeof WORLD_EXTENSION_VERSION; readonly reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function engagementOf(entity: CanonicalEntity): WorldEngagement {
  return {
    id: entity.id,
    code: text(entity.metadata?.code),
    name: entity.name,
    summary: text(entity.summary) ?? text(entity.metadata?.goal),
    status: text(entity.metadata?.status),
  };
}

/**
 * The projects of a Graph v2 → cities (top-level projects) and their districts
 * (projects whose `metadata.parent_project_id` names another project).  A
 * project whose declared parent (`metadata.parent_project_code`) is not in the
 * Graph is counted as unplaced.  Projects past `validTo` are counted, not drawn.
 * Nothing here knows any organization's words: kinds and statuses are the
 * Graph's own values.
 */
export function projectWorldFromGraph(graph: Pick<GraphFileV2, 'entities'> & { readonly edges?: GraphFileV2['edges'] }, now: Date = new Date()): WorldBusinessProjection {
  const projects = graph.entities.filter((entity) => entity.type === 'project');
  const active = projects.filter((entity) => !entity.validTo || Date.parse(entity.validTo) > now.getTime());
  const byId = new Map(active.map((entity) => [entity.id, entity]));
  // A district hangs on its top-level ancestor, so nested projects stay in one city.
  const topOf = (entity: CanonicalEntity): CanonicalEntity | null => {
    let current = entity;
    const seen = new Set<string>();
    for (;;) {
      const parentId = text(current.metadata?.parent_project_id);
      if (!parentId || parentId === current.id) return current;
      const parent = byId.get(parentId);
      if (!parent || seen.has(parentId)) return parent ? current : null;
      seen.add(parentId);
      current = parent;
    }
  };
  const cities = new Map<string, { entity: CanonicalEntity; engagements: WorldEngagement[] }>();
  const unplaced: WorldEngagement[] = [];
  const children: CanonicalEntity[] = [];
  for (const entity of active) {
    const parentId = text(entity.metadata?.parent_project_id);
    if (parentId && parentId !== entity.id) children.push(entity);
    else if (text(entity.metadata?.parent_project_code)) unplaced.push(engagementOf(entity));
    else cities.set(entity.id, { entity, engagements: [] });
  }
  for (const entity of children) {
    const top = topOf(entity);
    const city = top ? cities.get(top.id) : undefined;
    if (city && top!.id !== entity.id) city.engagements.push(engagementOf(entity));
    else unplaced.push(engagementOf(entity));
  }
  // Which business a decision belongs to: its scope code (organization Graph) or the project it
  // governs (local Graph), resolved to the city that project is or hangs under.
  const cityOfKey = new Map<string, string>();
  for (const [cityId, { entity, engagements }] of cities) {
    cityOfKey.set(entity.id, cityId);
    const code = text(entity.metadata?.code);
    if (code) cityOfKey.set(code, cityId);
    for (const engagement of engagements) {
      cityOfKey.set(engagement.id, cityId);
      if (engagement.code) cityOfKey.set(engagement.code, cityId);
    }
  }
  const governs = new Map<string, string[]>();
  for (const edge of graph.edges ?? []) {
    if (edge.relation !== 'governs') continue;
    governs.set(edge.fromId, [...(governs.get(edge.fromId) ?? []), edge.toId]);
  }
  const windowStart = now.getTime() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const activity = new Map<string, { decisions: number; latest: string | null }>();
  for (const decision of graph.entities) {
    if (decision.type !== 'decision') continue;
    const at = text(decision.metadata?.decided_at) ?? text(decision.validFrom);
    const time = at ? Date.parse(at) : Number.NaN;
    if (!Number.isFinite(time)) continue;
    const keys = [text(decision.metadata?.project_code), ...(governs.get(decision.id) ?? [])].filter((key): key is string => key !== null);
    const cityIds = new Set(keys.map((key) => cityOfKey.get(key)).filter((id): id is string => id !== undefined));
    for (const cityId of cityIds) {
      const entry = activity.get(cityId) ?? { decisions: 0, latest: null };
      if (time >= windowStart && time <= now.getTime()) entry.decisions += 1;
      if (!entry.latest || time > Date.parse(entry.latest)) entry.latest = new Date(time).toISOString();
      activity.set(cityId, entry);
    }
  }
  const businesses = [...cities.values()].map(({ entity, engagements }): WorldBusiness => ({
    id: entity.id,
    code: text(entity.metadata?.code) ?? entity.id,
    name: entity.name,
    kind: text(entity.metadata?.kind),
    purpose: text(entity.metadata?.goal) ?? text(entity.summary),
    status: text(entity.metadata?.status),
    repositories: Array.isArray(entity.metadata?.repositories)
      ? (entity.metadata!.repositories as unknown[]).map(text).filter((name): name is string => name !== null)
      : [],
    engagements: engagements.sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    activity: {
      window_days: ACTIVITY_WINDOW_DAYS,
      decisions: activity.get(entity.id)?.decisions ?? 0,
      latest_decision_at: activity.get(entity.id)?.latest ?? null,
    },
  }));
  return {
    businesses: businesses.sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    unplaced,
    excluded: { inactive: projects.length - active.length },
  };
}

/**
 * The vocabulary the world draws with: the host's kinds in their order, then
 * kinds the Graph uses that the host did not name (under their own value),
 * then unclassified projects; statuses are the common lifecycle words with the
 * host's on top.
 */
export function resolveWorldVocabulary(
  config: WorldVocabularyConfig | undefined,
  businesses: readonly WorldBusiness[],
  terms: readonly GraphVocabularyTerm[] | null | undefined = undefined
): WorldVocabulary {
  // The organization names its kinds in the Graph; the host's file only adds a look (form, colour).
  const graphTerms = new Map((terms ?? []).filter((term) => term.field === 'project.kind').map((term) => [term.value, term]));
  const named = (key: string, configLabel: string | undefined) => {
    const term = graphTerms.get(key);
    if (term) return { label: term.label, label_source: 'graph' as const, definition: term.definition };
    const label = text(configLabel);
    return label ? { label, label_source: 'config' as const, definition: null } : { label: key, label_source: 'value' as const, definition: null };
  };
  const configured = Object.entries(config?.kinds ?? {});
  const used = new Set(businesses.map((business) => business.kind));
  const kinds: WorldVocabulary['kinds'][number][] = configured.map(([key, entry], index) => ({
    key,
    ...named(key, entry.label),
    form: entry.form && (BUILDING_FORMS as readonly string[]).includes(entry.form) ? entry.form : 'office',
    color: entry.color && HEX_COLOR.test(entry.color) ? entry.color : KIND_PALETTE[index % KIND_PALETTE.length]!,
    configured: true,
  }));
  const configuredKeys = new Set(configured.map(([key]) => key));
  [...used].filter((key): key is string => key !== null && !configuredKeys.has(key)).sort().forEach((key) => {
    kinds.push({ key, ...named(key, undefined), form: 'office', color: KIND_PALETTE[kinds.length % KIND_PALETTE.length]!, configured: false });
  });
  if (used.has(null)) kinds.push({ key: null, label: '分類なし', label_source: 'value', definition: null, form: 'office', color: UNCLASSIFIED_COLOR, configured: false });
  const statuses = new Map<string, { label: string; phase: WorldLifecyclePhase }>(Object.entries(DEFAULT_STATUSES));
  for (const [key, entry] of Object.entries(config?.statuses ?? {})) {
    const base = statuses.get(key);
    statuses.set(key, {
      label: text(entry.label) ?? base?.label ?? key,
      phase: entry.phase && (LIFECYCLE_PHASES as readonly string[]).includes(entry.phase) ? entry.phase : base?.phase ?? 'active',
    });
  }
  const exitStates = EXIT_STATES.map((key) => ({ key, label: text(config?.exit_states?.[key]?.label) ?? DEFAULT_EXIT_STATES[key] }));
  return { kinds, statuses: [...statuses].map(([key, entry]) => ({ key, ...entry })), exit_states: exitStates, terms: terms === undefined ? 'none' : terms === null ? 'unavailable' : 'read' };
}

/** Reads and checks a vocabulary file; an invalid file is an error, never silently ignored. */
export async function readWorldVocabulary(path: string): Promise<WorldVocabularyConfig> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!isRecord(parsed)) throw new Error('world vocabulary must be a JSON object');
  const kinds: Record<string, { label?: string; form?: WorldBuildingForm; color?: string }> = {};
  for (const [key, entry] of Object.entries(isRecord(parsed.kinds) ? parsed.kinds : {})) {
    if (!isRecord(entry)) throw new Error(`world vocabulary kind ${key} must be an object`);
    if (entry.form !== undefined && !(BUILDING_FORMS as readonly unknown[]).includes(entry.form)) throw new Error(`world vocabulary kind ${key} has an unknown form`);
    if (entry.color !== undefined && !(typeof entry.color === 'string' && HEX_COLOR.test(entry.color))) throw new Error(`world vocabulary kind ${key} has an invalid color`);
    kinds[key] = { ...(text(entry.label) ? { label: text(entry.label)! } : {}), ...(entry.form ? { form: entry.form as WorldBuildingForm } : {}), ...(entry.color ? { color: entry.color as string } : {}) };
  }
  const statuses: Record<string, { label?: string; phase?: WorldLifecyclePhase }> = {};
  for (const [key, entry] of Object.entries(isRecord(parsed.statuses) ? parsed.statuses : {})) {
    if (!isRecord(entry)) throw new Error(`world vocabulary status ${key} must be an object`);
    if (entry.phase !== undefined && !(LIFECYCLE_PHASES as readonly unknown[]).includes(entry.phase)) throw new Error(`world vocabulary status ${key} has an unknown phase`);
    statuses[key] = { ...(text(entry.label) ? { label: text(entry.label)! } : {}), ...(entry.phase ? { phase: entry.phase as WorldLifecyclePhase } : {}) };
  }
  if (parsed.exit_states === undefined) return { kinds, statuses };
  if (!isRecord(parsed.exit_states)) throw new Error('world vocabulary exit_states must be an object');
  const exitStates: Partial<Record<WorldExitState, { label?: string }>> = {};
  for (const [key, entry] of Object.entries(parsed.exit_states)) {
    if (!(EXIT_STATES as readonly string[]).includes(key)) throw new Error(`world vocabulary has an unknown exit state ${key}`);
    if (!isRecord(entry)) throw new Error(`world vocabulary exit state ${key} must be an object`);
    exitStates[key as WorldExitState] = text(entry.label) ? { label: text(entry.label)! } : {};
  }
  return { kinds, statuses, exit_states: exitStates };
}

/**
 * The businesses from the same Graph the other screens read (this Mac's Graph).
 * An organization host draws its own records with `projectOrganizationWorld`.
 * A Graph that cannot be read is a state with its reason, never zero businesses.
 */
export async function readWorldBusinesses(
  context: Pick<LocalWebModuleContext, 'dataDir'>,
  options: { readonly vocabulary?: WorldVocabularyConfig; readonly now?: () => Date } = {}
): Promise<WorldBusinessesResponse> {
  const now = (options.now ?? (() => new Date()))();
  let graph: Pick<GraphFileV2, 'entities'>;
  let source: WorldSource;
  try {
    const state = await readLocalGraphState(context.dataDir);
    if (state.status === 'not_initialized' || state.status === 'migration_required') {
      return { status: state.status, version: WORLD_EXTENSION_VERSION, reason: state.status };
    }
    if (state.status !== 'ready') return { status: 'unavailable', version: WORLD_EXTENSION_VERSION, reason: state.message ?? 'local_graph_unreadable' };
    const os = await loadPersonalOs(context.dataDir);
    if (os.graph.version !== 2) return { status: 'migration_required', version: WORLD_EXTENSION_VERSION, reason: 'migration_required' };
    graph = os.graph;
    source = { authority: 'local', dataDir: context.dataDir };
  } catch (error) {
    return { status: 'unavailable', version: WORLD_EXTENSION_VERSION, reason: error instanceof Error ? error.message : 'graph_unreadable' };
  }
  const projection = projectWorldFromGraph(graph, now);
  return {
    status: 'ok',
    version: WORLD_EXTENSION_VERSION,
    source,
    as_of: now.toISOString(),
    vocabulary: resolveWorldVocabulary(options.vocabulary, projection.businesses),
    ...projection,
  };
}

/**
 * The world of an organization from the project and glossary-term records its Graph API returns, for an
 * organization web that hosts the same world screen (P16).  Pure: the caller reads the records with the
 * member's own grants, so the world shows only what that member may read.
 */
export function projectOrganizationWorld(
  records: { readonly projects: readonly unknown[]; readonly decisions?: readonly unknown[]; readonly glossaryTerms?: readonly unknown[] },
  options: { readonly server: string; readonly vocabulary?: WorldVocabularyConfig; readonly now?: Date }
): WorldBusinessesResponse {
  const now = options.now ?? new Date();
  const { graph } = projectOrganizationGraph({
    entities: { person: [], org: [], project: records.projects as never, decision: (records.decisions ?? []) as never, raci_assignment: [] },
    memberOf: [],
    assignedTo: [],
  });
  const projection = projectWorldFromGraph(graph, now);
  return {
    status: 'ok',
    version: WORLD_EXTENSION_VERSION,
    source: { authority: 'organization_graph', server: options.server },
    as_of: now.toISOString(),
    vocabulary: resolveWorldVocabulary(options.vocabulary, projection.businesses, projectVocabularyTerms(records.glossaryTerms ?? [])),
    ...projection,
  };
}

export interface WorldJudgmentPlace {
  readonly decision_attempt_id: string;
  /** Repository the judgment Host recorded for the turn (`turn-input.json` project_code); null when unrecorded. */
  readonly workspace: string | null;
}

const VALUE_PROOF_SUFFIX = '.value-proof.json';

/**
 * Reads, for every saved value proof in the judgment journal, the repository
 * the Host recorded for that turn. The journal is listed through the host's
 * shared listing cache (the same one as the 今日 list), so only folders that
 * changed are listed again; turn inputs are never rewritten by the Host, so
 * each is read once. A journal that cannot be read is `unavailable`, never
 * an empty list.
 */
export async function readJudgmentPlaces(
  journalRoot: string,
  options: { readonly cache?: JudgmentValueProofJournalCache; readonly workspaces?: Map<string, string | null> } = {}
): Promise<{ readonly status: 'available' | 'unavailable'; readonly places: readonly WorldJudgmentPlace[]; readonly reason?: string }> {
  const journal = await readJudgmentValueProofJournal({ root: journalRoot, ...(options.cache ? { cache: options.cache } : {}) });
  if (journal.status !== 'available') return { status: 'unavailable', places: [], reason: 'journal_unreadable' };
  const workspaces = options.workspaces ?? new Map<string, string | null>();
  const places = await Promise.all(journal.entries.map(async (entry) => {
    const turnInputFile = `${entry.file.slice(0, -VALUE_PROOF_SUFFIX.length)}.turn-input.json`;
    if (!workspaces.has(turnInputFile)) {
      const turnInput = await readJsonFile(turnInputFile);
      workspaces.set(turnInputFile, isRecord(turnInput) ? text(turnInput.project_code) : null);
    }
    return { decision_attempt_id: entry.proof.decision_attempt_id, workspace: workspaces.get(turnInputFile) ?? null };
  }));
  return { status: 'available', places };
}

async function readJsonFile(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function createWorldModule(context: LocalWebModuleContext, read: () => Promise<WorldBusinessesResponse>): LocalWebModule {
  const workspaces = new Map<string, string | null>();
  return {
    id: WORLD_EXTENSION_ID,
    uiFiles: [],
    async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
      if (request.method !== 'GET') return false;
      const path = requestUrl(request).pathname;
      if (path === `/api/extensions/${WORLD_EXTENSION_ID}/businesses`) {
        response.setHeader('Cache-Control', 'no-store');
        writeJson(response, 200, await read());
        return true;
      }
      // This Mac keeps no Canonical Task store, so the work inside a city is not connected here
      // (an organization web answers these from its Task API).  Said as a state, never as no work.
      if (path === `/api/extensions/${WORLD_EXTENSION_ID}/work-summary` || /^\/api\/extensions\/world\/businesses\/[^/]+\/work$/u.test(path)) {
        response.setHeader('Cache-Control', 'no-store');
        writeJson(response, 200, { status: 'not_connected', version: WORLD_WORK_VERSION, reason: 'task_store_not_connected' });
        return true;
      }
      if (path === `/api/extensions/${WORLD_EXTENSION_ID}/judgment-places`) {
        response.setHeader('Cache-Control', 'no-store');
        writeJson(response, 200, { version: WORLD_EXTENSION_VERSION, ...(await readJudgmentPlaces(context.journalRoot, { cache: context.journalCache, workspaces })) });
        return true;
      }
      return false;
    },
  };
}

export function createWorldExtension(options: { readonly vocabulary?: WorldVocabularyConfig } = {}): LocalWebExtension {
  return {
    id: WORLD_EXTENSION_ID,
    uiDir: fileURLToPath(new URL('../ui/world/', import.meta.url)),
    uiFiles: ['world-view.js', 'world-view.css', 'world-canvas-ui.js', 'world-canvas-ui.css', 'world-canvas-notes.js', 'world-vendor.js', 'world-placement.js', 'world-work-rail.js', 'world-district.js', 'world-scenery.js', 'world-exits.js'],
    screenEntry: 'world-view.js',
    // P17: the world sits above the home and opens first.
    navPosition: 'first',
    createModule: (context) => createWorldModule(context, () => readWorldBusinesses(context, { vocabulary: options.vocabulary, now: context.now })),
  };
}
