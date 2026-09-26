import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isActiveAt } from './canonical-graph.js';
import {
  GRAPH_CORRECTION_EDGE_FIELDS,
  GRAPH_CORRECTION_ENTITY_FIELDS,
  GRAPH_CORRECTION_NEW_EDGE_RELATIONS,
  GRAPH_CORRECTION_PROJECT_FIELDS,
  GRAPH_CORRECTIONS_FILE,
  graphRecordDigest,
  readGraphCorrectionHistory,
  type GraphCorrectionRecord
} from './graph-corrections.js';
import { ONTOLOGY_VERSION, portableOntology } from './ontology.js';
import { canonicalRelationRegistry, getCanonicalRelation } from './relation-registry.js';
import { loadPersonalOs } from './ssot.js';
import type { CanonicalEdge, CanonicalEntity, CanonicalEntityKind, CoreRelation, GraphFileV2, PersonalOs } from './types.js';

/**
 * Read views of the canonical local Graph for the local Web screens
 * "プロジェクトと関係者" and "情報と関係".
 *
 * Every function takes an explicit data directory chosen by the host, never by
 * the browser. A Graph v1 file is reported as `migration_required` and a
 * missing data set as `not_initialized`; neither is presented as zero items,
 * and a read failure is thrown instead of being returned as an empty list.
 */

export const GRAPH_WEB_VERSION = 'graph-web.v1' as const;
export const GRAPH_WEB_START_COMMAND = 'brainbase onboard:start';
export const GRAPH_WEB_SEARCH_MAX_LIMIT = 100;

const CANONICAL_FILES = ['graph.json', 'relationships.json', 'personal-kg.jsonl', 'decisions.jsonl'] as const;
const ENTITY_KINDS: readonly CanonicalEntityKind[] = ['person', 'org', 'project', 'decision'];
const PARTICIPATION: ReadonlySet<CoreRelation> = new Set(['participates_in', 'accountable_for']);
const EXTRACTED_CANDIDATE_FILE = /^extracted-[^/\\]+\.json$/u;
const ONBOARDING_LEDGER_FILE = 'runs/connected-onboarding.json';
const ONBOARDING_LEDGER_SCHEMA = 'connected_onboarding.v1';

export interface GraphWebSource {
  dataDir: string;
  graphFormat: 1 | 2 | null;
  authority: 'local_graph';
}

export interface GraphMigrationRequired {
  status: 'migration_required';
  source: GraphWebSource;
  /** Entities in the Graph v1 file. They exist but cannot be shown or corrected until migrated. */
  legacyEntityCount: number;
  /** Preview first; it prints the expectedInputDigest the write step needs. */
  command: string;
  writeCommand: string;
  message: string;
  absenceConfirmed: false;
}

export interface GraphNotInitialized {
  status: 'not_initialized';
  source: GraphWebSource;
  command: typeof GRAPH_WEB_START_COMMAND;
  message: string;
  /** No canonical file exists in the data directory, so nothing is registered. */
  absenceConfirmed: true;
}

export type GraphWebUnavailable = GraphMigrationRequired | GraphNotInitialized;

export interface GraphReadIssue {
  file: string;
  line?: number;
  reason: string;
}

export interface GraphEntityView {
  id: string;
  type: CanonicalEntityKind;
  name: string;
  aliases: string[];
  summary: string | null;
  tags: string[];
  validFrom: string | null;
  validTo: string | null;
  /** Active at the response `asOf`. */
  active: boolean;
  digest: string;
  goal?: string | null;
  status?: string | null;
}

export type GraphProvenanceReference =
  | { status: 'none' }
  | { status: 'unresolved'; sourceId: string }
  | {
    status: 'resolved';
    kind: 'extracted_candidate';
    file: string;
    candidateId: string;
    candidateKind: string | null;
    label: string | null;
  }
  | {
    status: 'resolved';
    kind: 'onboarding_run_candidate';
    file: typeof ONBOARDING_LEDGER_FILE;
    runId: string;
    candidateId: string;
    candidateKind: string | null;
    reviewStatus: string | null;
    label: string | null;
  }
  | {
    status: 'resolved';
    kind: 'graph_correction';
    file: typeof GRAPH_CORRECTIONS_FILE;
    correctionId: string;
    at: string;
    reason: string;
  };

