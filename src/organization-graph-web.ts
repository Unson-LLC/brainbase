import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { GraphWebError, openInMemoryGraph, type GraphWebOrganizationSource, type InMemoryGraphReader } from './graph-web.js';
import type { GraphVocabularyTerm, LocalWebOrganizationGraph } from './local-web-host.js';
import { canonicalEdgeId } from './canonical-graph.js';
import { canonicalGraphOntologyRelease } from './templates.js';
import type { CanonicalEdge, CanonicalEntity, CanonicalEntityKind, CoreRelation, GraphFileV2 } from './types.js';

/**
 * Ledger C1 (adopted 2026-09-24): while the owner validates the Web, the host
 * reads the owner's organization Graph read only. The records are projected
 * into an in-memory Graph v2 so the existing Graph screens read them through
 * the same views as a local Graph. Nothing is written locally or remotely.
 *
 * Relations come only from what the organization Graph states:
 *   - `member_of` person → project       → `participates_in` (role = role_code)
 *   - RACI `assigned_to` raci → person, with the RACI's project:
 *       accountable / A / lane decider / decision:*  → `accountable_for`
 *       any other role                                → `participates_in`
 * Retired or superseded records are counted, not drawn.
 */

export const ORGANIZATION_GRAPH_WEB_VERSION = 'organization-graph-web.v0' as const;
const ENTITY_TYPES: readonly CanonicalEntityKind[] = ['project', 'person', 'org', 'decision'];
const FETCH_TIMEOUT_MS = 15_000;
const CACHE_MS = 60_000;

interface OrganizationRecord {
  id: string;
  entity_type?: string;
  project_id?: string | null;
  project_code?: string | null;
  lifecycle_status?: string;
  payload?: Record<string, unknown>;
}

interface OrganizationEdge {
  id: string;
  from_id: string;
  to_id: string;
  rel_type: string;
  project_id?: string | null;
  lifecycle_status?: string;
  payload?: Record<string, unknown> | null;
}

export interface OrganizationGraphRecords {
  readonly entities: Readonly<Record<CanonicalEntityKind | 'raci_assignment', readonly OrganizationRecord[]>>;
  readonly memberOf: readonly OrganizationEdge[];
  readonly assignedTo: readonly OrganizationEdge[];
}