export interface GraphProvenanceView {
  sourceKind: NonNullable<CanonicalEdge['provenance']>['sourceKind'] | null;
  sourceId: string | null;
  evidenceHash: string | null;
  reference: GraphProvenanceReference;
}

export interface GraphEdgeView {
  id: string;
  relation: CoreRelation;
  meaning: string;
  direction: 'incoming' | 'outgoing';
  fromId: string;
  toId: string;
  role: string | null;
  context: string | null;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  provenance: GraphProvenanceView;
  counterpart: { id: string; type: CanonicalEntityKind; name: string; active: boolean; digest: string };
  digest: string;
}

export interface GraphWebStatus {
  status: 'ok';
  version: typeof GRAPH_WEB_VERSION;
  source: GraphWebSource;
  asOf: string;
  ontology: { id: string; version: string; releaseDigest: string; currentVersion: string };
  counts: {
    entities: Record<CanonicalEntityKind, number> & { total: number };
    edges: { total: number; active: number };
    relationships: number;
    corrections: number;
  };
  issues: GraphReadIssue[];
}

export interface GraphProjectListItem extends GraphEntityView {
  type: 'project';
  goal: string | null;
  status: string | null;
  /** Distinct people with an active participates_in or accountable_for relation. */
  participantCount: number;
  accountableCount: number;
}

export interface GraphProjectList {
  status: 'ok';
  source: GraphWebSource;
  asOf: string;
  projects: GraphProjectListItem[];
  /** True only when the readable Graph v2 holds no project at all. */
  absenceConfirmed: boolean;
}

export interface GraphProjectDetail {
  status: 'ok';
  source: GraphWebSource;
  asOf: string;
  project: GraphEntityView & { type: 'project'; goal: string | null; status: string | null; decisionPrinciples: string[]; metadata: Record<string, unknown> };
  /** Incoming participates_in / accountable_for relations, including ended ones. */
  participants: GraphEdgeView[];
  /** Other relations of the project (governs, owned_by, ...). */
  relations: GraphEdgeView[];
  history: GraphCorrectionRecord[];
  issues: GraphReadIssue[];
}

export interface GraphEntitySearchInput {
  q?: string;
  type?: string;
  asOf?: string;
  limit?: number;
  /** Used for each result's `active` flag when no as_of filter is given. */
  now?: Date;
}

export interface GraphEntitySearchResult {
  status: 'ok';
  source: GraphWebSource;
  query: { q: string; type: CanonicalEntityKind | null; asOf: string | null };
  results: GraphEntityView[];
  total: number;
  truncated: boolean;
  /**
   * True when the whole readable Graph v2 was scanned and nothing matched the
   * name/alias query and filters. Never true for Graph v1 or a read failure.
   */
  absenceConfirmed: boolean;
  /** True when the Graph v2 holds no entity at all (show "まだ登録がありません"). */
  graphEmpty: boolean;
}

export interface GraphEntityDetail {
  status: 'ok';
  source: GraphWebSource;
  asOf: string;
  entity: GraphEntityView & { metadata: Record<string, unknown> };
  outgoing: GraphEdgeView[];
  incoming: GraphEdgeView[];
  history: GraphCorrectionRecord[];
  issues: GraphReadIssue[];
}

export interface GraphOntologySummary {
  status: 'ok';
  source: GraphWebSource;
  asOf: string;
  ontology: { id: string; version: string; releaseDigest: string; currentVersion: string; upToDate: boolean };
  entityTypes: Array<{ id: CanonicalEntityKind; meaning: string; count: number }>;
  relations: Array<{ id: CoreRelation; from: CanonicalEntityKind; to: CanonicalEntityKind; meaning: string; count: number; activeCount: number }>;
  corrections: {
    entityFields: readonly string[];
    projectFields: readonly string[];
    edgeFields: readonly string[];
    newEdgeRelations: readonly string[];
  };
}

export type GraphWebErrorKind = 'invalid' | 'not_found' | 'unavailable';

export class GraphWebError extends Error {
  readonly name = 'GraphWebError';
  constructor(readonly kind: GraphWebErrorKind, readonly code: string, message: string) {
    super(message);
  }
}

export interface GraphWebReadOptions {
  asOf?: string;
  now?: Date;
}

type LoadedGraph = { os: PersonalOs; graph: GraphFileV2; source: GraphWebSource };

export async function readGraphWebStatus(dataDir: string, options: GraphWebReadOptions = {}): Promise<GraphWebStatus | GraphWebUnavailable> {
  const loaded = await loadForRead(dataDir);
  if ('status' in loaded) return loaded;
  const asOf = resolveAsOf(options);
  const { graph } = loaded;
  const entities = Object.fromEntries(ENTITY_KINDS.map((kind) => [kind, graph.entities.filter((entity) => entity.type === kind).length])) as Record<CanonicalEntityKind, number>;
  const history = await readGraphCorrectionHistory(dataDir);
  return {
    status: 'ok',
    version: GRAPH_WEB_VERSION,
    source: loaded.source,
    asOf,
    ontology: { ...graph.ontology, currentVersion: ONTOLOGY_VERSION },
    counts: {
      entities: { ...entities, total: graph.entities.length },
      edges: { total: graph.edges.length, active: graph.edges.filter((edge) => isActiveAt(edge, asOf)).length },
      relationships: loaded.os.relationships.relationships.length,
      corrections: history.records.length
    },
    issues: history.issues
  };
}

export async function listGraphProjects(dataDir: string, options: GraphWebReadOptions = {}): Promise<GraphProjectList | GraphWebUnavailable> {
  const loaded = await loadForRead(dataDir);
  if ('status' in loaded) return loaded;
  const asOf = resolveAsOf(options);
  const { graph } = loaded;
  const entities = entityIndex(graph);
  const projects = graph.entities.filter((entity) => entity.type === 'project').map((project) => {
    const participation = graph.edges.filter((edge) => edge.toId === project.id && PARTICIPATION.has(edge.relation)
      && isActiveAt(edge, asOf) && isEntityActive(entities.get(edge.fromId), asOf));
    return {
      ...projectView(project, asOf),
      participantCount: new Set(participation.map((edge) => edge.fromId)).size,
      accountableCount: new Set(participation.filter((edge) => edge.relation === 'accountable_for').map((edge) => edge.fromId)).size
    } satisfies GraphProjectListItem;
  }).sort(byActiveThenName);
  return { status: 'ok', source: loaded.source, asOf, projects, absenceConfirmed: projects.length === 0 };
}

export async function readGraphProject(dataDir: string, projectId: string, options: GraphWebReadOptions = {}): Promise<GraphProjectDetail | GraphWebUnavailable> {
  const loaded = await loadForRead(dataDir);
  if ('status' in loaded) return loaded;
  const asOf = resolveAsOf(options);
  const { graph } = loaded;
  const project = graph.entities.find((entity) => entity.id === projectId && entity.type === 'project');
  if (!project) throw new GraphWebError('not_found', 'project_not_found', `No project ${projectId}`);
  const references = await loadReferences(dataDir);
  const entities = entityIndex(graph);
  const edges = incidentEdges(graph, project.id, asOf, entities, references);
  const participants = edges.filter((edge) => edge.direction === 'incoming' && PARTICIPATION.has(edge.relation)).sort(byParticipation);
  const relations = edges.filter((edge) => !participants.includes(edge));
  const touched = new Set([project.id, ...edges.map((edge) => edge.id)]);
  return {
    status: 'ok',
    source: loaded.source,
    asOf,
    project: {
      ...projectView(project, asOf),
      decisionPrinciples: stringArray(project.metadata?.decisionPrinciples),
      metadata: project.metadata ?? {}
    },
    participants,
    relations,
    history: historyFor(references.history, touched),
    issues: references.issues
  };
}