export interface OrganizationGraphProjection {
  readonly graph: GraphFileV2;
  readonly excluded: { readonly inactive: number; readonly unnamed: number; readonly danglingRelations: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nameOf(type: CanonicalEntityKind, payload: Record<string, unknown>): string | null {
  return type === 'decision'
    ? text(payload.title) ?? text(payload.name) ?? text(payload.decision)?.slice(0, 80) ?? null
    : text(payload.display_name) ?? text(payload.name);
}

function isAccountableRole(payload: Record<string, unknown>): boolean {
  const role = text(payload.role_code) ?? text(payload.role) ?? '';
  const lane = text(payload.lane) ?? '';
  return role === 'accountable' || role === 'A' || lane === 'decider' || role.startsWith('decision:');
}

/** The record that is the project of its scope: its code, or else its id, is the scope's code. */
function isCatalogProject(record: OrganizationRecord, payload: Record<string, unknown>): boolean {
  const scope = text(record.project_code);
  return scope !== null && (text(payload.code) ?? record.id) === scope;
}

/**
 * The organization's words for field values: active glossary terms that carry
 * `payload.vocabulary = { field, value }`.  The name is the term's label, else
 * its term, else the value itself (pure; tested).
 */
export function projectVocabularyTerms(records: readonly unknown[]): GraphVocabularyTerm[] {
  const terms: GraphVocabularyTerm[] = [];
  for (const record of records) {
    if (!isRecord(record) || typeof record.id !== 'string' || !isRecord(record.payload)) continue;
    if (record.lifecycle_status && record.lifecycle_status !== 'active') continue;
    const vocabulary = record.payload.vocabulary;
    const field = isRecord(vocabulary) ? text(vocabulary.field) : null;
    const value = isRecord(vocabulary) ? text(vocabulary.value) : null;
    if (!field || !value) continue;
    terms.push({
      id: record.id,
      field,
      value,
      label: text(record.payload.label) ?? text(record.payload.term) ?? value,
      definition: text(record.payload.definition)
    });
  }
  return terms.sort((a, b) => a.id.localeCompare(b.id));
}

/** A project's code, parent and repositories as the organization Graph states them. */
function projectPlacement(record: OrganizationRecord, payload: Record<string, unknown>, catalogByCode: ReadonlyMap<string, string>): Record<string, unknown> {
  const scope = text(record.project_code);
  const isCatalog = isCatalogProject(record, payload);
  const code = text(payload.code) ?? (isCatalog ? scope : null);
  const repositories = Array.isArray(payload.repository_roots)
    ? payload.repository_roots.filter(isRecord).map((root) => text(root.repository)).filter((name): name is string => name !== null)
    : [];
  const parentId = scope ? catalogByCode.get(scope) : undefined;
  return {
    ...(code ? { code } : {}),
    ...(!isCatalog && scope ? { parent_project_code: scope } : {}),
    ...(!isCatalog && parentId && parentId !== record.id ? { parent_project_id: parentId } : {}),
    ...(repositories.length ? { repositories } : {})
  };
}

/** Projects organization Graph records into a canonical Graph v2 (pure; tested). */
export function projectOrganizationGraph(records: OrganizationGraphRecords, owner?: { id: string; name?: string }): OrganizationGraphProjection {
  const entities: CanonicalEntity[] = [];
  const ids = new Map<string, CanonicalEntityKind>();
  let inactive = 0;
  let unnamed = 0;
  // The organization's catalog project for each project code (its own code or id equals its scope);
  // other projects in that scope hang under it (the world draws them as its districts).
  const catalogByCode = new Map<string, string>();
  for (const record of records.entities.project ?? []) {
    if (!isRecord(record) || typeof record.id !== 'string' || (record.lifecycle_status && record.lifecycle_status !== 'active')) continue;
    const scope = text(record.project_code);
    if (scope && isCatalogProject(record, isRecord(record.payload) ? record.payload : {}) && !catalogByCode.has(scope)) catalogByCode.set(scope, record.id);
  }
  for (const type of ENTITY_TYPES) {
    for (const record of records.entities[type] ?? []) {
      if (!isRecord(record) || typeof record.id !== 'string' || ids.has(record.id)) continue;
      if (record.lifecycle_status && record.lifecycle_status !== 'active') {
        inactive += 1;
        continue;
      }
      const payload = isRecord(record.payload) ? record.payload : {};
      const name = nameOf(type, payload);
      if (!name) {
        unnamed += 1;
        continue;
      }
      const aliases = Array.isArray(payload.aliases) ? payload.aliases.filter((alias): alias is string => typeof alias === 'string' && alias.trim() !== '' && alias !== name) : [];
      const summary = text(payload.purpose) ?? text(payload.summary) ?? text(payload.description);
      const status = text(payload.operational_status) ?? text(payload.status);
      entities.push({
        id: record.id,
        type,
        name,
        ...(aliases.length ? { aliases: [...new Set(aliases)] } : {}),
        ...(summary ? { summary } : {}),
        metadata: {
          source: 'organization_graph',
          ...(record.project_code ? { project_code: record.project_code } : {}),
          ...(type === 'project' && summary ? { goal: summary } : {}),
          ...(type === 'project' && status ? { status } : {}),
          ...(type === 'project' && text(payload.kind) ? { kind: text(payload.kind) } : {}),
          ...(type === 'project' ? projectPlacement(record, payload, catalogByCode) : {})
        }
      });
      ids.set(record.id, type);
    }
  }
  // One canonical relation per person, relation and project (the edge id is derived from them);
  // the organization's role names for that pair are kept together.
  const byKey = new Map<string, { edge: CanonicalEdge; roles: string[] }>();
  let danglingRelations = 0;
  const addEdge = (sourceId: string, fromId: string, relation: CoreRelation, toId: string, role: string | null) => {
    if (ids.get(fromId) !== 'person' || ids.get(toId) !== 'project') {
      danglingRelations += 1;
      return;
    }
    const key = `${fromId}|${relation}|${toId}`;
    const existing = byKey.get(key);
    if (existing) {
      if (role && !existing.roles.includes(role)) existing.roles.push(role);
      return;
    }
    byKey.set(key, {
      edge: { id: canonicalEdgeId({ fromId, relation, toId }), fromId, relation, toId, provenance: { sourceKind: 'import', sourceId } },
      roles: role ? [role] : []
    });
  };
  for (const edge of records.memberOf) {
    if (edge.lifecycle_status && edge.lifecycle_status !== 'active') continue;
    addEdge(edge.id, edge.from_id, 'participates_in', edge.to_id, text(edge.payload?.role_code));
  }
  const raci = new Map((records.entities.raci_assignment ?? []).filter((record) => !record.lifecycle_status || record.lifecycle_status === 'active').map((record) => [record.id, record]));
  for (const edge of records.assignedTo) {
    if (edge.lifecycle_status && edge.lifecycle_status !== 'active') continue;
    const assignment = raci.get(edge.from_id);
    const projectId = assignment?.project_id ?? edge.project_id ?? null;
    if (!assignment || !projectId) {
      danglingRelations += 1;
      continue;
    }
    const payload = isRecord(assignment.payload) ? assignment.payload : {};
    const role = text(payload.role_code) ?? text(payload.role) ?? text(edge.payload?.role_code);
    addEdge(edge.id, edge.to_id, isAccountableRole(payload) ? 'accountable_for' : 'participates_in', projectId, role);
  }
  const edges = [...byKey.values()].map(({ edge, roles }) => (roles.length ? { ...edge, role: roles.join('、') } : edge));
  const ownerEntity = owner && ids.get(owner.id) === 'person' ? owner : undefined;
  return {
    graph: {
      version: 2,
      ontology: { ...canonicalGraphOntologyRelease.binding },
      owner: ownerEntity ? { id: ownerEntity.id, ...(ownerEntity.name ? { name: ownerEntity.name } : {}) } : {},
      entities,
      edges
    },
    excluded: { inactive, unnamed, danglingRelations }
  };
}

interface OrganizationAccess {
  readonly server: string;
  readonly token: string;
}

/** The owner's Brainbase server and token, read at request time (tokens rotate hourly). Never logged or returned. */
export async function readOrganizationAccess(home: string = homedir()): Promise<OrganizationAccess | { readonly reason: string }> {
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

async function getRecords(request: typeof fetch, access: OrganizationAccess, path: string): Promise<unknown[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await request(`${access.server}/api/info/graph/${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${access.token}`, Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal
    });
    if (response.status === 401 || response.status === 403) {
      throw new GraphWebError('unavailable', 'organization_graph_auth_failed', `The organization Graph refused the owner's token (HTTP ${response.status}); sign in again`);
    }
    if (!response.ok) throw new GraphWebError('unavailable', 'organization_graph_unavailable', `The organization Graph answered HTTP ${response.status} for ${path.split('?')[0]}`);
    const body = await response.json() as unknown;
    if (!isRecord(body) || !Array.isArray(body.records)) throw new GraphWebError('unavailable', 'organization_graph_unavailable', 'The organization Graph response has no records');
    return body.records;
  } catch (error) {
    if (error instanceof GraphWebError) throw error;
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timed out' : 'request failed';
    throw new GraphWebError('unavailable', 'organization_graph_unavailable', `The organization Graph ${reason}`);
  } finally {
    clearTimeout(timer);
  }
}

export interface OrganizationGraphSourceOptions {
  readonly home?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly cacheMs?: number;
}

/**
 * The organization Graph for the local host (C1). Reads are cached briefly and
 * shared while in flight; a failure is reported as `unavailable`, never as an
 * empty Graph.
 */
export async function createOrganizationGraphSource(options: OrganizationGraphSourceOptions = {}): Promise<LocalWebOrganizationGraph | { readonly reason: string }> {
  const home = options.home ?? homedir();
  const initial = await readOrganizationAccess(home);
  if ('reason' in initial) return initial;
  const request = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const cacheMs = options.cacheMs ?? CACHE_MS;
  type Loaded = { reader: InMemoryGraphReader<GraphWebOrganizationSource>; graph: GraphFileV2; terms: readonly GraphVocabularyTerm[] | null };
  let cached: { at: number; loaded: Loaded } | null = null;
  let inFlight: Promise<Loaded> | null = null;

  async function load(): Promise<Loaded> {
    const access = await readOrganizationAccess(home);
    if ('reason' in access) throw new GraphWebError('unavailable', 'organization_graph_not_connected', `The organization Graph cannot be read (${access.reason})`);
    // The organization's words are read alongside; failing to read them never fails the Graph.
    const termsRead = getRecords(request, access, 'entities?type=glossary_term&limit=500')
      .then((records) => projectVocabularyTerms(records))
      .catch(() => null);
    const [project, person, org, decision, raci, memberOf, assignedTo] = await Promise.all([
      getRecords(request, access, 'entities?type=project&limit=500'),
      getRecords(request, access, 'entities?type=person&limit=500'),
      getRecords(request, access, 'entities?type=org&limit=500'),
      getRecords(request, access, 'entities?type=decision&limit=500'),
      getRecords(request, access, 'entities?type=raci_assignment&limit=500'),
      getRecords(request, access, 'edges?type=member_of'),
      getRecords(request, access, 'edges?type=assigned_to')
    ]);
    const projection = projectOrganizationGraph({
      entities: {
        project: project as OrganizationRecord[],
        person: person as OrganizationRecord[],
        org: org as OrganizationRecord[],
        decision: decision as OrganizationRecord[],
        raci_assignment: raci as OrganizationRecord[]
      },
      memberOf: memberOf as OrganizationEdge[],
      assignedTo: assignedTo as OrganizationEdge[]
    });
    const source: GraphWebOrganizationSource = { dataDir: null, graphFormat: 2, authority: 'organization_graph', server: access.server, readAt: now().toISOString() };
    return { reader: openInMemoryGraph(projection.graph, source), graph: projection.graph, terms: await termsRead };
  }

  async function current(): Promise<Loaded> {
    const at = now().getTime();
    if (cached && at - cached.at < cacheMs) return cached.loaded;
    inFlight ??= load().then((loaded) => {
      cached = { at: now().getTime(), loaded };
      return loaded;
    }).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    server: initial.server,
    async read() {
      return (await current()).reader;
    },
    async readGraphFile() {
      return (await current()).graph;
    },
    async readVocabularyTerms() {
      return (await current()).terms;
    }
  };
}