export async function searchGraphEntities(dataDir: string, input: GraphEntitySearchInput = {}): Promise<GraphEntitySearchResult | GraphWebUnavailable> {
  const q = typeof input.q === 'string' ? input.q.trim() : '';
  if (q.length > 200) throw new GraphWebError('invalid', 'invalid_query', 'q must be at most 200 characters');
  const type = parseEntityType(input.type);
  const asOf = input.asOf === undefined || input.asOf === '' ? null : parseAsOf(input.asOf);
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > GRAPH_WEB_SEARCH_MAX_LIMIT) {
    throw new GraphWebError('invalid', 'invalid_query', `limit must be an integer from 1 to ${GRAPH_WEB_SEARCH_MAX_LIMIT}`);
  }
  const loaded = await loadForRead(dataDir);
  if ('status' in loaded) return loaded;
  const { graph } = loaded;
  const needle = normalize(q);
  const scored = graph.entities.flatMap((entity) => {
    if (type && entity.type !== type) return [];
    if (asOf && !isActiveAt(entity, asOf)) return [];
    const rank = matchRank(entity, needle);
    return rank === undefined ? [] : [{ entity, rank }];
  }).sort((left, right) => left.rank - right.rank
    || left.entity.type.localeCompare(right.entity.type, 'en')
    || left.entity.name.localeCompare(right.entity.name, 'ja')
    || left.entity.id.localeCompare(right.entity.id, 'en'));
  const viewAsOf = asOf ?? (input.now ?? new Date()).toISOString();
  const results = scored.slice(0, limit).map(({ entity }) => entityView(entity, viewAsOf));
  return {
    status: 'ok',
    source: loaded.source,
    query: { q, type, asOf },
    results,
    total: scored.length,
    truncated: scored.length > results.length,
    absenceConfirmed: scored.length === 0,
    graphEmpty: graph.entities.length === 0
  };
}

export async function readGraphEntity(dataDir: string, entityId: string, options: GraphWebReadOptions = {}): Promise<GraphEntityDetail | GraphWebUnavailable> {
  const loaded = await loadForRead(dataDir);
  if ('status' in loaded) return loaded;
  const asOf = resolveAsOf(options);
  const { graph } = loaded;
  const matches = graph.entities.filter((candidate) => candidate.id === entityId);
  if (matches.length === 0) throw new GraphWebError('not_found', 'entity_not_found', `No entity ${entityId}`);
  if (matches.length > 1) throw new GraphWebError('unavailable', 'entity_id_ambiguous', `Entity id ${entityId} is duplicated in graph.json`);
  const entity = matches[0]!;
  const references = await loadReferences(dataDir);
  const edges = incidentEdges(graph, entity.id, asOf, entityIndex(graph), references);
  const touched = new Set([entity.id, ...edges.map((edge) => edge.id)]);
  return {
    status: 'ok',
    source: loaded.source,
    asOf,
    entity: { ...entityView(entity, asOf), metadata: entity.metadata ?? {} },
    outgoing: edges.filter((edge) => edge.direction === 'outgoing'),
    incoming: edges.filter((edge) => edge.direction === 'incoming'),
    history: historyFor(references.history, touched),
    issues: references.issues
  };
}

export async function readGraphOntology(dataDir: string, options: GraphWebReadOptions = {}): Promise<GraphOntologySummary | GraphWebUnavailable> {
  const loaded = await loadForRead(dataDir);
  if ('status' in loaded) return loaded;
  const asOf = resolveAsOf(options);
  const { graph } = loaded;
  const concepts = new Map<string, string>(portableOntology.domains.types.concepts.map((concept) => [concept.id, concept.meaning]));
  return {
    status: 'ok',
    source: loaded.source,
    asOf,
    ontology: { ...graph.ontology, currentVersion: ONTOLOGY_VERSION, upToDate: graph.ontology.version === ONTOLOGY_VERSION },
    entityTypes: ENTITY_KINDS.map((kind) => ({
      id: kind,
      meaning: concepts.get(kind) ?? '',
      count: graph.entities.filter((entity) => entity.type === kind).length
    })),
    relations: Object.values(canonicalRelationRegistry).map((definition) => {
      const edges = graph.edges.filter((edge) => edge.relation === definition.id);
      return {
        id: definition.id,
        from: definition.from,
        to: definition.to,
        meaning: definition.meaning,
        count: edges.length,
        activeCount: edges.filter((edge) => isActiveAt(edge, asOf)).length
      };
    }),
    corrections: {
      entityFields: GRAPH_CORRECTION_ENTITY_FIELDS,
      projectFields: GRAPH_CORRECTION_PROJECT_FIELDS,
      edgeFields: GRAPH_CORRECTION_EDGE_FIELDS,
      newEdgeRelations: GRAPH_CORRECTION_NEW_EDGE_RELATIONS
    }
  };
}

async function loadForRead(dataDir: string): Promise<LoadedGraph | GraphWebUnavailable> {
  if (typeof dataDir !== 'string' || dataDir.trim() === '') throw new TypeError('dataDir is required');
  const present = await Promise.all(CANONICAL_FILES.map((file) => exists(join(dataDir, file))));
  if (!present.some(Boolean)) {
    return {
      status: 'not_initialized',
      source: { dataDir, graphFormat: null, authority: 'local_graph' },
      command: GRAPH_WEB_START_COMMAND,
      message: 'No canonical Brainbase data exists in this data directory yet',
      absenceConfirmed: true
    };
  }
  let os: PersonalOs;
  try {
    os = await loadPersonalOs(dataDir);
  } catch (error) {
    throw new GraphWebError('unavailable', 'graph_unavailable', error instanceof Error ? error.message : String(error));
  }
  if (os.graph.version !== 2) {
    const dir = shellArg(dataDir);
    return {
      status: 'migration_required',
      source: { dataDir, graphFormat: 1, authority: 'local_graph' },
      legacyEntityCount: os.graph.entities.length,
      command: `brainbase ontology:migrate --dir ${dir}`,
      writeCommand: `brainbase ontology:migrate --dir ${dir} --write --expected-input-digest <preview expectedInputDigest>`,
      message: 'graph.json is Graph v1. Migrate it to Graph v2 with the CLI; this host never migrates automatically',
      absenceConfirmed: false
    };
  }
  return { os, graph: os.graph, source: { dataDir, graphFormat: 2, authority: 'local_graph' } };
}

interface ReferenceIndex {
  extracted: Map<string, { file: string; kind: string | null; label: string | null }>;
  onboarding: Map<string, { runId: string; kind: string | null; reviewStatus: string | null; label: string | null }>;
  history: GraphCorrectionRecord[];
  corrections: Map<string, GraphCorrectionRecord>;
  issues: GraphReadIssue[];
}

async function loadReferences(dataDir: string): Promise<ReferenceIndex> {
  const issues: GraphReadIssue[] = [];
  const extracted = new Map<string, { file: string; kind: string | null; label: string | null }>();
  let candidateFiles: string[] = [];
  try {
    candidateFiles = (await readdir(join(dataDir, 'candidates'))).filter((file) => EXTRACTED_CANDIDATE_FILE.test(file)).sort();
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') issues.push({ file: 'candidates', reason: errorMessage(error) });
  }
  for (const name of candidateFiles) {
    const file = `candidates/${name}`;
    try {
      const parsed = JSON.parse(await readFile(join(dataDir, file), 'utf8')) as unknown;
      const candidates = isRecord(parsed) && Array.isArray(parsed.candidates) ? parsed.candidates : undefined;
      if (!candidates) {
        issues.push({ file, reason: 'candidate file has no candidates array' });
        continue;
      }
      for (const candidate of candidates) {
        if (!isRecord(candidate) || typeof candidate.id !== 'string' || extracted.has(candidate.id)) continue;
        extracted.set(candidate.id, { file, kind: stringOrNull(candidate.kind), label: payloadLabel(candidate.payload) });
      }
    } catch (error) {
      issues.push({ file, reason: errorMessage(error) });
    }
  }

  const onboarding = new Map<string, { runId: string; kind: string | null; reviewStatus: string | null; label: string | null }>();
  try {
    const parsed = JSON.parse(await readFile(join(dataDir, ONBOARDING_LEDGER_FILE), 'utf8')) as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== ONBOARDING_LEDGER_SCHEMA || !Array.isArray(parsed.runs)) {
      issues.push({ file: ONBOARDING_LEDGER_FILE, reason: 'unsupported connected onboarding ledger schema' });
    } else {
      for (const run of parsed.runs) {
        if (!isRecord(run) || typeof run.id !== 'string' || !Array.isArray(run.candidates)) continue;
        for (const candidate of run.candidates) {
          if (!isRecord(candidate) || typeof candidate.id !== 'string') continue;
          onboarding.set(candidate.id, {
            runId: run.id,
            kind: stringOrNull(candidate.kind),
            reviewStatus: stringOrNull(candidate.reviewStatus),
            label: payloadLabel(candidate.payload)
          });
        }
      }
    }
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') issues.push({ file: ONBOARDING_LEDGER_FILE, reason: errorMessage(error) });
  }

  const history = await readGraphCorrectionHistory(dataDir);
  issues.push(...history.issues);
  return {
    extracted,
    onboarding,
    history: history.records,
    corrections: new Map(history.records.map((record) => [record.id, record])),
    issues
  };
}

function resolveReference(edge: CanonicalEdge, references: ReferenceIndex): GraphProvenanceReference {
  const sourceId = edge.provenance?.sourceId;
  if (!sourceId) return { status: 'none' };
  const correction = references.corrections.get(sourceId);
  if (correction) {
    return { status: 'resolved', kind: 'graph_correction', file: GRAPH_CORRECTIONS_FILE, correctionId: correction.id, at: correction.at, reason: correction.reason };
  }
  const run = references.onboarding.get(sourceId);
  if (run) {
    return {
      status: 'resolved',
      kind: 'onboarding_run_candidate',
      file: ONBOARDING_LEDGER_FILE,
      runId: run.runId,
      candidateId: sourceId,
      candidateKind: run.kind,
      reviewStatus: run.reviewStatus,
      label: run.label
    };
  }
  const extracted = references.extracted.get(sourceId);
  if (extracted) {
    return { status: 'resolved', kind: 'extracted_candidate', file: extracted.file, candidateId: sourceId, candidateKind: extracted.kind, label: extracted.label };
  }
  return { status: 'unresolved', sourceId };
}

function incidentEdges(
  graph: GraphFileV2,
  entityId: string,
  asOf: string,
  entities: Map<string, CanonicalEntity>,
  references: ReferenceIndex
): GraphEdgeView[] {
  return graph.edges.flatMap((edge) => {
    const views: GraphEdgeView[] = [];
    if (edge.fromId === entityId) views.push(edgeView(edge, 'outgoing', entities.get(edge.toId), asOf, references));
    if (edge.toId === entityId) views.push(edgeView(edge, 'incoming', entities.get(edge.fromId), asOf, references));
    return views;
  }).sort((left, right) => Number(right.active) - Number(left.active)
    || left.relation.localeCompare(right.relation, 'en')
    || left.counterpart.name.localeCompare(right.counterpart.name, 'ja')
    || left.id.localeCompare(right.id, 'en'));
}

function edgeView(
  edge: CanonicalEdge,
  direction: 'incoming' | 'outgoing',
  counterpart: CanonicalEntity | undefined,
  asOf: string,
  references: ReferenceIndex
): GraphEdgeView {
  if (!counterpart) throw new GraphWebError('unavailable', 'graph_unavailable', `Relation ${edge.id} points to a missing entity`);
  return {
    id: edge.id,
    relation: edge.relation,
    meaning: getCanonicalRelation(edge.relation).meaning,
    direction,
    fromId: edge.fromId,
    toId: edge.toId,
    role: edge.role ?? null,
    context: edge.context ?? null,
    validFrom: edge.validFrom ?? null,
    validTo: edge.validTo ?? null,
    active: isActiveAt(edge, asOf),
    provenance: {
      sourceKind: edge.provenance?.sourceKind ?? null,
      sourceId: edge.provenance?.sourceId ?? null,
      evidenceHash: edge.provenance?.evidenceHash ?? null,
      reference: resolveReference(edge, references)
    },
    counterpart: {
      id: counterpart.id,
      type: counterpart.type,
      name: counterpart.name,
      active: isActiveAt(counterpart, asOf),
      digest: graphRecordDigest(counterpart)
    },
    digest: graphRecordDigest(edge)
  };
}

function entityView(entity: CanonicalEntity, asOf: string): GraphEntityView {
  return {
    id: entity.id,
    type: entity.type,
    name: entity.name,
    aliases: entity.aliases ?? [],
    summary: entity.summary ?? null,
    tags: entity.tags ?? [],
    validFrom: entity.validFrom ?? null,
    validTo: entity.validTo ?? null,
    active: isActiveAt(entity, asOf),
    digest: graphRecordDigest(entity),
    ...(entity.type === 'project' ? { goal: metadataString(entity, 'goal'), status: metadataString(entity, 'status') } : {})
  };
}

function projectView(project: CanonicalEntity, asOf: string): GraphEntityView & { type: 'project'; goal: string | null; status: string | null } {
  return { ...entityView(project, asOf), type: 'project', goal: metadataString(project, 'goal'), status: metadataString(project, 'status') };
}

function historyFor(records: GraphCorrectionRecord[], ids: Set<string>): GraphCorrectionRecord[] {
  return records.filter((record) => ids.has(record.target.id)).reverse();
}

function matchRank(entity: CanonicalEntity, needle: string): number | undefined {
  if (!needle) return 3;
  if (normalize(entity.id) === needle) return 0;
  let best: number | undefined;
  for (const value of [entity.name, ...(entity.aliases ?? [])]) {
    const candidate = normalize(value);
    const rank = candidate === needle ? 0 : candidate.startsWith(needle) ? 1 : candidate.includes(needle) ? 2 : undefined;
    if (rank !== undefined && (best === undefined || rank < best)) best = rank;
  }
  return best;
}

function parseEntityType(value: string | undefined): CanonicalEntityKind | null {
  if (value === undefined || value === '') return null;
  if (!(ENTITY_KINDS as readonly string[]).includes(value)) {
    throw new GraphWebError('invalid', 'invalid_query', `type must be one of ${ENTITY_KINDS.join(', ')}`);
  }
  return value as CanonicalEntityKind;
}

function resolveAsOf(options: GraphWebReadOptions): string {
  if (options.asOf !== undefined && options.asOf !== '') return parseAsOf(options.asOf);
  return (options.now ?? new Date()).toISOString();
}

function parseAsOf(value: string): string {
  try {
    isActiveAt({}, value);
  } catch {
    throw new GraphWebError('invalid', 'invalid_query', 'as_of must be an RFC 3339 date-time such as 2026-09-30T00:00:00Z');
  }
  return value;
}

function entityIndex(graph: GraphFileV2): Map<string, CanonicalEntity> {
  return new Map(graph.entities.map((entity) => [entity.id, entity]));
}

function isEntityActive(entity: CanonicalEntity | undefined, asOf: string): boolean {
  return entity !== undefined && isActiveAt(entity, asOf);
}

function byActiveThenName(left: GraphEntityView, right: GraphEntityView): number {
  return Number(right.active) - Number(left.active) || left.name.localeCompare(right.name, 'ja') || left.id.localeCompare(right.id, 'en');
}

function byParticipation(left: GraphEdgeView, right: GraphEdgeView): number {
  const order = (edge: GraphEdgeView) => edge.relation === 'accountable_for' ? 0 : 1;
  return Number(right.active) - Number(left.active)
    || order(left) - order(right)
    || left.counterpart.name.localeCompare(right.counterpart.name, 'ja')
    || left.id.localeCompare(right.id, 'en');
}

function metadataString(entity: CanonicalEntity, key: string): string | null {
  const value = entity.metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function payloadLabel(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  for (const key of ['name', 'person', 'title', 'text']) {
    if (typeof payload[key] === 'string' && payload[key]) return payload[key] as string;
  }
  return null;
}

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value) ? value : JSON.stringify(value);
}
